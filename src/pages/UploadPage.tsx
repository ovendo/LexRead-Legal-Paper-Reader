import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, FileScan, FileText, Lightbulb, LoaderCircle, RefreshCw, Settings2, Sparkles, UploadCloud } from "lucide-react";
import { getApiHealth, getDocument, getDocumentPage, getDocumentPageImageUrl, getJob, listDocuments, regenerateDocumentOutline, saveOutline, startDocumentAnalysis, startKimiOcr, toResearchDocument, uploadDocument, type ApiHealth, type ServerBlock, type ServerDocument, type ServerJob, type ServerOutlineItem } from "../api";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { DocumentKind, DocumentStatus } from "../types";
import { AppShell } from "../components/Layout";
import { Badge, Button, Panel, Progress } from "../components/UI";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;
  let inOl = false;
  let inPara = false;
  for (const line of lines) {
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
    const h4 = bold.match(/^#{4} (.+)/);
    const h3 = bold.match(/^#{3} (.+)/);
    const h2 = bold.match(/^#{2} (.+)/);
    const h1 = bold.match(/^# (.+)/);
    const li = bold.match(/^\- (.+)/);
    const olli = bold.match(/^\d+\. (.+)/);
    if (h4) { closePara(); closeLists(); html += "<h4>" + h4[1] + "</h4>"; }
    else if (h3) { closePara(); closeLists(); html += "<h3>" + h3[1] + "</h3>"; }
    else if (h2) { closePara(); closeLists(); html += "<h2>" + h2[1] + "</h2>"; }
    else if (h1) { closePara(); closeLists(); html += "<h1>" + h1[1] + "</h1>"; }
    else if (li) { if (!inList) { closePara(); html += "<ul>"; inList = true; } html += "<li>" + li[1] + "</li>"; }
    else if (olli) { if (!inOl) { closePara(); html += "<ol>"; inOl = true; } html += "<li>" + olli[1] + "</li>"; }
    else if (!line.trim()) { closePara(); closeLists(); }
    else { if (!inPara && !inList && !inOl) { html += "<p>"; inPara = true; } else if (inPara) html += "<br>"; html += bold; }
  }
  closePara();
  closeLists();
  return html;

  function closePara() { if (inPara) { html += "</p>"; inPara = false; } }
  function closeLists() { if (inList) { html += "</ul>"; inList = false; } if (inOl) { html += "</ol>"; inOl = false; } }
}

const statusCopy: Record<DocumentStatus, { label: string; tone: "neutral" | "blue" | "amber" | "green" | "red" }> = {
  uploaded: { label: "等待解析", tone: "neutral" },
  parsing: { label: "解析中", tone: "blue" },
  ocr: { label: "AI OCR 中", tone: "blue" },
  review: { label: "可阅读", tone: "green" },
  analyzing: { label: "可阅读 · AI 分析中", tone: "blue" },
  ready: { label: "可阅读 · AI 辅助就绪", tone: "green" },
  failed: { label: "解析失败", tone: "red" },
};

function getStep(document: ServerDocument | null) {
  if (!document) return 1;
  if (document.analysisStatus === "running" || document.analysisStatus === "completed") return 3;
  if (document.readingStatus === "readable" || document.readingStatus === "partial" || document.readingStatus === "error") return 2;
  return 1;
}

export function UploadPage() {
  const { navigate } = useRouter();
  const { state, dispatch, activeProject, showToast } = useAppStore();
  const [kind] = useState<DocumentKind>(() => new URLSearchParams(window.location.search).get("kind") === "judgment" ? "judgment" : "paper");
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [liveDocument, setLiveDocument] = useState<ServerDocument | null>(null);
  const [outlineDraft, setOutlineDraft] = useState<ServerOutlineItem[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewBlocks, setPreviewBlocks] = useState<ServerBlock[]>([]);
  const [previewMdResults, setPreviewMdResults] = useState("");
  const [previewImageLoading, setPreviewImageLoading] = useState(false);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [previewImageAttempt, setPreviewImageAttempt] = useState(0);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [analysisJob, setAnalysisJob] = useState<ServerJob | null>(null);
  const [ocrJob, setOcrJob] = useState<ServerJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingOutline, setIsSavingOutline] = useState(false);
  const [isRebuildingOutline, setIsRebuildingOutline] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const files = useMemo(() => state.documents.filter((doc) => doc.projectId === state.selectedProjectId && /^[0-9a-f-]{36}$/i.test(doc.id)).slice(0, 4), [state.documents, state.selectedProjectId]);
  const step = getStep(liveDocument);
  const lowConfidenceCount = liveDocument?.lowConfidencePages?.length ?? 0;
  const ocrBatchCount = Math.min(lowConfidenceCount, 120);
  const isAnalyzing = liveDocument?.analysisStatus === "running" || analysisJob?.status === "queued" || analysisJob?.status === "running";
  const isOcrRunning = liveDocument?.ocrStatus === "running" || ocrJob?.status === "queued" || ocrJob?.status === "running";
  const isBusy = isAnalyzing || isOcrRunning;
  const isReadable = liveDocument?.readingStatus === "readable" || liveDocument?.readingStatus === "partial";
  const canAnalyze = !!liveDocument && isReadable && liveDocument.analysisStatus !== "completed" && !isBusy;
  const canOcr = !!liveDocument && isReadable && !isBusy;
  const openApiSettings = () => window.dispatchEvent(new Event("lexread:open-api-settings"));
  const refreshHealth = async () => {
    try {
      const nextHealth = await getApiHealth();
      setHealth(nextHealth);
      showToast(nextHealth.ok ? "本地 API 连接正常" : "本地 API 暂未连接");
    } catch {
      setHealth(null);
      showToast("无法连接本地 API，请确认一键启动器正在运行");
    }
  };

  const syncDocument = (document: ServerDocument, preserveOutline = false) => {
    setLiveDocument(document);
    if (!preserveOutline) setOutlineDraft(document.outline ?? []);
    dispatch({ type: "UPSERT_DOCUMENT", document: toResearchDocument(document) });
  };

  const loadPreview = async (document: ServerDocument, requestedPage?: number) => {
    if (!document.pageCount) return;
    const page = Math.max(1, Math.min(document.pageCount, requestedPage ?? document.outline?.[0]?.page ?? 1));
    setPreviewPage(page);
    setPreviewImageLoading(true);
    setPreviewImageError(false);
    setPreviewImageAttempt(0);
    try {
      const result = await getDocumentPage(document.id, page);
      setPreviewBlocks(result.blocks);
      setPreviewMdResults(result.page?.mdResults ?? "");
    } catch (error) {
      setPreviewBlocks([]);
      setPreviewMdResults("");
      setErrorMessage(error instanceof Error ? error.message : "页面预览加载失败。");
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getApiHealth(), listDocuments(state.selectedProjectId)])
      .then(([apiHealth, documentResult]) => {
        if (cancelled) return;
        setHealth(apiHealth);
        dispatch({ type: "SYNC_SERVER_DOCUMENTS", projectId: state.selectedProjectId, documents: documentResult.documents.map(toResearchDocument) });
        const latest = documentResult.documents.find((document) => document.kind === kind);
        if (latest) {
          syncDocument(latest);
          if (["readable", "partial"].includes(latest.readingStatus)) void loadPreview(latest);
        }
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? `本地服务连接失败：${error.message}` : "本地服务连接失败。");
      });
    return () => { cancelled = true; };
  // Project changes are the only reason to reload server state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedProjectId]);

  const pollParsing = async (documentId: string) => {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const { document } = await getDocument(documentId);
      syncDocument(document);
      if (["readable", "partial"].includes(document.readingStatus)) {
        await loadPreview(document);
        return document;
      }
      if (document.readingStatus === "error") throw new Error(document.error || "PDF 解析失败。");
      await wait(750);
    }
    throw new Error("解析仍在后台运行，请稍后刷新页面查看。");
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setErrorMessage("当前仅支持 PDF 文件。");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setErrorMessage("文件超过 100MB，请压缩后重新上传。");
      return;
    }

    setIsUploading(true);
    setUploadingName(file.name);
    setErrorMessage(null);
    setPreviewBlocks([]);
    try {
      const { document } = await uploadDocument(file, state.selectedProjectId, kind);
      syncDocument(document);
      setUploadingName(null);
      showToast("原文件已安全保存在本机，开始读取 PDF 文字层");
      const parsed = await pollParsing(document.id);
      showToast(parsed.lowConfidencePages.length
        ? `文档已经可以阅读，AI 阅读辅助已自动排队；另有 ${parsed.lowConfidencePages.length} 页可继续 OCR`
        : "解析完成，AI 阅读辅助已自动在后台生成");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上传或解析失败。");
    } finally {
      setIsUploading(false);
      setUploadingName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveOutlineChanges = async () => {
    if (!liveDocument) return;
    setIsSavingOutline(true);
    setErrorMessage(null);
    try {
      const { document } = await saveOutline(liveDocument.id, outlineDraft);
      syncDocument(document);
      showToast("目录校对已保存，后续分析会使用这版结构");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "目录保存失败。");
    } finally {
      setIsSavingOutline(false);
    }
  };

  const rebuildOutline = async () => {
    if (!liveDocument) return;
    setIsRebuildingOutline(true);
    setErrorMessage(null);
    try {
      const { document } = await regenerateDocumentOutline(liveDocument.id);
      syncDocument(document);
      showToast("AI 已按论文实体内容重建目录，请逐项核对后保存");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 重建目录失败。");
    } finally { setIsRebuildingOutline(false); }
  };

  const startAnalysis = async () => {
    if (!liveDocument) return;
    setErrorMessage(null);
    try {
      const { job } = await startDocumentAnalysis(liveDocument.id, activeProject.question);
      setAnalysisJob(job);
      syncDocument({ ...liveDocument, analysisStatus: "running", progress: { stage: "reconstructing_argument", value: 20 } });
      showToast(liveDocument.kind === "paper" ? "AI 正在重建论证结构，并保留原文锚点" : "AI 正在提取争点、事实、证据、规范与法院说理");

      for (let attempt = 0; attempt < 360; attempt += 1) {
        const [jobResult, documentResult] = await Promise.all([getJob(job.id), getDocument(liveDocument.id)]);
        setAnalysisJob(jobResult.job);
        syncDocument(documentResult.document);
        if (jobResult.job.status === "completed") {
          showToast(liveDocument.kind === "paper" ? "AI 论证分析完成，已加入阅读器辅助视图" : "裁判推理分析完成，已加入阅读器辅助视图");
          return;
        }
        if (jobResult.job.status === "failed") throw new Error(jobResult.job.error || "分析任务失败。");
        await wait(1000);
      }
      throw new Error("分析仍在后台运行，请稍后在项目中查看。");
    } catch (error) {
      setAnalysisJob(null);
      setErrorMessage(error instanceof Error ? error.message : "分析任务启动失败。");
      try {
        const { document } = await getDocument(liveDocument.id);
        syncDocument(document);
      } catch { /* retain last known state */ }
    }
  };

  const runKimiOcr = async (scope: "pending" | "current" | "all" = "pending") => {
    if (!liveDocument) return;
    setErrorMessage(null);
    try {
      const pageNumbers = scope === "current"
        ? [previewPage]
        : scope === "pending" ? liveDocument.lowConfidencePages?.slice(0, 120) : undefined;
      const { job } = await startKimiOcr(liveDocument.id, pageNumbers, scope === "all" ? "all" : undefined);
      setOcrJob(job);
      syncDocument({ ...liveDocument, ocrStatus: "running", progress: { stage: "kimi_ocr", value: 1 } }, true);
      showToast(scope === "all"
        ? `将全文 ${job.totalPages ?? liveDocument.pageCount} 页发送给 AI 逐页重新识别`
        : scope === "current"
          ? `正在用 AI 重新识别第 ${previewPage} 页`
          : `将 ${job.totalPages ?? ocrBatchCount} 个异常页面发送给 AI 逐页识别`);

      for (let attempt = 0; attempt < 3600; attempt += 1) {
        const [jobResult, documentResult] = await Promise.all([getJob(job.id), getDocument(liveDocument.id)]);
        setOcrJob(jobResult.job);
        syncDocument(documentResult.document, true);
        const lastPageResult = jobResult.job.pageResults?.at(-1);
        if (lastPageResult?.page === previewPage) await loadPreview(documentResult.document, previewPage);
        if (jobResult.job.status === "completed") {
          setOcrJob(null);
          syncDocument(documentResult.document);
          await loadPreview(documentResult.document, previewPage);
          const failedPages = jobResult.job.failedPages ?? 0;
          showToast(failedPages ? `AI OCR 已完成，${failedPages} 页仍需复核` : "AI OCR 已完成，页面文本块已替换并保留模型记录");
          return;
        }
        if (jobResult.job.status === "failed") throw new Error(jobResult.job.error || "AI OCR 任务失败。");
        await wait(1000);
      }
      throw new Error("AI OCR 仍在后台运行，请稍后刷新页面查看。");
    } catch (error) {
      setOcrJob(null);
      setErrorMessage(error instanceof Error ? error.message : "AI OCR 启动失败。");
      try {
        const { document } = await getDocument(liveDocument.id);
        syncDocument(document);
      } catch { /* retain last known state */ }
    }
  };

  const taskProgress = isOcrRunning
    ? ocrJob?.progress ?? liveDocument?.progress?.value ?? 0
    : isAnalyzing ? analysisJob?.progress ?? liveDocument?.progress?.value ?? 0 : liveDocument?.progress?.value ?? 0;
  const taskStageLabel = isOcrRunning
    ? ocrJob?.stageLabel ?? liveDocument?.progress?.stageLabel ?? statusCopy[liveDocument?.status ?? "uploaded"].label
    : isAnalyzing ? analysisJob?.stageLabel ?? liveDocument?.progress?.stageLabel ?? "AI 分析中" : liveDocument?.progress?.stageLabel ?? statusCopy[liveDocument?.status ?? "uploaded"].label;
  const generatedCharacters = isOcrRunning
    ? ocrJob?.generatedCharacters ?? liveDocument?.progress?.generatedCharacters ?? 0
    : isAnalyzing ? analysisJob?.generatedCharacters ?? liveDocument?.progress?.generatedCharacters ?? 0 : liveDocument?.progress?.generatedCharacters ?? 0;
  const ocrProcessedPages = ocrJob?.processedPages ?? ocrJob?.pageResults?.length ?? 0;
  const ocrTotalPages = ocrJob?.totalPages ?? (liveDocument?.pageCount || ocrBatchCount);
  const confidence = Math.round((liveDocument?.averageConfidence ?? 0) * 100);
  const selectedPageNeedsOcr = liveDocument?.lowConfidencePages?.includes(previewPage) ?? false;
  const selectedPageUsedAi = previewBlocks.some((block) => block.extractionMethod === "kimi_vision_ocr" || block.extractionMethod === "glm_ocr");
  const canLoadPreviewImage = Boolean(liveDocument && previewPage >= 1 && liveDocument.pageCount >= previewPage);

  return <AppShell sidebar={false}>
      <div className="page-header upload-header"><button className="back-link" onClick={() => navigate(`/workspace/projects/${state.selectedProjectId}/overview`)}><ArrowLeft size={16} />返回项目</button><h1>{kind === "paper" ? "分析一篇论文" : "导入一份裁判文书"}</h1><div className="stepper">{[
      [1, "上传 PDF"], [2, "开始阅读"], [3, "AI 辅助（自动）"],
    ].map(([num, label], index) => <div className={step >= Number(num) ? "is-active" : ""} key={String(label)}><span>{step > Number(num) ? <Check size={14} /> : num}</span><strong>{label}</strong>{index < 2 && <i />}</div>)}</div></div>

    <div className="upload-layout upload-layout-simple">
      <Panel title={<>项目文档 <span className="count">{files.length + (uploadingName ? 1 : 0)}</span></>} action={<Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={isUploading}>+ 添加文件</Button>} className="upload-files">
        <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => void onFile(event.target.files?.[0])} />
        {uploadingName && <div className="file-card is-live"><span className="pdf-icon"><FileText size={21} /></span><div><strong>{uploadingName}</strong><small>正在写入本地存储并读取 PDF…</small><Badge tone="blue">处理中</Badge></div><LoaderCircle className="spin" size={17} /></div>}
        {files.map((doc) => {
          const status = statusCopy[doc.status];
          return <button className={`file-card file-card-button ${doc.id === liveDocument?.id ? "is-selected" : ""}`} key={doc.id} onClick={() => {
            void getDocument(doc.id).then(({ document }) => { syncDocument(document); if (["readable", "partial"].includes(document.readingStatus)) void loadPreview(document); }).catch(() => showToast("这是演示文档，尚无服务器原文件"));
          }}><span className={doc.kind === "paper" ? "pdf-icon" : "judgment-icon"}>{doc.kind === "paper" ? <FileText size={21} /> : <FileScan size={21} />}</span><div><strong>{doc.title}</strong><small>{doc.pages} 页 · {doc.kind === "paper" ? "论文" : "裁判文书"}</small><Badge tone={status.tone}>{status.label}</Badge></div>{doc.status === "ready" ? <CheckCircle2 size={18} className="success-icon" /> : ["parsing", "ocr", "analyzing"].includes(doc.status) ? <LoaderCircle className="spin" size={17} /> : null}</button>;
        })}
        <button className="upload-dropzone" disabled={isUploading} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void onFile(event.dataTransfer.files?.[0]); }}><UploadCloud size={30} /><strong>点击或拖拽 PDF 到此处</strong><span>原文件只保存在本机；支持文字型 PDF，单文件不超过 100MB</span></button>
        <p className="upload-scope-note">{kind === "paper" ? "完成基础解析后即可进入阅读器；AI 会自动生成全文和一级标题法学阅读辅助。" : "裁判文书会先完成原文解析，再自动提取主张、事实、证据、规范、说理与结论。"}</p>
      </Panel>

      <Panel title="文档解析与阅读准备" className="parse-main">
        <div className="parse-kpis parse-kpis-simple"><div><span>文档页数</span><strong>{liveDocument?.pageCount ?? 0}<small>页</small></strong></div><div><span>文本可信度</span><strong className={confidence >= 90 ? "green" : ""}>{confidence}% {liveDocument && <Badge tone={confidence >= 90 ? "green" : "amber"}>{confidence >= 90 ? "可分析" : "需复核"}</Badge>}</strong></div><div><span>需要 OCR</span><strong>{lowConfidenceCount}<small>页</small></strong></div></div>

        {!liveDocument && <div className="parse-empty"><UploadCloud size={28} /><strong>上传一份 PDF 开始真实解析</strong><span>这里不会再用演示计时器伪造结果。</span></div>}
        {liveDocument && <div className="parse-workspace">
          <div className="page-preview">
            {isOcrRunning && <div className="ocr-page-progress" role="status" aria-live="polite"><div><span><LoaderCircle className="spin" size={15} />{taskStageLabel}</span><strong>{ocrProcessedPages} / {ocrTotalPages} 页</strong></div><Progress value={taskProgress} tone="teal" /><small>{ocrJob?.currentPage ? `正在识别第 ${ocrJob.currentPage} 页` : "正在保存本页识别结果"} · 已生成 {generatedCharacters.toLocaleString("zh-CN")} 字</small></div>}
            <div className="page-comparison">
              <section className="comparison-pane source-pane"><div className="preview-title">PDF 原页面 <span>第 {previewPage} 页</span></div><div className="original-page-preview">{previewImageLoading && <div className="preview-image-state"><LoaderCircle className="spin" size={19} />正在载入原页面</div>}{!canLoadPreviewImage ? <div className="preview-image-state"><LoaderCircle className="spin" size={19} />正在准备原页面</div> : previewImageError ? <div className="preview-image-state error"><AlertCircle size={19} />原页面加载失败</div> : <img key={`${liveDocument.id}-${previewPage}-${previewImageAttempt}`} src={`${getDocumentPageImageUrl(liveDocument.id, previewPage)}?attempt=${previewImageAttempt}`} alt={`PDF 原文第 ${previewPage} 页`} onLoad={() => setPreviewImageLoading(false)} onError={() => { if (previewImageAttempt === 0) { setPreviewImageAttempt(1); setPreviewImageLoading(true); } else { setPreviewImageLoading(false); setPreviewImageError(true); } }} />}</div></section>
              <section className="comparison-pane text-pane"><div className="preview-title">提取文本预览 <span>第 {previewPage} 页</span>{selectedPageNeedsOcr && <Badge tone="amber">文字层异常</Badge>}{selectedPageUsedAi ? <Badge tone="green">AI OCR</Badge> : liveDocument.ocrStatus !== "running" && <Badge tone="neutral">PDF 文字层</Badge>}</div><div className="paper-page paper-text-preview">{previewMdResults ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(previewMdResults) }} /> : previewBlocks.length ? previewBlocks.slice(0, 18).map((block) => block.blockType === "heading" ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>) : <div className="preview-empty">{liveDocument.readingStatus === "processing" || liveDocument.ocrStatus === "running" ? "正在处理页面文本…" : "本页没有可读取的文字层"}</div>}<span>— {previewPage} —</span></div></section>
            </div>
            <div className="page-controls"><button disabled={previewPage <= 1} onClick={() => void loadPreview(liveDocument, previewPage - 1)}>‹</button><strong>{previewPage}</strong><span>/ {liveDocument.pageCount || 1}</span><button disabled={previewPage >= liveDocument.pageCount} onClick={() => void loadPreview(liveDocument, previewPage + 1)}>›</button></div><div className="preview-ocr-actions"><Button size="sm" variant="secondary" disabled={!canOcr} onClick={() => void runKimiOcr("current")}><FileScan size={15} />AI 重识别当前页</Button><Button size="sm" variant="secondary" disabled={!canOcr} onClick={() => void runKimiOcr("all")}><RefreshCw size={15} />AI 重识别全文</Button></div>
          </div>
          <div className="outline-tree"><div className="preview-title">目录结构 <span>可直接校对标题与层级</span><div className="document-section-actions"><Button size="sm" variant="secondary" disabled={isRebuildingOutline || !isReadable} onClick={() => void rebuildOutline()}>{isRebuildingOutline ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}AI 重建目录</Button><Button size="sm" variant="secondary" disabled={!outlineDraft.length || isSavingOutline} onClick={() => void saveOutlineChanges()}>{isSavingOutline ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}保存目录</Button></div></div>
            <div className="outline-edit-list">{outlineDraft.length ? outlineDraft.map((item) => <div className="outline-edit-row" key={item.id}>
              <select aria-label="目录层级" value={item.level} onChange={(event) => setOutlineDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, level: Number(event.target.value) } : entry))}><option value={1}>H1</option><option value={2}>H2</option><option value={3}>H3</option><option value={4}>H4</option></select>
              <input aria-label="目录标题" value={item.title} onChange={(event) => setOutlineDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry))} />
              <button onClick={() => void loadPreview(liveDocument, item.page)}>第 {item.page} 页</button>
              <Badge tone={item.confidence < .8 ? "amber" : "neutral"}>{Math.round(item.confidence * 100)}%</Badge>
            </div>) : <div className="outline-empty"><RefreshCw size={18} /><span>{liveDocument.readingStatus === "processing" ? "正在识别目录…" : "没有识别到目录，可直接翻页阅读"}</span></div>}</div>
          </div>
        </div>}

        {liveDocument && <div className="simple-processing-note"><FileScan size={17} /><span>{selectedPageUsedAi ? "当前预览来自 AI OCR 识别结果。" : "当前显示 PDF 自带文字层；完成 AI OCR 后将自动替换。"}</span></div>}
        <div className="analysis-cta">
          <div className="analysis-actions">
            {liveDocument?.kind === "paper" && isReadable && <Button onClick={() => navigate(`/workspace/read/paper/${liveDocument.id}`)}>开始阅读<ArrowRight size={17} /></Button>}
            {liveDocument?.kind === "judgment" && liveDocument.analysisStatus === "completed" && <Button onClick={() => navigate(`/workspace/read/judgment/${liveDocument.id}`)}>打开裁判文书<ArrowRight size={17} /></Button>}
            {liveDocument && isReadable && liveDocument.analysisStatus !== "completed" && <Button variant="secondary" onClick={() => health?.configured ? void startAnalysis() : openApiSettings()} disabled={!canAnalyze}>
              {isAnalyzing ? <LoaderCircle className="spin" size={17} /> : <Lightbulb size={17} />}
              {isAnalyzing ? `${taskStageLabel} · 已生成 ${generatedCharacters.toLocaleString("zh-CN")} 字` : health?.configured ? "重新生成 AI 阅读辅助" : "配置 API 后自动生成"}
            </Button>}
            {isOcrRunning ? <Button variant="secondary" disabled><LoaderCircle className="spin" size={17} />{taskStageLabel} · {ocrProcessedPages}/{ocrTotalPages} 页 · {generatedCharacters.toLocaleString("zh-CN")} 字</Button> : lowConfidenceCount > 0 && <Button variant="secondary" onClick={() => health?.configured ? void runKimiOcr() : openApiSettings()} disabled={!canOcr}>{!health?.configured ? "配置 API 后修复异常页" : `继续 OCR ${ocrBatchCount} 个异常页`}<FileScan size={17} /></Button>}
          </div>
          <span>{isReadable ? "文档已通过 AI OCR 识别，随时可以阅读；AI 辅助默认在后台自动生成。" : isOcrRunning ? `${taskStageLabel}（${ocrProcessedPages || (ocrJob?.processedPages ?? 0)}/${ocrTotalPages || liveDocument?.pageCount || "?"} 页，已生成 ${generatedCharacters.toLocaleString("zh-CN")} 字），完成后即可开始阅读。` : "正在读取 PDF，完成基础解析后将自动启动 AI OCR 识别。"}</span>
        </div>
      </Panel>

      <aside className="parse-rail">
        <Panel title={<><Lightbulb size={18} className="amber-icon" />数据可信度</>}><ul className="tip-list"><li>"PDF 文字层"表示尚未调用 AI；"{health?.ocrProvider === 'zhipu' ? '智谱' : 'Kimi'} OCR"才是视觉模型结果。</li><li>发现乱码、双栏错序或漏字时，可重识别当前页或全文。</li><li>AI OCR 无法辨认的内容必须标为"无法辨认"，不能自动补写。</li></ul></Panel>
        <Panel title={<><Settings2 size={18} />运行环境</>}><div className="setting-list">
          <button onClick={() => void refreshHealth()}><span>本地 API</span><strong className={health?.ok ? "green" : ""}>{health?.ok ? "已连接 · 点击复查" : "点击检查连接"}</strong></button>
          <button onClick={openApiSettings}><span>文本分析</span><strong>{health?.textModel ?? "点击配置"}</strong></button>
          <button onClick={() => showToast("OCR 仅处理低置信页面，不会把整本 PDF 发给模型")}><span>OCR 方式</span><strong>{health?.ocrProvider === 'zhipu' ? '智谱 GLM-OCR' : 'Kimi Vision'}</strong></button>
          <button onClick={openApiSettings}><span>密钥状态</span><strong className={health?.configured ? "green" : "amber"}>{health?.configured ? "已安全加载 · 可修改" : "点击完成配置"}</strong></button>
          <button onClick={() => showToast("原 PDF 与解析结果仅保存在这台电脑")}><span>原 PDF</span><strong className="green">仅保存在本机</strong></button>
        </div></Panel>
        <Panel title={<><Clock3 size={18} />任务进度</>}><p className="estimate-copy">{liveDocument ? taskStageLabel : "等待上传文档"}</p><strong className="estimate-time">{taskProgress}<small>%</small></strong><Progress value={taskProgress} tone="teal" /><div className="stage-labels"><span>上传</span><span>AI OCR</span><span>结构分析</span></div>{liveDocument && generatedCharacters > 0 && <small className="generated-count">已生成 {generatedCharacters.toLocaleString("zh-CN")} 字</small>}</Panel>
        {errorMessage ? <div className="recover-note error-note"><AlertCircle size={17} /><span>{errorMessage}</span></div> : <div className="recover-note"><AlertCircle size={17} /><span>任务状态会落盘保存；应用重启后仍能看到已完成结果。</span></div>}
      </aside>
    </div>
  </AppShell>;
}
