import type { AnalysisStatus, DocumentKind, LegalReadingGuide, OcrStatus, ReadingAnnotation, ReadingNode, ReadingStatus, ResearchDocument } from "./types";
import { DEMO_FEATURE_MESSAGE, IS_DEMO } from "./demo";

export type { ApiHealth, AiSettings, KimiSettings, ModelOption, ProviderOptions } from "./api-types";
import type { ApiHealth, AiSettings, KimiSettings } from "./api-types";

export interface ServerOutlineItem {
  id: string;
  title: string;
  level: number;
  page: number;
  blockId?: string | null;
  confidence: number;
  source: "automatic" | "user";
}

export interface ServerProgress {
  stage: string;
  stageLabel?: string;
  value: number;
  generatedCharacters?: number;
}

export interface ServerSourceAnchor {
  blockId: string;
  page: number;
  text: string;
  bbox: [number, number, number, number];
}

export interface ServerAnalysisNode {
  id: string;
  order: number;
  title: string;
  role: string;
  attribution: string;
  summary: string;
  reasons: string[];
  confidence: number;
  sourceType: "ai_summary" | "ai_inference";
  sourceAnchors: ServerSourceAnchor[];
  userStatus: ReadingNode["status"];
}

export interface ServerJudgmentIssue {
  id: string;
  order: number;
  title: string;
  stage: string;
  page: number;
  status: "已完成" | "进行中" | "待读取";
  claim: string;
  courtFact: string;
  evidence: string[];
  laws: string[];
  reasoning: string;
  conclusion: string;
  confidence: number;
  sourceType: "ai_summary" | "ai_inference";
  sourceAnchors: ServerSourceAnchor[];
}

export interface ServerAnalysis {
  analysisType?: "paper_argument" | "judgment_reasoning";
  model: string;
  generationMode?: "light";
  modelVersion: string;
  sourceCoverage: number;
  pipelineVersion?: string;
  citationBlockCount?: number;
  generatedCharacters?: number;
  documentSummary: {
    surfaceTopic: string;
    coreQuestion: string;
    coreConclusion: string;
    paradigm: string;
    boundary: string;
  };
  readingGuide?: LegalReadingGuide;
  nodes?: ServerAnalysisNode[];
  issues?: ServerJudgmentIssue[];
  caseSummary?: {
    caseNumber: string;
    court: string;
    cause: string;
    documentType: string;
    procedure: string;
    decisionDate: string;
    result: string;
  };
  warnings: string[];
  pipeline?: {
    totalSections: number;
    analyzedSections: number;
    sourceCharacterCount: number;
    analyzedCharacterCount: number;
    textCoverage: number;
  };
  generatedAt: string;
}

export interface ServerDocument {
  id: string;
  projectId: string;
  kind: DocumentKind;
  title: string;
  originalFilename: string;
  fileSize: number;
  status: ResearchDocument["status"];
  readingStatus: ReadingStatus;
  ocrStatus: OcrStatus;
  analysisStatus: AnalysisStatus;
  progress: ServerProgress;
  currentPage?: number;
  pageCount: number;
  outline: ServerOutlineItem[];
  lowConfidencePages: number[];
  averageConfidence: number;
  characterCount?: number;
  parsingVersion?: string;
  analysis?: ServerAnalysis;
  partialSections?: {
    title: string;
    startPage: number;
    endPage: number;
    summary: string;
    nodes: {
      candidateId: string;
      title: string;
      role: string;
      summary: string;
      sourceBlockIds: string[];
      confidence: number;
    }[];
  }[];
  error?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerPage {
  page: number;
  width: number;
  height: number;
  textLength: number;
  blockCount: number;
  extractionMethod: "pdf_text_layer" | "ocr_required" | "kimi_vision_ocr" | "glm_ocr";
  confidence: number;
  qualityIssue?: string | null;
  mdResults?: string;
  ocr?: {
    provider: "kimi" | "local_blank_detector";
    model: string;
    generatedAt: string;
    warnings: string[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    renderedWidth: number;
    renderedHeight: number;
  };
}

export interface ServerBlock {
  id: string;
  page: number;
  readingOrder: number;
  blockType: "heading" | "paragraph" | "footnote" | "page_number" | "table" | "caption" | "header" | "footer";
  text: string;
  bbox: [number, number, number, number];
  fontSize: number | null;
  extractionMethod: string;
  confidence: number;
  footnoteMarker?: string | null;
  footnoteRefs?: {
    marker: string;
    quote: string;
    startOffset: number;
    endOffset: number;
    targetFootnoteId?: string | null;
  }[];
  footnoteReferences?: {
    blockId: string;
    page: number;
    marker: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  }[];
}

export interface DocumentSearchResult {
  blockId: string;
  page: number;
  blockType: ServerBlock["blockType"];
  text: string;
  snippet: string;
}

export interface ServerJob {
  id: string;
  documentId: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage?: string;
  stageLabel?: string;
  generatedCharacters?: number;
  error?: string;
  totalPages?: number;
  completedPages?: number;
  processedPages?: number;
  failedPages?: number;
  currentPage?: number | null;
  lastProcessedPage?: number;
  pageResults?: { page: number; status: "completed" | "failed"; confidence?: number; error?: string }[];
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (IS_DEMO) throw new ApiError(DEMO_FEATURE_MESSAGE, 503);
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || `请求失败（HTTP ${response.status}）`, response.status);
  }
  return payload as T;
}

