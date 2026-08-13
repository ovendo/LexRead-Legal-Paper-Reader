import { callAiJson, getTextConfig } from "./ai-provider.mjs";

const MAX_CHUNK_CHARACTERS = 10_000;

function sourceLine(block) {
  return `[P${block.page}#${block.id}] ${block.text}`;
}

function splitOversizedSection(section) {
  const parts = [];
  let current = [];
  let characterCount = 0;
  for (const block of section.blocks) {
    const length = sourceLine(block).length + 1;
    if (current.length && characterCount + length > MAX_CHUNK_CHARACTERS) {
      parts.push({ ...section, part: parts.length + 1, blocks: current });
      current = [];
      characterCount = 0;
    }
    current.push(block);
    characterCount += length;
  }
  if (current.length) parts.push({ ...section, part: parts.length + 1, blocks: current });
  return parts;
}

function makeSections(document, blocks) {
  const blockIndex = new Map(blocks.map((block, index) => [block.id, index]));
  const boundaries = (document.outline ?? [])
    .filter((item) => Number(item.level) === 1)
    .map((item) => {
      const exactIndex = item.blockId ? blockIndex.get(item.blockId) : undefined;
      const index = exactIndex ?? blocks.findIndex((block) => block.page >= item.page);
      return index >= 0 ? { id: String(item.id || `heading-${item.page}`), index, title: String(item.title || `第 ${item.page} 页`) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index)
    .filter((item, index, items) => index === 0 || item.index !== items[index - 1].index);

  if (!boundaries.length || boundaries[0].index > 0) {
    boundaries.unshift({ id: "document-opening", index: 0, title: boundaries.length ? "标题前正文" : document.title || "正文" });
  }

  return boundaries.flatMap((boundary, index) => {
    const nextIndex = boundaries[index + 1]?.index ?? blocks.length;
    const sectionBlocks = blocks.slice(boundary.index, nextIndex);
    return sectionBlocks.length ? splitOversizedSection({ sectionId: boundary.id, title: boundary.title, blocks: sectionBlocks }) : [];
  });
}

export function buildAnalysisChunks(document) {
  const blocks = (document.blocks ?? [])
    .filter((block) => typeof block.text === "string" && block.text.trim())
    .sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
  if (!blocks.length) return [];

  return makeSections(document, blocks).map((section, index) => {
    const firstPage = section.blocks[0].page;
    const lastPage = section.blocks[section.blocks.length - 1].page;
    return {
      id: `section-part-${index + 1}`,
      sectionId: section.sectionId,
      part: section.part,
      title: section.title,
      startPage: firstPage,
      endPage: lastPage,
      characterCount: section.blocks.reduce((sum, block) => sum + sourceLine(block).length + 1, 0),
      blocks: section.blocks,
      sourceText: section.blocks.map(sourceLine).join("\n"),
    };
  });
}

export async function callKimiJson({ apiKey: _apiKey, baseUrl: _baseUrl, model: _model, systemPrompt, userPrompt, maxTokens = 8_000 }) {
  return callAiJson({ systemPrompt, userPrompt, maxTokens });
}

function normalizeMappedNodes(raw, chunk) {
  const validBlocks = new Map(chunk.blocks.map((block) => [block.id, block]));
  return (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 7).map((node, index) => ({
    candidateId: `${chunk.id}-node-${index + 1}`,
    title: String(node.title ?? `章节节点 ${index + 1}`).slice(0, 100),
    role: String(node.role ?? "论证展开").slice(0, 40),
    attribution: String(node.attribution ?? "作者观点").slice(0, 40),
    summary: String(node.summary ?? "").slice(0, 1600),
    reasons: Array.isArray(node.reasons) ? node.reasons.map(String).slice(0, 8) : [],
    sourceBlockIds: Array.isArray(node.sourceBlockIds)
      ? node.sourceBlockIds.filter((id) => typeof id === "string" && validBlocks.has(id)).slice(0, 16)
      : [],
    confidence: Math.max(0, Math.min(100, Number(node.confidence ?? 70))),
  })).filter((node) => node.summary || node.sourceBlockIds.length);
}

function strings(value, limit = 12) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit) : [];
}

