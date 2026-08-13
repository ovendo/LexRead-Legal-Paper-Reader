import { BookOpen, ClipboardCopy, ExternalLink, FileText, Filter, Gavel, Scale, Sparkles, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, EmptyState } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import type { MatrixEvidenceType, MatrixStance, ResearchDocument, ResearchMatrixEntry } from "../types";

type MatrixRow = {
  key: string;
  title: string;
  summary: string;
  document: ResearchDocument;
  page: number;
  issue: string;
  stance: MatrixStance;
  evidenceType: MatrixEvidenceType;
  verified: boolean;
  defaultNote: string;
};

const stanceOptions: MatrixStance[] = ["支持", "反对", "条件性", "背景", "待判断"];
const evidenceOptions: MatrixEvidenceType[] = ["学理观点", "裁判说理", "规范依据", "用户摘录", "待判断"];

function inferIssue(title: string, text: string) {
  const value = `${title} ${text}`;
  if (/人格|控制|调度|管理/.test(value)) return "平台控制与人格从属性";
  if (/经济|收入|依赖/.test(value)) return "经济从属性的判断";
  if (/组织|管理|劳动关系/.test(value)) return "劳动关系的认定标准";
  if (/证据|事实/.test(value)) return "事实与证据评价";
  if (/法律|法条|规范/.test(value)) return "法律规范的适用";
  if (/责任|裁判|赔偿/.test(value)) return "裁判结论与责任分配";
  return "待归类争点";
}

function relationToStance(relation: string): MatrixStance {
  return ["支持", "反对", "条件性", "背景"].includes(relation) ? relation as MatrixStance : "待判断";
}