export function getApiHealth() {
  return apiRequest<ApiHealth>("/api/health");
}

export function getKimiSettings() {
  return apiRequest<KimiSettings>("/api/settings/kimi");
}

export function getAiSettings() {
  return apiRequest<AiSettings>("/api/settings/ai");
}

export function saveAiSettings(settings: {
  ocrProvider: string; ocrModel: string;
  textProvider: string; textModel: string;
  kimi?: { apiKey?: string; baseUrl?: string };
  zhipu?: { apiKey?: string; baseUrl?: string };
  deepseek?: { apiKey?: string; baseUrl?: string };
}) {
  return apiRequest<AiSettings>("/api/settings/ai", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function testAiSettings() {
  return apiRequest<{ ok: boolean; provider: string; model: string }>("/api/settings/ai/test", { method: "POST" });
}

export function listDocuments(projectId: string) {
  return apiRequest<{ documents: ServerDocument[] }>(`/api/documents?projectId=${encodeURIComponent(projectId)}`);
}

export async function formatDocument(documentId: string) {
  const result = await apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}/format`, { method: "POST" });
  return result;
}

export function regenerateDocumentOutline(documentId: string) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}/outline/regenerate`, { method: "POST" });
}

export async function uploadDocument(file: File, projectId: string, kind: DocumentKind) {
  const form = new FormData();
  form.append("file", file);
  form.append("projectId", projectId);
  form.append("kind", kind);
  form.append("title", file.name.replace(/\.pdf$/i, ""));
  return apiRequest<{ document: ServerDocument }>("/api/documents", { method: "POST", body: form });
}

export function getDocument(documentId: string) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}`);
}

export function getDocumentPage(documentId: string, pageNumber: number) {
  return apiRequest<{ page: ServerPage; blocks: ServerBlock[] }>(`/api/documents/${encodeURIComponent(documentId)}/pages/${pageNumber}`);
}

export function getDocumentText(documentId: string) {
  return apiRequest<{ blocks: ServerBlock[]; footnotes: ServerBlock[]; characterCount: number }>(`/api/documents/${encodeURIComponent(documentId)}/text`);
}

export interface LegalCitationResult {
  id: string;
  page: number;
  marker: string;
  type: string;
  original: string;
  formatted: string;
  issues: string[];
  confidence: number;
}

export function getLegalCitations(documentId: string) {
  return apiRequest<{ documentId: string; citations: LegalCitationResult[]; total: number; needsReview: number }>(`/api/documents/${encodeURIComponent(documentId)}/legal-citations`);
}

export function searchDocument(documentId: string, query: string, limit = 80) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiRequest<{ query: string; total: number; results: DocumentSearchResult[] }>(`/api/documents/${encodeURIComponent(documentId)}/search?${params}`);
}

export function listAnnotations(filters: { documentId?: string; projectId?: string; query?: string; tag?: string }) {
  const params = new URLSearchParams();
  if (filters.documentId) params.set("documentId", filters.documentId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.query) params.set("q", filters.query);
  if (filters.tag) params.set("tag", filters.tag);
  return apiRequest<{ annotations: ReadingAnnotation[] }>(`/api/annotations?${params}`);
}

export function createAnnotation(documentId: string, annotation: ReadingAnnotation) {
  return apiRequest<{ annotation: ReadingAnnotation }>(`/api/documents/${encodeURIComponent(documentId)}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(annotation),
  });
}

export function syncDocumentAnnotations(documentId: string, annotations: ReadingAnnotation[]) {
  return apiRequest<{ annotations: ReadingAnnotation[] }>(`/api/documents/${encodeURIComponent(documentId)}/annotations/sync`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ annotations }),
  });
}

export function updateAnnotation(annotationId: string, changes: Partial<Pick<ReadingAnnotation, "kind" | "note" | "tags" | "color" | "cardType">>) {
  return apiRequest<{ annotation: ReadingAnnotation }>(`/api/annotations/${encodeURIComponent(annotationId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function deleteAnnotation(annotationId: string) {
  return apiRequest<{ ok: true; annotationId: string }>(`/api/annotations/${encodeURIComponent(annotationId)}`, {
    method: "DELETE",
  });
}

export interface ProjectTagSummary {
  tag: string;
  count: number;
  documentCount: number;
  updatedAt: string;
}

export function listProjectTags(projectId: string) {
  return apiRequest<{ tags: ProjectTagSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/tags`);
}

export function updateProjectTag(projectId: string, action: "rename" | "merge" | "delete", sourceTag: string, targetTag?: string) {
  return apiRequest<{ ok: true; affected: number }>(`/api/projects/${encodeURIComponent(projectId)}/tags`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sourceTag, targetTag }),
  });
}

