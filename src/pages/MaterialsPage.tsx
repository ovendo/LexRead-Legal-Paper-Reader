import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Edit3,
  ExternalLink,
  FileClock,
  FileSearch,
  FileText,
  FolderArchive,
  Gavel,
  Layers3,
  LoaderCircle,
  Quote,
  Scale,
  Search,
  ShieldCheck,
  Tags,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, EmptyState, cx } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { CardType, DocumentKind, ResearchCard, ResearchDocument } from "../types";

type LibraryView = "documents" | "cards";
type DocumentFilter = "全部" | DocumentKind;
type CardVerifyFilter = "全部" | "待核验" | "已核验";
type DocumentSort = "updated" | "progress" | "title";

const cardTypes: CardType[] = ["观点卡", "案例卡", "规范卡", "引用卡", "问题卡"];
const typeIcon: Record<CardType, typeof FileText> = { "观点卡": Quote, "案例卡": Scale, "规范卡": FileText, "引用卡": BookOpen, "问题卡": Gavel };
const typeTone: Record<CardType, string> = { "观点卡": "blue", "案例卡": "purple", "规范卡": "teal", "引用卡": "amber", "问题卡": "red" };

const statusMeta: Record<ResearchDocument["status"], { label: string; tone: "neutral" | "blue" | "amber" | "green" | "red"; progress: number }> = {
  uploaded: { label: "等待解析", tone: "neutral", progress: 10 },
  parsing: { label: "正在解析", tone: "blue", progress: 28 },
  ocr: { label: "Kimi OCR", tone: "blue", progress: 48 },
  review: { label: "可阅读", tone: "green", progress: 100 },
  analyzing: { label: "可阅读 · AI 分析中", tone: "blue", progress: 100 },
  ready: { label: "可阅读", tone: "green", progress: 100 },
  failed: { label: "处理失败", tone: "red", progress: 0 },
};