function normalizeParagraphAnalyses(raw, chunk) {
  // 逐段阅读已从产品流程移除：不再持久化或返回每段 AI 分析，避免无意义的耗时与输出。
  if (raw && chunk) return [];
  const returned = new Map((Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
    .filter((item) => typeof item?.blockId === "string")
    .map((item) => [item.blockId, item]));
  const paragraphBlocks = chunk.blocks.filter((block) => block.blockType === "paragraph" && block.text.trim());
  return paragraphBlocks.map((block, index) => {
    const item = returned.get(block.id) ?? {};
    const missing = !returned.has(block.id);
    return {
      id: `${chunk.id}-paragraph-${index + 1}`,
      blockId: block.id,
      page: block.page,
      title: `第 ${block.page} 页 · 第 ${index + 1} 段`,
      legalQuestion: String(item.legalQuestion ?? (missing ? "该段的具体法学问题意识待模型补充" : "")).slice(0, 1000),
      summary: String(item.summary ?? (missing ? block.text.slice(0, 500) : "")).slice(0, 1400),
      analysisApproach: String(item.analysisApproach ?? "").slice(0, 1400),
      framework: strings(item.framework, 10),
      confidence: Math.max(0, Math.min(100, Number(item.confidence ?? (missing ? 35 : 72)))),
      missing,
      sourceAnchor: { blockId: block.id, page: block.page, text: block.text, bbox: block.bbox },
    };
  });
}

function normalizeChunkReading(raw, chunk, paragraphs) {
  const item = raw.sectionAnalysis ?? {};
  const validBlockIds = new Set(chunk.blocks.map((block) => block.id));
  const requestedIds = strings(item.sourceBlockIds, 30).filter((id) => validBlockIds.has(id));
  const sourceIds = requestedIds.length ? requestedIds : chunk.blocks.filter((block) => block.blockType === "paragraph").map((block) => block.id).slice(0, 20);
  return {
    legalQuestion: String(item.legalQuestion ?? "").slice(0, 1600),
    summary: String(item.summary ?? raw.sectionSummary ?? "").slice(0, 2200),
    analysisApproach: String(item.analysisApproach ?? "").slice(0, 1800),
    framework: strings(item.framework, 14),
    sourceBlockIds: sourceIds,
  };
}

function normalizeFinalAnalysis(raw, document, mappedSections, usage) {
  const blockMap = new Map((document.blocks ?? []).map((block) => [block.id, block]));
  const candidates = mappedSections.flatMap((section) => section.nodes);
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  let rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (!rawNodes.length) rawNodes = candidates.slice(0, 12).map((candidate) => ({ ...candidate, candidateIds: [candidate.candidateId] }));

  const nodes = rawNodes.slice(0, 16).map((node, index) => {
    const inherited = Array.isArray(node.candidateIds)
      ? node.candidateIds.map((id) => candidateMap.get(id)).filter(Boolean)
      : [];
    const sourceIds = [...new Set([
      ...inherited.flatMap((candidate) => candidate.sourceBlockIds),
      ...(Array.isArray(node.sourceBlockIds) ? node.sourceBlockIds : []),
    ])].filter((id) => typeof id === "string" && blockMap.has(id)).slice(0, 20);
    const anchors = sourceIds.map((id) => {
      const block = blockMap.get(id);
      return { blockId: id, page: block.page, text: block.text, bbox: block.bbox };
    });
    return {
      id: `ai-node-${index + 1}`,
      order: index + 1,
      title: String(node.title ?? inherited[0]?.title ?? `分析节点 ${index + 1}`).slice(0, 80),
      role: String(node.role ?? inherited[0]?.role ?? "论证展开").slice(0, 40),
      attribution: String(node.attribution ?? inherited[0]?.attribution ?? "作者观点").slice(0, 40),
      summary: String(node.summary ?? inherited.map((item) => item.summary).join("；") ?? "").slice(0, 1800),
      reasons: Array.isArray(node.reasons) ? node.reasons.map(String).slice(0, 8) : inherited.flatMap((item) => item.reasons).slice(0, 8),
      confidence: Math.max(0, Math.min(100, Number(node.confidence ?? inherited[0]?.confidence ?? (anchors.length ? 78 : 45)))),
      sourceType: anchors.length ? "ai_summary" : "ai_inference",
      sourceAnchors: anchors,
      userStatus: "unread",
      userEdited: false,
    };
  });

  const citedBlockCount = new Set(nodes.flatMap((node) => node.sourceAnchors.map((anchor) => anchor.blockId))).size;
  const totalCharacters = (document.blocks ?? []).reduce((sum, block) => sum + String(block.text ?? "").length, 0);
  const analyzedCharacters = mappedSections.reduce((sum, section) => sum + section.characterCount, 0);
  const rawSectionAnalyses = new Map((Array.isArray(raw.sectionAnalyses) ? raw.sectionAnalyses : [])
    .filter((item) => typeof item?.sectionId === "string")
    .map((item) => [item.sectionId, item]));
  const sectionGroups = new Map();
  for (const section of mappedSections) {
    if (!sectionGroups.has(section.sectionId)) sectionGroups.set(section.sectionId, []);
    sectionGroups.get(section.sectionId).push(section);
  }
  const sections = [...sectionGroups.entries()].map(([sectionId, parts], index) => {
    const synthesized = rawSectionAnalyses.get(sectionId) ?? {};
    const paragraphs = [];
    const sourceAnchors = [...new Set(parts.flatMap((part) => part.reading.sourceBlockIds))].map((blockId) => blockMap.get(blockId)).filter(Boolean).map((block) => ({ blockId: block.id, page: block.page, text: block.text, bbox: block.bbox }));
    return {
      id: sectionId,
      order: index + 1,
      title: String(synthesized.title ?? parts[0]?.title ?? `一级标题 ${index + 1}`).slice(0, 180),
      legalQuestion: String(synthesized.legalQuestion ?? parts.map((part) => part.reading.legalQuestion).filter(Boolean).join("；")).slice(0, 2000),
      summary: String(synthesized.summary ?? parts.map((part) => part.reading.summary).filter(Boolean).join("；")).slice(0, 2600),
      analysisApproach: String(synthesized.analysisApproach ?? parts.map((part) => part.reading.analysisApproach).filter(Boolean).join("；")).slice(0, 2200),
      framework: strings(synthesized.framework, 16).length
        ? strings(synthesized.framework, 16)
        : [...new Set(parts.flatMap((part) => part.reading.framework))].slice(0, 16),
      confidence: Math.max(0, Math.min(100, Number(synthesized.confidence ?? 76))),
      sourceAnchors: sourceAnchors.slice(0, 80),
      paragraphs,
    };
  });
  const documentReading = raw.documentAnalysis ?? {};
  const requestedDocumentBlocks = strings(documentReading.sourceBlockIds, 40).filter((id) => blockMap.has(id));
  const documentSourceIds = requestedDocumentBlocks.length
    ? requestedDocumentBlocks
    : sections.flatMap((section) => section.sourceAnchors.slice(0, 2).map((anchor) => anchor.blockId));

  const generatedCharacters = nodes.reduce((sum, node) => sum + node.title.length + node.summary.length + node.reasons.join("").length, 0)
    + sections.reduce((sum, section) => sum + section.title.length + section.legalQuestion.length + section.summary.length + section.analysisApproach.length + section.framework.join("").length, 0)
    + (documentReading.legalQuestion?.length || 0)
    + (documentReading.summary?.length || 0)
    + (documentReading.analysisApproach?.length || 0)
    + documentReading.framework.join("").length
    + (raw.documentSummary?.surfaceTopic?.length || 0)
    + (raw.documentSummary?.coreQuestion?.length || 0)
    + (raw.documentSummary?.coreConclusion?.length || 0)
    + (raw.documentSummary?.boundary?.length || 0);

  const readingGuide = {
    document: {
      id: "document",
      title: document.title || "全文",
      legalQuestion: String(documentReading.legalQuestion ?? raw.documentSummary?.coreQuestion ?? "").slice(0, 2400),
      summary: String(documentReading.summary ?? raw.documentSummary?.coreConclusion ?? "").slice(0, 3200),
      analysisApproach: String(documentReading.analysisApproach ?? "").slice(0, 2600),
      framework: strings(documentReading.framework, 20),
      confidence: Math.max(0, Math.min(100, Number(documentReading.confidence ?? 78))),
      sourceAnchors: [...new Set(documentSourceIds)].map((id) => blockMap.get(id)).filter(Boolean).map((block) => ({
        blockId: block.id, page: block.page, text: block.text, bbox: block.bbox,
      })).slice(0, 40),
    },
    sections,
  };
  return {
    model: getTextConfig().model,
    generationMode: "light",
    modelVersion: new Date().toISOString(),
    pipelineVersion: "paper-legal-reading-v2",
    sourceCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
    citationBlockCount: citedBlockCount,
    documentSummary: {
      surfaceTopic: String(raw.documentSummary?.surfaceTopic ?? ""),
      coreQuestion: String(raw.documentSummary?.coreQuestion ?? ""),
      coreConclusion: String(raw.documentSummary?.coreConclusion ?? ""),
      paradigm: String(raw.documentSummary?.paradigm ?? "待确认"),
      boundary: String(raw.documentSummary?.boundary ?? ""),
    },
    readingGuide,
    nodes,
    warnings: [...new Set([
      ...mappedSections.flatMap((section) => section.warnings),
      ...(Array.isArray(raw.warnings) ? raw.warnings.map(String) : []),
    ])].slice(0, 30),
    pipeline: {
      totalSections: mappedSections.length,
      analyzedSections: mappedSections.length,
      sourceCharacterCount: totalCharacters,
      analyzedCharacterCount: analyzedCharacters,
      textCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
      generatedCharacters,
    },
    generatedCharacters,
    usage,
    generatedAt: new Date().toISOString(),
  };
}

const MAP_SYSTEM_PROMPT = `你是 LexRead 的法学论文分段分析器。你只分析当前提供的连续原文章节，并提炼它在全文论证中承担的功能。
硬约束：
1. 每个判断必须引用输入中真实存在的 block_id，不得虚构页码或来源。
2. 严格区分作者观点、他人观点、法院观点和 AI 推断。
3. 忽略页眉、页脚和纯目录噪声；找不到依据时明确说明，不要补全。
4. “问题意识”必须是法学问题意识：优先识别规范与事实的张力、权利义务配置、概念或要件解释、裁判分歧、证明责任、程序保障、制度正当性、法律效果或救济路径；不得只把段落主题改写成一般疑问句。
5. 对当前一级标题范围输出：问题意识、概括、分析思路、框架。
6. 按原文顺序另输出 1-6 个有实质作用的论证节点。
7. 只返回 JSON，不使用 Markdown 代码围栏。

JSON 结构：
{
  "sectionSummary": "本段在全文中的作用",
  "sectionAnalysis": {
    "legalQuestion": "本一级标题范围内的法学问题意识",
    "summary": "内容概括",
    "analysisApproach": "作者如何把法律问题拆解、比较、解释或论证",
    "framework": ["分析框架步骤"],
    "sourceBlockIds": ["本范围内真实存在的编号"]
  },
  "nodes": [{
    "title": "节点标题",
    "role": "问题提出/概念界定/学说梳理/理由/反对/回应/限定/核心结论",
    "attribution": "作者观点/他人观点/法院观点/AI推断",
    "summary": "节点内容及推理功能",
    "reasons": ["主要理由"],
    "sourceBlockIds": ["输入中真实存在的编号"],
    "confidence": 0
  }],
  "warnings": ["需要人工核验的事项"]
}`;

const REDUCE_SYSTEM_PROMPT = `你是 LexRead 的法学论文总论证编辑器。输入不是原文，而是已经逐段核验、带候选编号的章节节点。请重建全文主论证路线。
硬约束：
1. 论证节点只能使用输入中存在的 candidateId；阅读结构只能使用输入中出现过的 sectionId 和 sourceBlockIds，不得虚构 block_id 或页码。
2. 合并重复节点，保留关键反对意见、作者回应、适用边界与核心结论。
3. 严格区分作者观点、他人观点、法院观点和 AI 推断。
4. 全文与每个一级标题都必须输出法学问题意识、概括、分析思路和框架。
5. 法学问题意识必须落到规范解释、权利义务、法律要件、裁判分歧、程序保障、证明责任、制度正当性、法律效果或救济等法律关系，不得停留在一般主题概括。
6. sectionAnalyses 必须逐一覆盖输入中所有 sectionId，不得遗漏。
7. 输出 5-12 个主要节点，按全文推理顺序排列；短文可少于 5 个。
8. 只返回 JSON，不使用 Markdown 代码围栏。

JSON 结构：
{
  "documentSummary": {
    "surfaceTopic": "文章主题",
    "coreQuestion": "核心法律问题",
    "coreConclusion": "作者明确主张；无明确结论则写文中未明确说明",
    "paradigm": "教义学/立法论/实证/比较法/法律史/法哲学/其他",
    "boundary": "适用条件、例外或未解决问题"
  },
  "documentAnalysis": {
    "legalQuestion": "全文的法学问题意识",
    "summary": "全文概括",
    "analysisApproach": "全文分析思路",
    "framework": ["全文论证框架"],
    "sourceBlockIds": ["输入中出现过的真实 blockId"],
    "confidence": 0
  },
  "sectionAnalyses": [{
    "sectionId": "输入中真实存在的 sectionId",
    "title": "一级标题",
    "legalQuestion": "本一级标题的法学问题意识",
    "summary": "本一级标题概括",
    "analysisApproach": "本一级标题分析思路",
    "framework": ["本一级标题论证框架"],
    "confidence": 0
  }],
  "nodes": [{
    "candidateIds": ["输入中真实存在的 candidateId"],
    "title": "合并后的节点标题",
    "role": "节点功能",
    "attribution": "观点归属",
    "summary": "节点在全文中的内容和功能",
    "reasons": ["主要理由"],
    "confidence": 0
  }],
  "warnings": ["全文层面的待核验事项"]
}`;

const ANALYSIS_CONCURRENCY = 6;
const FULL_ANALYSIS_MAX_CHARS = 80_000;

const FULL_ANALYSIS_PROMPT = `你是 LexRead 的法学论文全文分析器。一次性阅读整篇论文，输出全文阅读辅助结构。
硬约束：
1. 每个判断必须引用输入中真实存在的 block_id（格式 [P页码#block_id] 中的 # 后部分），不得虚构页码或来源。
2. 严格区分作者观点、他人观点、法院观点和 AI 推断。
3. 忽略页眉、页脚和纯目录噪声；找不到依据时明确说明，不要补全。
4. 法学问题意识必须落到规范解释、权利义务、法律要件、裁判分歧、程序保障、证明责任、制度正当性、法律效果或救济等法律关系。
5. sectionAnalyses 必须覆盖论文主要一级标题范围；如果没有明确一级标题，按论文自然结构划分 3-8 个部分。
6. 输出 5-12 个主要论证节点，按全文推理顺序排列；短文可少于 5 个。
7. 只返回 JSON，不使用 Markdown 代码围栏。

JSON 结构：
{
  "documentSummary": {
    "surfaceTopic": "文章主题",
    "coreQuestion": "核心法律问题",
    "coreConclusion": "作者明确主张；无明确结论则写文中未明确说明",
    "paradigm": "教义学/立法论/实证/比较法/法律史/法哲学/其他",
    "boundary": "适用条件、例外或未解决问题"
  },
  "documentAnalysis": {
    "legalQuestion": "全文的法学问题意识",
    "summary": "全文概括",
    "analysisApproach": "全文分析思路",
    "framework": ["全文论证框架"],
    "sourceBlockIds": ["输入中出现过的真实 blockId"],
    "confidence": 0
  },
  "sectionAnalyses": [{
    "sectionId": "sec-1",
    "title": "一级标题或结构段名称",
    "legalQuestion": "本段的法学问题意识",
    "summary": "本段概括",
    "analysisApproach": "本段分析思路",
    "framework": ["本段论证框架"],
    "sourceBlockIds": ["本段真实 blockId"],
    "confidence": 0
  }],
  "nodes": [{
    "title": "节点标题",
    "role": "问题提出/概念界定/学说梳理/理由/反对/回应/限定/核心结论",
    "attribution": "作者观点/他人观点/法院观点/AI推断",
    "summary": "节点内容及推理功能",
    "reasons": ["主要理由"],
    "sourceBlockIds": ["输入中真实存在的 blockId"],
    "confidence": 0
  }],
  "warnings": ["全文层面的待核验事项"]
}`;

function buildFullSourceText(document) {
  const blocks = (document.blocks ?? [])
    .filter((block) => typeof block.text === "string" && block.text.trim())
    .sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
  return blocks.map((block) => `[P${block.page}#${block.id}] ${block.text}`).join("\n");
}

function normalizeFullTextAnalysis(raw, document, sourceText) {
  const blockMap = new Map((document.blocks ?? []).map((block) => [block.id, block]));
  const validBlockIds = new Set(document.blocks?.map((block) => block.id) ?? []);

  const sections = (Array.isArray(raw.sectionAnalyses) ? raw.sectionAnalyses : []).slice(0, 24).map((section, index) => {
    const sourceBlockIds = strings(section.sourceBlockIds, 30).filter((id) => validBlockIds.has(id));
    const sourceAnchors = sourceBlockIds.map((id) => {
      const block = blockMap.get(id);
      return { blockId: id, page: block.page, text: block.text, bbox: block.bbox };
    });
    return {
      id: String(section.sectionId || `section-${index + 1}`),
      order: index + 1,
      title: String(section.title || `一级标题 ${index + 1}`).slice(0, 180),
      legalQuestion: String(section.legalQuestion ?? "").slice(0, 2000),
      summary: String(section.summary ?? "").slice(0, 2600),
      analysisApproach: String(section.analysisApproach ?? "").slice(0, 2200),
      framework: strings(section.framework, 16),
      confidence: Math.max(0, Math.min(100, Number(section.confidence ?? 76))),
      sourceAnchors: sourceAnchors.slice(0, 80),
      paragraphs: sourceAnchors.slice(0, 40).map((anchor, paragraphIndex) => ({
        id: `full-paragraph-${index + 1}-${paragraphIndex + 1}`,
        blockId: anchor.blockId,
        page: anchor.page,
        title: `第 ${anchor.page} 页 · 依据 ${paragraphIndex + 1}`,
        legalQuestion: "",
        summary: String(anchor.text ?? "").slice(0, 1400),
        analysisApproach: "",
        framework: [],
        confidence: 70,
        missing: false,
        sourceAnchor: anchor,
      })),
    };
  });

  if (!sections.length) {
    const firstBlocks = (document.blocks ?? []).filter((block) => typeof block.text === "string" && block.text.trim()).slice(0, 20);
    sections.push({
      id: "section-1",
      order: 1,
      title: document.title || "正文",
      legalQuestion: String(documentReading.legalQuestion ?? "").slice(0, 2000),
      summary: String(documentReading.summary ?? "").slice(0, 2600),
      analysisApproach: String(documentReading.analysisApproach ?? "").slice(0, 2200),
      framework: strings(documentReading.framework, 16),
      confidence: Math.max(0, Math.min(100, Number(documentReading.confidence ?? 78))),
      sourceAnchors: firstBlocks.map((block) => ({ blockId: block.id, page: block.page, text: block.text, bbox: block.bbox })),
      paragraphs: firstBlocks.slice(0, 10).map((block, index) => ({
        id: `full-paragraph-1-${index + 1}`,
        blockId: block.id,
        page: block.page,
        title: `第 ${block.page} 页 · 依据 ${index + 1}`,
        legalQuestion: "",
        summary: String(block.text ?? "").slice(0, 1400),
        analysisApproach: "",
        framework: [],
        confidence: 70,
        missing: false,
        sourceAnchor: { blockId: block.id, page: block.page, text: block.text, bbox: block.bbox },
      })),
    });
  }

  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 16).map((node, index) => {
    const sourceBlockIds = strings(node.sourceBlockIds, 20).filter((id) => validBlockIds.has(id));
    const anchors = sourceBlockIds.map((id) => {
      const block = blockMap.get(id);
      return { blockId: id, page: block.page, text: block.text, bbox: block.bbox };
    });
    return {
      id: `ai-node-${index + 1}`,
      order: index + 1,
      title: String(node.title || `分析节点 ${index + 1}`).slice(0, 80),
      role: String(node.role || "论证展开").slice(0, 40),
      attribution: String(node.attribution || "作者观点").slice(0, 40),
      summary: String(node.summary ?? "").slice(0, 1800),
      reasons: Array.isArray(node.reasons) ? node.reasons.map(String).slice(0, 8) : [],
      confidence: Math.max(0, Math.min(100, Number(node.confidence ?? (anchors.length ? 78 : 45)))),
      sourceType: anchors.length ? "ai_summary" : "ai_inference",
      sourceAnchors: anchors,
      userStatus: "unread",
      userEdited: false,
    };
  });

  if (!nodes.length && sections.length) {
    sections.slice(0, 12).forEach((section, index) => {
      nodes.push({
        id: `ai-node-${index + 1}`,
        order: index + 1,
        title: section.title,
        role: "论证展开",
        attribution: "作者观点",
        summary: section.summary.slice(0, 1800),
        reasons: section.framework.slice(0, 8),
        confidence: section.confidence,
        sourceType: section.sourceAnchors.length ? "ai_summary" : "ai_inference",
        sourceAnchors: section.sourceAnchors.slice(0, 20),
        userStatus: "unread",
        userEdited: false,
      });
    });
  }

  const documentReading = raw.documentAnalysis ?? {};
  const requestedDocumentBlocks = strings(documentReading.sourceBlockIds, 40).filter((id) => validBlockIds.has(id));
  const documentSourceIds = requestedDocumentBlocks.length
    ? requestedDocumentBlocks
    : sections.flatMap((section) => section.sourceAnchors.slice(0, 2).map((anchor) => anchor.blockId));
  const documentSourceAnchors = [...new Set(documentSourceIds)].map((id) => blockMap.get(id)).filter(Boolean).map((block) => ({
    blockId: block.id, page: block.page, text: block.text, bbox: block.bbox,
  })).slice(0, 40);

  const readingGuide = {
    document: {
      id: "document",
      title: document.title || "全文",
      legalQuestion: String(documentReading.legalQuestion ?? raw.documentSummary?.coreQuestion ?? "").slice(0, 2400),
      summary: String(documentReading.summary ?? raw.documentSummary?.coreConclusion ?? "").slice(0, 3200),
      analysisApproach: String(documentReading.analysisApproach ?? "").slice(0, 2600),
      framework: strings(documentReading.framework, 20),
      confidence: Math.max(0, Math.min(100, Number(documentReading.confidence ?? 78))),
      sourceAnchors: documentSourceAnchors,
    },
    sections,
  };

  const totalCharacters = (document.blocks ?? []).reduce((sum, block) => sum + String(block.text ?? "").length, 0);
  const analyzedCharacters = sourceText.length;
  const generatedCharacters = nodes.reduce((sum, node) => sum + node.title.length + node.summary.length + node.reasons.join("").length, 0)
    + sections.reduce((sum, section) => sum + section.title.length + section.legalQuestion.length + section.summary.length + section.analysisApproach.length + section.framework.join("").length, 0)
    + readingGuide.document.legalQuestion.length
    + readingGuide.document.summary.length
    + readingGuide.document.analysisApproach.length
    + readingGuide.document.framework.join("").length
    + (raw.documentSummary?.surfaceTopic?.length || 0)
    + (raw.documentSummary?.coreQuestion?.length || 0)
    + (raw.documentSummary?.coreConclusion?.length || 0)
    + (raw.documentSummary?.boundary?.length || 0);

  return {
    model: getTextConfig().model,
    generationMode: "light",
    modelVersion: new Date().toISOString(),
    pipelineVersion: "paper-full-text-v1",
    sourceCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
    citationBlockCount: new Set(nodes.flatMap((node) => node.sourceAnchors.map((anchor) => anchor.blockId))).size,
    documentSummary: {
      surfaceTopic: String(raw.documentSummary?.surfaceTopic ?? ""),
      coreQuestion: String(raw.documentSummary?.coreQuestion ?? ""),
      coreConclusion: String(raw.documentSummary?.coreConclusion ?? ""),
      paradigm: String(raw.documentSummary?.paradigm ?? "待确认"),
      boundary: String(raw.documentSummary?.boundary ?? ""),
    },
    readingGuide,
    nodes,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 30) : [],
    pipeline: {
      totalSections: sections.length,
      analyzedSections: sections.length,
      sourceCharacterCount: totalCharacters,
      analyzedCharacterCount: analyzedCharacters,
      textCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
      generatedCharacters,
    },
    generatedCharacters,
    usage: { requests: 1, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    generatedAt: new Date().toISOString(),
  };
}

