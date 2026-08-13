import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { callAiJson, getOcrConfig, getTextConfig, getProviderConfig, getProviderOptions } from "./ai-provider.mjs";
import { formatDocumentBlocks } from "./format-document.mjs";
import { analyzePaperWithKimi } from "./kimi.mjs";
import { analyzeJudgmentWithKimi } from "./kimi-judgment.mjs";
import { ocrPageWithKimi } from "./kimi-ocr.mjs";
import { parsePdf } from "./pdf-parser.mjs";
import { createPdfRenderer, renderPdfPage } from "./pdf-renderer.mjs";
import { linkFootnoteReferences } from "./footnote-links.mjs";
import { normalizeLegalCitations } from "./citation-normalizer.mjs";
import { generateOutlineWithAi } from "./outline-generator.mjs";
import { documentFilePath, ensureStorage, projectDir, readDatabase, saveDocumentFile, updateDatabase } from "./storage.mjs";

dotenv.config({ path: path.join(projectDir, ".env.local") });

function loadEnvFromSettings(settings) {
  if (settings.ocrProvider) process.env.LEXREAD_OCR_PROVIDER = String(settings.ocrProvider);
  if (settings.ocrModel) process.env.LEXREAD_OCR_MODEL = String(settings.ocrModel);
  if (settings.textProvider) process.env.LEXREAD_TEXT_PROVIDER = String(settings.textProvider);
  if (settings.textModel) process.env.LEXREAD_TEXT_MODEL = String(settings.textModel);
  if (settings.kimi?.apiKey) process.env.KIMI_API_KEY = String(settings.kimi.apiKey);
  if (settings.kimi?.baseUrl) process.env.KIMI_BASE_URL = String(settings.kimi.baseUrl);
  if (settings.zhipu?.apiKey) process.env.ZHIPU_API_KEY = String(settings.zhipu.apiKey);
  if (settings.zhipu?.baseUrl) process.env.ZHIPU_BASE_URL = String(settings.zhipu.baseUrl);
  if (settings.deepseek?.apiKey) process.env.DEEPSEEK_API_KEY = String(settings.deepseek.apiKey);
  if (settings.deepseek?.baseUrl) process.env.DEEPSEEK_BASE_URL = String(settings.deepseek.baseUrl);
  // 兼容旧版
  if (settings.provider) process.env.AI_PROVIDER = String(settings.provider);
  if (settings.apiKey) process.env.AI_API_KEY = String(settings.apiKey);
  if (settings.model) process.env.AI_MODEL = String(settings.model);
  if (settings.ocrModel && !settings.ocrProvider) process.env.AI_OCR_MODEL = String(settings.ocrModel);
  if (settings.baseUrl) process.env.AI_BASE_URL = String(settings.baseUrl);
}

const localSettingsPath = path.join(projectDir, "data", "local-settings.json");
try {
  const storedSettings = JSON.parse(await readFile(localSettingsPath, "utf8"));
  if (storedSettings.ocrProvider || storedSettings.textProvider || storedSettings.provider) {
    loadEnvFromSettings(storedSettings);
  } else {
    // 迁移旧版 Kimi 配置
    const legacy = {
      provider: "kimi",
      apiKey: storedSettings.apiKey,
      model: storedSettings.model,
      ocrModel: storedSettings.ocrModel,
      baseUrl: storedSettings.baseUrl,
    };
    if (legacy.apiKey || legacy.model || legacy.baseUrl) {
      loadEnvFromSettings(legacy);
      await mkdir(path.dirname(localSettingsPath), { recursive: true });
      await writeFile(localSettingsPath, `${JSON.stringify(legacy, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") console.warn("本机 AI 配置读取失败，将继续使用 .env.local。", error?.message ?? error);
}

const app = express();
const port = Number(process.env.LEXREAD_API_PORT ?? 8787);
const pageImageCache = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    callback(allowed ? null : new Error("当前仅支持 PDF 文件。"), allowed);
  },
});

function normalizeUploadedFilename(filename) {
  const decoded = Buffer.from(filename, "latin1").toString("utf8");
  return decoded.includes("�") ? filename : decoded;
}

function safeEnvValue(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error(`${field} 不能为空或包含换行。`);
  return normalized;
}

async function persistAiSettings({ ocrProvider, ocrModel, textProvider, textModel, kimi, zhipu, deepseek }) {
  const next = { ocrProvider, ocrModel, textProvider, textModel, kimi: {}, zhipu: {}, deepseek: {} };

  if (kimi?.apiKey) next.kimi.apiKey = safeEnvValue(kimi.apiKey, "Kimi API Key");
  else next.kimi.apiKey = process.env.KIMI_API_KEY || "";

  if (kimi?.baseUrl) next.kimi.baseUrl = safeEnvValue(kimi.baseUrl, "Kimi API 地址").replace(/\/$/, "");
  else next.kimi.baseUrl = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";

  if (zhipu?.apiKey) next.zhipu.apiKey = safeEnvValue(zhipu.apiKey, "智谱 API Key");
  else next.zhipu.apiKey = process.env.ZHIPU_API_KEY || "";

  if (zhipu?.baseUrl) next.zhipu.baseUrl = safeEnvValue(zhipu.baseUrl, "智谱 API 地址").replace(/\/$/, "");
  else next.zhipu.baseUrl = process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";

  if (deepseek?.apiKey) next.deepseek.apiKey = safeEnvValue(deepseek.apiKey, "DeepSeek API Key");
  else next.deepseek.apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (deepseek?.baseUrl) next.deepseek.baseUrl = safeEnvValue(deepseek.baseUrl, "DeepSeek API 地址").replace(/\/$/, "");
  else next.deepseek.baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";

  if (!next.kimi.apiKey && !next.zhipu.apiKey && !next.deepseek.apiKey) throw new Error("至少需要配置一个平台的 API Key。");
  await mkdir(path.dirname(localSettingsPath), { recursive: true });
  const temporaryPath = `${localSettingsPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, localSettingsPath);
  loadEnvFromSettings(next);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const STAGE_LABELS = {
  uploaded: "已上传，等待解析",
  extracting_text: "提取 PDF 文字层",
  awaiting_ocr: "等待 AI OCR",
  kimi_ocr: "AI 正在识别页面",
  formatting: "整理文档结构",
  format_complete: "文档结构整理完成",
  ocr_failed: "识别过程遇到问题",
  parse_failed: "PDF 解析失败",
  preparing_sections: "准备分析章节",
  analyzing_full_text: "AI 正在全文分析",
  analyzing_sections: "AI 正在逐段分析",
  analyzing_judgment_sections: "AI 正在逐段分析",
  synthesizing_argument: "AI 正在综合论证结构",
  synthesizing_judgment: "AI 正在综合裁判结构",
  finalizing_anchors: "AI 正在关联原文依据",
  finalizing_judgment_anchors: "AI 正在关联原文依据",
  analysis_ready: "AI 阅读辅助已就绪",
  analysis_failed: "AI 分析失败",
  review: "可阅读",
  ready: "可阅读 · AI 辅助就绪",
};

function buildProgress({ stage, value = 0, generatedCharacters = 0 }) {
  return { stage, stageLabel: STAGE_LABELS[stage] || stage, value, generatedCharacters };
}

function lifecycleState(document) {
  const hasPages = Number(document.pageCount) > 0;
  const hasLowConfidencePages = Boolean(document.lowConfidencePages?.length);
  return {
    readingStatus: document.readingStatus
      ?? (document.status === "failed" && !hasPages ? "error" : !hasPages ? "processing" : hasLowConfidencePages ? "partial" : "readable"),
    ocrStatus: document.ocrStatus
      ?? (document.status === "ocr" ? "running" : hasLowConfidencePages ? "idle" : hasPages ? "completed" : "idle"),
    analysisStatus: document.analysisStatus
      ?? (document.status === "analyzing" ? "running" : document.analysis ? "completed" : "idle"),
  };
}

function publicDocument(document, includeBlocks = false) {
  const normalized = { ...document, ...lifecycleState(document) };
  if (includeBlocks) return normalized;
  const { blocks: _blocks, contentHash: _contentHash, ...summary } = normalized;
  return summary;
}

function repairLegacyNormalizedOcrBbox(block, page) {
  if (block.extractionMethod !== "kimi_vision_ocr" || block.fontSize != null || !Array.isArray(block.bbox)) return block;
  const [x, y, third, fourth] = block.bbox.map(Number);
  const looksLegacyNormalized = [x, y, third, fourth].every(Number.isFinite)
    && x <= page.width * 0.01
    && third <= page.width * 0.01
    && y >= page.height * 0.9
    && fourth <= page.height * 0.01;
  if (!looksLegacyNormalized) return block;

  const left = Math.max(0, Math.min(page.width, x * 1000));
  const right = Math.max(left, Math.min(page.width, third * 1000));
  const top = Math.max(0, Math.min(page.height, (page.height - y - fourth) * 1000));
  const bottomFromTop = Math.max(top, Math.min(page.height, fourth * 1000));
  const height = Math.max(1, bottomFromTop - top);
  return {
    ...block,
    bbox: [
      Number(left.toFixed(2)),
      Number(Math.max(0, page.height - bottomFromTop).toFixed(2)),
      Number(Math.max(1, right - left).toFixed(2)),
      Number(height.toFixed(2)),
    ],
  };
}

function uniqueDocuments(documents) {
  const seenHashes = new Set();
  return documents.filter((document) => {
    if (!document.contentHash) return true;
    const scopeHash = `${document.projectId}:${document.kind}:${document.contentHash}`;
    if (seenHashes.has(scopeHash)) return false;
    seenHashes.add(scopeHash);
    return true;
  });
}

const annotationKinds = new Set(["highlight", "note", "bookmark"]);
const annotationColors = new Set(["yellow", "blue", "green", "pink"]);
const annotationCardTypes = new Set(["观点卡", "案例卡", "规范卡", "引用卡", "问题卡"]);

function cleanAnnotationTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag ?? "").trim().slice(0, 50)).filter(Boolean))].slice(0, 30);
}

