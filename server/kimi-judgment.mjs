import { buildAnalysisChunks, callKimiJson } from "./kimi.mjs";
import { getTextConfig } from "./ai-provider.mjs";

const JUDGMENT_CONCURRENCY = 6;
const FULL_ANALYSIS_MAX_CHARS = 80_000;

function buildFullSourceText(document) {
  const blocks = (document.blocks ?? [])
    .filter((block) => typeof block.text === "string" && block.text.trim())
    .sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
  return blocks.map((block) => `[P${block.page}#${block.id}] ${block.text}`).join("\n");
}

const FULL_JUDGMENT_PROMPT = `你是 LexRead 的裁判文书全文分析器。一次性阅读整篇裁判文书，输出全文裁判推理结构。
硬约束：
1. 每个事实、证据、法律和结论必须引用输入中真实存在的 block_id（格式 [P页码#block_id] 中的 # 后部分），不得虚构页码或来源。
2. 严格区分当事人主张、法院认定事实、证据认定、适用法律、法院说理和裁判结果。
3. 不得补写当事人、案号、法条、证据或裁判结果。
4. 无实质裁判信息的目录、页眉和页脚可以不输出节点。
5. 只返回 JSON，不使用 Markdown。

JSON 结构：
{
  "caseSummary": {
    "caseNumber": "案号",
    "court": "法院",
    "cause": "案由",
    "documentType": "文书类型",
    "procedure": "审级/程序",
    "decisionDate": "裁判日期",
    "result": "裁判结果摘要"
  },
  "issues": [{
    "title": "节点标题",
    "stage": "诉讼请求/答辩意见/无争议事实/争议焦点/证据认定/法律适用/法院说理/裁判结果",
    "claim": "当事人主张；没有则空字符串",
    "courtFact": "法院认定事实；没有则空字符串",
    "evidence": ["证据及其证明对象"],
    "laws": ["原文明示的法律规范"],
    "reasoning": "事实如何连接规范与结论",
    "conclusion": "本节点结论",
    "sourceBlockIds": ["输入中真实存在的 blockId"],
    "confidence": 0
  }],
  "warnings": ["全案待核验事项"]
}`;

