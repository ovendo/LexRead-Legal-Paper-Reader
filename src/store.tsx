import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { backupResearchState, restoreResearchState, type FastLinkSnapshot } from "./fastlink";
import { initialState } from "./data";
import type { AppState, CardType, NodeStatus, ReadingAnnotation, ResearchCard, ResearchDocument, ResearchMatrixEntry, ResearchProject, WritingDraft } from "./types";

type Action =
  | { type: "SELECT_PROJECT"; projectId: string }
  | { type: "CREATE_PROJECT"; project: ResearchProject }
  | { type: "UPDATE_PROJECT_OUTLINE"; projectId: string; outline: ResearchProject["outline"] }
  | { type: "DELETE_PROJECT_OUTLINE"; projectId: string; outlineId: string }
  | { type: "ARCHIVE_PROJECT"; projectId: string; archived: boolean }
  | { type: "DELETE_PROJECT"; projectId: string }
  | { type: "TOGGLE_TASK"; taskId: string }
  | { type: "SET_DOCUMENT_STATUS"; documentId: string; status: ResearchDocument["status"] }
  | { type: "ADD_DOCUMENT"; document: ResearchDocument }
  | { type: "UPSERT_DOCUMENT"; document: ResearchDocument }
  | { type: "ARCHIVE_DOCUMENT"; documentId: string; archived: boolean }
  | { type: "DELETE_DOCUMENT"; documentId: string }
  | { type: "SYNC_SERVER_DOCUMENTS"; projectId: string; documents: ResearchDocument[] }
  | { type: "SET_DOCUMENT_PAGE"; documentId: string; page: number }
  | { type: "SET_PAPER_NODE"; documentId: string; nodeId: string }
  | { type: "SET_NODE_STATUS"; documentId: string; nodeId: string; status: NodeStatus }
  | { type: "SET_ISSUE"; documentId: string; issueId: string }
  | { type: "SET_ISSUE_STATUS"; documentId: string; issueId: string; status: "已完成" | "进行中" | "待读取" }
  | { type: "ADD_ANNOTATION"; annotation: ReadingAnnotation }
  | { type: "SYNC_DOCUMENT_ANNOTATIONS"; documentId: string; annotations: ReadingAnnotation[] }
  | { type: "UPDATE_ANNOTATION"; annotationId: string; changes: Partial<Pick<ReadingAnnotation, "kind" | "note" | "tags" | "color" | "cardType">> }
  | { type: "DELETE_ANNOTATION"; annotationId: string }
  | { type: "ADD_CARD"; card: ResearchCard }
  | { type: "UPDATE_CARD"; cardId: string; changes: Partial<Pick<ResearchCard, "title" | "note" | "tags" | "relation" | "outlineNode">> }
  | { type: "VERIFY_CARD"; cardId: string }
  | { type: "UPSERT_MATRIX_ENTRY"; entry: ResearchMatrixEntry }
  | { type: "UPSERT_WRITING_DRAFT"; draft: WritingDraft }
  | { type: "RESTORE_CLOUD_STATE"; snapshot: FastLinkSnapshot }
  | { type: "SET_TOAST"; message: string | null }
  | { type: "RESET_DEMO" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.projectId };
    case "CREATE_PROJECT":
      return { ...state, projects: [action.project, ...state.projects], selectedProjectId: action.project.id };
    case "UPDATE_PROJECT_OUTLINE":
      return { ...state, projects: state.projects.map((project) => project.id === action.projectId ? { ...project, outline: action.outline, updatedAt: "刚刚" } : project) };
    case "DELETE_PROJECT_OUTLINE":
      return {
        ...state,
        projects: state.projects.map((project) => project.id === action.projectId ? { ...project, outline: project.outline.filter((item) => item.id !== action.outlineId), updatedAt: "刚刚" } : project),
        writingDrafts: state.writingDrafts.filter((draft) => draft.projectId !== action.projectId || draft.outlineId !== action.outlineId),
      };
    case "ARCHIVE_PROJECT":
      return {
        ...state,
        projects: state.projects.map((project) => project.id === action.projectId
          ? { ...project, archivedAt: action.archived ? new Date().toISOString() : null }
          : project),
      };
    case "DELETE_PROJECT": {
      const projects = state.projects.filter((project) => project.id !== action.projectId);
      const selectedProjectId = state.selectedProjectId === action.projectId ? (projects.find((project) => !project.archivedAt)?.id ?? projects[0]?.id ?? "") : state.selectedProjectId;
      return {
        ...state,
        projects,
        documents: state.documents.filter((document) => document.projectId !== action.projectId),
        annotations: state.annotations.filter((annotation) => annotation.projectId !== action.projectId),
        cards: state.cards.filter((card) => card.projectId !== action.projectId),
        selectedProjectId,
      };
    }
    case "TOGGLE_TASK":
      return { ...state, tasks: state.tasks.map((task) => task.id === action.taskId ? { ...task, done: !task.done } : task) };
    case "SET_DOCUMENT_STATUS":
      return { ...state, documents: state.documents.map((doc) => doc.id === action.documentId ? { ...doc, status: action.status, updatedAt: "刚刚" } : doc) };
    case "ADD_DOCUMENT":
      return { ...state, documents: [action.document, ...state.documents] };
    case "UPSERT_DOCUMENT": {
      const existing = state.documents.find((document) => document.id === action.document.id);
      return {
        ...state,
        documents: existing
          ? state.documents.map((document) => document.id === action.document.id ? {
            ...document,
            ...action.document,
            currentPage: document.currentPage || action.document.currentPage,
          } : document)
          : [action.document, ...state.documents],
      };
    }
    case "ARCHIVE_DOCUMENT":
      return {
        ...state,
        documents: state.documents.map((document) => document.id === action.documentId
          ? { ...document, archivedAt: action.archived ? new Date().toISOString() : null }
          : document),
      };
    case "DELETE_DOCUMENT":
      return {
        ...state,
        documents: state.documents.filter((document) => document.id !== action.documentId),
        annotations: state.annotations.filter((annotation) => annotation.documentId !== action.documentId),
        cards: state.cards.filter((card) => card.documentId !== action.documentId),
      };
    case "SYNC_SERVER_DOCUMENTS": {
      const serverId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const retained = state.documents.filter((document) => document.projectId !== action.projectId || !serverId.test(document.id));
      return { ...state, documents: [...action.documents, ...retained] };
    }
    case "SET_DOCUMENT_PAGE":
      return {
        ...state,
        documents: state.documents.map((document) => document.id === action.documentId
          ? { ...document, currentPage: Math.max(1, Math.min(document.pages, action.page)) }
          : document),
      };
    case "SET_PAPER_NODE":
      return {
        ...state,
        documents: state.documents.map((doc) => {
          if (doc.id !== action.documentId || !doc.nodes) return doc;
          const node = doc.nodes.find((item) => item.id === action.nodeId);
          return { ...doc, activeNodeId: action.nodeId, currentPage: node?.page ?? doc.currentPage };
        }),
      };
    case "SET_NODE_STATUS":
      return {
        ...state,
        documents: state.documents.map((doc) => doc.id !== action.documentId || !doc.nodes ? doc : {
          ...doc,
          nodes: doc.nodes.map((node) => node.id === action.nodeId ? { ...node, status: action.status } : node),
        }),
      };
    case "SET_ISSUE":
      return {
        ...state,
        documents: state.documents.map((doc) => {
          if (doc.id !== action.documentId || !doc.issues) return doc;
          const issue = doc.issues.find((item) => item.id === action.issueId);
          return { ...doc, activeIssueId: action.issueId, currentPage: issue?.page ?? doc.currentPage };
        }),
      };
    case "SET_ISSUE_STATUS":
      return {
        ...state,
        documents: state.documents.map((doc) => doc.id !== action.documentId || !doc.issues ? doc : {
          ...doc,
          issues: doc.issues.map((issue) => issue.id === action.issueId ? { ...issue, status: action.status } : issue),
        }),
      };
    case "ADD_ANNOTATION":
      return { ...state, annotations: [action.annotation, ...state.annotations] };
    case "SYNC_DOCUMENT_ANNOTATIONS":
      return {
        ...state,
        annotations: [
          ...action.annotations,
          ...state.annotations.filter((annotation) => annotation.documentId !== action.documentId),
        ],
      };
    case "UPDATE_ANNOTATION":
      return {
        ...state,
        annotations: state.annotations.map((annotation) => annotation.id === action.annotationId
          ? { ...annotation, ...action.changes, updatedAt: new Date().toISOString() }
          : annotation),
      };
    case "DELETE_ANNOTATION":
      return { ...state, annotations: state.annotations.filter((annotation) => annotation.id !== action.annotationId) };
    case "ADD_CARD": {
      const exists = state.cards.some((card) =>
        card.documentId === action.card.documentId
        && card.type === action.card.type
        && card.page === action.card.page
        && card.excerpt === action.card.excerpt
      );
      return exists ? state : { ...state, cards: [action.card, ...state.cards] };
    }
    case "UPDATE_CARD":
      return { ...state, cards: state.cards.map((card) => card.id === action.cardId ? { ...card, ...action.changes, updatedAt: "刚刚" } : card) };
    case "VERIFY_CARD":
      return { ...state, cards: state.cards.map((card) => card.id === action.cardId ? { ...card, verifyStatus: "已核验", updatedAt: "刚刚" } : card) };
    case "UPSERT_MATRIX_ENTRY": {
      const exists = state.matrixEntries.some((entry) => entry.sourceKey === action.entry.sourceKey);
      return {
        ...state,
        matrixEntries: exists
          ? state.matrixEntries.map((entry) => entry.sourceKey === action.entry.sourceKey ? action.entry : entry)
          : [...state.matrixEntries, action.entry],
      };
    }
    case "UPSERT_WRITING_DRAFT": {
      const exists = state.writingDrafts.some((draft) => draft.projectId === action.draft.projectId && draft.outlineId === action.draft.outlineId);
      return { ...state, writingDrafts: exists ? state.writingDrafts.map((draft) => draft.projectId === action.draft.projectId && draft.outlineId === action.draft.outlineId ? action.draft : draft) : [...state.writingDrafts, action.draft] };
    }
    case "RESTORE_CLOUD_STATE":
      return {
        ...state,
        projects: action.snapshot.projects,
        annotations: action.snapshot.annotations,
        cards: action.snapshot.cards,
        matrixEntries: action.snapshot.matrixEntries,
        writingDrafts: action.snapshot.writingDrafts,
        tasks: action.snapshot.tasks,
        selectedProjectId: action.snapshot.selectedProjectId || state.selectedProjectId,
      };
    case "SET_TOAST":
      return { ...state, toast: action.message };
    case "RESET_DEMO":
      return initialState;
    default:
      return state;
  }
}