function normalizedPageRect(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const rect = value.map(Number);
  if (!rect.every(Number.isFinite)) return null;
  return rect.map((number) => Number(Math.max(0, Math.min(1, number)).toFixed(6)));
}

function normalizedPageRects(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizedPageRect).filter(Boolean).slice(0, 120);
}

function normalizedAnnotationSegments(values) {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const blockId = String(value?.blockId ?? "").slice(0, 200);
    const text = String(value?.text ?? "").slice(0, 5000);
    const startOffset = Math.max(0, Number(value?.startOffset) || 0);
    const endOffset = Math.max(startOffset, Number(value?.endOffset) || startOffset + text.length);
    return blockId && text ? [{ blockId, text, startOffset, endOffset }] : [];
  }).slice(0, 60);
}

function normalizeAnnotationInput(input, document, existing = null) {
  const now = new Date().toISOString();
  const text = String(input?.text ?? existing?.text ?? "").trim().slice(0, 5000);
  if (!text) throw new Error("标注原文不能为空。");
  const page = Math.max(1, Math.min(document.pageCount || 1, Number(input?.page ?? existing?.page) || 1));
  const startOffset = Math.max(0, Number(input?.startOffset ?? existing?.startOffset) || 0);
  const endOffset = Math.max(startOffset, Number(input?.endOffset ?? existing?.endOffset) || startOffset + text.length);
  const requestedId = String(input?.id ?? existing?.id ?? "");
  const id = /^[\w.:-]{1,120}$/.test(requestedId) ? requestedId : randomUUID();
  return {
    id,
    projectId: document.projectId,
    documentId: document.id,
    kind: annotationKinds.has(input?.kind) ? input.kind : existing?.kind ?? "highlight",
    text,
    note: String(input?.note ?? existing?.note ?? "").trim().slice(0, 10000),
    page,
    blockId: String(input?.blockId ?? existing?.blockId ?? "").slice(0, 200),
    startOffset,
    endOffset,
    quotePrefix: String(input?.quotePrefix ?? existing?.quotePrefix ?? "").slice(-80),
    quoteSuffix: String(input?.quoteSuffix ?? existing?.quoteSuffix ?? "").slice(0, 80),
    pageRect: normalizedPageRect(input?.pageRect ?? existing?.pageRect),
    segments: normalizedAnnotationSegments(input?.segments ?? existing?.segments),
    pageRects: normalizedPageRects(input?.pageRects ?? existing?.pageRects),
    cardType: annotationCardTypes.has(input?.cardType) ? input.cardType : existing?.cardType ?? "引用卡",
    tags: cleanAnnotationTags(input?.tags ?? existing?.tags),
    color: annotationColors.has(input?.color) ? input.color : existing?.color ?? "yellow",
    anchorStatus: ["exact", "recovered", "orphaned"].includes(input?.anchorStatus) ? input.anchorStatus : existing?.anchorStatus ?? "exact",
    createdAt: existing?.createdAt ?? String(input?.createdAt || now),
    updatedAt: String(input?.updatedAt || now),
  };
}

function blockPageRect(block, page) {
  if (!block || !page || !Array.isArray(block.bbox)) return null;
  const [x, y, width, height] = block.bbox.map(Number);
  if (![x, y, width, height, page.width, page.height].every(Number.isFinite) || !page.width || !page.height) return null;
  return normalizedPageRect([x / page.width, (page.height - y - height) / page.height, width / page.width, height / page.height]);
}

function recoverAnnotationAnchor(annotation, document) {
  const blocks = document.blocks ?? [];
  if (annotation.segments?.length) {
    let recoveredAny = false;
    const recoveredSegments = [];
    for (const segment of annotation.segments) {
      const currentBlock = blocks.find((block) => block.id === segment.blockId);
      const offsetsStillExact = currentBlock
        && currentBlock.text.slice(segment.startOffset, segment.endOffset) === segment.text;
      if (offsetsStillExact) {
        recoveredSegments.push(segment);
        continue;
      }
      const recoveredBlock = blocks.find((block) => block.text.includes(segment.text));
      if (!recoveredBlock) return { ...annotation, anchorStatus: "orphaned" };
      const startOffset = recoveredBlock.text.indexOf(segment.text);
      recoveredSegments.push({
        ...segment,
        blockId: recoveredBlock.id,
        startOffset,
        endOffset: startOffset + segment.text.length,
      });
      recoveredAny = true;
    }
    const primarySegment = recoveredSegments[0];
    const primaryBlock = blocks.find((block) => block.id === primarySegment.blockId);
    return {
      ...annotation,
      blockId: primarySegment.blockId,
      page: primaryBlock?.page ?? annotation.page,
      startOffset: primarySegment.startOffset,
      endOffset: primarySegment.endOffset,
      segments: recoveredSegments,
      anchorStatus: recoveredAny ? "recovered" : "exact",
      updatedAt: recoveredAny ? new Date().toISOString() : annotation.updatedAt,
    };
  }
  const current = blocks.find((block) => block.id === annotation.blockId);
  const expectedText = annotation.text;
  if (current) {
    const exactOffset = current.text.indexOf(expectedText);
    if (exactOffset >= 0) {
      const page = document.pages?.find((item) => item.page === current.page);
      return {
        ...annotation,
        page: current.page,
        startOffset: exactOffset,
        endOffset: exactOffset + expectedText.length,
        pageRect: annotation.pageRect ?? blockPageRect(current, page),
        anchorStatus: "exact",
      };
    }
  }
  const pageCandidates = blocks.filter((block) => block.page === annotation.page);
  const candidates = [...pageCandidates, ...blocks.filter((block) => block.page !== annotation.page)];
  const recovered = candidates.find((block) => block.text.includes(expectedText));
  if (!recovered) return { ...annotation, anchorStatus: "orphaned" };
  const startOffset = recovered.text.indexOf(expectedText);
  const page = document.pages?.find((item) => item.page === recovered.page);
  return {
    ...annotation,
    blockId: recovered.id,
    page: recovered.page,
    startOffset,
    endOffset: startOffset + expectedText.length,
    pageRect: blockPageRect(recovered, page),
    anchorStatus: "recovered",
    updatedAt: new Date().toISOString(),
  };
}

