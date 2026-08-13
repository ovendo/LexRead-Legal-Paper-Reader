import { ArrowLeft, Bookmark, Check, CheckCircle2, ChevronRight, CircleAlert, Download, FileText, Globe, Highlighter, Info, ListTree, LoaderCircle, MessageSquarePlus, MoreHorizontal, Pencil, PlusCircle, RefreshCw, Search, Sparkles, StickyNote, Tag, Tags, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAnnotation as createRemoteAnnotation, deleteAnnotation as deleteRemoteAnnotation, formatDocument, getApiHealth, getDocument, getDocumentFileUrl, getDocumentText, getJob, saveAnalysisNodeStatus, saveReadingPosition, searchDocument, startDocumentAnalysis, syncDocumentAnnotations, toResearchDocument, translateDocumentText, askAiAboutText, updateAnnotation as updateRemoteAnnotation, type ApiHealth, type DocumentSearchResult, type ServerBlock, type ServerDocument, type ServerJob } from "../api";
import { AppShell } from "../components/Layout";
import { Badge, Button } from "../components/UI";
import { FULL_VERSION_URL } from "../demo";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { AnnotationKind, CardType, HighlightColor, LegalReadingGuide, LegalReadingInsight, NodeStatus, ReadingAnnotation, ReadingNode } from "../types";

const serverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
type SelectionSegment = { blockId: string; startOffset: number; endOffset: number; text: string };
type ContinuousTextGroup = { id: string; blocks: ServerBlock[] };
type ReadingSelection = {
  text: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotePrefix: string;
  quoteSuffix: string;
  pageRect: [number, number, number, number] | null;
  segments: SelectionSegment[];
  pageRects: [number, number, number, number][];
  page: number;
  viewportRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
};
const annotationKindLabel: Record<AnnotationKind, string> = { highlight: "高亮", note: "笔记", bookmark: "收藏" };
const readingCardTypes: CardType[] = ["观点卡", "案例卡", "规范卡", "引用卡", "问题卡"];
const highlightColors: { value: HighlightColor; label: string }[] = [
  { value: "yellow", label: "琥珀" },
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "pink", label: "粉色" },
];

function annotationCardType(annotation: ReadingAnnotation): CardType {
  return annotation.cardType ?? "引用卡";
}

function annotationDisplayTags(annotation: ReadingAnnotation) {
  return [...new Set([annotationCardType(annotation), ...annotation.tags])];
}

function readSelectionWithin(container: HTMLElement | null, pageNumber: number): ReadingSelection | null {
  const browserSelection = window.getSelection();
  if (!container || !browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) return null;
  const range = browserSelection.getRangeAt(0);
  const anchorElement = browserSelection.anchorNode instanceof Element ? browserSelection.anchorNode : browserSelection.anchorNode?.parentElement;
  const focusElement = browserSelection.focusNode instanceof Element ? browserSelection.focusNode : browserSelection.focusNode?.parentElement;
  if (!anchorElement || !focusElement || !container.contains(anchorElement) || !container.contains(focusElement)) return null;

  const roots = [...container.querySelectorAll<HTMLElement>("[data-block-id]")];
  const segments = roots.flatMap((root): SelectionSegment[] => {
    if (!range.intersectsNode(root)) return [];
    const sourceText = root.textContent ?? "";
    if (!sourceText) return [];
    const offsetWithin = (node: Node, offset: number) => {
      const probe = document.createRange();
      probe.selectNodeContents(root);
      probe.setEnd(node, offset);
      return probe.toString().length;
    };
    const startOffset = root.contains(range.startContainer) ? offsetWithin(range.startContainer, range.startOffset) : 0;
    const endOffset = root.contains(range.endContainer) ? offsetWithin(range.endContainer, range.endOffset) : sourceText.length;
    if (endOffset <= startOffset) return [];
    return [{
      blockId: root.dataset.blockId || `page-${pageNumber}`,
      startOffset,
      endOffset,
      text: sourceText.slice(startOffset, endOffset),
    }];
  }).slice(0, 60);
  const selectedText = browserSelection.toString().replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!segments.length && !selectedText) return null;

  const primaryRoot = segments.length ? roots.find((root) => root.dataset.blockId === segments[0].blockId) : null;
  const blockText = primaryRoot?.textContent ?? segments[0]?.text ?? selectedText;
  const pageElement = primaryRoot?.closest<HTMLElement>(".pdf-image-page")
    ?? container.querySelector<HTMLElement>(".pdf-image-page");
  const pageBounds = pageElement?.getBoundingClientRect();
  const pageRects = pageBounds && pageBounds.width && pageBounds.height
    ? [...range.getClientRects()].flatMap((rect): [number, number, number, number][] => {
      const left = Math.max(rect.left, pageBounds.left);
      const top = Math.max(rect.top, pageBounds.top);
      const right = Math.min(rect.right, pageBounds.right);
      const bottom = Math.min(rect.bottom, pageBounds.bottom);
      if (right - left < 1 || bottom - top < 1) return [];
      return [[
        Math.max(0, Math.min(1, (left - pageBounds.left) / pageBounds.width)),
        Math.max(0, Math.min(1, (top - pageBounds.top) / pageBounds.height)),
        Math.max(0, Math.min(1, (right - left) / pageBounds.width)),
        Math.max(0, Math.min(1, (bottom - top) / pageBounds.height)),
      ]];
    }).slice(0, 120)
    : [];
  const text = (segments.length ? segments.map((segment) => segment.text).join("") : selectedText).replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!text) return null;
  const viewportRect = (() => {
    const r = range.getBoundingClientRect();
    return r.width && r.height ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
  })();
  const primarySegment = segments[0] ?? { blockId: `pdf-page-${pageNumber}`, startOffset: 0, endOffset: text.length, text };
  return {
    text,
    blockId: primarySegment.blockId,
    startOffset: primarySegment.startOffset,
    endOffset: primarySegment.endOffset,
    quotePrefix: blockText.slice(Math.max(0, primarySegment.startOffset - 80), primarySegment.startOffset),
    quoteSuffix: blockText.slice(primarySegment.endOffset, primarySegment.endOffset + 80),
    pageRect: pageRects[0] ?? null,
    segments,
    pageRects,
    page: Number(primaryRoot?.dataset.page) || pageNumber,
    viewportRect,
  };
}

const statusMap: Record<NodeStatus, { label: string; tone: "green" | "amber" | "blue" | "neutral" | "red" }> = {
  unread: { label: "未核验", tone: "neutral" },
  passed: { label: "已略读", tone: "neutral" },
  read: { label: "已阅读", tone: "blue" },
  understood: { label: "已理解", tone: "green" },
  doubt: { label: "存疑", tone: "amber" },
  disagree: { label: "不同意", tone: "red" },
  saved: { label: "已保存", tone: "blue" },
};