function normalizeFullJudgment(raw, document, sourceText) {
  const blockMap = new Map((document.blocks ?? []).map((block) => [block.id, block]));
  const validBlockIds = new Set(document.blocks?.map((block) => block.id) ?? []);

  const issues = (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 18).map((issue, index) => {
    const sourceBlockIds = strings(issue.sourceBlockIds, 24).filter((id) => validBlockIds.has(id));
    const sourceAnchors = sourceBlockIds.map((id) => {
      const block = blockMap.get(id);
      return { blockId: id, page: block.page, text: block.text, bbox: block.bbox };
    });
    return {
      id: `ai-issue-${index + 1}`,
      order: index + 1,
      title: String(issue.title || `裁判节点 ${index + 1}`).slice(0, 100),
      stage: String(issue.stage || "法院说理").slice(0, 40),
      page: sourceAnchors[0]?.page ?? 1,
      status: "待读取",
      claim: String(issue.claim ?? "").slice(0, 1600),
      courtFact: String(issue.courtFact ?? "").slice(0, 2000),
      evidence: strings(issue.evidence),
      laws: strings(issue.laws),
      reasoning: String(issue.reasoning ?? "").slice(0, 2400),
      conclusion: String(issue.conclusion ?? "").slice(0, 1600),
      confidence: Math.max(0, Math.min(100, Number(issue.confidence ?? (sourceAnchors.length ? 78 : 45)))),
      sourceType: sourceAnchors.length ? "ai_summary" : "ai_inference",
      sourceAnchors,
      userEdited: false,
    };
  });

  const totalCharacters = (document.blocks ?? []).reduce((sum, block) => sum + String(block.text ?? "").length, 0);
  const analyzedCharacters = sourceText.length;
  const lastConclusion = [...issues].reverse().find((issue) => issue.conclusion)?.conclusion ?? "";
  const generatedCharacters = issues.reduce((sum, issue) => sum
    + issue.title.length
    + issue.claim.length
    + issue.courtFact.length
    + issue.evidence.join("").length
    + issue.laws.join("").length
    + issue.reasoning.length
    + issue.conclusion.length, 0)
    + (raw.caseSummary?.caseNumber?.length || 0)
    + (raw.caseSummary?.court?.length || 0)
    + (raw.caseSummary?.cause?.length || 0)
    + (raw.caseSummary?.result?.length || 0);

  return {
    analysisType: "judgment_reasoning",
    model: getTextConfig().model,
    modelVersion: new Date().toISOString(),
    pipelineVersion: "judgment-full-text-v1",
    sourceCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
    caseSummary: {
      caseNumber: String(raw.caseSummary?.caseNumber ?? ""),
      court: String(raw.caseSummary?.court ?? ""),
      cause: String(raw.caseSummary?.cause ?? ""),
      documentType: String(raw.caseSummary?.documentType ?? "裁判文书"),
      procedure: String(raw.caseSummary?.procedure ?? "待确认"),
      decisionDate: String(raw.caseSummary?.decisionDate ?? ""),
      result: String(raw.caseSummary?.result ?? lastConclusion),
    },
    documentSummary: {
      surfaceTopic: String(raw.caseSummary?.cause ?? document.title ?? ""),
      coreQuestion: issues.find((issue) => issue.stage.includes("争议") || issue.title.includes("争议"))?.claim ?? "",
      coreConclusion: String(raw.caseSummary?.result ?? lastConclusion),
      paradigm: "裁判推理",
      boundary: "裁判结论仅适用于本案事实与证据结构",
    },
    issues,
    warnings: [...new Set([
      ...strings(raw.warnings, 30),
    ])].slice(0, 30),
    pipeline: {
      totalSections: 1,
      analyzedSections: 1,
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

async function analyzeJudgmentFullText(document, researchQuestion, options) {
  await options.onProgress?.({ stage: "analyzing_full_text", value: 15, completedSections: 1, totalSections: 1, generatedCharacters: 0 });
  const sourceText = buildFullSourceText(document);
  const { data, usage } = await callKimiJson({
    systemPrompt: FULL_JUDGMENT_PROMPT,
    userPrompt: `用户研究问题：${researchQuestion || "未提供"}\n\n带稳定原文锚点的全文：\n${sourceText}`,
    maxTokens: 12_000,
  });
  const analysis = normalizeFullJudgment(data, document, sourceText);
  if (usage) {
    analysis.usage.prompt_tokens = Number(usage.prompt_tokens ?? 0);
    analysis.usage.completion_tokens = Number(usage.completion_tokens ?? 0);
    analysis.usage.total_tokens = Number(usage.total_tokens ?? 0);
  }
  await options.onProgress?.({ stage: "analysis_ready", value: 100, completedSections: 1, totalSections: 1, generatedCharacters: analysis.generatedCharacters });
  return analysis;
}

function strings(value, limit = 12) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit) : [];
}

function normalizeMappedIssues(raw, chunk) {
  const blockIds = new Set(chunk.blocks.map((block) => block.id));
  return (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 10).map((issue, index) => ({
    candidateId: `${chunk.id}-issue-${index + 1}`,
    title: String(issue.title ?? `裁判节点 ${index + 1}`).slice(0, 100),
    stage: String(issue.stage ?? "法院说理").slice(0, 40),
    claim: String(issue.claim ?? "").slice(0, 1600),
    courtFact: String(issue.courtFact ?? "").slice(0, 2000),
    evidence: strings(issue.evidence),
    laws: strings(issue.laws),
    reasoning: String(issue.reasoning ?? "").slice(0, 2400),
    conclusion: String(issue.conclusion ?? "").slice(0, 1600),
    sourceBlockIds: strings(issue.sourceBlockIds, 24).filter((id) => blockIds.has(id)),
    confidence: Math.max(0, Math.min(100, Number(issue.confidence ?? 70))),
  })).filter((issue) => issue.claim || issue.courtFact || issue.reasoning || issue.conclusion || issue.sourceBlockIds.length);
}

function preferText(value, inherited, key) {
  const direct = String(value ?? "").trim();
  if (direct) return direct;
  return inherited.map((item) => String(item[key] ?? "").trim()).find(Boolean) ?? "";
}

function normalizeFinalJudgment(raw, document, sections, usage) {
  const blockMap = new Map((document.blocks ?? []).map((block) => [block.id, block]));
  const candidates = sections.flatMap((section) => section.issues);
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  let sourceIssues = Array.isArray(raw.issues) ? raw.issues : [];
  if (!sourceIssues.length) sourceIssues = candidates.slice(0, 14).map((candidate) => ({ ...candidate, candidateIds: [candidate.candidateId] }));

  const issues = sourceIssues.slice(0, 18).map((issue, index) => {
    const inherited = strings(issue.candidateIds, 12).map((id) => candidateMap.get(id)).filter(Boolean);
    const sourceBlockIds = [...new Set([
      ...inherited.flatMap((item) => item.sourceBlockIds),
      ...strings(issue.sourceBlockIds, 24),
    ])].filter((id) => blockMap.has(id)).slice(0, 30);
    const sourceAnchors = sourceBlockIds.map((id) => {
      const block = blockMap.get(id);
      return { blockId: id, page: block.page, text: block.text, bbox: block.bbox };
    });
    return {
      id: `ai-issue-${index + 1}`,
      order: index + 1,
      title: preferText(issue.title, inherited, "title") || `裁判节点 ${index + 1}`,
      stage: preferText(issue.stage, inherited, "stage") || "法院说理",
      page: sourceAnchors[0]?.page ?? 1,
      status: "待读取",
      claim: preferText(issue.claim, inherited, "claim"),
      courtFact: preferText(issue.courtFact, inherited, "courtFact"),
      evidence: strings(issue.evidence).length ? strings(issue.evidence) : [...new Set(inherited.flatMap((item) => item.evidence))].slice(0, 16),
      laws: strings(issue.laws).length ? strings(issue.laws) : [...new Set(inherited.flatMap((item) => item.laws))].slice(0, 16),
      reasoning: preferText(issue.reasoning, inherited, "reasoning"),
      conclusion: preferText(issue.conclusion, inherited, "conclusion"),
      confidence: Math.max(0, Math.min(100, Number(issue.confidence ?? inherited[0]?.confidence ?? (sourceAnchors.length ? 78 : 45)))),
      sourceType: sourceAnchors.length ? "ai_summary" : "ai_inference",
      sourceAnchors,
      userEdited: false,
    };
  });

  const totalCharacters = (document.blocks ?? []).reduce((sum, block) => sum + String(block.text ?? "").length, 0);
  const analyzedCharacters = sections.reduce((sum, section) => sum + section.characterCount, 0);
  const lastConclusion = [...issues].reverse().find((issue) => issue.conclusion)?.conclusion ?? "";
  const generatedCharacters = issues.reduce((sum, issue) => sum
    + issue.title.length
    + issue.claim.length
    + issue.courtFact.length
    + issue.evidence.join("").length
    + issue.laws.join("").length
    + issue.reasoning.length
    + issue.conclusion.length, 0)
    + (raw.caseSummary?.caseNumber?.length || 0)
    + (raw.caseSummary?.court?.length || 0)
    + (raw.caseSummary?.cause?.length || 0)
    + (raw.caseSummary?.result?.length || 0);
  return {
    analysisType: "judgment_reasoning",
    model: getTextConfig().model,
    modelVersion: new Date().toISOString(),
    pipelineVersion: "judgment-map-reduce-v1",
    sourceCoverage: totalCharacters ? Math.min(1, analyzedCharacters / totalCharacters) : 0,
    caseSummary: {
      caseNumber: String(raw.caseSummary?.caseNumber ?? ""),
      court: String(raw.caseSummary?.court ?? ""),
      cause: String(raw.caseSummary?.cause ?? ""),
      documentType: String(raw.caseSummary?.documentType ?? "裁判文书"),
      procedure: String(raw.caseSummary?.procedure ?? "待确认"),
      decisionDate: String(raw.caseSummary?.decisionDate ?? ""),
      result: String(raw.caseSummary?.result ?? lastConclusion),
    },
    documentSummary: {
      surfaceTopic: String(raw.caseSummary?.cause ?? document.title ?? ""),
      coreQuestion: issues.find((issue) => issue.stage.includes("争议") || issue.title.includes("争议"))?.claim ?? "",
      coreConclusion: String(raw.caseSummary?.result ?? lastConclusion),
      paradigm: "裁判推理",
      boundary: "裁判结论仅适用于本案事实与证据结构",
    },
    issues,
    warnings: [...new Set([
      ...sections.flatMap((section) => section.warnings),
      ...strings(raw.warnings, 30),
    ])].slice(0, 30),
    pipeline: {
      totalSections: sections.length,
      analyzedSections: sections.length,
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

const MAP_PROMPT = `你是 LexRead 的裁判文书分段分析器。你只分析当前提供的连续原文，并忠实提取该段在裁判推理中的作用。
硬约束：
1. 每个事实、证据、法律和结论必须引用输入中真实存在的 block_id。
2. 严格区分当事人主张、法院认定事实和法院说理；不得把主张写成认定事实。
3. 不得补写当事人、案号、法条、证据或裁判结果。
4. 无实质裁判信息的目录、页眉和页脚可以不输出节点。
5. 只返回 JSON，不使用 Markdown。

JSON：
{"sectionSummary":"本段功能","issues":[{"title":"节点标题","stage":"诉讼请求/答辩意见/无争议事实/争议焦点/证据认定/法律适用/法院说理/裁判结果","claim":"当事人主张；没有则空字符串","courtFact":"法院认定事实；没有则空字符串","evidence":["证据及其证明对象"],"laws":["原文明示的法律规范"],"reasoning":"事实如何连接规范与结论","conclusion":"本节点结论","sourceBlockIds":["真实编号"],"confidence":0}],"warnings":["待人工核验事项"]}`;

const REDUCE_PROMPT = `你是 LexRead 的裁判推理总编辑器。输入是已经分段核验并带 candidateId 的裁判节点，请按法院实际推理顺序重建全案。
硬约束：
1. 只能使用输入中真实存在的 candidateId，不得生成 block_id 或页码。
2. 必须区分当事人主张、法院认定事实、证据认定、适用法律、法院说理和裁判结果。
3. 不得把模型推测写成法院结论；缺失信息写空字符串。
4. 合并重复节点，但保留不同争议焦点。
5. 只返回 JSON，不使用 Markdown。

JSON：
{"caseSummary":{"caseNumber":"案号","court":"法院","cause":"案由","documentType":"文书类型","procedure":"审级/程序","decisionDate":"裁判日期","result":"裁判结果摘要"},"issues":[{"candidateIds":["真实 candidateId"],"title":"节点标题","stage":"节点类型","claim":"当事人主张","courtFact":"法院认定事实","evidence":["关键证据"],"laws":["适用法律"],"reasoning":"法院说理链","conclusion":"节点结论","confidence":0}],"warnings":["全案待核验事项"]}`;

export async function analyzeJudgmentWithKimi(document, researchQuestion = "", options = {}) {
  const config = getTextConfig();
  if (!config.apiKey) throw new Error("AI API 尚未配置。请点击页面顶栏的设置完成配置。");
  const chunks = buildAnalysisChunks(document);
  if (!chunks.length) throw new Error("裁判文书没有可供分析的文字块，请先完成 OCR 或文本校对。");

  const totalSourceChars = chunks.reduce((sum, chunk) => sum + chunk.sourceText.length, 0);
  if (totalSourceChars <= FULL_ANALYSIS_MAX_CHARS) {
    return analyzeJudgmentFullText(document, researchQuestion, options);
  }

  const sections = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 };
  let generatedCharacters = 0;

  function countIssueCharacters(issue) {
    return issue.title.length
      + issue.claim.length
      + issue.courtFact.length
      + issue.reasoning.length
      + issue.conclusion.length
      + issue.evidence.join("").length
      + issue.laws.join("").length;
  }

  for (let batchStart = 0; batchStart < chunks.length; batchStart += JUDGMENT_CONCURRENCY) {
    const batch = chunks.slice(batchStart, batchStart + JUDGMENT_CONCURRENCY);
    await options.onProgress?.({
      stage: "analyzing_judgment_sections",
      value: 10 + Math.round((batchStart / chunks.length) * 65),
      completedSections: sections.length,
      totalSections: chunks.length,
      currentSection: batch[0]?.title,
      generatedCharacters,
    });

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const response = await callKimiJson({
            systemPrompt: MAP_PROMPT,
            userPrompt: `用户研究问题：${researchQuestion || "未提供"}\n当前范围：${chunk.title}（第 ${chunk.startPage}-${chunk.endPage} 页）\n\n带稳定原文锚点的裁判文本：\n${chunk.sourceText}`,
            maxTokens: 9_000,
          });
          return { chunk, ok: true, response };
        } catch (error) {
          return { chunk, ok: false, error };
        }
      }),
    );

    for (const batchResult of batchResults) {
      await options.onProgress?.({ stage: "analyzing_judgment_sections", value: 10 + Math.round(sections.length / chunks.length * 65), completedSections: sections.length, totalSections: chunks.length, currentSection: batchResult.chunk.title });

      if (batchResult.ok) {
        const { chunk, response } = batchResult;
        usage.requests += 1;
        for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) usage[key] += Number(response.usage?.[key] ?? 0);
        const sectionIssues = normalizeMappedIssues(response.data, chunk);
        const section = {
          id: chunk.id,
          title: chunk.title,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          characterCount: chunk.characterCount,
          summary: String(response.data.sectionSummary ?? ""),
          issues: sectionIssues,
          warnings: strings(response.data.warnings, 12),
        };
        generatedCharacters += section.summary.length + sectionIssues.reduce((sum, issue) => sum + countIssueCharacters(issue), 0);
        sections.push(section);
      }
    }
  }

  if (!sections.length) {
    throw new Error("裁判文书分段分析未返回有效结果，请检查 AI 配置后重试。");
  }

  await options.onProgress?.({ stage: "synthesizing_judgment", value: 82, completedSections: chunks.length, totalSections: chunks.length, generatedCharacters });
  const synthesisInput = sections.map((section) => ({ section: section.title, pages: [section.startPage, section.endPage], summary: section.summary, issues: section.issues }));
  const response = await callKimiJson({
    systemPrompt: REDUCE_PROMPT,
    userPrompt: `项目研究问题：${researchQuestion || "未提供"}\n\n逐段核验结果：\n${JSON.stringify(synthesisInput)}`,
    maxTokens: 12_000,
  });
  usage.requests += 1;
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) usage[key] += Number(response.usage?.[key] ?? 0);
  await options.onProgress?.({ stage: "finalizing_judgment_anchors", value: 94, completedSections: chunks.length, totalSections: chunks.length });
  return normalizeFinalJudgment(response.data, document, sections, usage);
}