async function getDocument(documentId) {
  const database = await readDatabase();
  return database.documents.find((document) => document.id === documentId) ?? null;
}

async function updateDocument(documentId, changes) {
  return updateDatabase((database) => {
    const index = database.documents.findIndex((document) => document.id === documentId);
    if (index < 0) return null;
    database.documents[index] = { ...database.documents[index], ...changes, updatedAt: new Date().toISOString() };
    return database.documents[index];
  });
}

async function parseDocumentInBackground(documentId) {
  try {
    await updateDocument(documentId, {
      status: "parsing",
      readingStatus: "processing",
      progress: buildProgress({ stage: "extracting_text", value: 12 }),
      error: null,
    });
    const parsed = await parsePdf(documentFilePath(documentId));
    await updateDocument(documentId, {
      status: "review",
      readingStatus: "processing",
      ocrStatus: "idle",
      analysisStatus: "idle",
      progress: buildProgress({ stage: "awaiting_ocr", value: 100, generatedCharacters: parsed.characterCount || 0 }),
      pageCount: parsed.pageCount,
      pages: parsed.pages,
      blocks: parsed.blocks,
      outline: parsed.outline,
      lowConfidencePages: parsed.lowConfidencePages,
      characterCount: parsed.characterCount,
      averageConfidence: parsed.averageConfidence,
      parsingVersion: "pdfjs-text-v2",
    });

    const config = getOcrConfig();
    const allPages = Array.from({ length: parsed.pageCount }, (_, i) => i + 1);
    if (config.provider === "zhipu" && config.model === "glm-ocr") {
      void enqueueAutoOcr(documentId, allPages).catch((error) => {
        console.error("自动智谱 OCR 启动失败:", error?.message ?? error);
      });
    } else {
      console.warn(`文档 ${documentId} 需要智谱 GLM-OCR，但当前 AI 平台为 ${config.provider}。请切换至智谱并选择 GLM-OCR 模型。`);
    }
  } catch (error) {
    await updateDocument(documentId, {
      status: "failed",
      readingStatus: "error",
      progress: buildProgress({ stage: "parse_failed", value: 0 }),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function enqueueAutoOcr(documentId, pageNumbers) {
  const activeDatabase = await readDatabase();
  const existingJob = activeDatabase.jobs.find((job) =>
    job.documentId === documentId && job.type === "ai_ocr" && ["queued", "running"].includes(job.status)
  );
  if (existingJob) return existingJob;

  const jobId = randomUUID();
  const job = {
    id: jobId,
    documentId,
    type: "ai_ocr",
    status: "queued",
    progress: 0,
    totalPages: pageNumbers.length,
    completedPages: 0,
    processedPages: 0,
    failedPages: 0,
    currentPage: pageNumbers[0] ?? null,
    pageResults: [],
    createdAt: new Date().toISOString(),
  };
  await updateDatabase((database) => { database.jobs.unshift(job); });
  setImmediate(() => ocrDocumentInBackground(documentId, jobId, pageNumbers));
  return job;
}

async function enqueueDocumentAnalysis(document, researchQuestion = "", force = false) {
  const activeDatabase = await readDatabase();
  const existingJob = activeDatabase.jobs.find((job) =>
    job.documentId === document.id
    && ["paper_analysis", "judgment_analysis"].includes(job.type)
    && ["queued", "running"].includes(job.status)
  );
  if (existingJob) return existingJob;
  if (!force && document.analysisStatus === "completed" && document.analysis) {
    return activeDatabase.jobs.find((job) =>
      job.documentId === document.id
      && ["paper_analysis", "judgment_analysis"].includes(job.type)
      && job.status === "completed"
    ) ?? null;
  }
  const jobId = randomUUID();
  const job = {
    id: jobId,
    documentId: document.id,
    type: document.kind === "judgment" ? "judgment_analysis" : "paper_analysis",
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  await updateDatabase((database) => { database.jobs.unshift(job); });
  setImmediate(() => analyzeDocumentInBackground(document.id, jobId, String(researchQuestion || "")));
  return job;
}

async function analyzeDocumentInBackground(documentId, jobId, researchQuestion) {
  try {
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, { status: "running", progress: 10, stage: "preparing_sections", stageLabel: STAGE_LABELS.preparing_sections, generatedCharacters: 0, startedAt: new Date().toISOString() });
    });
    await updateDocument(documentId, {
      analysisStatus: "running",
      progress: buildProgress({ stage: "preparing_sections", value: 8 }),
      error: null,
    });
    const document = await getDocument(documentId);
    if (!document) throw new Error("文档不存在。");
    const analyze = document.kind === "judgment" ? analyzeJudgmentWithKimi : analyzePaperWithKimi;
    const analysis = await analyze(document, researchQuestion, {
      onProgress: async (progress) => {
        await Promise.all([
          updateDocument(documentId, {
            analysisStatus: "running",
            progress: buildProgress(progress),
            error: null,
            ...(progress.partialSections ? { partialSections: progress.partialSections } : {}),
          }),
          updateDatabase((database) => {
            const job = database.jobs.find((item) => item.id === jobId);
            if (job) Object.assign(job, {
              progress: progress.value,
              stage: progress.stage,
              stageLabel: STAGE_LABELS[progress.stage] || progress.stage,
              completedSections: progress.completedSections,
              totalSections: progress.totalSections,
              currentSection: progress.currentSection,
              generatedCharacters: progress.generatedCharacters ?? job.generatedCharacters ?? 0,
            });
          }),
        ]);
      },
    });
    const finalGeneratedCharacters = analysis.generatedCharacters || 0;
    await updateDocument(documentId, {
      status: "ready",
      readingStatus: document.lowConfidencePages?.length ? "partial" : "readable",
      analysisStatus: "completed",
      progress: buildProgress({ stage: "analysis_ready", value: 100, generatedCharacters: finalGeneratedCharacters }),
      analysis,
    });
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, { status: "completed", progress: 100, stage: "analysis_ready", stageLabel: STAGE_LABELS.analysis_ready, generatedCharacters: finalGeneratedCharacters, completedAt: new Date().toISOString() });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDocument(documentId, {
      status: "review",
      analysisStatus: "failed",
      progress: buildProgress({ stage: "analysis_failed", value: 0 }),
      error: message,
    });
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, { status: "failed", progress: 0, stage: "analysis_failed", stageLabel: STAGE_LABELS.analysis_failed, error: message, completedAt: new Date().toISOString() });
    });
  }
}

async function formatDocumentInBackground(documentId) {
  try {
    await updateDocument(documentId, {
      progress: buildProgress({ stage: "formatting", value: 10, generatedCharacters: 0 }),
      error: null,
    });

    const document = await getDocument(documentId);
    if (!document) throw new Error("文档不存在。");
    if (!document.blocks?.length) return;

    const result = await formatDocumentBlocks(document);

    await updateDocument(documentId, {
      blocks: result.blocks,
      outline: result.outline.length ? result.outline : document.outline,
      progress: buildProgress({ stage: "format_complete", value: 100, generatedCharacters: document.characterCount || 0 }),
    });
  } catch (error) {
    console.error("文档排版校正失败:", error?.message ?? error);
  }
}

const OCR_CONCURRENCY = 1;