export function getDocumentPageImageUrl(documentId: string, pageNumber: number) {
  return `/api/documents/${encodeURIComponent(documentId)}/pages/${pageNumber}/image`;
}

export function getDocumentFileUrl(documentId: string) {
  return `/api/documents/${encodeURIComponent(documentId)}/file`;
}

export function translateDocumentText(documentId: string, text: string) {
  return apiRequest<{ translation: string }>(`/api/documents/${encodeURIComponent(documentId)}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function askAiAboutText(documentId: string, text: string, before = "", after = "", question = "") {
  return apiRequest<{ analysis: string }>(`/api/documents/${encodeURIComponent(documentId)}/ask-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, before, after, question }),
  });
}

export function setDocumentArchived(documentId: string, archived: boolean) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
}

export function saveReadingPosition(documentId: string, currentPage: number) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPage }),
  });
}

export function deleteDocument(documentId: string) {
  return apiRequest<{ ok: true; documentId: string }>(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

export function saveOutline(documentId: string, outline: ServerOutlineItem[]) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}/outline`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outline }),
  });
}

export function startDocumentAnalysis(documentId: string, researchQuestion: string, force = false) {
  return apiRequest<{ job: ServerJob }>(`/api/documents/${encodeURIComponent(documentId)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ researchQuestion, force }),
  });
}

export function saveAnalysisNodeStatus(documentId: string, nodeId: string, status: ReadingNode["status"]) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}/analysis-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, status }),
  });
}

export function saveAnalysisIssueStatus(documentId: string, issueId: string, status: ServerJudgmentIssue["status"]) {
  return apiRequest<{ document: ServerDocument }>(`/api/documents/${encodeURIComponent(documentId)}/analysis-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueId, status }),
  });
}

export function startKimiOcr(documentId: string, pageNumbers?: number[], scope?: "all") {
  return apiRequest<{ job: ServerJob }>(`/api/documents/${encodeURIComponent(documentId)}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope === "all" ? { scope } : pageNumbers ? { pageNumbers } : {}),
  });
}

export function getJob(jobId: string) {
  return apiRequest<{ job: ServerJob }>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function toResearchDocument(document: ServerDocument): ResearchDocument {
  const nodes = document.analysis?.nodes?.map((node) => ({
    id: node.id,
    order: node.order,
    title: node.title,
    subtitle: node.role,
    page: node.sourceAnchors[0]?.page ?? 1,
    role: node.role,
    attribution: node.attribution,
    summary: node.summary,
    reasons: node.reasons,
    materials: node.sourceAnchors.slice(0, 4).map((anchor) => `第 ${anchor.page} 页 · ${anchor.text.slice(0, 90)}`),
    confidence: node.confidence,
    status: node.userStatus ?? "unread",
    sourceAnchors: node.sourceAnchors,
    sourceType: node.sourceType,
  })) satisfies ReadingNode[] | undefined;

  const issues = document.analysis?.issues?.map((issue) => ({
    id: issue.id,
    title: issue.title,
    page: issue.page,
    status: issue.status,
    claim: issue.claim,
    courtFact: issue.courtFact,
    evidence: issue.evidence,
    laws: issue.laws,
    stage: issue.stage,
    reasoning: issue.reasoning,
    conclusion: issue.conclusion,
    confidence: issue.confidence,
    sourceAnchors: issue.sourceAnchors,
  }));

  const partialNodes = document.partialSections?.flatMap((s) =>
    s.nodes.map((n, i) => ({
      id: n.candidateId,
      order: i + 1,
      title: n.title,
      subtitle: n.role,
      page: s.startPage,
      role: n.role,
      attribution: "AI推断",
      summary: n.summary,
      reasons: [],
      materials: [],
      confidence: n.confidence,
      status: "unread" as const,
      sourceAnchors: [],
      sourceType: "ai_inference" as const,
    })),
  );

  return {
    id: document.id,
    projectId: document.projectId,
    kind: document.kind,
    title: document.title,
    source: document.originalFilename || "本地上传",
    author: "待校对",
    pages: document.pageCount || 1,
    currentPage: document.currentPage ?? nodes?.[0]?.page ?? 1,
    status: document.status,
    readingStatus: document.readingStatus,
    ocrStatus: document.ocrStatus,
    analysisStatus: document.analysisStatus,
    confidence: Math.round((document.averageConfidence || 0) * 100),
    nodes: nodes ?? partialNodes,
    issues,
    activeNodeId: nodes?.[0]?.id ?? partialNodes?.[0]?.id,
    activeIssueId: issues?.[0]?.id,
    outline: document.outline,
    lowConfidencePages: document.lowConfidencePages,
    characterCount: document.characterCount,
    progress: document.progress,
    analysisSummary: document.analysis?.documentSummary,
    readingGuide: document.analysis?.readingGuide,
    analysisWarnings: document.analysis?.warnings,
    caseSummary: document.analysis?.caseSummary,
    error: document.error,
    archivedAt: document.archivedAt,
    updatedAt: new Date(document.updatedAt).toLocaleString("zh-CN", { hour12: false }),
  };
}