export function MatrixPage() {
  const { path, navigate } = useRouter();
  const { state, dispatch, showToast } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const [issueFilter, setIssueFilter] = useState("全部章节");
  const [stanceFilter, setStanceFilter] = useState<MatrixStance | "全部立场">("全部立场");

  const rows = useMemo<MatrixRow[]>(() => {
    const documents = state.documents.filter((document) => document.projectId === project.id && !document.archivedAt);
    const entries = new Map(state.matrixEntries.filter((entry) => entry.projectId === project.id).map((entry) => [entry.sourceKey, entry]));
    const cardRows = state.cards.filter((card) => card.projectId === project.id).map((card) => {
      const document = documents.find((item) => item.id === card.documentId);
      if (!document) return null;
      const saved = entries.get(`card:${card.id}`);
      return {
        key: `card:${card.id}`, title: card.title, summary: card.excerpt, document, page: card.sourceAnchor?.page ?? card.page,
        issue: saved?.issue || card.outlineNode || inferIssue(card.title, `${card.excerpt} ${card.tags.join(" ")}`),
        stance: saved?.stance || relationToStance(card.relation), evidenceType: saved?.evidenceType || (card.type === "规范卡" ? "规范依据" : "用户摘录"),
        verified: card.verifyStatus === "已核验", defaultNote: card.note,
      } satisfies MatrixRow;
    }).filter((row): row is MatrixRow => Boolean(row));
    return cardRows;
  }, [project.id, state.cards, state.documents, state.matrixEntries]);

  const issues = [...new Set(rows.map((row) => row.issue))];
  const visibleRows = rows.filter((row) => (issueFilter === "全部章节" || row.issue === issueFilter) && (stanceFilter === "全部立场" || row.stance === stanceFilter));
  const verifiedCount = rows.filter((row) => row.verified).length;
  const conflictCount = rows.filter((row) => row.stance === "反对" || row.stance === "条件性").length;

  const saveEntry = (row: MatrixRow, changes: Partial<Pick<ResearchMatrixEntry, "issue" | "stance" | "evidenceType" | "note">>) => {
    const existing = state.matrixEntries.find((entry) => entry.sourceKey === row.key);
    dispatch({ type: "UPSERT_MATRIX_ENTRY", entry: {
      sourceKey: row.key, projectId: project.id, issue: changes.issue ?? existing?.issue ?? row.issue,
      stance: changes.stance ?? existing?.stance ?? row.stance, evidenceType: changes.evidenceType ?? existing?.evidenceType ?? row.evidenceType,
      note: changes.note ?? existing?.note ?? row.defaultNote, updatedAt: new Date().toISOString(),
    } });
  };

  const openSource = (row: MatrixRow) => {
    dispatch({ type: "SET_DOCUMENT_PAGE", documentId: row.document.id, page: row.page });
    navigate(row.document.kind === "paper" ? `/workspace/read/paper/${row.document.id}?page=${row.page}` : `/workspace/read/judgment/${row.document.id}?page=${row.page}`);
  };

  const copyMarkdown = async () => {
    const lines = ["# 写作引用清单", `研究问题：${project.question}`, "", "| 写作章节 | 使用方式 | 材料类型 | 原文定位 |", "| --- | --- | --- | --- |"];
    for (const row of visibleRows) lines.push(`| ${row.issue} | ${row.stance} | ${row.evidenceType} | ${row.document.title}，第 ${row.page} 页：${row.title} |`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("写作引用清单已复制，可直接粘贴到作业草稿或 Markdown 文档");
    } catch { showToast("复制失败，请检查浏览器剪贴板权限"); }
  };

  return <AppShell sidebar={false} full>
    <div className="project-scoped-page matrix-scope">
      <ProjectContextNav projectId={project.id} />
      <section className="research-matrix-page">
        <header className="research-matrix-head">
          <div><span><TableProperties size={16} />从阅读到写作</span><h1>写作引用工作台</h1><p>阅读时保存的研究卡片会自动汇集到这里。为每条摘录归入写作章节、标明使用方式，并随时回到原文复核。</p></div>
          <Button variant="secondary" onClick={() => void copyMarkdown()}><ClipboardCopy size={16} />复制引用清单</Button>
        </header>
        <section className="matrix-question"><Sparkles size={18} /><div><span>本项目写作问题</span><strong>{project.question}</strong></div><small>先保存原文摘录，再决定它服务于哪一节写作。</small></section>
        <section className="matrix-kpis"><div><span>已保存引用</span><strong>{rows.length}</strong><small>只展示你主动沉淀的研究卡片</small></div><div><span>已核验原文</span><strong>{verifiedCount}</strong><small>可放心进入写作草稿的材料</small></div><div><span>反对或限定材料</span><strong>{conflictCount}</strong><small>避免只收集单一立场</small></div></section>
        <section className="matrix-controls"><div><Filter size={15} /><label>写作章节<select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}><option>全部章节</option>{issues.map((issue) => <option key={issue}>{issue}</option>)}</select></label><label>使用方式<select value={stanceFilter} onChange={(event) => setStanceFilter(event.target.value as MatrixStance | "全部立场")}><option>全部立场</option>{stanceOptions.map((stance) => <option key={stance}>{stance}</option>)}</select></label></div><span>显示 {visibleRows.length} 条引用</span></section>
        {visibleRows.length ? <div className="research-matrix-table"><div className="research-matrix-columns"><span>写作章节与摘录</span><span>使用方式</span><span>材料类型</span><span>你的释义</span><span>原文</span></div>{visibleRows.map((row) => <article key={row.key}><div className="matrix-material"><small>{row.document.kind === "paper" ? <BookOpen size={13} /> : <Gavel size={13} />}{row.document.kind === "paper" ? "论文摘录" : "裁判摘录"}{row.verified && <em>已核验</em>}</small><input aria-label={`${row.title} 所属写作章节`} defaultValue={row.issue} list="matrix-issue-options" onBlur={(event) => { const issue = event.target.value.trim(); if (issue && issue !== row.issue) saveEntry(row, { issue }); }} /><h2>{row.title}</h2><p>{row.summary || "暂无摘录，请回到原文补充。"}</p><span>{row.document.title} · 第 {row.page} 页</span></div><div><select aria-label={`${row.title} 的使用方式`} value={row.stance} onChange={(event) => saveEntry(row, { stance: event.target.value as MatrixStance })}>{stanceOptions.map((stance) => <option key={stance}>{stance}</option>)}</select></div><div><select aria-label={`${row.title} 的材料类型`} value={row.evidenceType} onChange={(event) => saveEntry(row, { evidenceType: event.target.value as MatrixEvidenceType })}>{evidenceOptions.map((type) => <option key={type}>{type}</option>)}</select></div><div><textarea aria-label={`${row.title} 的写作释义`} value={state.matrixEntries.find((entry) => entry.sourceKey === row.key)?.note ?? row.defaultNote} placeholder="用自己的话说明：这条摘录准备如何用于论文论证" onChange={(event) => saveEntry(row, { note: event.target.value })} /></div><div><button className="matrix-source-link" onClick={() => openSource(row)}><ExternalLink size={15} />回到第 {row.page} 页</button></div></article>)}<datalist id="matrix-issue-options">{issues.map((issue) => <option key={issue} value={issue} />)}</datalist></div> : <EmptyState icon={<FileText size={28} />} title="还没有写作引用" description="在阅读器中选中一段原文，添加标签或笔记后转为研究卡片；它会自动出现在这里。" />}
      </section>
    </div>
  </AppShell>;
}