export function MaterialsPage() {
  const { path, navigate } = useRouter();
  const { state, dispatch, showToast } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const projectDocuments = useMemo(() => state.documents.filter((document) => document.projectId === project.id), [state.documents, project.id]);
  const projectCards = useMemo(() => state.cards.filter((card) => card.projectId === project.id), [state.cards, project.id]);
  const focusedCardId = new URLSearchParams(window.location.search).get("card");
  const [view, setView] = useState<LibraryView>(focusedCardId ? "cards" : "documents");
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>("全部");
  const [documentSort, setDocumentSort] = useState<DocumentSort>("updated");
  const [cardType, setCardType] = useState<CardType | "全部">("全部");
  const [cardVerify, setCardVerify] = useState<CardVerifyFilter>("全部");
  const [query, setQuery] = useState("");
  const [selectedCardId, setSelectedCardId] = useState(focusedCardId ?? "");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const papers = projectDocuments.filter((document) => document.kind === "paper");
  const judgments = projectDocuments.filter((document) => document.kind === "judgment");
  const readyDocuments = projectDocuments.filter((document) => ["readable", "partial"].includes(document.readingStatus));
  const processingDocuments = projectDocuments.filter((document) => document.readingStatus === "processing");
  const pendingCards = projectCards.filter((card) => card.verifyStatus !== "已核验");
  const selectedCard = projectCards.find((card) => card.id === selectedCardId);

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projectDocuments.filter((document) => {
      const matchesKind = documentFilter === "全部" || document.kind === documentFilter;
      const matchesQuery = !normalized || `${document.title}${document.source}${document.author}`.toLowerCase().includes(normalized);
      return matchesKind && matchesQuery;
    }).sort((left, right) => {
      if (documentSort === "progress") {
        const leftProgress = left.pages ? left.currentPage / left.pages : 0;
        const rightProgress = right.pages ? right.currentPage / right.pages : 0;
        return leftProgress - rightProgress;
      }
      if (documentSort === "title") return left.title.localeCompare(right.title, "zh-CN");
      return right.updatedAt.localeCompare(left.updatedAt, "zh-CN", { numeric: true });
    });
  }, [documentFilter, documentSort, projectDocuments, query]);

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projectCards.filter((card) => {
      const matchesType = cardType === "全部" || card.type === cardType;
      const matchesVerify = cardVerify === "全部" || (cardVerify === "已核验" ? card.verifyStatus === "已核验" : card.verifyStatus !== "已核验");
      const matchesQuery = !normalized || `${card.title}${card.excerpt}${card.note}${card.source}${card.tags.join("")}`.toLowerCase().includes(normalized);
      return matchesType && matchesVerify && matchesQuery;
    });
  }, [cardType, cardVerify, projectCards, query]);

  useEffect(() => {
    if (project.id !== state.selectedProjectId) dispatch({ type: "SELECT_PROJECT", projectId: project.id });
  }, [dispatch, project.id, state.selectedProjectId]);

  useEffect(() => {
    if (selectedCardId && !projectCards.some((card) => card.id === selectedCardId)) setSelectedCardId("");
  }, [projectCards, selectedCardId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setSelectedCardId("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const upload = (kind: DocumentKind) => {
    dispatch({ type: "SELECT_PROJECT", projectId: project.id });
    navigate(`/workspace/upload-parse?kind=${kind}`);
  };

  const openDocument = (document: ResearchDocument) => {
    if (!["readable", "partial"].includes(document.readingStatus)) return navigate(`/workspace/upload-parse?kind=${document.kind}`);
    navigate(document.kind === "paper" ? `/workspace/read/paper/${document.id}` : `/workspace/read/judgment/${document.id}`);
  };

  const backToSource = (card: ResearchCard) => {
    const document = state.documents.find((item) => item.id === card.documentId);
    if (!document) return showToast("原始文档已不在当前项目中");
    const page = card.sourceAnchor?.page ?? card.page;
    const block = card.sourceAnchor?.blockId;
    if (document.kind === "judgment") {
      const targetId = card.targetId ?? [...(document.issues ?? [])].sort((left, right) => Math.abs(left.page - page) - Math.abs(right.page - page))[0]?.id;
      if (targetId) dispatch({ type: "SET_ISSUE", documentId: document.id, issueId: targetId });
      dispatch({ type: "SET_DOCUMENT_PAGE", documentId: document.id, page });
      return navigate(`/workspace/read/judgment/${document.id}?page=${page}${block ? `&block=${encodeURIComponent(block)}` : ""}`);
    }
    const targetId = card.targetId ?? [...(document.nodes ?? [])].sort((left, right) => Math.abs(left.page - page) - Math.abs(right.page - page))[0]?.id;
    if (targetId) dispatch({ type: "SET_PAPER_NODE", documentId: document.id, nodeId: targetId });
    dispatch({ type: "SET_DOCUMENT_PAGE", documentId: document.id, page });
    navigate(`/workspace/read/paper/${document.id}?page=${page}${block ? `&block=${encodeURIComponent(block)}` : ""}`);
  };

  const changeView = (next: LibraryView) => {
    setView(next);
    setQuery("");
    if (next === "documents") setSelectedCardId("");
  };

  return <AppShell sidebar={false} full>
    <div className="project-scoped-page project-library-scope">
      <ProjectContextNav projectId={project.id} />
      <section className="project-library-page">
        <header className="project-library-header">
          <div>
            <span><FolderArchive size={15} />项目资料库</span>
            <h1>{project.title}</h1>
            <p>{projectDocuments.length} 份文档，{projectCards.length} 张研究卡片。所有内容只在当前项目内组织。</p>
          </div>
          <div className="project-library-upload-actions">
            <Button onClick={() => upload("paper")}><UploadCloud size={16} />上传论文</Button>
            <Button variant="secondary" onClick={() => upload("judgment")}><Gavel size={16} />上传裁判文书</Button>
          </div>
        </header>

        <nav className="project-library-switch" aria-label="资料库内容">
          <button className={view === "documents" ? "is-active" : ""} onClick={() => changeView("documents")}>
            <span><Layers3 size={18} /><strong>文档库</strong></span>
            <small>上传的论文与裁判文书</small><em>{projectDocuments.length}</em>
          </button>
          <button className={view === "cards" ? "is-active" : ""} onClick={() => changeView("cards")}>
            <span><Quote size={18} /><strong>研究卡片</strong></span>
            <small>从阅读中保存的观点与证据</small><em>{projectCards.length}</em>
          </button>
        </nav>

        {view === "documents" ? <DocumentLibrary
          documents={filteredDocuments}
          allDocuments={projectDocuments}
          papers={papers.length}
          judgments={judgments.length}
          ready={readyDocuments.length}
          processing={processingDocuments.length}
          filter={documentFilter}
          setFilter={setDocumentFilter}
          sort={documentSort}
          setSort={setDocumentSort}
          query={query}
          setQuery={setQuery}
          setSearchElement={(element) => { searchRef.current = element; }}
          cards={projectCards}
          openDocument={openDocument}
          upload={upload}
        /> : <CardLibrary
          cards={filteredCards}
          allCards={projectCards}
          pending={pendingCards}
          type={cardType}
          setType={setCardType}
          verify={cardVerify}
          setVerify={setCardVerify}
          query={query}
          setQuery={setQuery}
          setSearchElement={(element) => { searchRef.current = element; }}
          openCard={setSelectedCardId}
          reviewNext={() => { const next = pendingCards[0]; if (next) setSelectedCardId(next.id); else showToast("当前项目的研究卡片已全部核验"); }}
        />}
      </section>

      {selectedCard && <CardDetail
        card={selectedCard}
        close={() => setSelectedCardId("")}
        backToSource={backToSource}
        verify={() => {
          if (!selectedCard.sourceAnchor) {
            showToast("缺少原文定位，不能标记为已核验");
            return;
          }
          dispatch({ type: "VERIFY_CARD", cardId: selectedCard.id });
          showToast("研究卡片已核验");
        }}
        update={(changes) => {
          dispatch({ type: "UPDATE_CARD", cardId: selectedCard.id, changes });
          showToast("研究卡片已更新，原文证据未被修改");
        }}
      />}
    </div>
  </AppShell>;
}

function DocumentLibrary({ documents, allDocuments, papers, judgments, ready, processing, filter, setFilter, sort, setSort, query, setQuery, setSearchElement, cards, openDocument, upload }: {
  documents: ResearchDocument[];
  allDocuments: ResearchDocument[];
  papers: number;
  judgments: number;
  ready: number;
  processing: number;
  filter: DocumentFilter;
  setFilter: (filter: DocumentFilter) => void;
  sort: DocumentSort;
  setSort: (sort: DocumentSort) => void;
  query: string;
  setQuery: (query: string) => void;
  setSearchElement: (element: HTMLInputElement | null) => void;
  cards: ResearchCard[];
  openDocument: (document: ResearchDocument) => void;
  upload: (kind: DocumentKind) => void;
}) {
  return <div className="document-library-view">
    <section className="document-library-summary">
      <div><FileText size={18} /><span>论文<strong>{papers}</strong></span></div>
      <div><Scale size={18} /><span>裁判文书<strong>{judgments}</strong></span></div>
      <div><CheckCircle2 size={18} /><span>分析完成<strong>{ready}</strong></span></div>
      <div><FileClock size={18} /><span>处理中<strong>{processing}</strong></span></div>
    </section>

    <div className="document-library-toolbar">
      <label className="project-library-search"><Search size={17} /><input ref={setSearchElement} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档标题、作者或来源" aria-label="搜索项目文档" />{query ? <button onClick={() => setQuery("")} aria-label="清空搜索"><X size={15} /></button> : <kbd>/</kbd>}</label>
      <div className="document-library-controls">
        <div className="document-kind-filter" aria-label="文档类型">
          {(["全部", "paper", "judgment"] as DocumentFilter[]).map((item) => <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{item === "全部" ? `全部 ${allDocuments.length}` : item === "paper" ? `论文 ${papers}` : `裁判文书 ${judgments}`}</button>)}
        </div>
        <label className="document-sort"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as DocumentSort)} aria-label="文档排序"><option value="updated">最近更新</option><option value="progress">阅读较少</option><option value="title">标题名称</option></select></label>
      </div>
    </div>

    <div className="document-library-section-head"><div><h2>项目文档</h2><p>打开论文即可继续阅读、标注和整理；AI 分析按需使用。</p></div><span>{documents.length} 份</span></div>
    {documents.length ? <div className="project-document-list">{documents.map((document) => <DocumentRow key={document.id} document={document} cardCount={cards.filter((card) => card.documentId === document.id).length} open={() => openDocument(document)} />)}</div> : <EmptyState icon={<FileSearch size={28} />} title={allDocuments.length ? "没有匹配的文档" : "项目中还没有文档"} description={allDocuments.length ? "换一个关键词或文档类型再试。" : "先上传一篇论文，系统会自动解析目录并生成阅读结构。"} action={!allDocuments.length ? <Button onClick={() => upload("paper")}><UploadCloud size={16} />上传第一篇论文</Button> : undefined} />}
  </div>;
}

