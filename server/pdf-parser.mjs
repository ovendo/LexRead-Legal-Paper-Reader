import { readFile } from "node:fs/promises";

let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

function median(values) {
  if (!values.length) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function normalizeText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function assessTextQuality(text, blocks = []) {
  if (text.length < 25) return { confidence: 0.2, reason: "too_little_text" };
  const replacementCount = (text.match(/[�\u0000]/g) ?? []).length;
  if (replacementCount / text.length > 0.01) return { confidence: 0.25, reason: "broken_character_map" };

  if (blocks.length >= 20) {
    const punctuationOnlyRatio = blocks.filter((block) => !/[\p{L}\p{N}]/u.test(block.text)).length / blocks.length;
    const tinyBlockRatio = blocks.filter((block) => [...block.text].length <= 3).length / blocks.length;
    if (punctuationOnlyRatio >= 0.3 || tinyBlockRatio >= 0.55) {
      return { confidence: 0.3, reason: "broken_reading_order_or_font_map" };
    }
  }

  const cjkCharacters = [...text].filter((character) => /[\u3400-\u9fff]/.test(character));
  if (cjkCharacters.length >= 40) {
    const frequencies = new Map();
    for (const character of cjkCharacters) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
    const diversity = frequencies.size / Math.min(cjkCharacters.length, 160);
    const dominantRatio = Math.max(...frequencies.values()) / cjkCharacters.length;
    if (diversity < 0.16 || dominantRatio > 0.22) return { confidence: 0.35, reason: "suspicious_glyph_repetition" };
    if (diversity < 0.24 || dominantRatio > 0.14) return { confidence: 0.72, reason: "text_layer_needs_review" };
  }

  return { confidence: 1, reason: null };
}

function headingLevel(text) {
  if (/^第[一二三四五六七八九十百]+[章节部分]/.test(text) || /^[一二三四五六七八九十]+、/.test(text)) return 1;
  if (/^[（(][一二三四五六七八九十]+[）)]/.test(text)) return 2;
  if (/^\d+\.\d+\.\d+/.test(text)) return 3;
  if (/^\d+\.\d+/.test(text)) return 2;
  return 1;
}

function semanticHeading(text, nextText = "") {
  const value = normalizeText(text).replace(/^\s*[①-⑳]\s*/, "");
  if (value.length < 2 || value.length > 80 || /[。！？；;]$/.test(value)) return null;
  if (/^(?:\d+|[①-⑳])\s*[、.．]/.test(value) && /(?:参见|载|出版社|页|号)$/.test(value)) return null;
  const fixed = /^(摘要|关键词|引言|导论|绪论|结语|结论|参考文献|附录|后记|Abstract|Keywords)$/i;
  const numbered = /^(第[一二三四五六七八九十百]+(?:章|节|部分)|[一二三四五六七八九十]+、|[（(][一二三四五六七八九十]+[）)]|\d+(?:\.\d+){0,3}[、.．\s])/;
  const substantive = /(?:问题的提出|理论基础|制度背景|规范分析|比较法|实证分析|案例分析|裁判|解释路径|制度完善|规则构造|研究方法|文献综述|核心概念|结论与建议|结论)$/;
  const followsBody = nextText.length >= 24 && !/^(?:\d+|[①-⑳])\s*[、.．]/.test(nextText);
  if (!fixed.test(value) && !numbered.test(value) && !(substantive.test(value) && followsBody)) return null;
  return { level: headingLevel(value), confidence: fixed.test(value) || numbered.test(value) ? 0.9 : 0.72 };
}

export function buildSemanticOutline(blocks) {
  const entries = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const nextText = blocks[index + 1]?.text ?? "";
    const result = semanticHeading(block.text, nextText);
    if (!result) continue;
    entries.push({
      id: `outline-semantic-${entries.length + 1}`,
      title: block.text,
      level: result.level,
      page: block.page,
      blockId: block.id,
      confidence: result.confidence,
      source: "automatic",
    });
    if (entries.length >= 160) break;
  }
  return entries;
}

