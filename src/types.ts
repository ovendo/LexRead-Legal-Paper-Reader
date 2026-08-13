export type DocumentKind = "paper" | "judgment";
export type DocumentStatus = "uploaded" | "parsing" | "ocr" | "review" | "analyzing" | "ready" | "failed";
export type ReadingStatus = "processing" | "readable" | "partial" | "error";
export type OcrStatus = "idle" | "running" | "partial" | "completed" | "failed";
export type AnalysisStatus = "idle" | "running" | "completed" | "failed";
export type NodeStatus = "unread" | "passed" | "read" | "understood" | "doubt" | "disagree" | "saved";
export type CardType = "观点卡" | "案例卡" | "规范卡" | "引用卡" | "问题卡";
export type VerifyStatus = "已核验" | "待核验" | "存疑";
export type AnnotationKind = "highlight" | "note" | "bookmark";
export type HighlightColor = "yellow" | "blue" | "green" | "pink";

export interface ReadingNode {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  page: number;
  role: string;
  attribution: string;
  summary: string;
  reasons: string[];
  materials: string[];
  confidence: number;
  status: NodeStatus;
  sourceType?: "ai_summary" | "ai_inference";
  sourceAnchors?: { blockId: string; page: number; text: string; bbox: [number, number, number, number] }[];
}

export interface LegalReadingInsight {
  id: string;
  title: string;
  legalQuestion: string;
  summary: string;
  analysisApproach: string;
  framework: string[];
  confidence: number;
  sourceAnchors: { blockId: string; page: number; text: string; bbox: [number, number, number, number] }[];
}

export interface LegalParagraphInsight extends LegalReadingInsight {
  blockId: string;
  page: number;
}

export interface LegalSectionInsight extends LegalReadingInsight {
  order: number;
  paragraphs: LegalParagraphInsight[];
}

export interface LegalReadingGuide {
  document: LegalReadingInsight;
  sections: LegalSectionInsight[];
}

export interface LegalIssue {
  id: string;
  title: string;
  page: number;
  status: "已完成" | "进行中" | "待读取";
  claim: string;
  courtFact: string;
  evidence: string[];
  laws: string[];
  stage?: string;
  reasoning?: string;
  conclusion?: string;
  confidence?: number;
  sourceAnchors?: { blockId: string; page: number; text: string; bbox: [number, number, number, number] }[];
}

export interface ResearchDocument {
  id: string;
  projectId: string;
  kind: DocumentKind;
  title: string;
  source: string;
  author: string;
  pages: number;
  currentPage: number;
  status: DocumentStatus;
  readingStatus: ReadingStatus;
  ocrStatus: OcrStatus;
  analysisStatus: AnalysisStatus;
  confidence: number;
  nodes?: ReadingNode[];
  issues?: LegalIssue[];
  activeNodeId?: string;
  activeIssueId?: string;
  outline?: { id: string; title: string; level: number; page: number; blockId?: string | null; confidence: number; source: "automatic" | "user" }[];
  lowConfidencePages?: number[];
  characterCount?: number;
  progress?: { stage: string; stageLabel?: string; value: number; generatedCharacters?: number };
  analysisSummary?: { surfaceTopic: string; coreQuestion: string; coreConclusion: string; paradigm: string; boundary: string };
  readingGuide?: LegalReadingGuide;
  analysisWarnings?: string[];
  caseSummary?: { caseNumber: string; court: string; cause: string; documentType: string; procedure: string; decisionDate: string; result: string };
  error?: string | null;
  archivedAt?: string | null;
  updatedAt: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  question: string;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  questionTree: { id: string; text: string; materialCount: number }[];
  outline: { id: string; title: string; sections: number }[];
  archivedAt?: string | null;
}

export interface ResearchCard {
  id: string;
  projectId: string;
  documentId: string;
  type: CardType;
  title: string;
  excerpt: string;
  note: string;
  source: string;
  page: number;
  tags: string[];
  verifyStatus: VerifyStatus;
  relation: "支持" | "反对" | "条件性" | "背景" | "方法";
  outlineNode: string;
  targetId?: string;
  sourceAnchor?: { blockId: string; page: number; text: string };
  updatedAt: string;
}

export type MatrixStance = "支持" | "反对" | "条件性" | "背景" | "待判断";
export type MatrixEvidenceType = "学理观点" | "裁判说理" | "规范依据" | "用户摘录" | "待判断";

export interface ResearchMatrixEntry {
  sourceKey: string;
  projectId: string;
  issue: string;
  stance: MatrixStance;
  evidenceType: MatrixEvidenceType;
  note: string;
  updatedAt: string;
}

export interface WritingDraft {
  projectId: string;
  outlineId: string;
  content: string;
  citationCardIds: string[];
  updatedAt: string;
}

export interface ReadingAnnotation {
  id: string;
  projectId: string;
  documentId: string;
  kind: AnnotationKind;
  text: string;
  note: string;
  page: number;
  blockId: string;
  startOffset?: number;
  endOffset?: number;
  quotePrefix?: string;
  quoteSuffix?: string;
  pageRect?: [number, number, number, number] | null;
  segments?: { blockId: string; startOffset: number; endOffset: number; text: string }[];
  pageRects?: [number, number, number, number][];
  anchorStatus?: "exact" | "recovered" | "orphaned";
  cardType?: CardType;
  tags: string[];
  color: HighlightColor;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  time: string;
  done: boolean;
  priority: "high" | "normal";
}

export interface AppState {
  projects: ResearchProject[];
  documents: ResearchDocument[];
  annotations: ReadingAnnotation[];
  cards: ResearchCard[];
  matrixEntries: ResearchMatrixEntry[];
  writingDrafts: WritingDraft[];
  tasks: TaskItem[];
  selectedProjectId: string;
  toast: string | null;
}