function DocumentRow({ document, cardCount, open }: { document: ResearchDocument; cardCount: number; open: () => void }) {
  const readable = ["readable", "partial"].includes(document.readingStatus);
  const legacyMeta = statusMeta[document.status];
  const meta = readable
    ? { label: document.readingStatus === "partial" ? "可阅读 · 部分页待 OCR" : document.analysisStatus === "running" ? "可阅读 · AI 分析中" : "可阅读", tone: "green" as const, progress: 100 }
    : legacyMeta;
  const nodeCount = document.kind === "paper" ? document.nodes?.length ?? 0 : document.issues?.length ?? 0;
  const readingProgress = document.pages ? Math.round((document.currentPage / document.pages) * 100) : 0;
  const taskProgress = document.readingStatus === "processing" ? document.progress?.value ?? meta.progress : meta.progress;
  const processing = document.readingStatus === "processing";
  const summary = document.kind === "paper"
    ? document.analysisSummary?.coreConclusion || document.nodes?.find((node) => node.role.includes("结论"))?.summary || document.nodes?.[0]?.summary
    : document.issues?.find((issue) => issue.status === "进行中")?.courtFact || document.issues?.[0]?.courtFact;
  const action = readable
    ? document.currentPage > 1 ? "继续阅读" : "开始阅读"
    : document.readingStatus === "error" ? "查看问题" : "查看进度";
  const KindIcon = document.kind === "paper" ? FileText : Scale;

  return <article className={cx("project-document-row", `status-${document.status}`)}>
    <button className="project-document-open" onClick={open} aria-label={`打开 ${document.title}`}>
      <span className={`project-document-kind ${document.kind}`}><KindIcon size={22} /></span>
      <span className="project-document-copy">
        <span className="project-document-title"><strong>{document.title}</strong><Badge tone={meta.tone}>{processing && <LoaderCircle className="spin" size={11} />}{meta.label}</Badge></span>
        <span className="project-document-meta">{document.kind === "paper" ? "学术论文" : "裁判文书"}<i />{document.author || document.source}<i />{document.pages} 页<i />更新于 {document.updatedAt}</span>
        <span className="project-document-summary">{summary || (readable ? "文档已经可以阅读，AI 分析可在阅读过程中按需使用。" : "文档正在进行基础解析，完成后即可开始阅读。")}</span>
      </span>
    </button>
    <div className="project-document-state">
      {readable ? <><div><span>阅读进度</span><strong>{readingProgress}%</strong></div><div className="document-reading-progress"><i style={{ width: `${readingProgress}%` }} /></div><small>{nodeCount ? `AI 已生成 ${nodeCount} 个辅助节点` : "尚未生成 AI 辅助"}{cardCount ? ` · ${cardCount} 张卡片` : ""}</small></> : <><div><span>处理进度</span><strong>{taskProgress}%</strong></div><div className="document-reading-progress processing"><i style={{ width: `${taskProgress}%` }} /></div><small>{document.readingStatus === "error" ? document.error || "可以返回处理页面重试" : "离开页面后任务仍会保存"}</small></>}
    </div>
    <Button variant={readable ? "secondary" : "primary"} size="sm" onClick={open}>{action}<ArrowRight size={14} /></Button>
  </article>;
}

