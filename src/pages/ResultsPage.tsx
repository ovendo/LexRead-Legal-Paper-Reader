import { ArrowRight, CheckCircle2, Download, FileText, Gavel, Library, PlusCircle } from "lucide-react";
import { useEffect } from "react";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, Progress } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";

export function ResultsPage() {
  const { path, navigate } = useRouter();
  const { state, dispatch, showToast } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const documents = state.documents.filter((document) => document.projectId === project.id);
  const cards = state.cards.filter((card) => card.projectId === project.id);
  const analyzedDocuments = documents.filter((document) => document.status === "ready" && (document.nodes?.length || document.issues?.length));
  const verifiedCards = cards.filter((card) => card.verifyStatus === "已核验");

  useEffect(() => { if (project.id !== state.selectedProjectId) dispatch({ type: "SELECT_PROJECT", projectId: project.id }); }, [dispatch, project.id, state.selectedProjectId]);

  const exportProject = () => {
    const documentSections = analyzedDocuments.map((document) => {
      const conclusion = document.analysisSummary?.coreConclusion || document.nodes?.at(-1)?.summary || document.issues?.at(-1)?.courtFact || "尚未形成结论";
      return `## ${document.title}\n\n${conclusion}`;
    }).join("\n\n");
    const cardSections = verifiedCards.map((card) => `- **${card.type}｜${card.title}**：${card.excerpt}（${card.source}，第 ${card.page} 页）`).join("\n");
    const content = `# ${project.title}\n\n## 核心研究问题\n\n${project.question}\n\n# 文档分析成果\n\n${documentSections || "尚无已完成的文档分析。"}\n\n# 已核验研究卡片\n\n${cardSections || "尚无已核验卡片。"}\n`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${project.title}-项目成果.md`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("已导出当前项目的 Markdown 成果包");
  };

  return <AppShell sidebar={false}>
    <div className="project-results-page">
      <ProjectContextNav projectId={project.id} />
      <header className="project-results-head"><div><span>项目成果</span><h1>{project.title}</h1><p>只汇总当前项目中已经分析的文档和经过人工核验的研究卡片。</p></div><Button onClick={exportProject}><Download size={17} />导出项目成果</Button></header>

      <section className="project-result-kpis">
        <div><FileText size={20} /><span>已分析文档<strong>{analyzedDocuments.length}</strong></span></div>
        <div><Library size={20} /><span>研究卡片<strong>{cards.length}</strong></span></div>
        <div><CheckCircle2 size={20} /><span>已核验卡片<strong>{verifiedCards.length}</strong></span></div>
        <div className="result-verify-progress"><span>卡片核验进度</span><Progress value={cards.length ? Math.round(verifiedCards.length / cards.length * 100) : 0} tone="teal" /><strong>{cards.length ? Math.round(verifiedCards.length / cards.length * 100) : 0}%</strong></div>
      </section>

      <section className="project-result-section">
        <div className="section-heading"><div><h2>文档分析成果</h2><p>每份成果仍然可以回到单篇概览和原文。</p></div></div>
        <div className="document-result-list">{analyzedDocuments.map((document) => {
          const conclusion = document.analysisSummary?.coreConclusion || document.nodes?.at(-1)?.summary || document.issues?.at(-1)?.courtFact || "已完成结构化阅读";
          const nodeCount = document.nodes?.length ?? document.issues?.length ?? 0;
          return <button key={document.id} onClick={() => navigate(document.kind === "paper" ? `/workspace/papers/${document.id}` : `/workspace/read/judgment/${document.id}`)}><span className={`result-doc-icon ${document.kind}`}>{document.kind === "paper" ? <FileText size={20} /> : <Gavel size={20} />}</span><div><strong>{document.title}</strong><p>{conclusion}</p><small>{document.kind === "paper" ? `${nodeCount} 个论证节点` : `${nodeCount} 个裁判节点`} · 原文 {document.pages} 页</small></div><Badge tone="green">分析完成</Badge><ArrowRight size={17} /></button>;
        })}</div>
        {!analyzedDocuments.length && <div className="result-empty"><FileText size={29} /><h3>当前项目还没有分析成果</h3><p>先上传并分析一份论文或裁判文书。</p><Button onClick={() => navigate(`/workspace/upload-parse?kind=paper`)}><PlusCircle size={16} />上传论文</Button></div>}
      </section>

      <section className="project-result-section verified-card-section">
        <div className="section-heading"><div><h2>已核验研究卡片</h2><p>只有人工确认过的材料才进入项目成果。</p></div><button onClick={() => navigate(`/workspace/projects/${project.id}/materials`)}>进入项目资料库 <ArrowRight size={14} /></button></div>
        <div className="verified-card-grid">{verifiedCards.slice(0, 6).map((card) => <article key={card.id}><div><Badge tone="blue">{card.type}</Badge><Badge tone="green">已核验</Badge></div><h3>{card.title}</h3><p>{card.excerpt}</p><footer>{card.source} · 第 {card.page} 页</footer></article>)}</div>
        {!verifiedCards.length && <p className="project-result-muted">当前项目还没有已核验卡片。</p>}
      </section>
    </div>
  </AppShell>;
}
