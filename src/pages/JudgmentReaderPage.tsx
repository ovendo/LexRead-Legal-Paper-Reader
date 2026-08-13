import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, FileText, Gavel, Minus, Plus, Save, Scale, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getDocument, getDocumentPage, getDocumentPageImageUrl, saveAnalysisIssueStatus, toResearchDocument, type ServerBlock, type ServerPage } from "../api";
import { AppShell } from "../components/Layout";
import { Badge, Button, Progress } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { LegalIssue } from "../types";

const serverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function JudgmentReaderPage() {
  const { path, navigate } = useRouter();
  const { state, activeJudgment, dispatch, createCardFromJudgment, showToast } = useAppStore();
  const documentId = decodeURIComponent(path.split("/read/judgment/")[1]?.split("/")[0] || "");
  const linkedPage = Number(new URLSearchParams(window.location.search).get("page")) || null;
  const linkedBlockId = new URLSearchParams(window.location.search).get("block");
  const isServerDocument = serverIdPattern.test(documentId);
  const doc = state.documents.find((item) => item.id === documentId) ?? (!isServerDocument ? activeJudgment : undefined);
  const [loading, setLoading] = useState(isServerDocument && !doc);
  const [error, setError] = useState("");
  const [pageNumber, setPageNumber] = useState(linkedPage ?? doc?.currentPage ?? 1);
  const [pageData, setPageData] = useState<{ page: ServerPage; blocks: ServerBlock[] } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(linkedBlockId);
  const [mobilePane, setMobilePane] = useState<"route" | "document" | "analysis">("document");

  useEffect(() => {
    if (!isServerDocument) return;
    let cancelled = false;
    setLoading(true);
    getDocument(documentId).then(({ document }) => {
      if (cancelled) return;
      const mapped = toResearchDocument(document);
      dispatch({ type: "UPSERT_DOCUMENT", document: mapped });
      setPageNumber(linkedPage ?? mapped.currentPage);
      if (linkedBlockId) setFocusedBlockId(linkedBlockId);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "裁判文书读取失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dispatch, documentId, isServerDocument, linkedBlockId, linkedPage]);

  useEffect(() => {
    if (doc) setPageNumber(linkedPage ?? doc.currentPage);
    if (linkedBlockId) setFocusedBlockId(linkedBlockId);
  }, [doc?.id, linkedBlockId, linkedPage]);

  useEffect(() => {
    if (!doc || !isServerDocument) return;
    let cancelled = false;
    getDocumentPage(doc.id, pageNumber).then((result) => { if (!cancelled) setPageData(result); }).catch(() => { if (!cancelled) setPageData(null); });
    return () => { cancelled = true; };
  }, [doc?.id, isServerDocument, pageNumber]);

  const issues = doc?.issues ?? [];
  const issue = issues.find((item) => item.id === doc?.activeIssueId) ?? issues[0];
  const activeIndex = issues.findIndex((item) => item.id === issue?.id);
  const completed = issues.filter((item) => item.sourceAnchors?.length && item.status === "已完成").length;
  const anchorIds = useMemo(() => new Set((issue?.sourceAnchors ?? []).filter((anchor) => anchor.page === pageNumber).map((anchor) => anchor.blockId)), [issue, pageNumber]);

  if (loading) return <JudgmentState text="正在加载裁判推理结果…" />;
  if (!doc || !issue) return <JudgmentState text={error || "这份裁判文书还没有结构化分析结果。"} action={() => navigate("/workspace/upload-parse?kind=judgment")} />;

  const goToPage = (page: number, blockId: string | null = null) => {
    const bounded = Math.max(1, Math.min(doc.pages, page));
    setPageNumber(bounded);
    setFocusedBlockId(blockId);
    dispatch({ type: "SET_DOCUMENT_PAGE", documentId: doc.id, page: bounded });
  };

  const selectIssue = (item: LegalIssue) => {
    dispatch({ type: "SET_ISSUE", documentId: doc.id, issueId: item.id });
    const anchor = item.sourceAnchors?.[0];
    goToPage(anchor?.page ?? item.page, anchor?.blockId ?? null);
    setMobilePane("document");
  };

  const confirmIssue = () => {
    if (!issue.sourceAnchors?.length) {
      showToast("缺少真实裁判原文依据，不能完成核验");
      return;
    }
    dispatch({ type: "SET_ISSUE_STATUS", documentId: doc.id, issueId: issue.id, status: "已完成" });
    if (isServerDocument) void saveAnalysisIssueStatus(doc.id, issue.id, "已完成").catch(() => showToast("核验状态已保存在本机，稍后会重试同步"));
    const next = issues[activeIndex + 1];
    if (next) {
      showToast("当前节点已确认，继续核验下一节点");
      window.setTimeout(() => selectIssue(next), 220);
    } else showToast("本份裁判文书的主要推理节点已核验完成");
  };

  return <AppShell sidebar={false} full>
    <header className="judgment-reader-head"><button className="back-link" onClick={() => navigate(`/workspace/projects/${doc.projectId}/overview`)}><ArrowLeft size={16} />返回项目</button><div><span>裁判文书核验</span><h1>{doc.title}</h1><p>{doc.caseSummary?.court || doc.source} · {doc.caseSummary?.procedure || "审级待确认"}</p></div><Badge tone={completed === issues.length ? "green" : "blue"}>{completed}/{issues.length} 已核验</Badge></header>
    <nav className="reader-mobile-switch" aria-label="裁判阅读器视图"><button className={mobilePane === "route" ? "is-active" : ""} onClick={() => setMobilePane("route")}>推理路线</button><button className={mobilePane === "document" ? "is-active" : ""} onClick={() => setMobilePane("document")}>原文</button><button className={mobilePane === "analysis" ? "is-active" : ""} onClick={() => setMobilePane("analysis")}>裁判要点</button></nav>
    <div className="judgment-layout judgment-layout-simple">
      <aside className={`judgment-nav ${mobilePane !== "route" ? "mobile-pane-inactive" : ""}`}><div className="judgment-nav-head"><h2>裁判推理路线</h2><p>主张 → 事实 → 证据 → 规范 → 结论</p></div><div className="issue-steps">{issues.map((item, index) => {
        const hasEvidence = Boolean(item.sourceAnchors?.length);
        return <button key={item.id} className={item.id === issue.id ? "is-active" : ""} onClick={() => selectIssue(item)}><span className={`issue-dot status-${item.status}`}>{hasEvidence && item.status === "已完成" ? "✓" : index + 1}</span><strong>{item.title}</strong><Badge tone={!hasEvidence ? "amber" : item.status === "已完成" ? "green" : item.id === issue.id ? "blue" : "neutral"}>{item.id === issue.id ? "当前" : !hasEvidence ? "缺少依据" : item.status}</Badge></button>;
      })}</div></aside>

      <section className={`judgment-document ${mobilePane !== "document" ? "mobile-pane-inactive" : ""}`}><div className="doc-toolbar"><strong>原始裁判页面</strong><span />{isServerDocument && <><button onClick={() => setZoom(Math.max(75, zoom - 10))}><Minus size={15} /></button><strong>{zoom}%</strong><button onClick={() => setZoom(Math.min(140, zoom + 10))}><Plus size={15} /></button></>}</div><div className="real-page-stage">{isServerDocument ? <div className="pdf-image-scroll"><div className="pdf-image-page" style={{ width: `${zoom}%` }}><img src={getDocumentPageImageUrl(doc.id, pageNumber)} alt={`${doc.title} 第 ${pageNumber} 页`} />{pageData && [...anchorIds].map((blockId) => {
        const block = pageData.blocks.find((item) => item.id === blockId);
        if (!block) return null;
        const [x, y, width, height] = block.bbox;
        const style = { left: `${x / pageData.page.width * 100}%`, bottom: `${y / pageData.page.height * 100}%`, width: `${width / pageData.page.width * 100}%`, height: `${Math.max(height / pageData.page.height * 100, 1.2)}%` } as CSSProperties;
        return <button key={blockId} className={`source-highlight ${focusedBlockId === blockId ? "is-focused" : ""}`} style={style} />;
      })}</div></div> : <DemoJudgmentPage issue={issue} />}</div><div className="doc-pager simple-doc-pager"><button disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={17} /></button><strong>{pageNumber}</strong><span>/ {doc.pages} 页</span><button disabled={pageNumber >= doc.pages} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={17} /></button><div /><span>{anchorIds.size ? `本页 ${anchorIds.size} 处依据已标出` : "选择右侧依据可跳转原文"}</span></div></section>

      <aside className={`judgment-insight ${mobilePane !== "analysis" ? "mobile-pane-inactive" : ""}`}><div className="judgment-insight-head"><span>当前节点 · {issue.stage || "裁判推理"}</span><h2>{issue.title}</h2>{issue.confidence && <Badge tone={issue.confidence >= 80 ? "blue" : "amber"}>{issue.confidence}% 置信度</Badge>}</div><div className="judgment-sections">
        {issue.claim && <section><div><Scale size={17} /><strong>当事人主张</strong></div><p>{issue.claim}</p></section>}
        {issue.courtFact && <section><div><ShieldCheck size={17} /><strong>法院认定事实</strong><Badge tone="green">需核验</Badge></div><p>{issue.courtFact}</p></section>}
        {issue.evidence.length > 0 && <section><div><FileText size={17} /><strong>关键证据（{issue.evidence.length}）</strong></div>{issue.evidence.map((item, index) => <p key={`${item}-${index}`}>E{index + 1} · {item}</p>)}</section>}
        {issue.laws.length > 0 && <section><div><Gavel size={17} /><strong>适用法律</strong></div>{issue.laws.map((law) => <p key={law}>{law}</p>)}</section>}
        {issue.reasoning && <section><div><Scale size={17} /><strong>法院说理</strong></div><p>{issue.reasoning}</p></section>}
        {issue.conclusion && <section><div><CheckCircle2 size={17} /><strong>节点结论</strong></div><p>{issue.conclusion}</p></section>}
        <section><div><FileText size={17} /><strong>原文依据</strong></div><div className="source-anchor-list">{issue.sourceAnchors?.length ? issue.sourceAnchors.map((anchor) => <button key={anchor.blockId} onClick={() => { goToPage(anchor.page, anchor.blockId); setMobilePane("document"); }}><FileText size={14} /><span><strong>第 {anchor.page} 页</strong>{anchor.text.slice(0, 82)}</span></button>) : <p>该节点未绑定真实裁判原文，只能视为 AI 提取结果。</p>}</div></section>
        {!issue.sourceAnchors?.length && <section className="verification-blocked"><CircleAlert size={17} /><div><strong>等待裁判原文依据</strong><p>绑定真实原文后，才能保存案例卡或完成核验。</p></div></section>}
      </div><div className="judgment-actions"><Button variant="secondary" disabled={!issue.sourceAnchors?.length} onClick={() => createCardFromJudgment(doc.id)}><Save size={16} />保存案例卡</Button><Button disabled={!issue.sourceAnchors?.length} onClick={confirmIssue}><CheckCircle2 size={16} />{issue.sourceAnchors?.length ? "确认依据并继续" : "缺少原文依据"}</Button></div></aside>
    </div>
    <div className="judgment-progress"><span>原文进度</span><Progress value={Math.round(pageNumber / doc.pages * 100)} /><b>{pageNumber}/{doc.pages} 页</b><i /><span>推理核验</span><Progress value={Math.round(completed / issues.length * 100)} tone="teal" /><b>{Math.round(completed / issues.length * 100)}%</b><button onClick={() => navigate(`/workspace/projects/${doc.projectId}/materials`)}>进入项目资料库 →</button></div>
  </AppShell>;
}

function DemoJudgmentPage({ issue }: { issue: LegalIssue }) {
  return <div className="text-page demo-evidence-page"><div className="demo-source-label">演示裁判文本 · 第 {issue.page} 页</div><h2>{issue.title}</h2>{issue.claim && <p>{issue.claim}</p>}{issue.courtFact && <p className="is-source">{issue.courtFact}</p>}{issue.laws.map((law) => <p key={law}>{law}</p>)}</div>;
}

function JudgmentState({ text, action }: { text: string; action?: () => void }) {
  return <AppShell sidebar={false}><div className="reader-state"><Gavel size={34} /><h1>裁判文书分析</h1><p>{text}</p>{action && <Button onClick={action}>返回上传页</Button>}</div></AppShell>;
}
