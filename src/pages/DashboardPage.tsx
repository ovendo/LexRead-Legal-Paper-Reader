import { Archive, ArchiveRestore, ArrowRight, FileText, FolderKanban, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { deleteDocument } from "../api";
import { AppShell } from "../components/Layout";
import { Button, Progress } from "../components/UI";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import { getProjectProgress } from "../researchProgress";

export function DashboardPage() {
  const { navigate } = useRouter();
  const { state, dispatch } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pendingProject, setPendingProject] = useState<{ id: string; mode: "archive" | "restore" | "delete" } | null>(null);
  const visibleProjects = state.projects.filter((project) => Boolean(project.archivedAt) === showArchived);

  const openProject = (projectId: string) => {
    dispatch({ type: "SELECT_PROJECT", projectId });
    navigate(`/workspace/projects/${projectId}/overview`);
  };

  const createProject = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const projectId = `p-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 10);
    dispatch({ type: "CREATE_PROJECT", project: {
      id: projectId,
      title: trimmedTitle,
      question: question.trim() || "尚未填写核心研究问题",
      stage: "资料收集",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      questionTree: [],
      outline: [],
    } });
    setCreating(false);
    setTitle("");
    setQuestion("");
    navigate(`/workspace/projects/${projectId}/overview`);
  };

  const confirmProjectAction = async () => {
    if (!pendingProject) return;
    const project = state.projects.find((item) => item.id === pendingProject.id);
    if (!project) return setPendingProject(null);
    if (pendingProject.mode === "delete") {
      const serverDocuments = state.documents.filter((document) => document.projectId === project.id && serverIdPattern.test(document.id));
      const results = await Promise.allSettled(serverDocuments.map((document) => deleteDocument(document.id)));
      if (results.some((result) => result.status === "rejected")) {
        dispatch({ type: "SET_TOAST", message: "部分 PDF 文件未能从本地服务器删除，请稍后重试" });
        return;
      }
      dispatch({ type: "DELETE_PROJECT", projectId: project.id });
      dispatch({ type: "SET_TOAST", message: "项目及关联文档已删除" });
    } else {
      const archived = pendingProject.mode === "archive";
      dispatch({ type: "ARCHIVE_PROJECT", projectId: project.id, archived });
      dispatch({ type: "SET_TOAST", message: archived ? "项目已归档，可随时恢复" : "项目已恢复" });
    }
    setPendingProject(null);
  };

  return <AppShell sidebar={false}>
    <div className="projects-home">
      <header className="projects-home-head"><div><span>LexRead 研究空间</span><h1>{showArchived ? "已归档项目" : "选择一个研究项目"}</h1><p>{showArchived ? "归档项目不会出现在日常工作区，恢复后可继续研究。" : "论文、裁判文书、阅读卡片和成果都归入项目，先选定研究问题，再开始阅读。"}</p></div><div className="projects-head-actions"><Button variant="secondary" onClick={() => setShowArchived(!showArchived)}>{showArchived ? <FolderKanban size={16} /> : <Archive size={16} />}{showArchived ? "返回项目" : `归档项目 (${state.projects.filter((item) => item.archivedAt).length})`}</Button><Button onClick={() => setCreating(true)}><Plus size={17} />新建研究项目</Button></div></header>

      <section className="project-choice-grid project-choice-grid-projects">
        {visibleProjects.map((project) => {
          const documents = state.documents.filter((document) => document.projectId === project.id && (!document.archivedAt || Boolean(project.archivedAt)));
          const ready = documents.filter((document) => document.status === "ready").length;
          const progress = getProjectProgress(state, project.id);
          return <article className="project-choice-card" key={project.id}><button className="project-card-open" onClick={() => openProject(project.id)}><div className="project-card-icon"><FolderKanban size={22} /></div><div className="project-card-title"><strong>{project.title}</strong><ArrowRight size={17} /></div><p>{project.question}</p><div className="project-card-progress"><Progress value={progress} /><span>{progress}%</span></div><footer><span><FileText size={14} />{documents.length} 份文档</span><span>{ready} 份可阅读</span><time>更新于 {project.updatedAt}</time></footer></button><div className="project-card-actions"><button onClick={() => setPendingProject({ id: project.id, mode: project.archivedAt ? "restore" : "archive" })}>{project.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}{project.archivedAt ? "恢复" : "归档"}</button><button className="danger" onClick={() => setPendingProject({ id: project.id, mode: "delete" })}><Trash2 size={14} />删除</button></div></article>;
        })}
      </section>
      {!visibleProjects.length && <div className="projects-empty"><Archive size={28} /><strong>{showArchived ? "没有已归档项目" : "还没有研究项目"}</strong><p>{showArchived ? "归档后的项目会集中显示在这里。" : "新建项目后即可上传和阅读论文。"}</p></div>}
    </div>

    {creating && <div className="simple-modal-backdrop" onMouseDown={() => setCreating(false)}><form className="simple-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createProject(); }}><button type="button" className="modal-close" onClick={() => setCreating(false)} aria-label="关闭"><X size={18} /></button><span>新建研究项目</span><h2>你准备研究什么问题？</h2><label>项目名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：平台劳动关系认定研究" /></label><label>核心研究问题<textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="先写一个暂定问题，进入项目后还可以调整。" /></label><div><Button type="button" variant="secondary" onClick={() => setCreating(false)}>取消</Button><Button type="submit" disabled={!title.trim()}>创建并进入项目<ArrowRight size={16} /></Button></div></form></div>}
    {pendingProject && <div className="simple-modal-backdrop" onMouseDown={() => setPendingProject(null)}><div className="simple-modal confirm-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><span>{pendingProject.mode === "delete" ? "删除项目" : pendingProject.mode === "archive" ? "归档项目" : "恢复项目"}</span><h2>{pendingProject.mode === "delete" ? "确定永久删除这个项目？" : pendingProject.mode === "archive" ? "暂时收起这个项目？" : "恢复到日常工作区？"}</h2><p>{pendingProject.mode === "delete" ? "项目内的 PDF、阅读进度和研究卡片都会一并删除，此操作无法撤销。" : pendingProject.mode === "archive" ? "文档、标注和研究卡片都会保留，可从归档项目中恢复。" : "恢复后，项目及全部材料会重新出现在项目列表中。"}</p><div><Button variant="secondary" onClick={() => setPendingProject(null)}>取消</Button><Button className={pendingProject.mode === "delete" ? "danger-button" : ""} onClick={confirmProjectAction}>{pendingProject.mode === "delete" ? "永久删除" : pendingProject.mode === "archive" ? "确认归档" : "确认恢复"}</Button></div></div></div>}
  </AppShell>;
}

const serverIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