async function ocrDocumentInBackground(documentId, jobId, pageNumbers) {
  const failures = [];
  let successCount = 0;
  let processedCount = 0;
  let generatedCharacters = 0;
  let renderer;
  try {
    await updateDocument(documentId, {
      ocrStatus: "running",
      progress: buildProgress({ stage: "kimi_ocr", value: 1 }),
      error: null,
    });
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, {
        status: "running",
        progress: 0,
        stage: "kimi_ocr",
        stageLabel: STAGE_LABELS.kimi_ocr,
        generatedCharacters: 0,
        processedPages: 0,
        currentPage: pageNumbers[0] ?? null,
        startedAt: new Date().toISOString(),
      });
    });

    renderer = await createPdfRenderer(documentFilePath(documentId));
    for (let batchStart = 0; batchStart < pageNumbers.length; batchStart += OCR_CONCURRENCY) {
      const batch = pageNumbers.slice(batchStart, batchStart + OCR_CONCURRENCY);

      const batchResults = await Promise.all(
        batch.map(async (pageNumber) => {
          try {
            const document = await getDocument(documentId);
            if (!document) throw new Error("文档不存在。");
            const page = document.pages?.find((item) => item.page === pageNumber);
            if (!page) throw new Error(`第 ${pageNumber} 页尚未完成基础解析。`);
            const rendered = await renderer.render(pageNumber);
            const outlineHints = (document.outline ?? []).filter((item) => item.page === pageNumber).map((item) => item.title).slice(0, 12);
            const result = rendered.isVisuallyBlank ? {
              blocks: [],
              confidence: 1,
              characterCount: 0,
              qualityIssue: null,
              warnings: ["本页经本地像素检测确认为空白页，未消耗 Kimi API。"],
              pageType: "blank",
              provider: "local_blank_detector",
              model: "blank-page-detector-v1",
              usage: null,
              generatedAt: new Date().toISOString(),
            } : await ocrPageWithKimi({ dataUrl: rendered.dataUrl, page: { ...page, inkCoverage: rendered.inkCoverage }, outlineHints });
            if ((result.pageType !== "blank" && !result.blocks.length) || result.confidence < 0.65) throw new Error(`Kimi OCR 返回内容可信度不足（${Math.round(result.confidence * 100)}%）。`);
            return { pageNumber, ok: true, result, rendered };
          } catch (error) {
            return { pageNumber, ok: false, error };
          }
        }),
      );

      for (const batchResult of batchResults) {
        processedCount += 1;
        if (batchResult.ok) {
          const { pageNumber, result, rendered } = batchResult;
          generatedCharacters += result.characterCount || 0;
          await updateDatabase((database) => {
            const storedDocument = database.documents.find((item) => item.id === documentId);
            const job = database.jobs.find((item) => item.id === jobId);
            if (!storedDocument || !job) return;
            storedDocument.blocks = [
              ...(storedDocument.blocks ?? []).filter((block) => block.page !== pageNumber),
              ...result.blocks,
            ].sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
            storedDocument.pages = (storedDocument.pages ?? []).map((storedPage) => storedPage.page === pageNumber ? {
              ...storedPage,
              textLength: result.characterCount,
              blockCount: result.blocks.length,
              extractionMethod: result.provider === "zhipu_glm_ocr" ? "glm_ocr" : "kimi_vision_ocr",
              confidence: result.confidence,
              qualityIssue: result.qualityIssue,
              mdResults: result.mdResults || "",
              ocr: {
                provider: result.provider,
                model: result.model,
                generatedAt: result.generatedAt,
                warnings: result.warnings,
                usage: result.usage,
                renderedWidth: rendered.width,
                renderedHeight: rendered.height,
              },
            } : storedPage);
            storedDocument.lowConfidencePages = (storedDocument.lowConfidencePages ?? []).filter((number) => number !== pageNumber);
            storedDocument.averageConfidence = storedDocument.pages.length
              ? storedDocument.pages.reduce((sum, storedPage) => sum + storedPage.confidence, 0) / storedDocument.pages.length
              : 0;
            storedDocument.characterCount = storedDocument.blocks.reduce((sum, block) => sum + block.text.length, 0);
            storedDocument.ocrHistory = [...(storedDocument.ocrHistory ?? []), {
              page: pageNumber,
              provider: result.provider,
              model: result.model,
              confidence: result.confidence,
              generatedAt: result.generatedAt,
            }].slice(-1000);
            storedDocument.updatedAt = new Date().toISOString();
            storedDocument.progress = buildProgress({ stage: "kimi_ocr", value: Math.round((processedCount / pageNumbers.length) * 100), generatedCharacters });
            job.pageResults.push({ page: pageNumber, status: "completed", confidence: result.confidence, usage: result.usage });
            job.completedPages = successCount + 1;
            job.processedPages = processedCount;
            job.lastProcessedPage = pageNumber;
            job.currentPage = null;
            job.progress = Math.round((processedCount / pageNumbers.length) * 100);
            job.generatedCharacters = generatedCharacters;
          });
          successCount += 1;
        } else {
          const { pageNumber, error } = batchResult;
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ page: pageNumber, error: message });
          await updateDatabase((database) => {
            const job = database.jobs.find((item) => item.id === jobId);
            if (!job) return;
            job.pageResults.push({ page: pageNumber, status: "failed", error: message });
            job.failedPages = failures.length;
            job.processedPages = processedCount;
            job.lastProcessedPage = pageNumber;
            job.currentPage = null;
            job.progress = Math.round((processedCount / pageNumbers.length) * 100);
            job.generatedCharacters = generatedCharacters;
          });
        }
        await updateDocument(documentId, { progress: buildProgress({ stage: "kimi_ocr", value: Math.round((processedCount / pageNumbers.length) * 100), generatedCharacters }) });
      }
    }

    const allFailed = successCount === 0;
    const updatedDocument = await getDocument(documentId);
    const nextStage = allFailed ? "ocr_failed" : "formatting";
    await updateDocument(documentId, {
      status: updatedDocument?.analysis ? "ready" : "review",
      readingStatus: failures.length ? "partial" : "readable",
      ocrStatus: failures.length ? "partial" : "completed",
      progress: buildProgress({ stage: nextStage, value: 100, generatedCharacters }),
      error: failures.length ? `${failures.length} 页 OCR 未成功，已保留为待复核页面。` : null,
    });
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, {
        status: allFailed ? "failed" : "completed",
        progress: 100,
        stage: nextStage,
        stageLabel: STAGE_LABELS[nextStage],
        completedPages: successCount,
        processedPages: pageNumbers.length,
        failedPages: failures.length,
        currentPage: null,
        error: allFailed ? failures[0]?.error || "Kimi OCR 未能完成任何页面。" : failures.length ? `${failures.length} 页需要重试。` : null,
        completedAt: new Date().toISOString(),
      });
    });

    if (!allFailed && !failures.length) {
      void formatDocumentInBackground(documentId).catch((error) => {
        console.error("自动文档排版校正失败:", error?.message ?? error);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedDocument = await getDocument(documentId);
    await updateDocument(documentId, {
      status: failedDocument?.analysis ? "ready" : "review",
      readingStatus: failedDocument?.pageCount ? "partial" : "error",
      ocrStatus: "failed",
      progress: buildProgress({ stage: "ocr_failed", value: 0, generatedCharacters }),
      error: message,
    });
    await updateDatabase((database) => {
      const job = database.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, { status: "failed", progress: 0, stage: "ocr_failed", stageLabel: STAGE_LABELS.ocr_failed, generatedCharacters, error: message, completedAt: new Date().toISOString() });
    });
  } finally {
    await renderer?.close().catch(() => undefined);
  }
}

app.get("/api/health", (_request, response) => {
  const ocr = getOcrConfig();
  const text = getTextConfig();
  response.json({
    ok: true,
    service: "lexread-api",
    version: "0.6.0",
    configured: Boolean(ocr.apiKey || text.apiKey),
    ocrProvider: ocr.provider,
    ocrModel: ocr.model,
    textProvider: text.provider,
    textModel: text.model,
    providerOptions: getProviderOptions(),
    kimiConfigured: Boolean(process.env.KIMI_API_KEY || process.env.AI_API_KEY),
    kimiModel: text.model,
    kimiGenerationMode: "light",
    kimiOcrModel: ocr.model,
    ocrApiProvider: ocr.provider === "zhipu" ? "zhipu_vision" : "kimi_vision",
  });
});