function CardLibrary({ cards, allCards, pending, type, setType, verify, setVerify, query, setQuery, setSearchElement, openCard, reviewNext }: {
  cards: ResearchCard[];
  allCards: ResearchCard[];
  pending: ResearchCard[];
  type: CardType | "全部";
  setType: (type: CardType | "全部") => void;
  verify: CardVerifyFilter;
  setVerify: (verify: CardVerifyFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  setSearchElement: (element: HTMLInputElement | null) => void;
  openCard: (id: string) => void;
  reviewNext: () => void;
}) {
  return <div className="research-card-library-view">
    <section className="research-card-callout">
      <div><span className={pending.length ? "needs-review" : "is-complete"}>{pending.length ? <CircleAlert size={18} /> : <ShieldCheck size={18} />}</span><div><strong>{pending.length ? `${pending.length} 张卡片需要回到原文核验` : "研究卡片已全部核验"}</strong><p>只有核验后的卡片才会进入项目成果和引用清单。</p></div></div>
      <Button onClick={reviewNext} disabled={!pending.length}>{pending.length ? "继续核验" : "已完成"}<ArrowRight size={15} /></Button>
    </section>

    <div className="research-card-toolbar">
      <label className="project-library-search"><Search size={17} /><input ref={setSearchElement} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索观点、原文摘录或标签" aria-label="搜索研究卡片" />{query ? <button onClick={() => setQuery("")} aria-label="清空搜索"><X size={15} /></button> : <kbd>/</kbd>}</label>
      <div className="research-card-verify-filter" aria-label="卡片核验状态">{(["全部", "待核验", "已核验"] as CardVerifyFilter[]).map((item) => <button key={item} className={verify === item ? "is-active" : ""} onClick={() => setVerify(item)}>{item}{item === "待核验" && pending.length ? <em>{pending.length}</em> : null}</button>)}</div>
    </div>

    <nav className="research-card-type-filter" aria-label="研究卡片类型"><button className={type === "全部" ? "is-active" : ""} onClick={() => setType("全部")}>全部 <em>{allCards.length}</em></button>{cardTypes.map((item) => { const Icon = typeIcon[item]; const count = allCards.filter((card) => card.type === item).length; return <button key={item} className={type === item ? "is-active" : ""} onClick={() => setType(item)}><Icon size={14} />{item}<em>{count}</em></button>; })}</nav>

    <div className="document-library-section-head"><div><h2>研究卡片</h2><p>从论文与裁判文书中保存的观点、规范、案例和引用。</p></div><span>{cards.length} 张</span></div>
    {cards.length ? <div className="research-card-grid">{cards.map((card) => { const Icon = typeIcon[card.type]; return <button key={card.id} onClick={() => openCard(card.id)}><span className={`research-card-kind tone-${typeTone[card.type]}`}><Icon size={18} /></span><span className="research-card-grid-title"><strong>{card.title}</strong><Badge tone={card.verifyStatus === "已核验" ? "green" : "amber"}>{card.verifyStatus}</Badge></span><p>{card.excerpt}</p><span className="research-card-source">{card.source} · 第 {card.page} 页</span><span className="research-card-tags">{card.tags.slice(0, 2).map((tag) => <em key={tag}>{tag}</em>)}</span><ChevronRight size={16} /></button>; })}</div> : <EmptyState icon={<Quote size={28} />} title={allCards.length ? "没有匹配的研究卡片" : "还没有研究卡片"} description={allCards.length ? "调整关键词、类型或核验状态后再试。" : "进入论文或裁判文书阅读器，把重要原文保存为研究卡片。"} />}
  </div>;
}

function CardDetail({ card, close, backToSource, verify, update }: {
  card: ResearchCard;
  close: () => void;
  backToSource: (card: ResearchCard) => void;
  verify: () => void;
  update: (changes: Partial<Pick<ResearchCard, "title" | "note" | "tags" | "relation" | "outlineNode">>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    title: card.title,
    note: card.note,
    tags: card.tags.join("，"),
    relation: card.relation,
    outlineNode: card.outlineNode,
  }));
  const save = () => {
    const title = draft.title.trim();
    if (!title) return;
    update({
      title,
      note: draft.note.trim(),
      tags: draft.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      relation: draft.relation,
      outlineNode: draft.outlineNode.trim() || "未归入提纲",
    });
    setEditing(false);
  };

  return <div className="research-card-drawer-layer"><button className="research-card-drawer-backdrop" onClick={close} aria-label="关闭研究卡片详情" /><aside className="research-card-drawer" aria-label="研究卡片详情">
    <header><div><Badge tone={card.verifyStatus === "已核验" ? "green" : "amber"}>{card.verifyStatus === "已核验" ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}{card.verifyStatus}</Badge><span>{card.type}</span></div><button className="icon-button" onClick={close} aria-label="关闭"><X size={18} /></button></header>
    <div className="research-card-drawer-scroll">
      {editing ? <div className="card-edit-form">
        <label><span>卡片标题</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="card-edit-grid">
          <label><span>与研究问题的关系</span><select value={draft.relation} onChange={(event) => setDraft({ ...draft, relation: event.target.value as ResearchCard["relation"] })}><option>支持</option><option>反对</option><option>条件性</option><option>背景</option><option>方法</option></select></label>
          <label><span>归入提纲</span><input value={draft.outlineNode} onChange={(event) => setDraft({ ...draft, outlineNode: event.target.value })} /></label>
        </div>
        <label><span>研究笔记</span><textarea rows={6} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <label><span>标签（逗号分隔）</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
        <div className="card-edit-actions"><Button variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button onClick={save} disabled={!draft.title.trim()}>保存修改</Button></div>
      </div> : <>
        <div className="drawer-title-row"><div><h2>{card.title}</h2><p className="drawer-purpose"><span>{card.relation}</span>用于“{card.outlineNode}”</p></div><button onClick={() => setEditing(true)}><Edit3 size={13} />编辑卡片</button></div>
        <section className="drawer-evidence"><div><strong>原文证据</strong>{card.sourceAnchor ? <button onClick={() => backToSource(card)}>定位第 {card.page} 页 <ExternalLink size={13} /></button> : <span className="drawer-evidence-missing">尚未绑定</span>}</div><blockquote>{card.excerpt}</blockquote><small>{card.source} · 第 {card.page} 页</small></section>
        <section><div><strong>研究笔记</strong><button onClick={() => setEditing(true)}><Edit3 size={13} />编辑</button></div><p>{card.note || "尚未补充研究笔记。"}</p></section>
        <section><div><strong>标签</strong><button onClick={() => setEditing(true)}><Tags size={13} />管理</button></div><div className="drawer-tags">{card.tags.length ? card.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <span>尚未添加标签</span>}</div></section>
      </>}
    </div>
    <footer>{card.verifyStatus !== "已核验" && <Button variant="secondary" onClick={verify} disabled={!card.sourceAnchor}><CheckCircle2 size={15} />{card.sourceAnchor ? "标记已核验" : "缺少原文定位"}</Button>}<Button onClick={() => backToSource(card)} disabled={!card.sourceAnchor}>查看原文 <ArrowRight size={15} /></Button></footer>
  </aside></div>;
}
