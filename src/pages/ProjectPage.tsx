import { Archive, ArchiveRestore, ArrowRight, BookOpenCheck, CircleAlert, FileText, Gavel, GitBranch, Library, Plus, Scale, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, Progress } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { ResearchDocument } from "../types";
import { getProjectProgress } from "../researchProgress";
import { deleteDocument, setDocumentArchived } from "../api";
import { DEMO_FEATURE_MESSAGE, IS_DEMO } from "../demo";

const statusCopy: Record<ResearchDocument["status"], { label: string; tone: "neutral" | "blue" | "amber" | "green" | "red" }> = {
  uploaded: { label: "等待解析", tone: "neutral" }, parsing: { label: "解析中", tone: "blue" }, ocr: { label: "OCR 中", tone: "blue" },
  review: { label: "可阅读", tone: "green" }, analyzing: { label: "可阅读 · AI 分析中", tone: "blue" }, ready: { label: "可阅读", tone: "green" }, failed: { label: "处理失败", tone: "red" },
};

export function ProjectPage() {
  const { path, navigate } = useRouter();
  const { state, dispatch } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const documents = state.documents.filter((document) => document.projectId === project.id);
  const activeDocuments = documents.filter((document) => !document.archivedAt);
  const cards = state.cards.filter((card) => card.projectId === project.id);
  const papers = activeDocuments.filter((document) => document.kind === "paper");
  const judgments = activeDocuments.filter((document) => document.kind === "judgment");
  const [showAllReviewTasks, setShowAllReviewTasks] = useState(false);
  const [showArchivedDocuments, setShowArchivedDocuments] = useState(false);
  const [pendingDocument, setPendingDocument] = useState<{ document: ResearchDocument; mode: "archive" | "restore" | "delete" } | null>(null);
  const projectProgress = getProjectProgress(state, project.id);
  const visibleDocuments = documents.filter((document) => Boolean(document.archivedAt) === showArchivedDocuments);

  const reviewTasks = useMemo(() => {
    const paperTasks = papers.flatMap((document) => (document.nodes ?? [])
      .filter((node) => !node.sourceAnchors?.length || ["doubt", "disagree", "unread"].includes(node.status))
      .map((node) => ({
        id: `paper-${document.id}-${node.id}`,
        kind: "paper" as const,
        documentId: document.id,
        targetId: node.id,
        title: node.title,
        source: document.title,
        detail: !node.sourceAnchors?.length ? "AI 结论缺少真实原文依据" : node.status === "doubt" ? "理解存疑，需要回到原文判断" : node.status === "disagree" ? "与 AI 判断存在分歧" : "尚未核验原文依据",
        label: !node.sourceAnchors?.length ? "缺少依据" : node.status === "doubt" ? "存疑" : node.status === "disagree" ? "有分歧" : "待读取",
        tone: node.status === "doubt" || node.status === "disagree" ? "amber" as const : "neutral" as const,
        rank: node.status === "doubt" || node.status === "disagree" ? 1 : 4,
      })));
    const judgmentTasks = judgments.flatMap((document) => (document.issues ?? [])
      .filter((issue) => !issue.sourceAnchors?.length || issue.status !== "已完成")
      .map((issue) => ({
        id: `judgment-${document.id}-${issue.id}`,
        kind: "judgment" as const,
        documentId: document.id,
        targetId: issue.id,
        title: issue.title,
        source: document.title,
        detail: !issue.sourceAnchors?.length ? "裁判推理缺少真实原文依据" : issue.status === "进行中" ? "正在核验法院事实、证据与说理" : "尚未核验裁判原文",
        label: !issue.sourceAnchors?.length ? "缺少依据" : issue.status,
        tone: issue.status === "进行中" ? "blue" as const : "neutral" as const,
        rank: issue.status === "进行中" ? 2 : 5,
      })));
    const activeDocumentIds = new Set(activeDocuments.map((document) => document.id));
    const cardTasks = cards.filter((card) => activeDocumentIds.has(card.documentId) && card.verifyStatus !== "已核验").map((card) => ({
      id: `card-${card.id}`,
      kind: "card" as const,
      documentId: card.documentId,
      targetId: card.id,
      title: card.title,
      source: card.source,
      detail: "研究卡片尚未完成原文核验",
      label: card.verifyStatus,
      tone: "amber" as const,
      rank: 3,
    }));
    return [...paperTasks, ...judgmentTasks, ...cardTasks].sort((left, right) => left.rank - right.rank);
  }, [activeDocuments, cards, judgments, papers]);

  useEffect(() => { if (project.id !== state.selectedProjectId) dispatch({ type: "SELECT_PROJECT", projectId: project.id }); }, [dispatch, project.id, state.selectedProjectId]);

  const upload = (kind: "paper" | "judgment") => {
    if (IS_DEMO) {
      dispatch({ type: "SET_TOAST", message: DEMO_FEATURE_MESSAGE });
      return;
    }
    dispatch({ type: "SELECT_PROJECT", projectId: project.id });
    navigate(`/workspace/upload-parse?kind=${kind}`);
  };

  const openDocument = (document: ResearchDocument) => {
    if (!["readable", "partial"].includes(document.readingStatus)) return navigate(`/workspace/upload-parse?kind=${document.kind}`);
    if (document.kind === "paper") navigate(`/workspace/read/paper/${document.id}`);
    else navigate(`/workspace/read/judgment/${document.id}`);
  };

  const openReviewTask = (task: (typeof reviewTasks)[number]) => {
    if (task.kind === "card") return navigate(`/workspace/projects/${project.id}/materials?card=${encodeURIComponent(task.targetId)}`);
    if (task.kind === "paper") {
      dispatch({ type: "SET_PAPER_NODE", documentId: task.documentId, nodeId: task.targetId });
      return navigate(`/workspace/read/paper/${task.documentId}`);
    }
    dispatch({ type: "SET_ISSUE", documentId: task.documentId, issueId: task.targetId });
    navigate(`/workspace/read/judgment/${task.documentId}`);
  };

  const primaryReviewTask = reviewTasks[0];
  const secondaryReviewTasks = reviewTasks.slice(1, showAllReviewTasks ? undefined : 4);

  const confirmDocumentAction = async () => {
    if (!pendingDocument) return;
    const { document, mode } = pendingDocument;
    try {
      if (mode === "delete") {
        if (serverIdPattern.test(document.id)) await deleteDocument(document.id);
        dispatch({ type: "DELETE_DOCUMENT", documentId: document.id });
        showToastMessage("文档及关联研究卡片已删除");
      } else {
        const archived = mode === "archive";
        if (serverIdPattern.test(document.id)) await setDocumentArchived(document.id, archived);
        dispatch({ type: "ARCHIVE_DOCUMENT", documentId: document.id, archived });
        showToastMessage(archived ? "文档已归档，可随时恢复" : "文档已恢复");
      }
      setPendingDocument(null);
    } catch (error) {
      showToastMessage(error instanceof Error ? error.message : "操作失败，请稍后重试");
    }
  };

  const showToastMessage = (message: string) => dispatch({ type: "SET_TOAST", message });

  return <AppShell sidebar={false}>
    <div className="project-hub">
      <ProjectContextNav projectId={project.id} />
      <header className="project-hub-head"><div><span>研究项目</span><h1>{project.title}</h1><p>{project.question}</p></div><div><Button onClick={() => upload("paper")}><Plus size={16} />上传论文</Button><Button variant="secondary" onClick={() => upload("judgment")}><Gavel size={16} />上传裁判文书</Button></div></header>

      <section className="project-key-strip">
        <div><FileText size={19} /><span>论文<strong>{papers.length}</strong></span></div>
        <div><Gavel size={19} /><span>裁判文书<strong>{judgments.length}</strong></span></div>
        <div><Library size={19} /><span>研究卡片<strong>{cards.length}</strong></span></div>
        <div className="project-progress-summary"><span>真实进度</span><Progress value={projectProgress} /><strong>{projectProgress}%</strong></div>
      </section>

      <section className="project-research-workbench">
        <div className="project-questions-panel">
          <header><div><span className="research-board-icon"><GitBranch size={18} /></span><div><h2>研究问题结构</h2><p>围绕核心问题组织文档、观点与裁判材料。</p></div></div><button onClick={() => navigate(`/workspace/projects/${project.id}/materials`)}>进入资料库 <ArrowRight size={14} /></button></header>
          <div className="question-tree-root"><span>核心问题</span><strong>{project.question}</strong></div>
          {project.questionTree.length ? <div className="question-tree-branches">{project.questionTree.map((question, index) => <article key={question.id}><span>{index + 1}</span><div><strong>{question.text}</strong><small>{question.materialCount} 条相关材料线索</small></div></article>)}</div> : <div className="question-tree-empty"><GitBranch size={20} /><div><strong>子问题尚未形成</strong><p>文档分析完成后，可以把关键争点逐步沉淀为研究结构。</p></div></div>}
        </div>

        <aside className="project-review-center">
          <header><div><span className="review-board-icon"><ShieldCheck size={18} /></span><div><h2>待核验任务</h2><p>只显示需要回到原文确认的内容。</p></div></div><Badge tone={reviewTasks.length ? "amber" : "green"}>{reviewTasks.length} 项</Badge></header>
          {primaryReviewTask ? <><button className="primary-review-task" onClick={() => openReviewTask(primaryReviewTask)}><span><CircleAlert size={16} />建议先处理</span><strong>{primaryReviewTask.title}</strong><p>{primaryReviewTask.detail}</p><small>{primaryReviewTask.source}</small><em>继续核验 <ArrowRight size={13} /></em></button><div className="review-task-list">{secondaryReviewTasks.map((task) => <button key={task.id} onClick={() => openReviewTask(task)}><span className={`review-kind ${task.kind}`}>{task.kind === "paper" ? <BookOpenCheck size={15} /> : task.kind === "judgment" ? <Gavel size={15} /> : <Library size={15} />}</span><div><strong>{task.title}</strong><small>{task.source}</small></div><Badge tone={task.tone}>{task.label}</Badge><ArrowRight size={14} /></button>)}</div>{reviewTasks.length > 4 && <button className="review-expand" onClick={() => setShowAllReviewTasks(!showAllReviewTasks)}>{showAllReviewTasks ? "收起任务" : `查看其余 ${reviewTasks.length - 4} 项任务`}</button>}</> : <div className="review-empty"><ShieldCheck size={25} /><strong>当前没有待核验内容</strong><p>新的 AI 分析节点和研究卡片会自动进入这里。</p></div>}
        </aside>
      </section>

      <section className="project-documents-section">
        <div className="section-heading"><div><h2>{showArchivedDocuments ? "已归档文档" : "项目文档"}</h2><p>{showArchivedDocuments ? "恢复后即可继续阅读和标注。" : "打开论文即可继续阅读；AI 分析是可选的辅助视图。"}</p></div><div className="document-section-actions"><button onClick={() => setShowArchivedDocuments(!showArchivedDocuments)}>{showArchivedDocuments ? <FileText size={14} /> : <Archive size={14} />}{showArchivedDocuments ? "返回文档" : `归档 (${documents.filter((item) => item.archivedAt).length})`}</button><button onClick={() => navigate(`/workspace/projects/${project.id}/materials`)}>查看项目资料库 <ArrowRight size={14} /></button></div></div>
        <div className="project-document-grid">{visibleDocuments.map((document) => {
          const meta = statusCopy[document.status];
          const nodeCount = document.nodes?.length ?? 0;
          return <article className="project-document-row" key={document.id}><button className="project-document-open" onClick={() => openDocument(document)}><span className={`project-doc-kind ${document.kind}`} >{document.kind === "paper" ? <FileText size={21} /> : <Scale size={21} />}</span><div><strong>{document.title}</strong><p>{document.kind === "paper" ? "学术论文" : "裁判文书"} · {document.pages} 页{nodeCount ? ` · ${nodeCount} 个分析节点` : ""}</p></div><Badge tone={meta.tone}>{meta.label}</Badge><ArrowRight size={17} /></button><div className="project-document-actions"><button aria-label={document.archivedAt ? "恢复文档" : "归档文档"} title={document.archivedAt ? "恢复" : "归档"} onClick={() => setPendingDocument({ document, mode: document.archivedAt ? "restore" : "archive" })}>{document.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button><button className="danger" aria-label="删除文档" title="删除" onClick={() => setPendingDocument({ document, mode: "delete" })}><Trash2 size={15} /></button></div></article>;
        })}</div>
        {!visibleDocuments.length && <div className="project-no-docs">{showArchivedDocuments ? <Archive size={30} /> : <FileText size={30} />}<h3>{showArchivedDocuments ? "没有已归档文档" : "项目里还没有文档"}</h3><p>{showArchivedDocuments ? "归档后的论文和裁判文书会显示在这里。" : "上传一篇论文，完成基础解析后即可开始阅读和标注。"}</p>{!showArchivedDocuments && <Button onClick={() => upload("paper")}><Plus size={16} />上传第一篇论文</Button>}</div>}
      </section>

      <section className="project-question-card"><div><span>核心研究问题</span><h2>{project.question}</h2><p>文档要点和研究卡片都围绕这个问题组织。</p></div><div><span>当前阶段</span><strong>{project.stage}</strong><small>{cards.filter((card) => card.verifyStatus !== "已核验").length} 张卡片仍待核验</small></div></section>
    </div>
    {pendingDocument && <div className="simple-modal-backdrop" onMouseDown={() => setPendingDocument(null)}><div className="simple-modal confirm-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>{pendingDocument.mode === "delete" ? "删除文档" : pendingDocument.mode === "archive" ? "归档文档" : "恢复文档"}</span><h2>{pendingDocument.mode === "delete" ? "确定永久删除这份文档？" : pendingDocument.mode === "archive" ? "暂时收起这份文档？" : "恢复到项目文档？"}</h2><p>{pendingDocument.mode === "delete" ? `“${pendingDocument.document.title}”的 PDF、阅读进度及关联研究卡片都会删除，无法撤销。` : pendingDocument.mode === "archive" ? "PDF、阅读进度和全部标注都会保留。" : "恢复后可以继续阅读、核验和添加标签。"}</p><div><Button variant="secondary" onClick={() => setPendingDocument(null)}>取消</Button><Button variant={pendingDocument.mode === "delete" ? "danger" : "primary"} onClick={confirmDocumentAction}>{pendingDocument.mode === "delete" ? "永久删除" : pendingDocument.mode === "archive" ? "确认归档" : "确认恢复"}</Button></div></div></div>}
  </AppShell>;
}

const serverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