const STORAGE_KEY = "lexread-mvp-state-v1";

function getInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const restored = raw ? { ...initialState, ...JSON.parse(raw), toast: null } as AppState : initialState;
    return {
      ...restored,
      annotations: restored.annotations ?? [],
      matrixEntries: restored.matrixEntries ?? [],
      writingDrafts: restored.writingDrafts ?? [],
      documents: restored.documents.map((document) => ({
        ...document,
        readingStatus: document.readingStatus
          ?? (document.status === "failed" && !document.pages ? "error" : document.pages ? (document.lowConfidencePages?.length ? "partial" : "readable") : "processing"),
        ocrStatus: document.ocrStatus
          ?? (document.status === "ocr" ? "running" : document.lowConfidencePages?.length ? "idle" : document.pages ? "completed" : "idle"),
        analysisStatus: document.analysisStatus
          ?? (document.status === "analyzing" ? "running" : document.nodes?.length || document.issues?.length ? "completed" : "idle"),
        nodes: document.nodes?.map((node) => !node.sourceAnchors?.length && node.status === "understood" ? { ...node, status: "doubt" as const } : node),
        issues: document.issues?.map((issue) => !issue.sourceAnchors?.length && issue.status === "已完成" ? { ...issue, status: "进行中" as const } : issue),
      })),
      cards: restored.cards.map((card) => !card.sourceAnchor && card.verifyStatus === "已核验" ? { ...card, verifyStatus: "待核验" as const } : card),
    };
  } catch {
    return initialState;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  activeProject: AppState["projects"][number];
  activePaper?: ResearchDocument;
  activeJudgment?: ResearchDocument;
  showToast: (message: string) => void;
  createCardFromPaper: (documentId: string, type?: CardType) => void;
  createCardFromJudgment: (documentId: string) => void;
  cloudSync: { status: "idle" | "syncing" | "success" | "error"; message?: string; updatedAt?: string };
  backupToFastLink: () => Promise<void>;
  restoreFromFastLink: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);
  const [cloudSync, setCloudSync] = useState<StoreValue["cloudSync"]>({ status: "idle" });

  useEffect(() => {
    const { toast: _toast, ...persisted } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [state]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: "SET_TOAST", message: null }), 2200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  const activeProject = state.projects.find((item) => item.id === state.selectedProjectId) ?? state.projects[0];
  const activePaper = state.documents.find((doc) => doc.projectId === activeProject.id && doc.kind === "paper" && doc.nodes);
  const activeJudgment = state.documents.find((doc) => doc.projectId === activeProject.id && doc.kind === "judgment");

  const backupToFastLink = useCallback(async () => {
    setCloudSync({ status: "syncing" });
    try {
      const result = await backupResearchState(state);
      const message = `已备份至快链云端（${Math.ceil(result.usage.bytes / 1024)}KB / ${Math.ceil(result.usage.maxBytes / 1024)}KB）`;
      setCloudSync({ status: "success", message, updatedAt: result.updatedAt });
      dispatch({ type: "SET_TOAST", message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "快链云端备份失败，请稍后重试。";
      setCloudSync({ status: "error", message });
      dispatch({ type: "SET_TOAST", message });
    }
  }, [state]);

  const restoreFromFastLink = useCallback(async () => {
    setCloudSync({ status: "syncing" });
    try {
      const snapshot = await restoreResearchState();
      dispatch({ type: "RESTORE_CLOUD_STATE", snapshot });
      const message = `已从快链恢复 ${new Date(snapshot.updatedAt).toLocaleString("zh-CN")} 的研究资料`;
      setCloudSync({ status: "success", message, updatedAt: snapshot.updatedAt });
      dispatch({ type: "SET_TOAST", message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "快链云端恢复失败，请稍后重试。";
      setCloudSync({ status: "error", message });
      dispatch({ type: "SET_TOAST", message });
    }
  }, []);

  const showToast = (message: string) => dispatch({ type: "SET_TOAST", message });

  const createCardFromPaper = (documentId: string, type: CardType = "观点卡") => {
    const doc = state.documents.find((item) => item.id === documentId);
    const node = doc?.nodes?.find((item) => item.id === doc.activeNodeId);
    if (!doc || !node) return;
    const anchor = node.sourceAnchors?.[0];
    if (!anchor) {
      showToast("缺少真实原文依据，暂不能保存研究卡片");
      return;
    }
    dispatch({ type: "ADD_CARD", card: {
      id: `c-${Date.now()}`, projectId: doc.projectId, documentId: doc.id, type,
      title: node.title, excerpt: anchor.text, note: `来自“${node.title}”节点，已保留原文定位。`,
      source: doc.title, page: anchor.page, tags: [node.role, node.attribution], verifyStatus: "待核验", relation: "支持",
      outlineNode: "待关联提纲", targetId: node.id, sourceAnchor: { blockId: anchor.blockId, page: anchor.page, text: anchor.text }, updatedAt: "刚刚",
    } });
    showToast(`${type}已保存，并保留第 ${anchor.page} 页原文定位`);
  };

  const createCardFromJudgment = (documentId: string) => {
    const doc = state.documents.find((item) => item.id === documentId);
    const issue = doc?.issues?.find((item) => item.id === doc.activeIssueId);
    if (!doc || !issue) return;
    const anchor = issue.sourceAnchors?.[0];
    if (!anchor) {
      showToast("缺少真实裁判原文依据，暂不能保存案例卡");
      return;
    }
    dispatch({ type: "ADD_CARD", card: {
      id: `c-${Date.now()}`, projectId: doc.projectId, documentId: doc.id, type: "案例卡",
      title: issue.title, excerpt: anchor.text, note: `争点：${issue.claim}`,
      source: doc.title, page: anchor.page, tags: ["裁判规则", "事实要件"], verifyStatus: "待核验", relation: "背景",
      outlineNode: "待关联提纲", targetId: issue.id, sourceAnchor: { blockId: anchor.blockId, page: anchor.page, text: anchor.text }, updatedAt: "刚刚",
    } });
    showToast(`案例卡已保存，并保留第 ${anchor.page} 页裁判原文定位`);
  };

  const value = useMemo(() => ({
    state, dispatch, activeProject, activePaper, activeJudgment, showToast, createCardFromPaper, createCardFromJudgment,
    cloudSync, backupToFastLink, restoreFromFastLink,
  }), [state, activeProject, activePaper, activeJudgment, cloudSync, backupToFastLink, restoreFromFastLink]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppProvider");
  return value;
}