function groupItemsIntoLines(items, pageNumber) {
  const usable = items
    .filter((item) => typeof item.str === "string" && normalizeText(item.str))
    .map((item) => ({
      text: normalizeText(item.str),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      width: Number(item.width ?? 0),
      height: Math.abs(Number(item.height ?? item.transform?.[0] ?? 10)),
      fontSize: Math.abs(Number(item.transform?.[0] ?? item.height ?? 10)),
    }));

  const rows = [];
  for (const item of usable.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, item.height * 0.28));
    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row, index) => {
      const rowItems = row.items.sort((a, b) => a.x - b.x);
      const text = normalizeText(rowItems.map((item) => item.text).join(" "));
      const x = Math.min(...rowItems.map((item) => item.x));
      const y = Math.min(...rowItems.map((item) => item.y));
      const maxX = Math.max(...rowItems.map((item) => item.x + item.width));
      const height = Math.max(...rowItems.map((item) => item.height));
      const fontSize = Math.max(...rowItems.map((item) => item.fontSize));
      return {
        id: `b-${pageNumber}-${index + 1}`,
        page: pageNumber,
        readingOrder: index + 1,
        // 标题由后续的语义结构识别决定，绝不以字号或加粗作为目录依据。
        blockType: "paragraph",
        text,
        bbox: [Number(x.toFixed(2)), Number(y.toFixed(2)), Number((maxX - x).toFixed(2)), Number(height.toFixed(2))],
        fontSize: Number(fontSize.toFixed(2)),
        extractionMethod: "pdf_text_layer",
        confidence: 1,
      };
    })
    .filter((block) => block.text.length > 0);
}

async function extractNativeOutline(pdf) {
  const root = await pdf.getOutline();
  if (!Array.isArray(root) || !root.length) return [];
  const entries = [];

  async function visit(items, level) {
    for (const item of items) {
      let page = 1;
      try {
        const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(destination) && destination[0]) page = (await pdf.getPageIndex(destination[0])) + 1;
      } catch { /* keep page one when a bookmark target cannot be resolved */ }
      const title = normalizeText(String(item.title ?? ""));
      if (title) entries.push({
        id: `outline-native-${entries.length + 1}`,
        title,
        level: Math.max(1, Math.min(4, level)),
        page,
        blockId: null,
        confidence: 1,
        source: "automatic",
      });
      if (Array.isArray(item.items) && item.items.length) await visit(item.items, level + 1);
      if (entries.length >= 300) return;
    }
  }

  await visit(root, 1);
  return entries;
}

export async function parsePdf(filePath) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await readFile(filePath));
  const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pages = [];
  const allBlocks = [];
  const lowConfidencePages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const blocks = groupItemsIntoLines(textContent.items, pageNumber);
    const pageText = blocks.map((block) => block.text).join("\n");
    const textLength = pageText.length;
    const quality = assessTextQuality(pageText, blocks);
    const needsOcr = quality.confidence < 0.65;
    if (needsOcr) lowConfidencePages.push(pageNumber);
    const normalizedBlocks = blocks.map((block) => ({ ...block, confidence: quality.confidence }));
    pages.push({
      page: pageNumber,
      width: Number(viewport.width.toFixed(2)),
      height: Number(viewport.height.toFixed(2)),
      textLength,
      blockCount: normalizedBlocks.length,
      extractionMethod: needsOcr ? "ocr_required" : "pdf_text_layer",
      confidence: quality.confidence,
      qualityIssue: quality.reason,
    });
    allBlocks.push(...normalizedBlocks);
  }

  const semanticOutline = buildSemanticOutline(allBlocks);
  const nativeOutline = semanticOutline.length ? [] : await extractNativeOutline(pdf);
  const outline = semanticOutline.length ? semanticOutline : nativeOutline;
  const outlineBlockIds = new Set(outline.map((item) => item.blockId).filter(Boolean));
  for (const block of allBlocks) if (outlineBlockIds.has(block.id)) block.blockType = "heading";

  return {
    pageCount: pdf.numPages,
    pages,
    blocks: allBlocks,
    outline,
    lowConfidencePages,
    characterCount: allBlocks.reduce((sum, block) => sum + block.text.length, 0),
    averageConfidence: pages.length ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length : 0,
  };
}