app.get("/api/settings/ai", (_request, response) => {
  const ocr = getOcrConfig();
  const text = getTextConfig();
  response.json({
    configured: Boolean(ocr.apiKey || text.apiKey),
    ocrProvider: ocr.provider,
    ocrModel: ocr.model,
    textProvider: text.provider,
    textModel: text.model,
    kimi: { apiKey: Boolean(process.env.KIMI_API_KEY), baseUrl: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1" },
    zhipu: { apiKey: Boolean(process.env.ZHIPU_API_KEY), baseUrl: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4" },
    deepseek: { apiKey: Boolean(process.env.DEEPSEEK_API_KEY), baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1" },
    providerOptions: getProviderOptions(),
  });
});

app.put("/api/settings/ai", async (request, response, next) => {
  try {
    const body = request.body;
    const ocrProvider = body.ocrProvider || "zhipu";
    const textProvider = body.textProvider || "kimi";

    await persistAiSettings({
      ocrProvider,
      ocrModel: body.ocrModel || "",
      textProvider,
      textModel: body.textModel || "",
      kimi: { apiKey: body.kimi?.apiKey, baseUrl: body.kimi?.baseUrl },
      zhipu: { apiKey: body.zhipu?.apiKey, baseUrl: body.zhipu?.baseUrl },
      deepseek: { apiKey: body.deepseek?.apiKey, baseUrl: body.deepseek?.baseUrl },
    });
    const ocr = getOcrConfig();
    const text = getTextConfig();
    response.json({
      configured: true,
      ocrProvider: ocr.provider,
      ocrModel: ocr.model,
      textProvider: text.provider,
      textModel: text.model,
      kimi: { apiKey: Boolean(process.env.KIMI_API_KEY), baseUrl: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1" },
      zhipu: { apiKey: Boolean(process.env.ZHIPU_API_KEY), baseUrl: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4" },
      deepseek: { apiKey: Boolean(process.env.DEEPSEEK_API_KEY), baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1" },
      providerOptions: getProviderOptions(),
    });
  } catch (error) { next(error); }
});

app.post("/api/settings/ai/test", async (_request, response, next) => {
  try {
    const text = getTextConfig();
    if (!text.apiKey) return response.status(503).json({ error: "请先保存至少一个平台的 API Key。" });
    const result = await callAiJson({
      systemPrompt: "你是 API 连通性检查器。只返回 JSON：{\"ok\":true}",
      userPrompt: "检查连接。",
      maxTokens: 32,
    });
    response.json({ ok: result.data?.ok === true, provider: text.provider, model: text.model });
  } catch (error) { next(error); }
});

// 保留旧版兼容端点
app.get("/api/settings/kimi", (_request, response) => {
  const text = getTextConfig();
  response.json({ configured: Boolean(text.apiKey), model: text.model, ocrModel: getOcrConfig().model, baseUrl: text.baseUrl });
});

app.get("/api/documents", async (request, response, next) => {
  try {
    const database = await readDatabase();
    const projectId = typeof request.query.projectId === "string" ? request.query.projectId : null;
    const documents = uniqueDocuments(projectId ? database.documents.filter((document) => document.projectId === projectId) : database.documents);
    response.json({ documents: documents.map((document) => publicDocument(document)) });
  } catch (error) { next(error); }
});

app.post("/api/documents", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: "请选择需要上传的 PDF 文件。" });
    const id = randomUUID();
    const now = new Date().toISOString();
    const originalFilename = normalizeUploadedFilename(request.file.originalname);
    const projectId = String(request.body.projectId || "p1");
    const kind = request.body.kind === "judgment" ? "judgment" : "paper";
    const contentHash = createHash("sha256").update(request.file.buffer).digest("hex");
    const existingDatabase = await readDatabase();
    const existing = existingDatabase.documents.find((document) => document.projectId === projectId && document.kind === kind && document.contentHash === contentHash);
    if (existing) return response.status(200).json({ document: publicDocument(existing), duplicate: true });
    await saveDocumentFile(id, request.file.buffer);
    const document = {
      id,
      projectId,
      kind,
      title: String(request.body.title || originalFilename.replace(/\.pdf$/i, "")),
      originalFilename,
      mimeType: request.file.mimetype,
      fileSize: request.file.size,
      contentHash,
      status: "uploaded",
      readingStatus: "processing",
      ocrStatus: "idle",
      analysisStatus: "idle",
      progress: buildProgress({ stage: "uploaded", value: 2 }),
      currentPage: 1,
      pageCount: 0,
      pages: [],
      blocks: [],
      outline: [],
      lowConfidencePages: [],
      averageConfidence: 0,
      userEdits: [],
      createdAt: now,
      updatedAt: now,
    };
    await updateDatabase((database) => { database.documents.unshift(document); });
    setImmediate(() => parseDocumentInBackground(id));
    response.status(202).json({ document: publicDocument(document) });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    response.json({ document: publicDocument(document) });
  } catch (error) { next(error); }
});

app.patch("/api/documents/:documentId", async (request, response, next) => {
  try {
    const currentDocument = await getDocument(request.params.documentId);
    if (!currentDocument) return response.status(404).json({ error: "文档不存在。" });
    const changes = {};
    if (typeof request.body?.archived === "boolean") changes.archivedAt = request.body.archived ? new Date().toISOString() : null;
    if (request.body?.currentPage != null) {
      const currentPage = Number(request.body.currentPage);
      if (!Number.isInteger(currentPage)) return response.status(400).json({ error: "阅读页码格式不正确。" });
      changes.currentPage = Math.max(1, Math.min(currentDocument.pageCount || 1, currentPage));
    }
    if (!Object.keys(changes).length) return response.status(400).json({ error: "没有可更新的文档字段。" });
    const document = Object.hasOwn(changes, "currentPage") && !Object.hasOwn(changes, "archivedAt")
      ? await updateDatabase((database) => {
        const index = database.documents.findIndex((item) => item.id === request.params.documentId);
        if (index < 0) return null;
        database.documents[index] = {
          ...database.documents[index],
          currentPage: changes.currentPage,
          readingPositionUpdatedAt: new Date().toISOString(),
        };
        return database.documents[index];
      })
      : await updateDocument(request.params.documentId, changes);
    response.json({ document: publicDocument(document) });
  } catch (error) { next(error); }
});

app.delete("/api/documents/:documentId", async (request, response, next) => {
  try {
    const currentDocument = await getDocument(request.params.documentId);
    if (!currentDocument) return response.status(404).json({ error: "文档不存在。" });
    await updateDatabase((database) => {
      database.documents = database.documents.filter((document) => document.id !== request.params.documentId);
      database.jobs = database.jobs.filter((job) => job.documentId !== request.params.documentId);
      database.annotations = database.annotations.filter((annotation) => annotation.documentId !== request.params.documentId);
    });
    pageImageCache.forEach((_value, key) => {
      if (key.startsWith(`${request.params.documentId}:`)) pageImageCache.delete(key);
    });
    await rm(path.dirname(documentFilePath(request.params.documentId)), { recursive: true, force: true });
    response.json({ ok: true, documentId: request.params.documentId });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/pages/:pageNumber", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const pageNumber = Number(request.params.pageNumber);
    const page = document.pages?.find((item) => item.page === pageNumber);
    if (!page) return response.status(404).json({ error: "页面不存在或尚未解析。" });
    const blocks = (document.blocks ?? [])
      .filter((block) => block.page === pageNumber)
      .map((block) => repairLegacyNormalizedOcrBbox(block, page));
    response.json({ page, blocks });
  } catch (error) { next(error); }
});

function isReadingPageArtifact(block) {
  const text = String(block?.text ?? "").replace(/\s+/g, " ").trim();
  if (["header", "footer", "page_number"].includes(block?.blockType)) return true;
  if (!text) return true;
  if (/China Academic Journal Electronic Publishing House|cnki\.net/i.test(text)) return true;
  if (/^\d{3}\s*[—-]\s*中国法律评论$/.test(text) || /^中国法律评论\s*\d{3}$/.test(text)) return true;
  if (/^\d{4}\s*年第\s*\d+\s*期[（(].*?[）)]\s*[—-]?\s*\d{3}$/.test(text)) return true;
  return false;
}

function normalizedReadingText(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function looksLikeReadingFootnote(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return /^\d{1,2}\s+/.test(text)
    && /《[^》]+》/.test(text)
    && /(出版社|载《|译[，,]|第\s*\d+[\s—-]*(?:页|期)|总序)/.test(text);
}

app.post("/api/documents/:documentId/format", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!document.blocks?.length) return response.status(400).json({ error: "文档没有可排版的文字块。" });

    await updateDocument(document.id, { progress: buildProgress({ stage: "formatting", value: 10, generatedCharacters: document.characterCount || 0 }) });
    const result = await formatDocumentBlocks(document);
    const updatedDocument = await updateDocument(document.id, {
      blocks: result.blocks,
      outline: result.outline.length ? result.outline : document.outline,
      progress: buildProgress({ stage: "format_complete", value: 100, generatedCharacters: document.characterCount || 0 }),
    });
    response.json({ document: publicDocument(updatedDocument, true) });
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/outline/regenerate", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!document.blocks?.length) return response.status(400).json({ error: "文档尚未完成文字解析。" });
    const outline = await generateOutlineWithAi(document);
    if (!outline.length) return response.status(422).json({ error: "AI 未能从原文确认目录结构，请检查 OCR 结果后重试。" });
    const updated = await updateDocument(document.id, { outline });
    response.json({ document: publicDocument(updated, true) });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/text", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const orderedBlocks = [...(document.blocks ?? [])]
      .sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
    const readableBlocks = orderedBlocks.filter((block) => !isReadingPageArtifact(block));
    const blocks = readableBlocks.filter((block) => block.blockType !== "footnote" && !looksLikeReadingFootnote(block.text));
    const footnotes = readableBlocks.filter((block) => block.blockType === "footnote" || looksLikeReadingFootnote(block.text));
    const normalizedFootnoteCorpus = () => normalizedReadingText(footnotes.map((block) => block.text).join("\n"));
    for (const [index, outlineItem] of (document.outline ?? []).entries()) {
      if (!looksLikeReadingFootnote(outlineItem.title)) continue;
      const normalizedCandidate = normalizedReadingText(outlineItem.title);
      if (normalizedFootnoteCorpus().includes(normalizedCandidate)) continue;
      footnotes.push({
        id: `recovered-footnote-${outlineItem.blockId ?? outlineItem.id ?? index}`,
        page: Number(outlineItem.page) || 1,
        readingOrder: index + 1,
        blockType: "footnote",
        text: String(outlineItem.title).replace(/\s+/g, " ").trim(),
        bbox: [0, 0, 0, 0],
        fontSize: null,
        confidence: 0.72,
        extractionMethod: "outline_recovery",
        footnoteMarker: String(outlineItem.title).trim().match(/^(\d{1,3})/)?.[1] ?? null,
        footnoteRefs: [],
      });
    }
    footnotes.sort((left, right) => left.page - right.page || left.readingOrder - right.readingOrder);
    const { blocks: linkedBlocks, footnotes: footnotesWithReferences } = linkFootnoteReferences(blocks, footnotes);
    response.json({
      blocks: linkedBlocks,
      footnotes: footnotesWithReferences,
      characterCount: linkedBlocks.reduce((sum, block) => sum + block.text.length, 0)
        + footnotesWithReferences.reduce((sum, block) => sum + block.text.length, 0),
    });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/legal-citations", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!document.blocks?.length) return response.status(400).json({ error: "文档尚未完成文字解析。" });
    const footnotes = (document.blocks ?? []).filter((block) => block.blockType === "footnote" || looksLikeReadingFootnote(block.text));
    const citations = normalizeLegalCitations(footnotes);
    response.json({ documentId: document.id, citations, total: citations.length, needsReview: citations.filter((item) => item.issues.length).length });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/search", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const query = String(request.query.q ?? "").trim().slice(0, 100);
    if (query.length < 2) return response.json({ query, total: 0, results: [] });
    const limit = Math.max(1, Math.min(200, Number(request.query.limit) || 80));
    const normalizedQuery = query.toLocaleLowerCase("zh-CN");
    const matches = (document.blocks ?? []).filter((block) =>
      !isReadingPageArtifact(block) && block.text.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    );
    const results = matches.slice(0, limit).map((block) => {
      const normalizedText = block.text.replace(/\s+/g, " ").trim();
      const index = normalizedText.toLocaleLowerCase("zh-CN").indexOf(normalizedQuery);
      const start = Math.max(0, index - 36);
      const end = Math.min(normalizedText.length, index + query.length + 56);
      return {
        blockId: block.id,
        page: block.page,
        blockType: block.blockType,
        text: normalizedText,
        snippet: `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${end < normalizedText.length ? "…" : ""}`,
      };
    });
    response.json({ query, total: matches.length, results });
  } catch (error) { next(error); }
});

