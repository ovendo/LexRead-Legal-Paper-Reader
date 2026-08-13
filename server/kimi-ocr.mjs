import { assessTextQuality } from "./pdf-parser.mjs";
import { callAiVision, callZhipuLayoutParsing, getOcrConfig } from "./ai-provider.mjs";

function normalizeBbox(value, page) {
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, page.width, page.height];
  let [rawX, rawY, rawWidth, rawHeight] = value.map((item) => Math.max(0, Math.min(1000, Number(item) || 0)));
  if (Math.max(rawX, rawY, rawWidth, rawHeight) <= 1) {
    const usesCornerCoordinates = rawWidth > rawX && rawHeight > rawY;
    if (usesCornerCoordinates) {
      rawWidth -= rawX;
      rawHeight -= rawY;
    }
    rawX *= 1000;
    rawY *= 1000;
    rawWidth *= 1000;
    rawHeight *= 1000;
  }
  const width = Math.max(0, Math.min(1000 - rawX, rawWidth));
  const height = Math.max(0, Math.min(1000 - rawY, rawHeight));
  return [
    Number((rawX / 1000 * page.width).toFixed(2)),
    Number(((1000 - rawY - height) / 1000 * page.height).toFixed(2)),
    Number((width / 1000 * page.width).toFixed(2)),
    Number((height / 1000 * page.height).toFixed(2)),
  ];
}

function normalizeBlockType(value) {
  return ["heading", "paragraph", "footnote", "page_number", "table", "caption", "header", "footer"].includes(value) ? value : "paragraph";
}

function normalizeFootnoteMarker(value) {
  return String(value ?? "").trim().replace(/^[（(\[]|[）)\]]$/g, "").slice(0, 20);
}

function inferredFootnoteMarker(text) {
  return normalizeFootnoteMarker(String(text ?? "").trim().match(/^(\*+|[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,3})/)?.[1]);
}

function normalizeFootnoteRefs(values, text) {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const marker = normalizeFootnoteMarker(value?.marker);
    const quote = String(value?.quote ?? "").replace(/\u0000/g, "").trim().slice(0, 120);
    if (!marker) return [];
    let startOffset = Number(value?.startOffset);
    let endOffset = Number(value?.endOffset);
    const offsetsValid = Number.isInteger(startOffset) && Number.isInteger(endOffset)
      && startOffset >= 0 && endOffset > startOffset && endOffset <= text.length
      && text.slice(startOffset, endOffset).includes(marker);
    if (!offsetsValid && quote) {
      const quoteStart = text.indexOf(quote);
      if (quoteStart >= 0) {
        const markerWithinQuote = quote.indexOf(marker);
        startOffset = quoteStart + Math.max(0, markerWithinQuote);
        endOffset = markerWithinQuote >= 0 ? startOffset + marker.length : quoteStart + quote.length;
      }
    }
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)
      || startOffset < 0 || endOffset <= startOffset || endOffset > text.length) return [];
    return [{ marker, quote, startOffset, endOffset }];
  }).slice(0, 40);
}

export function normalizeOcrResult(raw, page, model) {
  const items = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = items.slice(0, 180).map((item, index) => {
    const confidence = Math.max(0.2, Math.min(0.98, Number(item.confidence ?? 75) / 100));
    const blockType = normalizeBlockType(String(item.type ?? "paragraph"));
    const text = String(item.text ?? "").replace(/\u0000/g, "").trim().slice(0, 6000);
    return {
      id: `ocr-${page.page}-${index + 1}`,
      page: page.page,
      readingOrder: index + 1,
      blockType,
      text,
      bbox: normalizeBbox(item.bbox, page),
      fontSize: null,
      extractionMethod: "kimi_vision_ocr",
      confidence,
      model,
      footnoteMarker: blockType === "footnote"
        ? normalizeFootnoteMarker(item.footnoteMarker) || inferredFootnoteMarker(text) || null
        : null,
      footnoteRefs: blockType === "footnote" ? [] : normalizeFootnoteRefs(item.footnoteRefs, text),
    };
  }).filter((block) => block.text);

  const text = blocks.map((block) => block.text).join("\n");
  const quality = assessTextQuality(text);
  const characterCount = text.length;
  const pageType = ["text", "mixed", "blank"].includes(String(raw.pageType)) ? String(raw.pageType) : "text";
  const weightedConfidence = characterCount
    ? blocks.reduce((sum, block) => sum + block.confidence * block.text.length, 0) / characterCount
    : 0;
  const confirmedBlank = pageType === "blank" && blocks.length === 0 && Number(page.inkCoverage ?? 1) < 0.00015;
  const sparsePageConfidence = characterCount > 0 && characterCount < 25 && blocks.length > 0
    ? Math.min(0.9, weightedConfidence || 0.75)
    : null;
  const confidence = confirmedBlank
    ? 1
    : sparsePageConfidence ?? Math.min(quality.confidence, weightedConfidence || quality.confidence);

  return {
    blocks,
    confidence,
    characterCount,
    qualityIssue: confirmedBlank ? null : sparsePageConfidence ? "sparse_text_page" : quality.reason,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 20) : [],
    pageType,
    provider: "kimi",
  };
}