export function PaperReaderPage() {
  const { path, navigate } = useRouter();
  const { state, activePaper, dispatch, createCardFromPaper, showToast } = useAppStore();
  const routeDocumentId = decodeURIComponent(path.split("/read/paper/")[1]?.split("/")[0] || "");
  const linkedPage = Number(new URLSearchParams(window.location.search).get("page")) || null;
  const linkedBlockId = new URLSearchParams(window.location.search).get("block");
  const isServerDocument = serverIdPattern.test(routeDocumentId);
  const doc = state.documents.find((item) => item.id === routeDocumentId) ?? (!isServerDocument ? activePaper : undefined);
  const initialReadingPage = useRef(linkedPage ?? doc?.currentPage ?? 1);
  const [navigationMode, setNavigationMode] = useState<"toc" | "tags" | "argument">("toc");
  const [pageNumber, setPageNumber] = useState(initialReadingPage.current);
  const [documentText, setDocumentText] = useState<{ blocks: ServerBlock[]; footnotes: ServerBlock[]; characterCount: number } | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(isServerDocument);
  const [loadingText, setLoadingText] = useState(isServerDocument);
  const [loadError, setLoadError] = useState("");
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(linkedBlockId);
  const [mobilePane, setMobilePane] = useState<"route" | "document" | "analysis">("document");
  const [rightView, setRightView] = useState<"annotations" | "ai" | "info">("ai");
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [blockSelectionMode, setBlockSelectionMode] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [annotationKind, setAnnotationKind] = useState<AnnotationKind>("highlight");
  const [annotationNote, setAnnotationNote] = useState("");
  const [annotationColor, setAnnotationColor] = useState<HighlightColor>("yellow");
  const [selectedCardType, setSelectedCardType] = useState<CardType>("引用卡");
  const [tagInput, setTagInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [aiSelection, setAiSelection] = useState<ReadingSelection | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [kimiHealth, setKimiHealth] = useState<ApiHealth | null>(null);
  const [analysisJob, setAnalysisJob] = useState<ServerJob | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showTranslations, setShowTranslations] = useState(false);
  const [translatingBatch, setTranslatingBatch] = useState(false);
  const [selectionTranslation, setSelectionTranslation] = useState("");
  const [translatingSelection, setTranslatingSelection] = useState(false);
  const [aiQueryPopup, setAiQueryPopup] = useState<{ loading: boolean; response: string; error: string; source: ReadingSelection; _rect: ReadingSelection["viewportRect"] } | null>(null);
  const [formatting, setFormatting] = useState(false);
  const [readingScope, setReadingScope] = useState<"document" | "section">("document");
  const [selectedReadingSectionId, setSelectedReadingSectionId] = useState("");
  const readerStageRef = useRef<HTMLDivElement>(null);
  const annotationSyncRef = useRef(new Set<string>());
  const automaticAnalysisRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isServerDocument) return;
    let cancelled = false;
    setLoadingDocument(true);
    setLoadError("");
    getDocument(routeDocumentId)
      .then(({ document }) => {
        if (cancelled) return;
        const mapped = toResearchDocument(document);
        dispatch({ type: "UPSERT_DOCUMENT", document: mapped });
        setPageNumber(linkedPage ?? initialReadingPage.current);
        if (linkedBlockId) setFocusedBlockId(linkedBlockId);
      })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : "文档读取失败"); })
      .finally(() => { if (!cancelled) setLoadingDocument(false); });
    return () => { cancelled = true; };
  }, [dispatch, isServerDocument, linkedBlockId, linkedPage, routeDocumentId]);

  useEffect(() => {
    if (doc) setPageNumber(linkedPage ?? doc.currentPage);
    if (linkedBlockId) setFocusedBlockId(linkedBlockId);
  }, [doc?.id, linkedBlockId, linkedPage]);

  useEffect(() => {
    if (!doc || !isServerDocument || annotationSyncRef.current.has(doc.id)) return;
    annotationSyncRef.current.add(doc.id);
    const localAnnotations = state.annotations.filter((annotation) => annotation.documentId === doc.id);
    syncDocumentAnnotations(doc.id, localAnnotations)
      .then(({ annotations }) => dispatch({ type: "SYNC_DOCUMENT_ANNOTATIONS", documentId: doc.id, annotations }))
      .catch(() => {
        annotationSyncRef.current.delete(doc.id);
        showToast("标注服务暂时不可用，当前修改仍会保存在本机");
      });
  }, [dispatch, doc?.id, isServerDocument]);

  useEffect(() => {
    if (!doc || !isServerDocument) {
      setDocumentText(null);
      return;
    }
    let cancelled = false;
    setLoadingText(true);
    getDocumentText(doc.id)
      .then((result) => { if (!cancelled) setDocumentText(result); })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : "提取文本读取失败"); })
      .finally(() => { if (!cancelled) setLoadingText(false); });
    return () => { cancelled = true; };
  }, [doc?.id, isServerDocument]);

  useEffect(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setAnnotationDialogOpen(false);
  }, [doc?.id]);

  useEffect(() => {
    const guide = doc?.readingGuide;
    if (!guide) return;
    const firstSection = guide.sections[0];
    setSelectedReadingSectionId((current) => guide.sections.some((section) => section.id === current) ? current : firstSection?.id ?? "");
  }, [doc?.readingGuide]);

  useEffect(() => {
    let cancelled = false;
    const refreshKimiHealth = () => {
      getApiHealth()
        .then((health) => { if (!cancelled) setKimiHealth(health); })
        .catch(() => { if (!cancelled) setKimiHealth(null); });
    };
    refreshKimiHealth();
    window.addEventListener("lexread:kimi-settings-updated", refreshKimiHealth);
    return () => {
      cancelled = true;
      window.removeEventListener("lexread:kimi-settings-updated", refreshKimiHealth);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let selectionTimer = 0;
    const captureFinishedSelection = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nextSelection = readSelectionWithin(readerStageRef.current, pageNumber);
        if (nextSelection) setSelection(nextSelection);
      });
    };
    const captureChangedSelection = () => {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(captureFinishedSelection, 80);
    };
    document.addEventListener("pointerup", captureFinishedSelection, true);
    document.addEventListener("keyup", captureFinishedSelection, true);
    document.addEventListener("selectionchange", captureChangedSelection);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(selectionTimer);
      document.removeEventListener("pointerup", captureFinishedSelection, true);
      document.removeEventListener("keyup", captureFinishedSelection, true);
      document.removeEventListener("selectionchange", captureChangedSelection);
    };
  }, [pageNumber]);

  const nodes = doc?.nodes ?? [];
  const node = nodes.find((item) => item.id === doc?.activeNodeId) ?? nodes[0] ?? null;
  const pageAnchorIds = useMemo(() => new Set((node?.sourceAnchors ?? []).map((anchor) => anchor.blockId)), [node]);
  const documentAnnotations = useMemo(() => state.annotations.filter((annotation) => annotation.documentId === doc?.id), [doc?.id, state.annotations]);
  const continuousTextGroups = useMemo(() => groupContinuousTextBlocks(documentText?.blocks ?? []), [documentText?.blocks]);
  const markdownOutline = useMemo(() => (documentText?.blocks ?? []).flatMap((block) => {
    const title = markdownOutlineTitle(block);
    return title ? [{ id: block.id, title, page: block.page, blockId: block.id }] : [];
  }), [documentText?.blocks]);
  const documentTags = useMemo(() => {
    const counts = new Map<string, { count: number; pages: number[] }>();
    for (const annotation of documentAnnotations) {
      for (const tag of annotationDisplayTags(annotation)) {
        const current = counts.get(tag) ?? { count: 0, pages: [] };
        current.count += 1;
        if (!current.pages.includes(annotation.page)) current.pages.push(annotation.page);
        counts.set(tag, current);
      }
    }
    return [...counts.entries()].map(([tag, value]) => ({ tag, ...value })).sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"));
  }, [documentAnnotations]);
  const tagSuggestions = useMemo(() => {
    const existing = [
      ...state.annotations.filter((annotation) => annotation.projectId === doc?.projectId).flatMap((annotation) => annotation.tags),
      ...state.cards.filter((card) => card.projectId === doc?.projectId).flatMap((card) => card.tags),
    ];
    return [...new Set(["核心观点", "重要引用", "研究方法", "待核验", ...existing])].slice(0, 8);
  }, [doc?.projectId, state.annotations, state.cards]);
  const annotationSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (query.length < 2) return [];
    return documentAnnotations.filter((annotation) =>
      `${annotation.text} ${annotation.note} ${annotationDisplayTags(annotation).join(" ")}`.toLocaleLowerCase("zh-CN").includes(query)
    ).slice(0, 30);
  }, [documentAnnotations, searchQuery]);
  const selectedBlockId = useMemo(() => selection?.blockId ?? null, [selection?.blockId]);

  const translateFullText = useCallback(async () => {
    if (!doc || !isServerDocument) return;
    if (showTranslations) { setShowTranslations(false); return; }
    setShowTranslations(true);
    if (Object.keys(translations).length) return;
    setTranslatingBatch(true);
    const blocks = documentText?.blocks ?? [];
    const CHUNK_SIZE = 8;
    for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
      const chunk = blocks.slice(i, i + CHUNK_SIZE);
      const chunkText = chunk.map((block) => block.text).join("\n\n");
      if (!chunkText.trim()) continue;
      try {
        const result = await translateDocumentText(doc.id, chunkText);
        const chunkTranslations = result.translation.split(/\n\n+/);
        setTranslations((prev) => {
          const next = { ...prev };
          chunk.forEach((block, index) => {
            next[block.id] = chunkTranslations[index]?.trim() || "";
          });
          return next;
        });
      } catch {
        showToast("翻译请求失败，请检查 AI 配置");
      }
    }
    setTranslatingBatch(false);
  }, [doc, isServerDocument, showTranslations, translations, documentText?.blocks, showToast]);

  const translateSelection = useCallback(async () => {
    if (!selection || !doc || !isServerDocument) return;
    setSelectionTranslation("");
    setTranslatingSelection(true);
    try {
      const result = await translateDocumentText(doc.id, selection.text);
      setSelectionTranslation(result.translation);
    } catch {
      showToast("翻译请求失败");
    } finally {
      setTranslatingSelection(false);
    }
  }, [doc, isServerDocument, selection, showToast]);

  const clearSelectionTranslation = useCallback(() => {
    setSelectionTranslation("");
  }, []);

  const startAiAnalysis = useCallback(async (automatic = false) => {
    if (!doc || !isServerDocument) return;
    setRightView("ai");
    setMobilePane("analysis");
    setAnalysisError("");
    if (!kimiHealth?.configured) {
      if (!automatic) window.dispatchEvent(new Event("lexread:open-api-settings"));
      return;
    }
    try {
      const projectQuestion = state.projects.find((project) => project.id === doc.projectId)?.question ?? "";
      const { job } = await startDocumentAnalysis(doc.id, projectQuestion, Boolean(doc.nodes?.length && !doc.readingGuide));
      setAnalysisJob(job);
      dispatch({
        type: "UPSERT_DOCUMENT",
        document: {
          ...doc,
          status: "analyzing",
          analysisStatus: "running",
          progress: { stage: "preparing_sections", value: Math.max(8, job.progress || 0) },
          error: null,
        },
      });
      showToast(automatic ? "已自动生成 AI 阅读辅助" : "AI 阅读辅助已开始生成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 阅读辅助启动失败";
      setAnalysisError(message);
      try {
        const { document } = await getDocument(doc.id);
        dispatch({ type: "UPSERT_DOCUMENT", document: toResearchDocument(document) });
      } catch { /* retain the readable document */ }
    }
  }, [dispatch, doc, isServerDocument, kimiHealth?.configured, showToast, state.projects]);

  const formatFullDocument = useCallback(async () => {
    if (!doc || !isServerDocument) return;
    setFormatting(true);
    try {
      const { document: formattedDocument } = await formatDocument(doc.id);
      dispatch({ type: "UPSERT_DOCUMENT", document: toResearchDocument(formattedDocument) });
      const textResult = await getDocumentText(doc.id);
      setDocumentText(textResult);
      showToast("AI 一键排版完成，已校正标题、脚注和页面噪声");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "排版失败");
    } finally {
      setFormatting(false);
    }
  }, [dispatch, doc, isServerDocument, showToast]);

  useEffect(() => {
    if (!doc || !isServerDocument || !kimiHealth?.configured || doc.readingGuide || doc.analysisStatus === "running") return;
    if (automaticAnalysisRef.current.has(doc.id)) return;
    automaticAnalysisRef.current.add(doc.id);
    void startAiAnalysis(true);
  }, [doc, isServerDocument, kimiHealth?.configured, startAiAnalysis]);

  useEffect(() => {
    if (!doc || !isServerDocument || doc.analysisStatus !== "running") return;
    let cancelled = false;
    const pollAnalysis = async () => {
      for (let attempt = 0; attempt < 360 && !cancelled; attempt += 1) {
        try {
          const [documentResult, jobResult] = await Promise.all([
            getDocument(doc.id),
            analysisJob?.id ? getJob(analysisJob.id).catch(() => null) : Promise.resolve(null),
          ]);
          if (cancelled) return;
          if (jobResult?.job) setAnalysisJob(jobResult.job);
          const mapped = toResearchDocument(documentResult.document);
          dispatch({ type: "UPSERT_DOCUMENT", document: mapped });
          if (mapped.analysisStatus === "completed") {
            setAnalysisError("");
            showToast("AI 阅读辅助已生成，可按论证节点返回原文核验");
            return;
          }
          if (mapped.analysisStatus === "failed") {
            setAnalysisError(mapped.error || jobResult?.job.error || "AI 阅读辅助生成失败");
            return;
          }
        } catch (error) {
          if (attempt >= 2) setAnalysisError(error instanceof Error ? error.message : "生成进度暂时无法读取");
        }
        await wait(1000);
      }
    };
    void pollAnalysis();
    return () => { cancelled = true; };
  }, [analysisJob?.id, dispatch, doc?.analysisStatus, doc?.id, isServerDocument, showToast]);

  if (loadingDocument) return <ReaderState title="正在打开论文" detail="正在加载原文、目录和阅读位置…" />;
  if (loadError && !doc) return <ReaderState title="无法打开论文" detail={loadError} action={() => navigate("/workspace/upload-parse")} />;
  if (!doc) return <ReaderState title="还没有可阅读的论文" detail="请先上传并完成 PDF 基础解析。" action={() => navigate("/workspace/upload-parse")} />;
  if (!isServerDocument && !node) return <ReaderState title="体验完整论文阅读" detail="请下载完整版体验 PDF 阅读、OCR 与 AI 分析功能。" actionLabel="下载完整版" action={() => { window.location.href = FULL_VERSION_URL; }} />;

  const goToPage = (nextPage: number, blockId: string | null = null) => {
    const bounded = Math.max(1, Math.min(doc.pages, nextPage));
    setPageNumber(bounded);
    setFocusedBlockId(blockId);
    dispatch({ type: "SET_DOCUMENT_PAGE", documentId: doc.id, page: bounded });
    if (isServerDocument) void saveReadingPosition(doc.id, bounded).catch(() => undefined);
    if (blockId) window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  };

  const goToFootnote = (footnoteId: string) => {
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-footnote-id="${CSS.escape(footnoteId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 20);
  };

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!doc || query.length < 2) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(query ? "至少输入两个字符" : "");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const result = await searchDocument(doc.id, query);
      setSearchResults(result.results);
      setSearchTotal(result.total);
    } catch (error) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const openSearchResult = (result: DocumentSearchResult) => {
    goToPage(result.page, result.blockId);
    setSearchOpen(false);
    setMobilePane("document");
  };

  const selectNode = (item: ReadingNode) => {
    dispatch({ type: "SET_PAPER_NODE", documentId: doc.id, nodeId: item.id });
    const anchor = item.sourceAnchors?.[0];
    goToPage(anchor?.page ?? item.page, anchor?.blockId ?? null);
    setMobilePane("document");
  };

  const setStatus = (status: NodeStatus) => {
    if (!node) return;
    if (status === "understood" && !node.sourceAnchors?.length) {
      showToast("缺少真实原文依据，不能标记为已核验");
      return;
    }
    dispatch({ type: "SET_NODE_STATUS", documentId: doc.id, nodeId: node.id, status });
    if (isServerDocument) void saveAnalysisNodeStatus(doc.id, node.id, status).catch(() => showToast("核验状态已保存在本机，稍后会重试同步"));
    if (status === "understood") {
      const nextNode = nodes[node.order] ?? null;
      showToast(nextNode ? "已确认，继续核验下一节点" : "全文主要论证已核验完成");
      if (nextNode) window.setTimeout(() => selectNode(nextNode), 250);
    } else {
      showToast("已标记存疑，稍后可集中复核");
    }
  };

  const warning = doc.analysisWarnings?.[0] || "AI 提炼可能遗漏限定条件，请结合下方原文锚点核验。";
  const hasEvidence = Boolean(node?.sourceAnchors?.length);

  const captureSelection = () => {
    window.requestAnimationFrame(() => {
      const nextSelection = readSelectionWithin(readerStageRef.current, pageNumber);
      if (nextSelection) setSelection(nextSelection);
    });
  };

  const selectionForBlock = (block: ServerBlock): ReadingSelection => {
    return {
      text: block.text,
      blockId: block.id,
      startOffset: 0,
      endOffset: block.text.length,
      quotePrefix: "",
      quoteSuffix: "",
      pageRect: null,
      segments: [{ blockId: block.id, startOffset: 0, endOffset: block.text.length, text: block.text }],
      pageRects: [],
      page: block.page,
      viewportRect: null,
    };
  };

  const selectionWithBlockRect = (current: ReadingSelection) => current;

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const clearBrowserSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setBlockSelectionMode(false);
  };

  const createAnnotation = (kind: AnnotationKind, options?: { openEditor?: boolean }) => {
    if (!selection) return;
    if (options?.openEditor) {
      setEditingAnnotationId(null);
      setAnnotationKind(kind);
      setAnnotationNote("");
      setAnnotationColor("yellow");
      setSelectedCardType("引用卡");
      setSelectedTags([]);
      setTagInput("");
      setAnnotationDialogOpen(true);
      return;
    }
    const anchoredSelection = selectionWithBlockRect(selection);
    const annotation: ReadingAnnotation = {
      id: `annotation-${Date.now()}`,
      projectId: doc.projectId,
      documentId: doc.id,
      kind,
      text: anchoredSelection.text,
      note: "",
      page: anchoredSelection.page,
      blockId: anchoredSelection.blockId,
      startOffset: anchoredSelection.startOffset,
      endOffset: anchoredSelection.endOffset,
      quotePrefix: anchoredSelection.quotePrefix,
      quoteSuffix: anchoredSelection.quoteSuffix,
      pageRect: anchoredSelection.pageRect,
      segments: anchoredSelection.segments,
      pageRects: anchoredSelection.pageRects,
      anchorStatus: "exact",
      cardType: "引用卡",
      tags: [],
      color: "yellow",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_ANNOTATION", annotation });
    if (isServerDocument) void createRemoteAnnotation(doc.id, annotation).catch(() => showToast("高亮已保存在本机，稍后会重试同步"));
    clearBrowserSelection();
    setRightView("annotations");
    showToast(kind === "bookmark" ? "已收藏这段原文" : "高亮已保存");
  };

  const saveSelectionAsCitation = () => {
    if (!selection) return;
    const anchoredSelection = selectionWithBlockRect(selection);
    dispatch({ type: "ADD_CARD", card: {
      id: `c-citation-${Date.now()}`,
      projectId: doc.projectId,
      documentId: doc.id,
      type: "引用卡",
      title: anchoredSelection.text.length > 34 ? `${anchoredSelection.text.slice(0, 34)}…` : anchoredSelection.text,
      excerpt: anchoredSelection.text,
      note: "待写作时补充：这条引文准备如何支撑你的判断。",
      source: doc.source,
      page: anchoredSelection.page,
      tags: [],
      verifyStatus: "已核验",
      relation: "支持",
      outlineNode: "待归入提纲",
      sourceAnchor: { blockId: anchoredSelection.blockId, page: anchoredSelection.page, text: anchoredSelection.text },
      updatedAt: "刚刚",
    } });
    clearBrowserSelection();
    showToast("已加入写作引用，可在“开始写作”中插入段落");
  };

  const askAiAboutSelection = () => {
    if (!selection || !doc) return;
    const rect = selection.viewportRect;
    setAiQueryPopup({ loading: false, response: "", error: "", source: selection, _rect: rect });
    setSelection(null);
  };

  const submitAiQuestion = async (question: string) => {
    if (!aiQueryPopup || !doc) return;
    const source = aiQueryPopup.source;
    setAiQueryPopup({ ...aiQueryPopup, loading: true, response: "", error: "" });
    try {
      const { analysis } = await askAiAboutText(doc.id, source.text, source.quotePrefix, source.quoteSuffix, question);
      setAiQueryPopup({ ...aiQueryPopup, loading: false, response: analysis, error: "" });
    } catch (error) {
      setAiQueryPopup({ ...aiQueryPopup, loading: false, response: "", error: error instanceof Error ? error.message : "AI 查询失败" });
    }
  };

  const openAnnotationEditor = (annotation: ReadingAnnotation) => {
    setEditingAnnotationId(annotation.id);
    setAnnotationKind(annotation.kind);
    setAnnotationNote(annotation.note);
    setAnnotationColor(annotation.color);
    setSelectedCardType(annotationCardType(annotation));
    setSelectedTags(annotation.tags);
    setTagInput("");
    setAnnotationDialogOpen(true);
  };

  const saveAnnotation = () => {
    const editing = editingAnnotationId ? state.annotations.find((annotation) => annotation.id === editingAnnotationId) : null;
    if (!selection && !editing) return;
    const customTags = tagInput.split(/[，,、]/).map((tag) => tag.trim()).filter(Boolean);
    const tags = [...new Set([...selectedTags, ...customTags])];
    if (editing) {
      const changes = { kind: annotationKind, note: annotationNote.trim(), tags, color: annotationColor, cardType: selectedCardType };
      dispatch({ type: "UPDATE_ANNOTATION", annotationId: editing.id, changes });
      if (isServerDocument) void updateRemoteAnnotation(editing.id, changes).catch(() => showToast("修改已保存在本机，稍后会重试同步"));
      showToast("标注已更新");
    } else if (selection) {
      const anchoredSelection = selectionWithBlockRect(selection);
      const annotation: ReadingAnnotation = {
        id: `annotation-${Date.now()}`,
        projectId: doc.projectId,
        documentId: doc.id,
        kind: annotationKind,
        text: anchoredSelection.text,
        note: annotationNote.trim(),
        page: anchoredSelection.page,
        blockId: anchoredSelection.blockId,
        startOffset: anchoredSelection.startOffset,
        endOffset: anchoredSelection.endOffset,
        quotePrefix: anchoredSelection.quotePrefix,
        quoteSuffix: anchoredSelection.quoteSuffix,
        pageRect: anchoredSelection.pageRect,
        segments: anchoredSelection.segments,
        pageRects: anchoredSelection.pageRects,
        anchorStatus: "exact",
        cardType: selectedCardType,
        tags,
        color: annotationColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_ANNOTATION", annotation });
      if (isServerDocument) void createRemoteAnnotation(doc.id, annotation).catch(() => showToast("标注已保存在本机，稍后会重试同步"));
      showToast("阅读标注已保存");
    }
    clearBrowserSelection();
    setAnnotationDialogOpen(false);
    setEditingAnnotationId(null);
    setRightView("annotations");
  };

  const openAnnotationSource = (annotation: ReadingAnnotation) => {
    goToPage(annotation.page, annotation.blockId);
    setMobilePane("document");
    if (annotation.anchorStatus === "recovered") showToast("原文更新后已自动恢复标注位置");
    if (annotation.anchorStatus === "orphaned") showToast("未找到完全一致的原文片段，已返回原页");
  };

  const convertAnnotationToCard = (annotation: ReadingAnnotation) => {
    const cardType = annotationCardType(annotation);
    const relation = cardType === "案例卡" || cardType === "规范卡" ? "背景" : cardType === "问题卡" ? "条件性" : "支持";
    dispatch({ type: "ADD_CARD", card: {
      id: `c-annotation-${Date.now()}`,
      projectId: annotation.projectId,
      documentId: annotation.documentId,
      type: cardType,
      title: annotation.text.length > 34 ? `${annotation.text.slice(0, 34)}…` : annotation.text,
      excerpt: annotation.text,
      note: annotation.note || "由阅读标注转为研究卡片。",
      source: doc.title,
      page: annotation.page,
      tags: annotation.tags,
      verifyStatus: "已核验",
      relation,
      outlineNode: "待关联提纲",
      sourceAnchor: { blockId: annotation.blockId, page: annotation.page, text: annotation.text },
      updatedAt: "刚刚",
    } });
    showToast(`已转为${cardType}，原阅读标注仍保留`);
  };

  const deleteAnnotation = (annotation: ReadingAnnotation) => {
    if (!window.confirm("删除这条标注？研究卡片不会受到影响。")) return;
    dispatch({ type: "DELETE_ANNOTATION", annotationId: annotation.id });
    if (isServerDocument) void deleteRemoteAnnotation(annotation.id).catch(() => showToast("本机标注已删除，服务端同步将在稍后重试"));
    showToast("标注已删除");
  };

  return <AppShell sidebar={false} full>
    <header className="reader-header reader-header-simple">
      <button className="back-link" onClick={() => navigate(`/workspace/projects/${doc.projectId}/overview`)}><ArrowLeft size={16} />返回项目</button>
      <div><h1>{doc.title}</h1><span>Markdown 全文阅读 · 连续文本 · 脚注文末汇总</span></div>
      <div className="reader-header-actions"><button onClick={() => setSearchOpen((current) => !current)} className={searchOpen ? "is-active" : ""}><Search size={15} />搜索</button><button onClick={() => { setRightView("info"); setMobilePane("analysis"); }}><MoreHorizontal size={15} />更多</button><Badge tone={doc.readingStatus === "partial" ? "amber" : "green"}>提取文本</Badge></div>
    </header>

    {searchOpen && <section className="reader-search-panel" aria-label="全文搜索">
      <form onSubmit={(event) => { event.preventDefault(); void runSearch(); }}><Search size={17} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索全文，至少输入两个字符" aria-label="搜索全文" /><button type="submit" disabled={searching}>{searching ? "搜索中" : "搜索"}</button><button type="button" onClick={() => setSearchOpen(false)} aria-label="关闭搜索"><X size={16} /></button></form>
      {searchError && <p className="reader-search-error">{searchError}</p>}
      {!searchError && searchQuery.trim().length >= 2 && !searching && <div className="reader-search-summary">提取文本 {searchTotal} 处 · 标注 {annotationSearchResults.length} 条{searchTotal > searchResults.length ? `，显示前 ${searchResults.length} 处` : ""}</div>}
      {annotationSearchResults.length > 0 && <div className="reader-search-annotation-results"><strong>阅读标注</strong>{annotationSearchResults.map((annotation) => <button key={annotation.id} onClick={() => { openAnnotationSource(annotation); setSearchOpen(false); }}><span>{annotationKindLabel[annotation.kind]} · {annotationCardType(annotation)}</span><p>{annotation.note || annotation.text}</p><div>{annotationDisplayTags(annotation).map((tag) => <em key={tag}>{tag}</em>)}</div></button>)}</div>}
      {searchResults.length > 0 && <div className="reader-search-results">{searchResults.map((result) => <button key={`${result.blockId}-${result.page}`} onClick={() => openSearchResult(result)}><span>提取文本</span><p>{result.snippet}</p><ChevronRight size={14} /></button>)}</div>}
    </section>}

    <nav className="reader-mobile-switch" aria-label="阅读器视图"><button className={mobilePane === "route" ? "is-active" : ""} onClick={() => setMobilePane("route")}>导航</button><button className={mobilePane === "document" ? "is-active" : ""} onClick={() => setMobilePane("document")}>提取文本</button><button className={mobilePane === "analysis" ? "is-active" : ""} onClick={() => setMobilePane("analysis")}>阅读工具</button></nav>
    <div className="reader-layout paper-reader reader-layout-simple">
      <aside className={`reader-left ${mobilePane !== "route" ? "mobile-pane-inactive" : ""}`}>
        <div className="reader-navigation-tabs">
          <button className={navigationMode === "toc" ? "is-active" : ""} onClick={() => setNavigationMode("toc")}><ListTree size={14} />目录</button>
          <button className={navigationMode === "tags" ? "is-active" : ""} onClick={() => setNavigationMode("tags")}><Tags size={14} />标签</button>
          <button className={navigationMode === "argument" ? "is-active" : ""} onClick={() => setNavigationMode("argument")}><Sparkles size={14} />论证</button>
        </div>
        {navigationMode === "argument" ? nodes.length ? <div className="argument-steps simple-argument-steps">{nodes.map((item) => {
          const meta = statusMap[item.status];
          return <button key={item.id} className={item.id === node?.id ? "is-active" : ""} onClick={() => selectNode(item)}>
            <span className="step-number">{item.order}</span>
            <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
            <Badge tone={!item.sourceAnchors?.length ? "amber" : meta.tone}>{item.id === node?.id ? "当前" : !item.sourceAnchors?.length ? "AI 推断" : meta.label}</Badge>
          </button>;
        })}</div> : <div className="reader-tool-empty"><Sparkles size={22} /><strong>{doc.analysisStatus === "running" ? "正在生成 AI 论证结构" : "AI 论证结构准备中"}</strong><p>{doc.analysisStatus === "running" ? "生成完成后会自动显示论证节点与原文依据。" : "阅读器会默认在后台自动生成。"}</p></div>
          : navigationMode === "tags" ? documentTags.length ? <div className="reader-tag-navigation">{documentTags.map((item) => <section key={item.tag}><header><Tag size={12} /><strong>{item.tag}</strong><span>{item.count}</span></header><div>{documentAnnotations.filter((annotation) => annotationDisplayTags(annotation).includes(item.tag)).map((annotation) => <button key={annotation.id} onClick={() => openAnnotationSource(annotation)}>{annotation.text.slice(0, 64)}</button>)}</div></section>)}</div> : <div className="reader-tool-empty"><Tags size={22} /><strong>本文还没有标签</strong><p>给原文添加标签后，可以从这里按主题快速返回。</p></div>
            : <div className="author-toc">{markdownOutline.length ? markdownOutline.map((item) => <button key={item.id} onClick={() => { goToPage(item.page, item.blockId); setMobilePane("document"); }}>{item.title}</button>) : <div className="reader-tool-empty"><FileText size={22} /><strong>没有识别到目录</strong><p>可直接连续阅读全文。</p></div>}</div>}
      </aside>

      <section className={`document-canvas ${mobilePane !== "document" ? "mobile-pane-inactive" : ""}`}>
        <div className="doc-toolbar simple-doc-toolbar">
          <strong className="markdown-mode-label">提取文本 · Markdown</strong>
          <button className={`reader-tag-entry ${blockSelectionMode ? "is-active" : ""}`} onClick={() => { setBlockSelectionMode((current) => !current); showToast(blockSelectionMode ? "已退出选段模式" : "选段模式已开启，点击一段原文即可标注"); }}><Highlighter size={15} />{blockSelectionMode ? "点击原文选段" : "选择文字加标签"}</button>
          {isServerDocument && <button className="translation-toggle" onClick={translateFullText} disabled={translatingBatch}>{translatingBatch ? <LoaderCircle className="spin" size={13} /> : <Globe size={13} />}{showTranslations ? "隐藏翻译" : translatingBatch ? "翻译中" : "翻译全文"}</button>}
          {isServerDocument && <button className="translation-toggle" onClick={() => void formatFullDocument()} disabled={formatting}>{formatting ? <LoaderCircle className="spin" size={13} /> : <ListTree size={13} />}{formatting ? "排版中" : "AI 一键排版"}</button>}
          <span />
          {isServerDocument && <a className="doc-download-link" href={getDocumentFileUrl(doc.id)} download><Download size={15} />下载 PDF</a>}
        </div>

        <div className="real-page-stage" ref={readerStageRef}>
          {loadingText && <div className="page-loading">正在整理 Markdown 全文…</div>}
          {!isServerDocument ? <DemoEvidencePage node={node} page={pageNumber} onSelect={captureSelection} annotations={documentAnnotations} /> : <article className="markdown-document selectable-text-page" onMouseUp={captureSelection} onPointerUp={captureSelection}>
            {continuousTextGroups.length ? continuousTextGroups.map((group) => {
              if (group.blocks.length > 1) return <ContinuousMarkdownParagraph
                key={group.id}
                group={group}
                annotations={documentAnnotations}
                focusedBlockId={focusedBlockId}
                sourceBlockIds={pageAnchorIds}
                selectable={blockSelectionMode}
                selectedBlockId={selectedBlockId}
                onSelectBlock={(block) => { setSelection(selectionForBlock(block)); setBlockSelectionMode(false); }}
                onFootnoteClick={goToFootnote}
                translations={showTranslations ? translations : {}}
              />;
              const block = group.blocks[0];
              const blockAnnotations = annotationsForBlock(block.text, block.id, documentAnnotations);
              return <div key={block.id}>
                <MarkdownBlock
                  key={block.id}
                  block={block}
                  annotations={blockAnnotations}
                  focused={focusedBlockId === block.id}
                  sourced={pageAnchorIds.has(block.id)}
                  selectable={blockSelectionMode}
                  selected={selectedBlockId === block.id}
                  onSelectBlock={() => { setSelection(selectionForBlock(block)); setBlockSelectionMode(false); }}
                  onFootnoteClick={goToFootnote}
                />
                {showTranslations && translations[block.id] && <div className="translation-block"><div className="translation-block-label"><Globe size={11} />翻译</div>{translations[block.id]}</div>}
              </div>;
            }) : !loadingText && <div className="page-loading">未提取到可显示的正文。</div>}
            {translatingBatch && <div className="translation-progress"><LoaderCircle className="spin" size={13} /> 正在翻译全文…</div>}
            {documentText?.footnotes.length ? <section className="markdown-footnotes" aria-label="脚注"><h2>脚注</h2>{documentText.footnotes.map((block) => {
              const blockAnnotations = annotationsForBlock(block.text, block.id, documentAnnotations);
              return <div key={block.id}>
                <MarkdownBlock
                  key={block.id}
                  block={block}
                  annotations={blockAnnotations}
                  focused={focusedBlockId === block.id}
                  sourced={pageAnchorIds.has(block.id)}
                  selectable={blockSelectionMode}
                  selected={selectedBlockId === block.id}
                  onSelectBlock={() => { setSelection(selectionForBlock(block)); setBlockSelectionMode(false); }}
                  onFootnoteReferenceClick={(reference) => goToPage(reference.page, reference.blockId)}
                  footnote
                />
                {showTranslations && translations[block.id] && <div className="translation-block"><div className="translation-block-label"><Globe size={11} />翻译</div>{translations[block.id]}</div>}
              </div>;
            })}</section> : null}
          </article>}
          {selection && <div className="selection-action-bar"><div className="selection-summary"><Highlighter size={16} /><strong>“{selection.text.slice(0, 54)}{selection.text.length > 54 ? "…" : ""}”</strong></div><div className="selection-actions"><button onMouseDown={(event) => event.preventDefault()} onClick={saveSelectionAsCitation}><MessageSquarePlus size={14} />写作引用</button><button onMouseDown={(event) => event.preventDefault()} onClick={() => createAnnotation("highlight")}><Highlighter size={14} />高亮</button><button onMouseDown={(event) => event.preventDefault()} onClick={() => createAnnotation("highlight", { openEditor: true })}><Tag size={14} />标签</button><button onMouseDown={(event) => event.preventDefault()} onClick={() => createAnnotation("note", { openEditor: true })}><StickyNote size={14} />笔记</button><button onMouseDown={(event) => event.preventDefault()} onClick={askAiAboutSelection}><Sparkles size={14} />询问 AI</button><button onMouseDown={(event) => event.preventDefault()} onClick={translateSelection}><Globe size={14} />翻译</button></div><button className="selection-close" onClick={clearBrowserSelection} aria-label="取消选择"><X size={15} /></button></div>}
          {aiQueryPopup && <AiQueryPopup
          response={aiQueryPopup.response}
          error={aiQueryPopup.error}
          loading={aiQueryPopup.loading}
          selectedText={aiQueryPopup.source.text}
          viewportRect={aiQueryPopup._rect}
          onAsk={submitAiQuestion}
          onClose={() => setAiQueryPopup(null)}
          onSave={(text) => {
            if (!doc) return;
            const annotation: ReadingAnnotation = {
              id: `note-${Date.now()}`,
              documentId: doc.id,
              projectId: doc.projectId,
              kind: "note",
              text: `AI 分析：${text.slice(0, 80)}…`,
              note: text,
              color: "yellow",
              tags: ["AI分析"],
              cardType: "观点卡",
              blockId: aiQueryPopup.source.blockId,
              page: aiQueryPopup.source.page,
              startOffset: aiQueryPopup.source.startOffset,
              endOffset: aiQueryPopup.source.endOffset,
              pageRects: aiQueryPopup.source.pageRects,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            dispatch({ type: "ADD_ANNOTATION", annotation });
            if (isServerDocument) createRemoteAnnotation(doc.id, annotation).catch(() => {});
            setRightView("annotations");
            setAiQueryPopup(null);
            showToast("AI 分析已保存到右侧栏");
          }}
        />}

        {selectionTranslation && <div className="translation-popover"><div className="translation-popover-header"><strong>选中文本翻译</strong><button onClick={clearSelectionTranslation} aria-label="关闭"><X size={14} /></button></div>{selectionTranslation}</div>}
          {translatingSelection && <div className="translation-popover"><div className="translation-popover-header"><strong>选中文本翻译</strong></div><span className="translation-loading"><LoaderCircle className="spin" size={14} /> 翻译中…</span></div>}
        </div>
      </section>

      <aside className={`reader-right reader-insight-simple ${mobilePane !== "analysis" ? "mobile-pane-inactive" : ""}`}>
        <div className="reader-tool-tabs">
          <button className={rightView === "annotations" ? "is-active" : ""} onClick={() => setRightView("annotations")}><Tag size={14} />标注</button>
          <button className={rightView === "ai" ? "is-active" : ""} onClick={() => setRightView("ai")}><Sparkles size={14} />AI 助手</button>
          <button className={rightView === "info" ? "is-active" : ""} onClick={() => setRightView("info")}><Info size={14} />信息</button>
        </div>
        {rightView === "annotations" && <div className="reader-annotation-panel">
          <header><span>全文标注</span><strong>{documentAnnotations.length} 条阅读记录</strong></header>
          {documentAnnotations.length ? <div className="reader-page-annotations">{documentAnnotations.map((annotation) => <article key={annotation.id} className={`annotation-card annotation-color-${annotation.color}`}><button className="annotation-source" onClick={() => openAnnotationSource(annotation)}><span>{annotationKindLabel[annotation.kind]} · {annotationCardType(annotation)}{annotation.anchorStatus === "recovered" ? " · 锚点已恢复" : annotation.anchorStatus === "orphaned" ? " · 定位需修复" : ""}</span><p>{annotation.text}</p>{annotation.note && <strong>{annotation.note}</strong>}<div>{annotationDisplayTags(annotation).map((tag) => <em key={tag}>{tag}</em>)}</div></button><footer><button onClick={() => openAnnotationEditor(annotation)}><Pencil size={12} />编辑</button><button onClick={() => convertAnnotationToCard(annotation)}><PlusCircle size={12} />转为{annotationCardType(annotation)}</button><button className="is-danger" onClick={() => deleteAnnotation(annotation)}><Trash2 size={12} />删除</button></footer></article>)}</div> : <div className="reader-tool-empty"><Highlighter size={23} /><strong>全文还没有标注</strong><p>在提取文本中选择文字，即可添加标签和阅读记录。</p></div>}
        </div>}
        {rightView === "ai" && (doc.readingGuide ? <LegalReadingGuidePanel
          guide={doc.readingGuide}
          scope={readingScope}
          sectionId={selectedReadingSectionId}
          onScopeChange={setReadingScope}
          onSectionChange={setSelectedReadingSectionId}
          onOpenSource={(page, blockId) => {
            goToPage(page, blockId);
            setMobilePane("document");
          }}
        /> : node && doc.analysisStatus !== "running" ? <>
          <div className="insight-head"><span>AI 阅读辅助 · 第 {node.order}/{nodes.length} 个节点</span><Badge tone={node.confidence < 75 ? "amber" : "blue"}>{node.confidence}%</Badge><h2>{node.title}</h2><p>{node.role} · {node.attribution}</p></div>
          <div className="insight-body">
            {aiSelection && <section className="ai-selection-context"><span className="insight-label">已带入选中文本</span><blockquote>{aiSelection.text}</blockquote><Button size="sm" onClick={() => showToast("已基于选中文本建立提问上下文")}><Sparkles size={14} />基于这段文字提问</Button></section>}
            <section><span className="insight-label">核心判断</span><MarkdownResponse content={node.summary || "AI 未生成可用判断。"} /></section>
            {node.reasons.length > 0 && <section><span className="insight-label">主要理由</span><ul>{node.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
            <section><span className="insight-label">文本依据</span><div className="source-anchor-list">{node.sourceAnchors?.length ? node.sourceAnchors.map((anchor) => <button key={anchor.blockId} onClick={() => { goToPage(anchor.page, anchor.blockId); setMobilePane("document"); }}><FileText size={14} /><span>{anchor.text.slice(0, 88)}</span></button>) : <p>该项是 AI 推断，尚无可靠文本定位。</p>}</div></section>
            <section className="critical-box"><div><CircleAlert size={17} /><span>使用提示</span></div><p>{warning}</p></section>
            <section className="reader-save-row"><button disabled={!hasEvidence} title={!hasEvidence ? "缺少原文依据" : undefined} onClick={() => createCardFromPaper(doc.id, "观点卡")}><PlusCircle size={15} />转为观点卡</button><button disabled={!hasEvidence} title={!hasEvidence ? "缺少原文依据" : undefined} onClick={() => createCardFromPaper(doc.id, "引用卡")}><MessageSquarePlus size={15} />保存引用</button></section>
          </div>
        </> : <AiGenerationPanel
          configured={Boolean(kimiHealth?.configured)}
          model={kimiHealth?.textModel ?? "kimi-k2.6"}
          status={doc.analysisStatus}
          progress={analysisJob?.progress ?? doc.progress?.value ?? 0}
          stageLabel={analysisJob?.stageLabel ?? doc.progress?.stageLabel}
          generatedCharacters={analysisJob?.generatedCharacters ?? doc.progress?.generatedCharacters ?? 0}
          error={analysisError || (doc.analysisStatus === "failed" ? doc.error || "" : "")}
          selection={aiSelection?.text ?? ""}
          onGenerate={() => void startAiAnalysis(false)}
          onConfigure={() => window.dispatchEvent(new Event("lexread:open-api-settings"))}
        />)}
        {rightView === "info" && <div className="reader-document-info"><span>文献信息</span><h2>{doc.title}</h2><dl><div><dt>来源</dt><dd>{doc.source}</dd></div><div><dt>作者</dt><dd>{doc.author || "待补充"}</dd></div><div><dt>页数</dt><dd>{doc.pages} 页</dd></div><div><dt>文字可信度</dt><dd>{doc.confidence}%</dd></div><div><dt>AI 辅助</dt><dd>{doc.analysisStatus === "completed" ? "已生成" : doc.analysisStatus === "running" ? "生成中" : "未生成"}</dd></div></dl></div>}
      </aside>
    </div>

    <footer className="reader-simple-progress"><span>Markdown 全文</span><strong>{documentText?.characterCount ?? doc.characterCount ?? 0} 字</strong><button onClick={() => navigate(`/workspace/projects/${doc.projectId}/materials`)}>查看全部阅读材料 →</button></footer>
    {annotationDialogOpen && (selection || editingAnnotationId) && <div className="simple-modal-backdrop" onMouseDown={() => setAnnotationDialogOpen(false)}><div className="simple-modal reading-tag-modal annotation-editor-modal" role="dialog" aria-modal="true" aria-label={editingAnnotationId ? "编辑标注" : "添加标注"} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setAnnotationDialogOpen(false)} aria-label="关闭"><X size={18} /></button><span>{editingAnnotationId ? "编辑阅读标注" : "提取文本标注"}</span><h2>{editingAnnotationId ? "调整这条阅读记录" : "保存并对应研究卡类型"}</h2><blockquote>{editingAnnotationId ? state.annotations.find((annotation) => annotation.id === editingAnnotationId)?.text : selection?.text}</blockquote><label>研究卡类型<div className="card-type-choice-grid">{readingCardTypes.map((cardType) => <button type="button" className={selectedCardType === cardType ? "is-selected" : ""} key={cardType} onClick={() => setSelectedCardType(cardType)}>{selectedCardType === cardType && <Check size={13} />}{cardType}</button>)}</div></label><label>标注方式<div className="annotation-kind-grid">{(["highlight", "note", "bookmark"] as AnnotationKind[]).map((kind) => <button type="button" className={annotationKind === kind ? "is-selected" : ""} key={kind} onClick={() => setAnnotationKind(kind)}>{annotationKind === kind && <Check size={13} />}{annotationKindLabel[kind]}</button>)}</div></label><label>高亮颜色<div className="annotation-color-grid">{highlightColors.map((color) => <button type="button" className={`annotation-color-${color.value} ${annotationColor === color.value ? "is-selected" : ""}`} aria-label={color.label} key={color.value} onClick={() => setAnnotationColor(color.value)}><span />{color.label}</button>)}</div></label><label>笔记<textarea value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} placeholder="记录你的理解、疑问或关联线索" /></label><label>内容标签<div className="tag-choice-grid">{tagSuggestions.map((tag) => <button type="button" className={selectedTags.includes(tag) ? "is-selected" : ""} key={tag} onClick={() => toggleTag(tag)}>{selectedTags.includes(tag) && <Check size={13} />}{tag}</button>)}</div></label><label>新标签<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="多个标签用逗号分隔" /></label><div><Button variant="secondary" onClick={() => setAnnotationDialogOpen(false)}>取消</Button><Button onClick={saveAnnotation}><Highlighter size={15} />{editingAnnotationId ? "保存修改" : "保存标注"}</Button></div></div></div>}
  </AppShell>;
}

function AiGenerationPanel({
  configured,
  model,
  status,
  progress,
  stageLabel,
  generatedCharacters,
  error,
  selection,
  onGenerate,
  onConfigure,
}: {
  configured: boolean;
  model: string;
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  stageLabel?: string;
  generatedCharacters?: number;
  error: string;
  selection: string;
  onGenerate: () => void;
  onConfigure: () => void;
}) {
  const running = status === "running";
  const percent = Math.max(0, Math.min(100, running ? Math.max(8, progress) : progress));
  const title = !configured
    ? "连接 Kimi 后自动生成"
    : running
      ? (stageLabel || "正在生成三级 AI 阅读辅助")
      : status === "failed"
        ? "生成未完成，原文仍可阅读"
        : "AI 阅读辅助准备自动生成";
  return <div className="reader-ai-generation" role="status" aria-live="polite">
    <header>
      <span><Sparkles size={19} /></span>
      <div><small>AI 阅读辅助 · 默认自动生成</small><h2>{title}</h2></div>
      <Badge tone={running ? "blue" : status === "failed" ? "amber" : configured ? "green" : "neutral"}>{running ? `${percent}%` : configured ? "轻量模式" : "待配置"}</Badge>
    </header>
    <p>将按“全文—一级标题”生成法学问题意识、概括、分析思路和框架，并把判断链接回原文。</p>
    <div className="ai-generation-model"><span>生成模型</span><strong>{model}</strong><em>关闭深度思考</em></div>
    {selection && <blockquote>已保留选中文本：“{selection.slice(0, 100)}{selection.length > 100 ? "…" : ""}”</blockquote>}
    {running && <div className="ai-generation-progress">
      <div><span>{stageLabel || "生成进度"}</span><strong>{(generatedCharacters ?? 0).toLocaleString("zh-CN")} 字</strong></div>
      <i><b style={{ width: `${percent}%` }} /></i>
      <small>已生成字数会随全文与章节分析结果累加</small>
    </div>}
    {error && <div className="ai-generation-error"><CircleAlert size={16} /><div><strong>生成任务遇到问题</strong><p>{error}</p><small>原文、目录和阅读标注都已保留。</small></div></div>}
    <footer>
      {!configured ? <Button onClick={onConfigure}>配置 Kimi 并自动生成</Button> : <Button onClick={onGenerate} disabled={running}>{running ? <LoaderCircle className="spin" size={15} /> : status === "failed" ? <RefreshCw size={15} /> : <Sparkles size={15} />}{running ? "正在后台生成" : status === "failed" ? "重新生成阅读辅助" : "立即生成阅读辅助"}</Button>}
    </footer>
  </div>;
}

function LegalReadingGuidePanel({
  guide,
  scope,
  sectionId,
  onScopeChange,
  onSectionChange,
  onOpenSource,
}: {
  guide: LegalReadingGuide;
  scope: "document" | "section";
  sectionId: string;
  onScopeChange: (scope: "document" | "section") => void;
  onSectionChange: (sectionId: string) => void;
  onOpenSource: (page: number, blockId: string) => void;
}) {
  const section = guide.sections.find((item) => item.id === sectionId) ?? guide.sections[0] ?? guide.document;
  const insight: LegalReadingInsight | undefined = scope === "document" ? guide.document : section;
  if (!insight) return <div className="reader-tool-empty"><CircleAlert size={22} /><strong>阅读结构尚不完整</strong><p>可重新生成以补齐这一层级。</p></div>;
  const scopeLabel = scope === "document" ? "全文" : "一级标题";
  return <div className="legal-reading-panel">
    <header>
      <div><span>AI 法学阅读辅助</span><h2>{scopeLabel}</h2></div>
      <Badge tone={insight.confidence < 70 ? "amber" : "blue"}>{insight.confidence}%</Badge>
    </header>
    <nav aria-label="阅读分析层级">
      <button className={scope === "document" ? "is-active" : ""} onClick={() => onScopeChange("document")}>全文</button>
      <button className={scope === "section" ? "is-active" : ""} onClick={() => onScopeChange("section")}>一级标题</button>
    </nav>
    {scope !== "document" && <div className="legal-reading-selectors">
      <label><span>一级标题</span><select value={section?.id ?? ""} onChange={(event) => onSectionChange(event.target.value)}>{guide.sections.map((item) => <option value={item.id} key={item.id}>{item.order}. {item.title}</option>)}</select></label>
    </div>}
    <div className="legal-reading-content">
      <div className="legal-reading-title"><small>{scopeLabel}</small><h3>{insight.title}</h3></div>
      <section className="legal-question-block"><span>法学问题意识</span><MarkdownResponse content={insight.legalQuestion || "未识别到明确的法学问题意识，建议结合原文复核。"} /></section>
      <section><span>内容概括</span><MarkdownResponse content={insight.summary || "暂无概括。"} /></section>
      <section><span>分析思路</span><MarkdownResponse content={insight.analysisApproach || "暂无分析思路。"} /></section>
      <section><span>论证框架</span>{insight.framework.length ? <ol>{insight.framework.map((item, index) => <li key={`${index}-${item}`}><i>{index + 1}</i><p>{item}</p></li>)}</ol> : <p>暂无可确认的框架。</p>}</section>
      <section className="legal-reading-sources"><span>原文依据</span><div>{insight.sourceAnchors.length ? insight.sourceAnchors.slice(0, 12).map((anchor) => <button key={anchor.blockId} onClick={() => onOpenSource(anchor.page, anchor.blockId)}><FileText size={13} /><span>第 {anchor.page} 页</span><p>{anchor.text.slice(0, 76)}</p><ChevronRight size={13} /></button>) : <p>这一判断尚未绑定可靠原文。</p>}</div></section>
      <div className="legal-reading-caution"><CircleAlert size={14} /><p>AI 提炼用于建立阅读路径；法律概念、规范依据与作者立场仍需回到原文核验。</p></div>
    </div>
  </div>;
}

function inferredMarkdownHeadingLevel(block: ServerBlock) {
  if (block.blockType === "heading") return 2;
  const text = block.text.replace(/\s+/g, "").trim();
  if (text.length <= 64 && /^[一二三四五六七八九十]+、/.test(text)) return 2;
  if (text.length <= 42 && /^第[一二三四五六七八九十]+[，,]/.test(text)) return 3;
  return null;
}

function embeddedMarkdownHeadingLength(block: ServerBlock) {
  if (block.blockType !== "paragraph") return 0;
  const ordinalMatch = block.text.match(/^(第[一二三四五六七八九十]+[，,][^。]{2,60}。)/);
  if (ordinalMatch) return ordinalMatch[1].length;
  const match = block.text.match(/^([一二三四五六七八九十]+、.{2,34}?(?:关系变迁|关系|变迁|结构|机制|问题|逻辑|结论|建议|路径|对策))/);
  return match?.[1].length ?? 0;
}

function markdownOutlineTitle(block: ServerBlock) {
  if (inferredMarkdownHeadingLevel(block)) return block.text.replace(/\s+/g, " ").trim();
  const embeddedLength = embeddedMarkdownHeadingLength(block);
  return embeddedLength ? block.text.slice(0, embeddedLength).replace(/\s+/g, " ").trim() : null;
}

function groupContinuousTextBlocks(blocks: ServerBlock[]) {
  const groups: ContinuousTextGroup[] = [];
  for (const block of blocks) {
    const previousGroup = groups.at(-1);
    const previousBlock = previousGroup?.blocks.at(-1);
    const previousLooksLikeAuthorLine = previousBlock
      && previousBlock.text.replace(/\s+/g, "").length <= 80
      && /(大学|学院|教授|研究员|学者|作者)/.test(previousBlock.text);
    const continuesPreviousParagraph = previousBlock?.blockType === "paragraph"
      && block.blockType === "paragraph"
      && !previousLooksLikeAuthorLine
      && !inferredMarkdownHeadingLevel(previousBlock)
      && !inferredMarkdownHeadingLevel(block)
      && !/[。！？!?；;：:][”’）》】）)]?$/.test(previousBlock.text.trim())
      && !/^[一二三四五六七八九十]+、/.test(block.text.trim());
    if (previousGroup && continuesPreviousParagraph) previousGroup.blocks.push(block);
    else groups.push({ id: block.id, blocks: [block] });
  }
  return groups;
}

function ContinuousMarkdownParagraph({
  group,
  annotations,
  focusedBlockId,
  sourceBlockIds,
  selectable,
  selectedBlockId,
  onSelectBlock,
  onFootnoteClick,
  translations,
}: {
  group: ContinuousTextGroup;
  annotations: ReadingAnnotation[];
  focusedBlockId: string | null;
  sourceBlockIds: Set<string>;
  selectable: boolean;
  selectedBlockId: string | null;
  onSelectBlock: (block: ServerBlock) => void;
  onFootnoteClick: (footnoteId: string) => void;
  translations?: Record<string, string>;
}) {
  const groupedAnnotations = group.blocks.flatMap((block) => annotationsForBlock(block.text, block.id, annotations));
  const tags = [...new Set(groupedAnnotations.flatMap((annotation) => [annotationKindLabel[annotation.kind], ...annotationDisplayTags(annotation)]))];
  return <div className={`markdown-block ${tags.length ? "has-user-tags" : ""} ${selectable ? "is-selectable-block" : ""}`}>
    <p className="markdown-paragraph">{group.blocks.map((block) => {
      const blockAnnotations = annotationsForBlock(block.text, block.id, annotations);
      const partClassName = [
        "markdown-text-part",
        focusedBlockId === block.id ? "is-focused" : "",
        sourceBlockIds.has(block.id) ? "is-source" : "",
        selectedBlockId === block.id ? "reader-block-selected" : "",
      ].filter(Boolean).join(" ");
      return <span
        key={block.id}
        data-block-id={block.id}
        data-page={block.page}
        className={partClassName}
        onClick={selectable ? () => onSelectBlock(block) : undefined}
      ><AnnotatedText text={block.text} blockId={block.id} annotations={blockAnnotations} emphasisEnd={embeddedMarkdownHeadingLength(block)} footnoteRefs={block.footnoteRefs} onFootnoteClick={onFootnoteClick} /></span>;
    })}</p>
    {tags.length > 0 && <div className="inline-reading-tags"><Tag size={12} />{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
    {translations && group.blocks.map((block) => translations[block.id] ? <div key={`t-${block.id}`} className="translation-block"><div className="translation-block-label"><Globe size={11} />翻译</div>{translations[block.id]}</div> : null)}
  </div>;
}

function MarkdownBlock({
  block,
  annotations,
  focused,
  sourced,
  selectable,
  selected,
  onSelectBlock,
  onFootnoteClick,
  onFootnoteReferenceClick,
  footnote = false,
}: {
  block: ServerBlock;
  annotations: ReadingAnnotation[];
  focused: boolean;
  sourced: boolean;
  selectable: boolean;
  selected?: boolean;
  onSelectBlock: () => void;
  onFootnoteClick?: (footnoteId: string) => void;
  onFootnoteReferenceClick?: (reference: NonNullable<ServerBlock["footnoteReferences"]>[number]) => void;
  footnote?: boolean;
}) {
  const tags = [...new Set(annotations.flatMap((annotation) => [annotationKindLabel[annotation.kind], ...annotationDisplayTags(annotation)]))];
  const className = [
    footnote ? "markdown-footnote-text" : `markdown-${block.blockType}`,
    focused ? "is-focused" : "",
    sourced ? "is-source" : "",
  ].filter(Boolean).join(" ");
  const content = <AnnotatedText text={block.text} blockId={block.id} annotations={annotations} footnoteRefs={block.footnoteRefs} onFootnoteClick={onFootnoteClick} />;
  const textProps = {
    "data-block-id": block.id,
    "data-page": block.page,
    "data-footnote-id": footnote ? block.id : undefined,
    "data-footnote-marker": footnote ? block.footnoteMarker ?? undefined : undefined,
    className,
    onClick: selectable ? onSelectBlock : undefined,
  };

  let textElement;
  const headingLevel = inferredMarkdownHeadingLevel(block);
  if (footnote) textElement = <p {...textProps}>{content}</p>;
  else if (headingLevel === 2) textElement = <h2 {...textProps}>{content}</h2>;
  else if (headingLevel === 3) textElement = <h3 {...textProps}>{content}</h3>;
  else if (block.blockType === "table") textElement = <pre {...textProps}>{content}</pre>;
  else if (block.blockType === "caption") textElement = <p {...textProps}>{content}</p>;
  else textElement = <p {...textProps}>{content}</p>;

  return <div className={`markdown-block ${tags.length ? "has-user-tags" : ""} ${selectable ? "is-selectable-block" : ""} ${selected ? "reader-block-selected" : ""}`}>
    {textElement}
    {footnote && block.footnoteReferences?.length ? <div className="footnote-backlinks">{block.footnoteReferences.map((reference, index) => <button type="button" key={`${reference.blockId}-${reference.startOffset}`} onClick={() => onFootnoteReferenceClick?.(reference)}>返回正文{block.footnoteReferences!.length > 1 ? ` ${index + 1}` : ""}</button>)}</div> : null}
    {tags.length > 0 && <div className="inline-reading-tags"><Tag size={12} />{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
  </div>;
}

function DemoEvidencePage({ node, page, onSelect, annotations }: { node: ReadingNode; page: number; onSelect: () => void; annotations: ReadingAnnotation[] }) {
  const paragraphs = [node.summary, ...node.reasons];
  return <div className="markdown-document demo-evidence-page selectable-text-page" onMouseUp={onSelect}><h2>{node.title}</h2>{paragraphs.map((text, index) => {
    const blockId = `demo-${page}-${index}`;
    const blockAnnotations = annotations.filter((annotation) => annotation.blockId === blockId);
    const tags = [...new Set(blockAnnotations.flatMap((annotation) => [annotationKindLabel[annotation.kind], ...annotationDisplayTags(annotation)]))];
    return <div className={`markdown-block ${tags.length ? "has-user-tags" : ""}`} key={`${blockId}-${text}`}><p data-block-id={blockId} data-page={page} className={index === 0 ? "is-source" : ""}><AnnotatedText text={text} blockId={blockId} annotations={blockAnnotations} /></p>{tags.length > 0 && <div className="inline-reading-tags"><Tag size={12} />{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</div>;
  })}</div>;
}

function normalizedTextMap(text: string) {
  const characters: string[] = [];
  const sourceIndexes: number[] = [];
  let sourceIndex = 0;
  for (const character of text) {
    if (!/\s/u.test(character)) {
      characters.push(character);
      sourceIndexes.push(sourceIndex);
    }
    sourceIndex += character.length;
  }
  return { text: characters.join(""), sourceIndexes };
}

function resolveAnnotationRange(text: string, blockId: string, annotation: ReadingAnnotation) {
  const segment = annotation.segments?.find((item) => item.blockId === blockId);
  if (annotation.segments?.length && !segment) return null;
  if (!annotation.segments?.length && annotation.blockId !== blockId) return null;
  const expectedText = segment?.text || annotation.text;
  if (segment && segment.startOffset >= 0 && segment.endOffset <= text.length && segment.endOffset > segment.startOffset
    && normalizedTextMap(text.slice(segment.startOffset, segment.endOffset)).text === normalizedTextMap(expectedText).text) {
    return { start: segment.startOffset, end: segment.endOffset };
  }
  if (annotation.blockId === blockId && annotation.startOffset != null && annotation.endOffset != null
    && annotation.startOffset >= 0 && annotation.endOffset <= text.length && annotation.endOffset > annotation.startOffset
    && normalizedTextMap(text.slice(annotation.startOffset, annotation.endOffset)).text === normalizedTextMap(expectedText).text) {
    return { start: annotation.startOffset, end: annotation.endOffset };
  }

  const source = normalizedTextMap(text);
  const quote = normalizedTextMap(expectedText);
  if (!source.text || !quote.text) return null;
  let normalizedStart = source.text.indexOf(quote.text);
  let normalizedLength = quote.text.length;
  if (normalizedStart < 0 && quote.text.includes(source.text) && source.text.length >= 4) {
    normalizedStart = 0;
    normalizedLength = source.text.length;
  }
  if (normalizedStart < 0) {
    let best = { sourceStart: -1, length: 0 };
    for (let start = 0; start < source.text.length; start += 1) {
      for (let length = Math.min(source.text.length - start, quote.text.length); length >= 4; length -= 1) {
        if (length <= best.length) break;
        if (quote.text.includes(source.text.slice(start, start + length))) best = { sourceStart: start, length };
      }
    }
    if (best.sourceStart < 0) return null;
    normalizedStart = best.sourceStart;
    normalizedLength = best.length;
  }
  const start = source.sourceIndexes[normalizedStart];
  const endSourceIndex = source.sourceIndexes[normalizedStart + normalizedLength - 1];
  return start == null || endSourceIndex == null ? null : { start, end: endSourceIndex + 1 };
}

function annotationsForBlock(text: string, blockId: string, annotations: ReadingAnnotation[]) {
  return annotations.filter((annotation) => resolveAnnotationRange(text, blockId, annotation));
}

function AnnotatedText({
  text,
  blockId = "",
  annotations,
  emphasisEnd = 0,
  footnoteRefs = [],
  onFootnoteClick,
}: {
  text: string;
  blockId?: string;
  annotations: ReadingAnnotation[];
  emphasisEnd?: number;
  footnoteRefs?: NonNullable<ServerBlock["footnoteRefs"]>;
  onFootnoteClick?: (footnoteId: string) => void;
}) {
  const ranges = annotations.flatMap((annotation) => {
    const range = resolveAnnotationRange(text, blockId || annotation.blockId, annotation);
    return range ? [{ ...range, annotation }] : [];
  });
  const validFootnoteRefs = footnoteRefs.filter((reference) =>
    reference.startOffset >= 0 && reference.endOffset > reference.startOffset && reference.endOffset <= text.length
  );
  if (!ranges.length && !emphasisEnd && !validFootnoteRefs.length) return <>{text}</>;
  const boundaries = [...new Set([
    0,
    text.length,
    ...(emphasisEnd > 0 && emphasisEnd < text.length ? [emphasisEnd] : []),
    ...ranges.flatMap((range) => [range.start, range.end]),
    ...validFootnoteRefs.flatMap((reference) => [reference.startOffset, reference.endOffset]),
  ])].sort((left, right) => left - right);
  return <>{boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const annotation = ranges.find((range) => range.start <= start && range.end >= end)?.annotation;
    const footnoteReference = validFootnoteRefs.find((reference) => reference.startOffset <= start && reference.endOffset >= end);
    const content = text.slice(start, end);
    const highlighted = annotation
      ? <mark key={`${start}-${end}`} className={`reading-highlight annotation-color-${annotation.color}`}>{content}</mark>
      : <span key={`${start}-${end}`}>{content}</span>;
    const linked = footnoteReference?.targetFootnoteId && onFootnoteClick
      ? <button
        type="button"
        key={`${start}-${end}-footnote`}
        className="footnote-reference"
        title={`查看脚注 ${footnoteReference.marker}`}
        onClick={(event) => { event.stopPropagation(); onFootnoteClick(footnoteReference.targetFootnoteId!); }}
      >{highlighted}</button>
      : highlighted;
    return emphasisEnd > start
      ? <strong key={`${start}-${end}-heading`} className="markdown-inline-heading">{linked}</strong>
      : linked;
  })}</>;
}

function ReaderState({ title, detail, action, actionLabel = "返回上传页" }: { title: string; detail: string; action?: () => void; actionLabel?: string }) {
  return <AppShell sidebar={false} full><div className="reader-state"><FileText size={34} /><h1>{title}</h1><p>{detail}</p>{action && <Button onClick={action}>{actionLabel}</Button>}</div></AppShell>;
}

function AiQueryPopup({
  response,
  error,
  loading,
  selectedText,
  viewportRect,
  onClose,
  onAsk,
  onSave,
}: {
  response: string;
  error: string;
  loading: boolean;
  selectedText: string;
  viewportRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
  onClose: () => void;
  onAsk: (question: string) => void;
  onSave: (text: string) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [question, setQuestion] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const style: React.CSSProperties = viewportRect ? {
    position: "fixed",
    left: Math.max(12, Math.min(viewportRect.left, window.innerWidth - 420)),
    top: Math.min(viewportRect.bottom + 8, window.innerHeight - 350),
    width: 400,
    maxHeight: 320,
  } : {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 420,
    maxHeight: 360,
  };

  return <div className="ai-query-popup" style={style} ref={containerRef}>
    <header>
      <span><Sparkles size={16} /></span>
      <strong>{loading ? "AI 正在回答问题…" : error ? "回答出错" : response ? "AI 回答" : "询问 AI"}</strong>
      <button onClick={onClose}><X size={16} /></button>
    </header>
    <div className="ai-query-body">
      <div className="ai-query-context">原文上下文：{selectedText.slice(0, 90)}{selectedText.length > 90 ? "…" : ""}</div>
      <label className="ai-query-question"><span>你想问什么？</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：作者这里的核心论证是什么？这个观点有哪些可反驳之处？" rows={3} disabled={loading} /><button onClick={() => onAsk(question.trim())} disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{response ? "重新提问" : "结合这段原文回答"}</button></label>
      {loading ? <div className="ai-query-loading"><LoaderCircle className="spin" size={22} /><span>正在结合原文回答…</span></div>
        : error ? <div className="ai-query-error"><CircleAlert size={18} /><p>{error}</p></div>
        : <div className="ai-query-response"><MarkdownResponse content={response} /></div>}
    </div>
    {response && !loading && <footer>
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
      <Button size="sm" onClick={() => { onSave(response); setSaved(true); }} disabled={saved}>
        {saved ? <><CheckCircle2 size={14} />已保存</> : <><Bookmark size={14} />保存到右侧栏</>}
      </Button>
    </footer>}
  </div>;
}

function MarkdownResponse({ content }: { content: string }) {
  const inline = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
  return <div className="ai-markdown">{content.replace(/```(?:markdown)?/gi, "").replace(/```/g, "").split("\n").map((line, index) => {
    const value = line.trim();
    if (!value) return <span className="ai-markdown-gap" key={index} />;
    const heading = value.match(/^#{1,3}\s+(.+)/);
    if (heading) return <strong className="ai-markdown-heading" key={index}>{inline(heading[1])}</strong>;
    if (/^[-*]\s+/.test(value)) return <div className="ai-markdown-item" key={index}><i>•</i><span>{inline(value.replace(/^[-*]\s+/, ""))}</span></div>;
    if (/^\d+[.、]\s+/.test(value)) return <div className="ai-markdown-item" key={index}><i>{value.match(/^\d+/)?.[0]}.</i><span>{inline(value.replace(/^\d+[.、]\s+/, ""))}</span></div>;
    if (/^>\s?/.test(value)) return <blockquote key={index}>{inline(value.replace(/^>\s?/, ""))}</blockquote>;
    return <p key={index}>{inline(value)}</p>;
  })}</div>;
}