app.get("/api/annotations", async (request, response, next) => {
  try {
    const documentId = typeof request.query.documentId === "string" ? request.query.documentId : null;
    const projectId = typeof request.query.projectId === "string" ? request.query.projectId : null;
    const query = String(request.query.q ?? "").trim().toLocaleLowerCase("zh-CN");
    const tag = String(request.query.tag ?? "").trim();
    const database = await readDatabase();
    const documentsById = new Map(database.documents.map((document) => [document.id, document]));
    let changed = false;
    const repaired = database.annotations.map((annotation) => {
      const document = documentsById.get(annotation.documentId);
      if (!document) return annotation;
      const nextAnnotation = recoverAnnotationAnchor(annotation, document);
      if (JSON.stringify(nextAnnotation) !== JSON.stringify(annotation)) changed = true;
      return nextAnnotation;
    });
    if (changed) {
      await updateDatabase((storedDatabase) => {
        const repairedById = new Map(repaired.map((annotation) => [annotation.id, annotation]));
        storedDatabase.annotations = storedDatabase.annotations.map((annotation) => repairedById.get(annotation.id) ?? annotation);
      });
    }
    const annotations = repaired
      .filter((annotation) => !documentId || annotation.documentId === documentId)
      .filter((annotation) => !projectId || annotation.projectId === projectId)
      .filter((annotation) => !tag || annotation.tags.includes(tag))
      .filter((annotation) => !query || `${annotation.text} ${annotation.note} ${annotation.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(query))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    response.json({ annotations });
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/annotations", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const annotation = normalizeAnnotationInput(request.body, document);
    const saved = await updateDatabase((database) => {
      const existing = database.annotations.find((item) => item.id === annotation.id);
      if (existing) return existing;
      database.annotations.unshift(annotation);
      return annotation;
    });
    response.status(201).json({ annotation: saved });
  } catch (error) { next(error); }
});

app.put("/api/documents/:documentId/annotations/sync", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!Array.isArray(request.body?.annotations)) return response.status(400).json({ error: "标注同步数据格式不正确。" });
    const incoming = request.body.annotations.slice(0, 2000).map((annotation) => normalizeAnnotationInput(annotation, document));
    const annotations = await updateDatabase((database) => {
      for (const annotation of incoming) {
        const index = database.annotations.findIndex((item) => item.id === annotation.id && item.documentId === document.id);
        if (index < 0) {
          database.annotations.unshift(annotation);
          continue;
        }
        const stored = database.annotations[index];
        if (String(annotation.updatedAt).localeCompare(String(stored.updatedAt)) > 0) database.annotations[index] = annotation;
      }
      database.annotations = database.annotations.map((annotation) => annotation.documentId === document.id
        ? recoverAnnotationAnchor(annotation, document)
        : annotation);
      return database.annotations
        .filter((annotation) => annotation.documentId === document.id)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    });
    response.json({ annotations });
  } catch (error) { next(error); }
});

app.patch("/api/annotations/:annotationId", async (request, response, next) => {
  try {
    const database = await readDatabase();
    const existing = database.annotations.find((annotation) => annotation.id === request.params.annotationId);
    if (!existing) return response.status(404).json({ error: "标注不存在。" });
    const document = database.documents.find((item) => item.id === existing.documentId);
    if (!document) return response.status(404).json({ error: "标注对应的文档不存在。" });
    const annotation = normalizeAnnotationInput({ ...existing, ...request.body, id: existing.id, updatedAt: new Date().toISOString() }, document, existing);
    await updateDatabase((storedDatabase) => {
      const index = storedDatabase.annotations.findIndex((item) => item.id === existing.id);
      if (index >= 0) storedDatabase.annotations[index] = annotation;
    });
    response.json({ annotation });
  } catch (error) { next(error); }
});

app.delete("/api/annotations/:annotationId", async (request, response, next) => {
  try {
    const deleted = await updateDatabase((database) => {
      const before = database.annotations.length;
      database.annotations = database.annotations.filter((annotation) => annotation.id !== request.params.annotationId);
      return database.annotations.length < before;
    });
    if (!deleted) return response.status(404).json({ error: "标注不存在。" });
    response.json({ ok: true, annotationId: request.params.annotationId });
  } catch (error) { next(error); }
});

app.get("/api/projects/:projectId/tags", async (request, response, next) => {
  try {
    const database = await readDatabase();
    const counts = new Map();
    for (const annotation of database.annotations.filter((item) => item.projectId === request.params.projectId)) {
      for (const tag of annotation.tags) {
        const current = counts.get(tag) ?? { tag, count: 0, documentIds: new Set(), updatedAt: annotation.updatedAt };
        current.count += 1;
        current.documentIds.add(annotation.documentId);
        if (String(annotation.updatedAt).localeCompare(String(current.updatedAt)) > 0) current.updatedAt = annotation.updatedAt;
        counts.set(tag, current);
      }
    }
    const tags = [...counts.values()]
      .map((item) => ({ tag: item.tag, count: item.count, documentCount: item.documentIds.size, updatedAt: item.updatedAt }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"));
    response.json({ tags });
  } catch (error) { next(error); }
});

app.patch("/api/projects/:projectId/tags", async (request, response, next) => {
  try {
    const action = String(request.body?.action ?? "");
    const sourceTag = String(request.body?.sourceTag ?? "").trim();
    const targetTag = String(request.body?.targetTag ?? "").trim().slice(0, 50);
    if (!["rename", "merge", "delete"].includes(action) || !sourceTag || (action !== "delete" && !targetTag)) {
      return response.status(400).json({ error: "标签操作参数不正确。" });
    }
    let affected = 0;
    await updateDatabase((database) => {
      database.annotations = database.annotations.map((annotation) => {
        if (annotation.projectId !== request.params.projectId || !annotation.tags.includes(sourceTag)) return annotation;
        affected += 1;
        const tags = action === "delete"
          ? annotation.tags.filter((tag) => tag !== sourceTag)
          : [...new Set(annotation.tags.map((tag) => tag === sourceTag ? targetTag : tag))];
        return { ...annotation, tags, updatedAt: new Date().toISOString() };
      });
    });
    response.json({ ok: true, affected });
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/pages/:pageNumber/image", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const pageNumber = Number(request.params.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.pageCount) {
      return response.status(404).json({ error: "页面不存在或尚未解析。" });
    }
    const cacheKey = `${document.id}:${pageNumber}:${document.updatedAt}`;
    let bytes = pageImageCache.get(cacheKey);
    if (!bytes) {
      const rendered = await renderPdfPage(documentFilePath(document.id), pageNumber, { maxDimension: 1800, scale: 2, quality: 84 });
      bytes = rendered.bytes;
      pageImageCache.set(cacheKey, bytes);
      while (pageImageCache.size > 20) pageImageCache.delete(pageImageCache.keys().next().value);
    }
    response.set("Cache-Control", "private, max-age=3600");
    response.type("image/jpeg").send(bytes);
  } catch (error) { next(error); }
});

app.get("/api/documents/:documentId/file", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const filePath = documentFilePath(document.id);
    await access(filePath);
    response.type("application/pdf").sendFile(filePath);
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/translate", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const text = String(request.body?.text ?? "").trim().slice(0, 10000);
    if (!text) return response.status(400).json({ error: "翻译文本不能为空。" });
    const config = getTextConfig();
    if (!config.apiKey) return response.status(503).json({ error: "AI API 尚未配置。" });
    const result = await callAiJson({
      systemPrompt: `你是一个专业的法学文献翻译助手。请将以下中文法学文献内容翻译成英文。翻译要求：
1. 保持原文的法学专业术语准确性
2. 保持原文的论证逻辑和段落结构
3. 法律条款、案例名、学者姓名保持原文（不翻译）
4. 只返回 JSON，不要添加任何额外解释：{"translation":"译文"}`,
      userPrompt: `请将以下中文法学文本翻译成英文，直接输出翻译结果：\n\n${text}`,
      maxTokens: 8000,
    });
    const translation = typeof result.data?.translation === "string" ? result.data.translation
      : typeof result.data?.Translation === "string" ? result.data.Translation
      : typeof result.data === "string" ? result.data
      : JSON.stringify(result.data ?? {});
    response.json({ translation: String(translation).trim() });
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/ask-ai", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    const selectedText = String(request.body?.text ?? "").trim().slice(0, 3000);
    const contextBefore = String(request.body?.before ?? "").trim().slice(0, 500);
    const contextAfter = String(request.body?.after ?? "").trim().slice(0, 500);
    const question = String(request.body?.question ?? "").trim().slice(0, 1200);
    if (!selectedText) return response.status(400).json({ error: "选中文本不能为空。" });
    const config = getTextConfig();
    if (!config.apiKey) return response.status(503).json({ error: "AI API 尚未配置。" });

    let prompt = `你是法学论文阅读助手。请严格依据选中段落及其上下文回答用户问题；不能从原文推出时要明确说明。要求：
1. 先直接回答用户问题，再说明关键依据
2. 使用 Markdown：用 ## 小标题、- 要点、**重点**，不要复述整段原文
3. 涉及作者立场、规范依据或推论时，要区分原文明确内容与自己的推断

只返回 JSON，不要输出代码围栏：{"analysis":"## 回答\\n- ..."}。`;

    let userPrompt = `用户问题：${question || "请分析这段话的论证功能、核心命题与可商榷之处。"}\n\n选中文本："${selectedText}"`;
    if (contextBefore) userPrompt = `上文："${contextBefore}"\n\n${userPrompt}`;
    if (contextAfter) userPrompt = `${userPrompt}\n\n下文："${contextAfter}"`;

    const result = await callAiJson({
      systemPrompt: prompt,
      userPrompt,
      maxTokens: 2000,
    });

    const analysis = typeof result.data?.analysis === "string" ? result.data.analysis
      : typeof result.data === "string" ? result.data
      : JSON.stringify(result.data ?? {});

    response.json({ analysis: String(analysis).trim() });
  } catch (error) { next(error); }
});

app.patch("/api/documents/:documentId/outline", async (request, response, next) => {
  try {
    if (!Array.isArray(request.body.outline)) return response.status(400).json({ error: "目录数据格式不正确。" });
    const outline = request.body.outline.slice(0, 300).map((item, index) => ({
      id: String(item.id || `outline-user-${index + 1}`),
      title: String(item.title || "未命名目录").slice(0, 160),
      level: Math.max(1, Math.min(4, Number(item.level || 1))),
      page: Math.max(1, Number(item.page || 1)),
      blockId: item.blockId ? String(item.blockId) : null,
      confidence: 1,
      source: "user",
    }));
    const currentDocument = await getDocument(request.params.documentId);
    if (!currentDocument) return response.status(404).json({ error: "文档不存在。" });
    const document = await updateDocument(request.params.documentId, {
      outline,
      userEdits: [...(currentDocument.userEdits ?? []), { type: "outline", editedAt: new Date().toISOString() }].slice(-100),
    });
    response.json({ document: publicDocument(document) });
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/analyze", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!getTextConfig().apiKey) return response.status(503).json({ error: "AI API 尚未配置，请点击页面顶栏的设置完成配置。" });
    if (!["review", "ready", "analyzing"].includes(document.status)) return response.status(409).json({ error: "文档尚未完成解析或校对。" });
    const job = await enqueueDocumentAnalysis(document, request.body.researchQuestion, request.body?.force === true);
    if (!job) return response.status(409).json({ error: "AI 阅读辅助已经生成。" });
    response.status(202).json({ job });
  } catch (error) { next(error); }
});

app.patch("/api/documents/:documentId/analysis-status", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!document.analysis) return response.status(409).json({ error: "文档尚未生成 AI 分析结果。" });

    const nodeId = typeof request.body?.nodeId === "string" ? request.body.nodeId : "";
    const issueId = typeof request.body?.issueId === "string" ? request.body.issueId : "";
    const status = typeof request.body?.status === "string" ? request.body.status : "";
    if (Boolean(nodeId) === Boolean(issueId)) return response.status(400).json({ error: "请指定一个论文节点或裁判节点。" });

    if (nodeId) {
      if (!["unread", "passed", "read", "understood", "doubt", "disagree", "saved"].includes(status)) {
        return response.status(400).json({ error: "论文节点核验状态不正确。" });
      }
      const nodes = document.analysis.nodes ?? [];
      if (!nodes.some((node) => node.id === nodeId)) return response.status(404).json({ error: "论文分析节点不存在。" });
      const updated = await updateDocument(document.id, {
        analysis: { ...document.analysis, nodes: nodes.map((node) => node.id === nodeId ? { ...node, userStatus: status } : node) },
      });
      return response.json({ document: publicDocument(updated) });
    }

    if (!["已完成", "进行中", "待读取"].includes(status)) return response.status(400).json({ error: "裁判节点核验状态不正确。" });
    const issues = document.analysis.issues ?? [];
    if (!issues.some((issue) => issue.id === issueId)) return response.status(404).json({ error: "裁判分析节点不存在。" });
    const updated = await updateDocument(document.id, {
      analysis: { ...document.analysis, issues: issues.map((issue) => issue.id === issueId ? { ...issue, status } : issue) },
    });
    response.json({ document: publicDocument(updated) });
  } catch (error) { next(error); }
});

app.post("/api/documents/:documentId/ocr", async (request, response, next) => {
  try {
    const document = await getDocument(request.params.documentId);
    if (!document) return response.status(404).json({ error: "文档不存在。" });
    if (!["review", "ready"].includes(document.status)) return response.status(409).json({ error: "请等待当前解析或分析任务完成。" });
    if (!getOcrConfig().apiKey) return response.status(503).json({ error: "AI API 尚未配置，请点击页面顶栏的设置完成配置。" });
    const requestedPages = request.body?.scope === "all"
      ? Array.from({ length: document.pageCount }, (_, index) => index + 1)
      : Array.isArray(request.body.pageNumbers) ? request.body.pageNumbers.map(Number) : (document.lowConfidencePages ?? []);
    const pageNumbers = [...new Set(requestedPages)]
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= document.pageCount)
      .slice(0, 120);
    if (!pageNumbers.length) return response.status(409).json({ error: "请选择需要 Kimi OCR 的页面。" });
    const activeDatabase = await readDatabase();
    const existingJob = activeDatabase.jobs.find((job) => job.documentId === document.id && ["kimi_ocr", "ai_ocr"].includes(job.type) && ["queued", "running"].includes(job.status));
    if (existingJob) return response.status(409).json({ error: "该文档已有 OCR 任务正在运行。", job: existingJob });
    const jobId = randomUUID();
    const job = {
      id: jobId,
      documentId: document.id,
      type: "kimi_ocr",
      status: "queued",
      progress: 0,
      totalPages: pageNumbers.length,
      completedPages: 0,
      processedPages: 0,
      failedPages: 0,
      currentPage: pageNumbers[0] ?? null,
      pageResults: [],
      createdAt: new Date().toISOString(),
    };
    await updateDatabase((database) => { database.jobs.unshift(job); });
    setImmediate(() => ocrDocumentInBackground(document.id, jobId, pageNumbers));
    response.status(202).json({ job });
  } catch (error) { next(error); }
});

app.get("/api/jobs/:jobId", async (request, response, next) => {
  try {
    const database = await readDatabase();
    const job = database.jobs.find((item) => item.id === request.params.jobId);
    if (!job) return response.status(404).json({ error: "任务不存在。" });
    response.json({ job });
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
    ? 413
    : error instanceof Error && error.message === "当前仅支持 PDF 文件。" ? 400 : 500;
  const message = error instanceof Error ? error.message : "服务器发生未知错误。";
  console.error(`[LexRead API] ${message}`);
  response.status(status).json({ error: message });
});

async function recoverInterruptedWork() {
  const retryDocumentIds = [];
  await updateDatabase(async (database) => {
    for (const document of database.documents) {
      if (!document.contentHash) {
        try {
          const bytes = await readFile(documentFilePath(document.id));
          document.contentHash = createHash("sha256").update(bytes).digest("hex");
        } catch { /* a missing original is surfaced only when the user opens it */ }
      }
      const normalizedFilename = normalizeUploadedFilename(document.originalFilename || "");
      if (normalizedFilename && normalizedFilename !== document.originalFilename) {
        if (document.title === document.originalFilename?.replace(/\.pdf$/i, "")) document.title = normalizedFilename.replace(/\.pdf$/i, "");
        document.originalFilename = normalizedFilename;
      }
      if (["uploaded", "parsing"].includes(document.status) || (document.status === "review" && document.parsingVersion && document.parsingVersion !== "pdfjs-text-v2")) retryDocumentIds.push(document.id);
      if (document.status === "analyzing") Object.assign(document, {
        status: "review",
        progress: { stage: "analysis_interrupted", value: 0 },
        error: "上次分析因应用关闭而中断，可重新开始。",
      });
      if (document.status === "ocr") Object.assign(document, {
        status: "review",
        progress: { stage: "ocr_interrupted", value: 0 },
        error: "上次 Kimi OCR 因应用关闭而中断，已完成页面仍然保留，可继续处理剩余页面。",
      });
    }
    for (const job of database.jobs) {
      if (["queued", "running"].includes(job.status)) Object.assign(job, {
        status: "failed",
        progress: 0,
        error: "任务因应用关闭而中断，请重新开始。",
        completedAt: new Date().toISOString(),
      });
    }
  });
  retryDocumentIds.forEach((documentId) => setImmediate(() => parseDocumentInBackground(documentId)));
}

await ensureStorage();
await recoverInterruptedWork();
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`LexRead API listening on http://127.0.0.1:${port}`);
  const ocr = getOcrConfig();
  const text = getTextConfig();
  console.log(`OCR: ${ocr.provider === "zhipu" ? "智谱" : "Kimi"} · ${ocr.model} | 文本: ${text.provider === "zhipu" ? "智谱" : "Kimi"} · ${text.model} | 已配置: ${Boolean(ocr.apiKey || text.apiKey)}`);
});
server.on("error", (error) => {
  console.error(`[LexRead API] 无法监听 127.0.0.1:${port}：${error.message}`);
  process.exitCode = 1;
});