export async function ocrPageWithKimi({ dataUrl, page, outlineHints = [] }) {
  const config = getOcrConfig();
  if (!config.apiKey) {
    const label = config.provider === "zhipu" ? "智谱" : "Kimi";
    throw new Error(`${label} API 尚未配置。请点击页面顶栏的设置完成配置。`);
  }

  if (config.provider === "zhipu" && config.model === "glm-ocr") {
    const result = await callZhipuLayoutParsing({ dataUrl, pageNumber: page.page });
    return normalizeGlmOcrResult(result, page, config.model);
  }

  const systemPrompt = `你是法律文档 OCR 转写器。任务是忠实转写页面，不是总结、改写或补全。
硬约束：
1. 只输出图片中可见的文字，无法辨认处写〔无法辨认〕，禁止根据上下文猜测。
2. 保留标题、段落、表格与双栏阅读顺序；不要纠正原文措辞。
3. 脚注必须与正文彻底分离：每条脚注输出为 type="footnote" 的独立 block，保留原脚注编号；脚注 blocks 必须排列在本页所有正文 blocks 之后，禁止把脚注混入 paragraph。
4. 必须建立正文脚注标记与脚注内容的对应关系：
   - 正文 block 的 text 必须保留图片中可见的脚注标记（如 *、1、①）。
   - 正文 block 用 footnoteRefs 输出每个脚注标记，marker 与脚注编号完全一致；quote 必须是包含该标记的最短原文片段；startOffset/endOffset 是该标记在本 block text 中的字符区间。
   - footnote block 必须输出 footnoteMarker，且与正文 footnoteRefs.marker 完全一致。
   - 没有脚注引用的 block 输出 footnoteRefs: []，不得猜测不存在的对应关系。
5. bbox 使用图片左上角为原点的 0-1000 归一化坐标，格式为 [x,y,width,height]。
6. confidence 是 0-100 的识别把握度；不清楚的内容必须降低分数。
7. 只返回 JSON，不返回 Markdown 代码围栏。

JSON 结构：
{"pageType":"text|mixed|blank","blocks":[{"type":"heading|paragraph|footnote|page_number|table|caption|header|footer","text":"逐字转写内容","bbox":[0,0,1000,1000],"confidence":90,"footnoteMarker":"脚注块填写编号，其他块为null","footnoteRefs":[{"marker":"1","quote":"包含脚注标记的最短逐字原文","startOffset":12,"endOffset":13}]}],"warnings":["需要人工检查的事项"]}`;
  const hints = outlineHints.length ? `PDF 书签提示（仅帮助判断标题，不可作为图片中不存在的正文）：${outlineHints.join("；")}` : "本页没有书签提示。";
  const result = await callAiVision({
    dataUrl,
    systemPrompt,
    userPrompt: `这是法律研究文档第 ${page.page} 页。${hints} 请按视觉阅读顺序逐块转写，不要遗漏表格、脚注以及嵌入截图中清晰可辨的文字。`,
  });
  return {
    ...normalizeOcrResult(result.data, page, config.model),
    model: config.model,
    usage: result.usage,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeGlmOcrResult(result, page, model) {
  const mdHeadings = new Set();
  if (result.mdResults) {
    for (const line of result.mdResults.split("\n")) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);
      if (headingMatch) {
        const title = headingMatch[1].trim().replace(/\*{1,3}(.+?)\*{1,3}/g, "$1");
        if (title) mdHeadings.add(title);
      }
    }
  }

  function cleanText(text) {
    return text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*{1,3}(.+?)\*{1,3}/g, "$1")
      .replace(/^>\s+/gm, "")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
  }

  const blocks = result.blocks.map((item, index) => {
    const rawText = String(item.content ?? "").slice(0, 6000);
    const text = cleanText(rawText);
    if (!text) return null;
    const isTable = item.label === "table";
    const isHeading = !isTable && (
      mdHeadings.has(rawText.replace(/\*{1,3}(.+?)\*{1,3}/g, "$1").replace(/^#+\s*/, "").trim()) ||
      (text.length <= 80 && /^[^。，；：、,.;:]+$/.test(text) && !text.includes("\n"))
    );
    return {
      id: `ocr-${page.page}-${index + 1}`,
      page: page.page,
      readingOrder: item.index ?? index + 1,
      blockType: isTable ? "table" : isHeading ? "heading" : "paragraph",
      text,
      bbox: normalizeBbox(item.bbox, page),
      fontSize: null,
      extractionMethod: "glm_ocr",
      confidence: 0.92,
      model,
      footnoteMarker: null,
      footnoteRefs: [],
    };
  }).filter(Boolean);

  const text = blocks.map((block) => block.text).join("\n");
  const quality = assessTextQuality(text);
  const characterCount = text.length;

  return {
    blocks,
    confidence: characterCount ? Math.min(0.95, blocks.length ? 0.92 : 0) : 0,
    characterCount,
    qualityIssue: quality.reason,
    warnings: [],
    pageType: blocks.length ? "text" : "blank",
    provider: "zhipu_glm_ocr",
    model,
    usage: result.usage,
    generatedAt: new Date().toISOString(),
    mdResults: result.mdResults || "",
  };
}