async function analyzePaperFullText(document, researchQuestion, options) {
  await options.onProgress?.({ stage: "analyzing_full_text", value: 15, completedSections: 1, totalSections: 1, generatedCharacters: 0 });
  const sourceText = buildFullSourceText(document);
  const { data, usage } = await callKimiJson({
    systemPrompt: FULL_ANALYSIS_PROMPT,
    userPrompt: `用户研究问题：${researchQuestion || "未提供，按文档自身问题意识分析"}\n\n带稳定原文锚点的全文：\n${sourceText}`,
    maxTokens: 12_000,
  });
  const analysis = normalizeFullTextAnalysis(data, document, sourceText);
  if (usage) {
    analysis.usage.prompt_tokens = Number(usage.prompt_tokens ?? 0);
    analysis.usage.completion_tokens = Number(usage.completion_tokens ?? 0);
    analysis.usage.total_tokens = Number(usage.total_tokens ?? 0);
  }
  await options.onProgress?.({ stage: "analysis_ready", value: 100, completedSections: 1, totalSections: 1, generatedCharacters: analysis.generatedCharacters });
  return analysis;
}

export async function analyzePaperWithKimi(document, researchQuestion = "", options = {}) {
  const config = getTextConfig();
  if (!config.apiKey) {
    const label = config.provider === "zhipu" ? "智谱" : "Kimi";
    const error = new Error(`${label} API 尚未配置。请点击页面顶栏的设置完成配置。`);
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  const chunks = buildAnalysisChunks(document);
  if (!chunks.length) throw new Error("文档没有可供分析的文字块，请先完成 OCR 或文本校对。");

  const totalSourceChars = chunks.reduce((sum, chunk) => sum + chunk.sourceText.length, 0);
  if (totalSourceChars <= FULL_ANALYSIS_MAX_CHARS) {
    return analyzePaperFullText(document, researchQuestion, options);
  }

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
  const mappedSections = [];
  let generatedCharacters = 0;

  function countSectionCharacters(section) {
    return section.sectionSummary.length
      + section.nodes.reduce((sum, node) => sum + node.title.length + node.summary.length + node.reasons.join("").length, 0)
      + section.paragraphs.reduce((sum, paragraph) => sum
        + paragraph.legalQuestion.length
        + paragraph.summary.length
        + paragraph.analysisApproach.length
        + paragraph.framework.join("").length, 0)
      + (section.reading?.summary?.length ?? 0)
      + (section.reading?.legalQuestion?.length ?? 0)
      + (section.reading?.analysisApproach?.length ?? 0)
      + section.reading.framework.join("").length;
  }

  for (let batchStart = 0; batchStart < chunks.length; batchStart += ANALYSIS_CONCURRENCY) {
    const batch = chunks.slice(batchStart, batchStart + ANALYSIS_CONCURRENCY);
    const batchIndex = Math.floor(batchStart / ANALYSIS_CONCURRENCY) + 1;
    const batchCount = Math.ceil(chunks.length / ANALYSIS_CONCURRENCY);
    await options.onProgress?.({
      stage: "analyzing_sections",
      value: 10 + Math.round((batchStart / chunks.length) * 65),
      completedSections: mappedSections.length,
      totalSections: chunks.length,
      currentSection: batch[0]?.title,
      generatedCharacters,
    });

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const { data, usage: requestUsage } = await callKimiJson({
            systemPrompt: MAP_SYSTEM_PROMPT,
            userPrompt: `用户研究问题：${researchQuestion || "未提供，按文档自身问题意识分析"}\n当前范围：${chunk.title}（第 ${chunk.startPage}-${chunk.endPage} 页）\n\n带稳定原文锚点的文本：\n${chunk.sourceText}`,
          });
          return { chunk, ok: true, data, requestUsage };
        } catch (error) {
          return { chunk, ok: false, error };
        }
      }),
    );

    for (const batchResult of batchResults) {
      if (batchResult.ok) {
        const { chunk, data, requestUsage } = batchResult;
        usage.requests += 1;
        for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) usage[key] += Number(requestUsage?.[key] ?? 0);
        const section = {
          id: chunk.id,
          sectionId: chunk.sectionId,
          title: chunk.title,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          characterCount: chunk.characterCount,
          sectionSummary: String(data.sectionSummary ?? ""),
          nodes: normalizeMappedNodes(data, chunk),
          paragraphs: normalizeParagraphAnalyses(data, chunk),
          reading: null,
          warnings: Array.isArray(data.warnings) ? data.warnings.map(String).slice(0, 10) : [],
        };
        section.reading = normalizeChunkReading(data, chunk, section.paragraphs);
        generatedCharacters += countSectionCharacters(section);
        mappedSections.push(section);
      }
    }

    if (mappedSections.length < chunks.length) {
      await options.onProgress?.({
        stage: "analyzing_sections",
        value: 10 + Math.round((mappedSections.length / chunks.length) * 65),
        completedSections: mappedSections.length,
        totalSections: chunks.length,
        currentSection: batch[batch.length - 1]?.title,
        generatedCharacters,
        partialSections: mappedSections.map((s) => ({
          title: s.title,
          startPage: s.startPage,
          endPage: s.endPage,
          summary: s.sectionSummary,
          nodes: s.nodes.map((n) => ({ candidateId: n.candidateId, title: n.title, role: n.role, summary: n.summary, sourceBlockIds: n.sourceBlockIds, confidence: n.confidence })),
        })),
      });
    }
  }

  await options.onProgress?.({ stage: "synthesizing_argument", value: 82, completedSections: chunks.length, totalSections: chunks.length, generatedCharacters });
  const synthesisInput = mappedSections.map((section) => ({
    sectionId: section.sectionId,
    section: section.title,
    pages: [section.startPage, section.endPage],
    summary: section.sectionSummary,
    legalReading: section.reading,
    nodes: section.nodes,
  }));
  const { data: synthesis, usage: synthesisUsage } = await callKimiJson({
    systemPrompt: REDUCE_SYSTEM_PROMPT,
    userPrompt: `用户研究问题：${researchQuestion || "未提供，按文档自身问题意识分析"}\n\n逐段核验结果：\n${JSON.stringify(synthesisInput)}`,
    maxTokens: 10_000,
  });
  usage.requests += 1;
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) usage[key] += Number(synthesisUsage?.[key] ?? 0);
  await options.onProgress?.({ stage: "finalizing_anchors", value: 94, completedSections: chunks.length, totalSections: chunks.length });
  return normalizeFinalAnalysis(synthesis, document, mappedSections, usage);
}
