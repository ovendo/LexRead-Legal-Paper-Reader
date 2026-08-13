import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, CircleAlert, FileText, Link2, Network } from "lucide-react";
import { useEffect, useState } from "react";
import { getDocument, toResearchDocument } from "../api";
import { AppShell } from "../components/Layout";
import { Badge, Button } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";

const serverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nodeStatusLabel = { unread: "未核验", passed: "已通过", read: "已阅读", understood: "已理解", doubt: "存疑", disagree: "有分歧", saved: "已保存" } as const;
const needsReview = (status: keyof typeof nodeStatusLabel) => ["unread", "doubt", "disagree"].includes(status);

export function PaperOverviewPage() {
  const { path, navigate } = useRouter();
  const { state, activePaper, dispatch } = useAppStore();
  const documentId = decodeURIComponent(path.split("/papers/")[1]?.split("/")[0] || "");
  const isServerDocument = serverIdPattern.test(documentId);
  const doc = state.documents.find((item) => item.id === documentId) ?? (!isServerDocument ? activePaper : undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(doc?.nodes?.[0]?.id ?? null);
  const [loading, setLoading] = useState(isServerDocument && !doc);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isServerDocument) return;
    let cancelled = false;
    setLoading(true);
    getDocument(documentId).then(({ document }) => {
      if (cancelled) return;
      const mapped = toResearchDocument(document);
      dispatch({ type: "UPSERT_DOCUMENT", document: mapped });
      setSelectedNodeId(mapped.nodes?.[0]?.id ?? null);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "论文读取失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dispatch, documentId, isServerDocument]);

  if (loading) return <PaperOverviewState text="正在加载论文分析…" />;
  if (!doc || !doc.nodes?.length) return <PaperOverviewState text={error || "这篇论文还没有分析结果，请先完成全文分析。"} action={() => navigate("/workspace/upload-parse")} />;

  const selectedNode = doc.nodes.find((node) => node.id === selectedNodeId) ?? doc.nodes[0];
  const anchoredNodes = doc.nodes.filter((node) => node.sourceAnchors?.length).length;
  const summary = doc.analysisSummary;
  const pendingNodes = doc.nodes.filter((node) => !node.sourceAnchors?.length || needsReview(node.status));
  const questionFallback = doc.nodes.find((node) => node.role.includes("问题") || node.title.includes("问题"))?.summary;
  const conclusionFallback = [...doc.nodes].reverse().find((node) => node.role.includes("结论") || node.title.includes("结论"))?.summary;

  const enterReader = () => {
    dispatch({ type: "SET_PAPER_NODE", documentId: doc.id, nodeId: selectedNode.id });
    navigate(`/workspace/read/paper/${doc.id}`);
  };

  return <AppShell sidebar={false}>
    <div className="paper-overview-page">
      <button className="back-link" onClick={() => navigate(`/workspace/projects/${doc.projectId}/overview`)}><ArrowLeft size={16} />返回项目</button>
      <header className="paper-overview-head"><div><span>论文概览</span><h1>{doc.title}</h1><p>{doc.source} · {doc.pages} 页 · AI 分析结果需由你结合原文核验</p></div><div className="paper-overview-actions"><Badge tone={pendingNodes.length ? "amber" : "green"}>{pendingNodes.length ? `${pendingNodes.length} 个节点待核验` : "主要节点已核验"}</Badge><Button onClick={enterReader}><BookOpen size={17} />进入原文核验<ArrowRight size={16} /></Button></div></header>

      <section className="paper-overview-summary">
        <article><span>核心问题</span><h2>{summary?.coreQuestion || questionFallback || "需要在原文中进一步确认"}</h2></article>
        <article><span>作者结论</span><p>{summary?.coreConclusion || conclusionFallback || selectedNode.summary}</p></article>
        <article><span>适用边界</span><p>{summary?.boundary || "需要在原文阅读中继续确认限定条件。"}</p></article>
      </section>

      <section className="paper-argument-section">
        <div className="section-heading"><div><h2><Network size={18} />论文论证图谱</h2><p>点击节点查看要点；进入阅读器后可逐个回到原文。</p></div><Badge tone={anchoredNodes === doc.nodes.length ? "green" : "amber"}>{anchoredNodes}/{doc.nodes.length} 节点有原文依据</Badge></div>
        <div className="paper-node-map">{doc.nodes.map((node, index) => {
          const hasEvidence = Boolean(node.sourceAnchors?.length);
          return <div className="paper-node-wrap" key={node.id}><button className={`${node.id === selectedNode.id ? "is-active" : ""} ${!hasEvidence || needsReview(node.status) ? "needs-review" : ""}`} onClick={() => setSelectedNodeId(node.id)}><span>{node.order}</span><strong>{node.title}</strong><small>{node.role}</small><em>{hasEvidence ? nodeStatusLabel[node.status] : "缺少依据"}</em></button>{index < doc.nodes!.length - 1 && <i>→</i>}</div>;
        })}</div>
      </section>

      <section className="selected-paper-node">
        <div className="selected-node-copy"><span>当前要点 · {selectedNode.attribution}</span><h2>{selectedNode.title}</h2><p>{selectedNode.summary}</p>{selectedNode.reasons.length > 0 && <ul>{selectedNode.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</div>
        <aside><div><Link2 size={17} /><span>原文依据<strong>{selectedNode.sourceAnchors?.length ?? 0} 处</strong></span></div><div><CheckCircle2 size={17} /><span>AI 置信度<strong>{selectedNode.confidence}%</strong></span></div><div className={!selectedNode.sourceAnchors?.length || needsReview(selectedNode.status) ? "node-review-status pending" : "node-review-status"}>{!selectedNode.sourceAnchors?.length || needsReview(selectedNode.status) ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span>核验状态<strong>{selectedNode.sourceAnchors?.length ? nodeStatusLabel[selectedNode.status] : "缺少依据"}</strong></span></div>{selectedNode.sourceAnchors?.[0] ? <button onClick={enterReader}><FileText size={15} />从第 {selectedNode.sourceAnchors[0].page} 页开始核验<ArrowRight size={14} /></button> : <div className="node-warning"><CircleAlert size={15} />没有可靠锚点，不能标记已核验</div>}</aside>
      </section>
    </div>
  </AppShell>;
}

function PaperOverviewState({ text, action }: { text: string; action?: () => void }) {
  return <AppShell sidebar={false}><div className="reader-state"><FileText size={34} /><h1>论文概览</h1><p>{text}</p>{action && <Button onClick={action}>返回上传页</Button>}</div></AppShell>;
}
