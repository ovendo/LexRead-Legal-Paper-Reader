import { AlertTriangle, ClipboardCopy, ExternalLink, FileCheck2, FileText, LoaderCircle, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getLegalCitations, type LegalCitationResult } from "../api";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, EmptyState } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";

export function CitationPage() {
  const { path, navigate } = useRouter();
  const { state, showToast } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const papers = useMemo(() => state.documents.filter((item) => item.projectId === project.id && item.kind === "paper"), [project.id, state.documents]);
  const [documentId, setDocumentId] = useState("");
  const [citations, setCitations] = useState<LegalCitationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyRisks, setOnlyRisks] = useState(false);
  const selected = papers.find((item) => item.id === documentId);
  const visible = onlyRisks ? citations.filter((item) => item.issues.length) : citations;
  const riskCount = citations.filter((item) => item.issues.length).length;

  useEffect(() => {
    if (!documentId && papers[0]) setDocumentId(papers[0].id);
    if (documentId && !papers.some((item) => item.id === documentId)) setDocumentId(papers[0]?.id ?? "");
  }, [documentId, papers]);

  useEffect(() => {
    let cancelled = false;
    if (!documentId) { setCitations([]); return; }
    setLoading(true);
    getLegalCitations(documentId)
      .then((result) => { if (!cancelled) setCitations(result.citations); })
      .catch((error) => { if (!cancelled) { setCitations([]); showToast(error instanceof Error ? error.message : "读取脚注失败"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, showToast]);

  const copyAll = async () => {
    if (!citations.length) return;
    const output = citations.map((item, index) => String(index + 1) + ". " + item.formatted).join("\n");
    try { await navigator.clipboard.writeText(output); showToast("已复制全部转换后的引注草稿"); }
    catch { showToast("复制失败，请检查浏览器权限"); }
  };

  return <AppShell sidebar={false} full>
    <div className="project-scoped-page citation-scope">
      <ProjectContextNav projectId={project.id} />
      <section className="citation-page">
        <header>
          <div>
            <span><FileCheck2 size={16} />自动脚注转换</span>
            <h1>论文引注校对</h1>
            <p>选择已上传的论文，系统直接读取 PDF 中已识别的脚注，批量转换为法学引注草稿，并标出不能可靠转换的条目。</p>
          </div>
          <Button variant="secondary" onClick={() => navigate("/workspace/upload-parse?kind=paper")}><UploadCloud size={16} />上传论文</Button>
        </header>
        {!papers.length ? <div className="citation-empty"><EmptyState icon={<FileText size={30} />} title="还没有可转换的论文" description="请先上传 PDF。文字解析完成后，脚注会自动出现在这里。" action={<Button onClick={() => navigate("/workspace/upload-parse?kind=paper")}>上传论文</Button>} /></div> :
          <div className="citation-auto">
            <div className="citation-auto-toolbar">
              <label>来源论文<select value={documentId} onChange={(event) => setDocumentId(event.target.value)}>{papers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <div><Badge tone={riskCount ? "amber" : "green"}>{loading ? "读取中" : riskCount ? riskCount + " 条待核验" : "基础信息齐全"}</Badge><Button onClick={() => void copyAll()} disabled={loading || !citations.length}><ClipboardCopy size={15} />复制全部</Button></div>
            </div>
            {selected && !["readable", "partial"].includes(selected.readingStatus) ? <p className="citation-processing"><LoaderCircle size={16} className="spin" />论文仍在解析中；文字和脚注读取完成后会自动显示。</p> :
              <div className="citation-listing">
                <aside>
                  <strong>转换结果</strong>
                  <span>{citations.length} 条已识别脚注</span>
                  <button className={!onlyRisks ? "is-active" : ""} onClick={() => setOnlyRisks(false)}>全部脚注 <em>{citations.length}</em></button>
                  <button className={onlyRisks ? "is-active" : ""} onClick={() => setOnlyRisks(true)}>待人工核对 <em>{riskCount}</em></button>
                  <p>不会补写或虚构缺失的作者、页码、案号等信息。</p>
                </aside>
                <main>
                  {loading ? <p className="citation-loading"><LoaderCircle size={18} className="spin" />正在提取并转换脚注…</p> :
                    visible.length ? visible.map((item, index) => <article key={item.id}>
                      <header><span>#{onlyRisks ? citations.indexOf(item) + 1 : index + 1} · 第 {item.page} 页</span><Badge tone={item.issues.length ? "amber" : "green"}>{item.type}</Badge></header>
                      <p className="citation-original">原脚注：{item.original}</p>
                      <blockquote>{item.formatted}</blockquote>
                      <footer>{item.issues.length ? <span className="citation-risk"><AlertTriangle size={14} />{item.issues.join("；")}</span> : <span className="citation-ready">可作为引注草稿使用，提交前仍请对照原文。</span>}<button onClick={() => navigate("/workspace/read/paper/" + documentId + "?page=" + item.page)}><ExternalLink size={14} />回到原文</button></footer>
                    </article>) : <p className="citation-loading">{onlyRisks ? "没有待人工核对的脚注。" : "这篇论文没有识别到脚注。若 PDF 是扫描件，请先在上传页完成 OCR。"}</p>}
                </main>
              </div>}
          </div>}
      </section>
    </div>
  </AppShell>;
}
