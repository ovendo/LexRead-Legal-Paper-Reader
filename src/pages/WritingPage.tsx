import { BookOpen, ClipboardCopy, FilePenLine, Plus, Quote, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, ProjectContextNav } from "../components/Layout";
import { Badge, Button, EmptyState } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";

export function WritingPage() {
  const { path, navigate } = useRouter(); const { state, dispatch, showToast } = useAppStore();
  const projectId = decodeURIComponent(path.split("/projects/")[1]?.split("/")[0] || state.selectedProjectId);
  const project = state.projects.find((item) => item.id === projectId) ?? state.projects[0];
  const sections = project.outline.length ? project.outline : [{ id: "opening", title: "引言", sections: 1 }];
  const [sectionId, setSectionId] = useState(sections[0].id);
  const draft = state.writingDrafts.find((item) => item.projectId === project.id && item.outlineId === sectionId);
  const [content, setContent] = useState(draft?.content ?? "");
  const cards = useMemo(() => state.cards.filter((card) => card.projectId === project.id), [project.id, state.cards]);
  const documentsById = useMemo(() => new Map(state.documents.map((document) => [document.id, document])), [state.documents]);
  useEffect(() => { setContent(state.writingDrafts.find((item) => item.projectId === project.id && item.outlineId === sectionId)?.content ?? ""); }, [project.id, sectionId, state.writingDrafts]);
  useEffect(() => { if (project.id !== state.selectedProjectId) dispatch({ type: "SELECT_PROJECT", projectId: project.id }); }, [dispatch, project.id, state.selectedProjectId]);
  const save = (next = content, cardId?: string) => dispatch({ type: "UPSERT_WRITING_DRAFT", draft: { projectId: project.id, outlineId: sectionId, content: next, citationCardIds: [...new Set([...(draft?.citationCardIds ?? []), ...(cardId ? [cardId] : [])])], updatedAt: new Date().toISOString() } });
  const insertCitation = (cardId: string, mode: "quote" | "paraphrase") => {
    const card = cards.find((item) => item.id === cardId); if (!card) return;
    const citation = `（${card.source}，第 ${card.page} 页）`; const text = mode === "quote" ? `“${card.excerpt}”${citation}` : `${card.note || card.excerpt}${citation}`;
    const next = `${content}${content.trim() ? "\n\n" : ""}${text}`; setContent(next); save(next, card.id); showToast(mode === "quote" ? "已插入直接引语与页码" : "已插入转述引用与页码");
  };
  const citationFootnote = (cardId: string) => {
    const card = cards.find((item) => item.id === cardId);
    if (!card) return "";
    const sourceDocument = documentsById.get(card.documentId);
    const author = sourceDocument?.author && sourceDocument.author !== "待校对" ? sourceDocument.author : "";
    const title = sourceDocument?.title || card.title;
    return author ? author + "：《" + title + "》，" + card.source + "，第 " + card.page + " 页。" : card.source + "：《" + title + "》，第 " + card.page + " 页。";
  };
  const copy = async () => {
    const usedCards = (draft?.citationCardIds ?? []).map((id) => citationFootnote(id)).filter(Boolean);
    const notes = usedCards.map((item, index) => "〔" + (index + 1) + "〕" + item).join("\\n");
    const output = content + (notes ? "\\n\\n注释\\n" + notes : "");
    try { await navigator.clipboard.writeText(output); showToast(usedCards.length ? "段落与脚注草稿已复制，请核对刊期信息" : "当前段落草稿已复制"); } catch { showToast("复制失败，请检查浏览器权限"); }
  };
  const copyFootnote = async (cardId: string) => {
    const card = cards.find((item) => item.id === cardId); if (!card) return;
    const document = documentsById.get(card.documentId);
    const author = document?.author && document.author !== "待校对" ? document.author : "";
    const footnote = author ? `${author}：《${document?.title || card.title}》，${card.source}，第 ${card.page} 页。` : `${card.source}：《${document?.title || card.title}》，第 ${card.page} 页。`;
    try { await navigator.clipboard.writeText(footnote); showToast("脚注草稿已复制，请按课程要求核对作者、年份和期号"); } catch { showToast("复制失败，请检查浏览器权限"); }
  };
  const selected = sections.find((item) => item.id === sectionId);
  const addSection = (event?: React.MouseEvent) => {
    if (event?.shiftKey) return deleteSection();
    const title = window.prompt("新建写作章节", "第二章");
    if (!title?.trim()) return;
    const next = [...project.outline, { id: "outline-" + Date.now(), title: title.trim(), sections: 1 }];
    dispatch({ type: "UPDATE_PROJECT_OUTLINE", projectId: project.id, outline: next });
    setSectionId(next[next.length - 1].id);
    showToast("已新建写作章节");
  };
  const deleteSection = () => {
    if (project.outline.length <= 1) return showToast("请至少保留一个写作章节");
    if (!window.confirm("删除“" + (selected?.title || "") + "”及其草稿？此操作无法恢复。")) return;
    const next = project.outline.filter((item) => item.id !== sectionId);
    dispatch({ type: "DELETE_PROJECT_OUTLINE", projectId: project.id, outlineId: sectionId });
    setSectionId(next[0].id);
    showToast("章节及其草稿已删除");
  };
  return <AppShell sidebar={false} full><div className="project-scoped-page writing-scope"><ProjectContextNav projectId={project.id} /><section className="writing-page"><header><div><span><FilePenLine size={16} />从阅读到写作</span><h1>论文写作工作台</h1><p>把已保存的原文观点插入你正在写的段落，并始终保留出处与页码。</p></div><Button variant="secondary" onClick={() => void copy()}><ClipboardCopy size={16} />复制当前段落</Button></header><div className="writing-layout"><aside className="writing-outline"><div className="writing-outline-head"><strong>论文提纲</strong><button onClick={addSection}><Plus size={14} />新建章节</button></div><p>选择一个章节，围绕它积累段落与引文。</p>{sections.map((item) => <button key={item.id} className={item.id === sectionId ? "is-active" : ""} onClick={() => setSectionId(item.id)}><span>{item.title}</span><small>{state.writingDrafts.find((draftItem) => draftItem.projectId === project.id && draftItem.outlineId === item.id)?.citationCardIds.length ?? 0} 条引文</small></button>)}</aside><main className="writing-editor"><div className="writing-editor-head"><div><span>正在写</span><h2>{selected?.title}</h2></div><button onClick={() => { save(); showToast("段落草稿已保存到本机项目"); }}><Save size={15} />保存</button></div><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="先写出你的判断，再从右侧插入经过阅读确认的原文、转述和页码。" /><footer><span>直接引语必须保持原意；转述前请先写清自己的判断。</span><Badge tone="blue">本机保存</Badge></footer></main><aside className="writing-citations"><div><strong>可用引用</strong><span>{cards.length} 条</span></div><p>阅读器中选中原文后点击“写作引用”，它会自动出现在这里。</p>{cards.length ? <div>{cards.map((card) => <article key={card.id}><Badge tone={card.verifyStatus === "已核验" ? "green" : "amber"}>{card.verifyStatus}</Badge><h3>{card.title}</h3><blockquote>{card.excerpt}</blockquote><small>{card.source} · 第 {card.page} 页</small><footer><button onClick={() => insertCitation(card.id, "quote")}><Quote size={13} />直接引语</button><button onClick={() => insertCitation(card.id, "paraphrase")}><Plus size={13} />转述引用</button><button onClick={() => void copyFootnote(card.id)}><ClipboardCopy size={13} />脚注</button></footer></article>)}</div> : <EmptyState icon={<BookOpen size={26} />} title="还没有可用引用" description="回到阅读器，选中有价值的原文并保存为研究卡片。" action={<Button onClick={() => navigate(`/workspace/projects/${project.id}/materials`)}>打开资料库</Button>} />}</aside></div></section></div></AppShell>;
}
