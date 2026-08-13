import { ArrowRight, BookOpenCheck, BookOpenText, CheckCircle2, ChevronDown, CircleHelp, CloudDownload, CloudUpload, FilePenLine, FolderKanban, KeyRound, LayoutDashboard, Library, LoaderCircle, Menu, Plus, Settings, ShieldCheck, TableProperties, UserRound, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getApiHealth, getAiSettings, saveAiSettings, testAiSettings, type ApiHealth, type AiSettings, type ProviderOptions } from "../api";
import { DEMO_FEATURE_MESSAGE, FULL_VERSION_URL, IS_DEMO } from "../demo";
import { useRouter } from "../router";
import { useAppStore } from "../store";
import { Button, Modal, cx } from "./UI";

const topNav = [
  { label: "研究项目", path: "/workspace", icon: FolderKanban },
];

function routeActive(current: string, target: string) {
  if (target === "/workspace") return current === "/workspace" || current.includes("/projects/") || current.includes("/papers/") || current.includes("/read/") || current.includes("upload-parse");
  return false;
}

export function TopNav() {
  const { path, navigate } = useRouter();
  const { showToast, backupToFastLink, restoreFromFastLink, cloudSync } = useAppStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => { if (!IS_DEMO) getApiHealth().then(setHealth).catch(() => setHealth(null)); }, []);
  useEffect(() => {
    const openSettings = () => IS_DEMO ? showToast(DEMO_FEATURE_MESSAGE) : setApiOpen(true);
    window.addEventListener("lexread:open-api-settings", openSettings);
    return () => window.removeEventListener("lexread:open-api-settings", openSettings);
  }, []);

  const statusLabel = IS_DEMO ? "演示模式" : health === null ? "检查中" : health.configured ? "已配置" : "未配置";

  return <>
    <header className="top-nav">
      <button className="brand" onClick={() => navigate("/workspace")} aria-label="返回工作台">
        <span className="brand-mark"><span>L</span><span>R</span></span>
        <span className="brand-name">LexRead<small>法律论文阅读器</small></span>
      </button>
      <nav className="top-links" aria-label="主导航">
        {topNav.map((item) => <button key={item.path} className={cx("top-link", routeActive(path, item.path) && "is-active")} onClick={() => navigate(item.path)}>{item.label}</button>)}
      </nav>
      <div className="top-actions">
        <button className={cx("api-settings-trigger", health?.configured && "is-configured", !IS_DEMO && health === null && "is-checking", IS_DEMO && "is-demo")} onClick={() => IS_DEMO ? showToast(DEMO_FEATURE_MESSAGE) : setApiOpen(true)}><KeyRound size={16} /><span>AI API</span><em>{statusLabel}</em><i /></button>
        <button className="profile-button" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><span>张</span><em>张研究员</em><ChevronDown size={15} /></button>
        {profileOpen && <div className="profile-menu">
          <div><span>张</span><strong>张研究员<small>{cloudSync.status === "syncing" ? "快链同步中…" : "本地研究空间"}</small></strong></div>
          <button disabled={cloudSync.status === "syncing"} onClick={() => IS_DEMO ? showToast(DEMO_FEATURE_MESSAGE) : void backupToFastLink()}><CloudUpload size={16} /><span>{cloudSync.status === "syncing" ? "正在备份…" : "备份研究资料到快链"}</span></button>
          <button disabled={cloudSync.status === "syncing"} onClick={() => {
            if (IS_DEMO) return showToast(DEMO_FEATURE_MESSAGE);
            if (window.confirm("将以快链备份替换本机的项目、标注、研究卡片和写作草稿。PDF 原件、解析全文和 API 密钥不会恢复，是否继续？")) void restoreFromFastLink();
          }}><CloudDownload size={16} /><span>从快链恢复研究资料</span></button>
          <p className="profile-cloud-note">仅同步项目、标注、卡片、写作草稿和任务；PDF 原件、解析全文与 API 密钥始终留在本机。</p>
          <button onClick={() => { IS_DEMO ? showToast(DEMO_FEATURE_MESSAGE) : setApiOpen(true); setProfileOpen(false); }}><Settings size={16} /><span>AI API 设置</span></button>
          <button onClick={() => { window.dispatchEvent(new Event("lexread:open-help")); setProfileOpen(false); }}><CircleHelp size={16} /><span>使用帮助</span></button>
          <button onClick={() => { navigate("/workspace"); setProfileOpen(false); }}><FolderKanban size={16} /><span>返回项目列表</span></button>
        </div>}
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="菜单">{mobileOpen ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
      {mobileOpen && <nav className="mobile-links">{topNav.map((item) => <button key={item.path} onClick={() => { navigate(item.path); setMobileOpen(false); }}><item.icon size={17} />{item.label}</button>)}</nav>}
    </header>
    {apiOpen && <AiSettingsDialog onClose={() => setApiOpen(false)} onConfigured={(nextHealth) => setHealth(nextHealth)} showToast={showToast} />}
  </>;
}

function AiSettingsDialog({ onClose, onConfigured, showToast }: { onClose: () => void; onConfigured: (health: ApiHealth) => void; showToast: (message: string) => void }) {
  const [settings, setSettings] = useState<AiSettings>({ configured: false, ocrProvider: "zhipu", ocrModel: "glm-ocr", textProvider: "kimi", textModel: "moonshot-v1-32k", kimi: { apiKey: false, baseUrl: "https://api.moonshot.cn/v1" }, zhipu: { apiKey: false, baseUrl: "https://open.bigmodel.cn/api/paas/v4" }, deepseek: { apiKey: false, baseUrl: "https://api.deepseek.com/v1" }, providerOptions: {} });
  const [kimiKey, setKimiKey] = useState("");
  const [zhipuKey, setZhipuKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    getAiSettings().then((s) => { setSettings(s); }).catch((error) => setResult({ tone: "error", text: error instanceof Error ? error.message : "配置读取失败" })).finally(() => setLoading(false));
  }, []);

  const saveAndTest = async () => {
    setSaving(true);
    setResult(null);
    let savedLocally = false;
    try {
      const saved = await saveAiSettings({
        ocrProvider: settings.ocrProvider, ocrModel: settings.ocrModel,
        textProvider: settings.textProvider, textModel: settings.textModel,
        kimi: { apiKey: kimiKey.trim() || undefined, baseUrl: settings.kimi.baseUrl },
        zhipu: { apiKey: zhipuKey.trim() || undefined, baseUrl: settings.zhipu.baseUrl },
        deepseek: { apiKey: deepseekKey.trim() || undefined, baseUrl: settings.deepseek.baseUrl },
      });
      setSettings(saved);
      setKimiKey("");
      setZhipuKey("");
      setDeepseekKey("");
      savedLocally = true;
      onConfigured(await getApiHealth());
      const tested = await testAiSettings();
      if (!tested.ok) throw new Error("配置已保存，但模型没有返回预期结果。");
      setResult({ tone: "success", text: `连接成功，当前使用 ${tested.model}` });
      window.dispatchEvent(new Event("lexread:kimi-settings-updated"));
      showToast("AI API 已保存并通过连接测试");
    } catch (error) {
      const message = error instanceof Error ? error.message : "API 配置失败";
      setResult({ tone: "error", text: savedLocally ? `配置已保存在本机，但连接测试失败：${message}` : message });
    } finally { setSaving(false); }
  };

  const allOpts = settings.providerOptions;
  const ocrOpts = settings.textProvider === settings.ocrProvider && allOpts[settings.ocrProvider]?.ocr
    ? allOpts[settings.ocrProvider].ocr : (allOpts[settings.ocrProvider]?.ocr ?? allOpts["zhipu"]?.ocr ?? []);
  const ocrAnalysisOpts = allOpts[settings.ocrProvider]?.analysis ?? [];
  const textAnalysisOpts = allOpts[settings.textProvider]?.analysis ?? [];

  return <Modal title="AI API 设置" onClose={onClose}>
    <div className="kimi-settings-modal">
      <div className="kimi-security-note"><span><ShieldCheck size={18} /></span><div><strong>{settings.configured ? "密钥已保存在本机" : "连接你的 AI 平台账号"}</strong><p>密钥只写入本机私有配置文件，页面不会读取或回显已经保存的密钥。</p></div>{settings.configured && <CheckCircle2 size={18} />}</div>
      {loading ? <div className="kimi-settings-loading"><LoaderCircle className="spin" size={20} />正在读取配置</div> : <div className="kimi-settings-form">
        <fieldset className="settings-section">
          <legend><span>视觉识别 (OCR)</span><small>文档逐页图片识别，获取文字层</small></legend>
          <label><span>OCR 平台</span>
            <div className="provider-toggle">
              <button className={cx(settings.ocrProvider === "kimi" && "is-active")} onClick={() => setSettings({ ...settings, ocrProvider: "kimi", ocrModel: allOpts["kimi"]?.ocr?.[0]?.value || settings.ocrModel })} disabled={!allOpts["kimi"]?.ocr?.length}>Kimi</button>
              <button className={cx(settings.ocrProvider === "zhipu" && "is-active")} onClick={() => setSettings({ ...settings, ocrProvider: "zhipu", ocrModel: allOpts["zhipu"]?.ocr?.[0]?.value || "glm-ocr" })}>智谱 (推荐)</button>
            </div>
          </label>
          {settings.ocrProvider === "kimi" && <label><span>Kimi API Key</span><input type="password" value={kimiKey} onChange={(e) => setKimiKey(e.target.value)} autoComplete="off" placeholder={settings.kimi.apiKey ? "已保存 · 留空则不变" : "粘贴 Kimi Key"} /></label>}
          {settings.ocrProvider === "zhipu" && <label><span>智谱 API Key</span><input type="password" value={zhipuKey} onChange={(e) => setZhipuKey(e.target.value)} autoComplete="off" placeholder={settings.zhipu.apiKey ? "已保存 · 留空则不变" : "粘贴智谱 Key"} /></label>}
          <label><span>OCR 模型</span>
            <select value={settings.ocrModel} onChange={(e) => setSettings({ ...settings, ocrModel: e.target.value })}>
              {ocrOpts.map((opt: { value: string; label: string }) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
          {settings.ocrProvider === "kimi" && <label><span>Kimi API 地址</span><input value={settings.kimi.baseUrl} onChange={(e) => setSettings({ ...settings, kimi: { ...settings.kimi, baseUrl: e.target.value } })} /></label>}
          {settings.ocrProvider === "zhipu" && <label><span>智谱 API 地址</span><input value={settings.zhipu.baseUrl} onChange={(e) => setSettings({ ...settings, zhipu: { ...settings.zhipu, baseUrl: e.target.value } })} /></label>}
        </fieldset>

        <fieldset className="settings-section">
          <legend><span>文本分析</span><small>论文论证重构、裁判推理提取；默认使用最快文本模型</small></legend>
          <label><span>分析平台</span>
            <div className="provider-toggle">
              <button className={cx(settings.textProvider === "kimi" && "is-active")} onClick={() => setSettings({ ...settings, textProvider: "kimi", textModel: allOpts["kimi"]?.analysis?.[0]?.value || settings.textModel })}>Kimi</button>
              <button className={cx(settings.textProvider === "zhipu" && "is-active")} onClick={() => setSettings({ ...settings, textProvider: "zhipu", textModel: allOpts["zhipu"]?.analysis?.[0]?.value || "glm-4-flash" })}>智谱 (推荐)</button>
              <button className={cx(settings.textProvider === "deepseek" && "is-active")} onClick={() => setSettings({ ...settings, textProvider: "deepseek", textModel: allOpts["deepseek"]?.analysis?.[0]?.value || "deepseek-chat" })}>DeepSeek (最快)</button>
            </div>
          </label>
          {settings.textProvider === "kimi" && <label><span>Kimi API Key</span><input type="password" value={kimiKey} onChange={(e) => setKimiKey(e.target.value)} autoComplete="off" placeholder={settings.kimi.apiKey ? "已保存 · 留空则不变" : "粘贴 Kimi Key"} /></label>}
          {settings.textProvider === "zhipu" && <label><span>智谱 API Key</span><input type="password" value={zhipuKey} onChange={(e) => setZhipuKey(e.target.value)} autoComplete="off" placeholder={settings.zhipu.apiKey ? "已保存 · 留空则不变" : "粘贴智谱 Key"} /></label>}
          {settings.textProvider === "deepseek" && <label><span>DeepSeek API Key</span><input type="password" value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)} autoComplete="off" placeholder={settings.deepseek.apiKey ? "已保存 · 留空则不变" : "粘贴 DeepSeek Key"} /></label>}
          <label><span>分析模型</span>
            <select value={settings.textModel} onChange={(e) => setSettings({ ...settings, textModel: e.target.value })}>
              {textAnalysisOpts.map((opt: { value: string; label: string }) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <small>所有文本功能共用此模型，默认优先速度；OCR 模型不受影响。</small>
          </label>
          {settings.textProvider === "kimi" && <label><span>Kimi API 地址</span><input value={settings.kimi.baseUrl} onChange={(e) => setSettings({ ...settings, kimi: { ...settings.kimi, baseUrl: e.target.value } })} /></label>}
          {settings.textProvider === "zhipu" && <label><span>智谱 API 地址</span><input value={settings.zhipu.baseUrl} onChange={(e) => setSettings({ ...settings, zhipu: { ...settings.zhipu, baseUrl: e.target.value } })} /></label>}
          {settings.textProvider === "deepseek" && <label><span>DeepSeek API 地址</span><input value={settings.deepseek.baseUrl} onChange={(e) => setSettings({ ...settings, deepseek: { ...settings.deepseek, baseUrl: e.target.value } })} /></label>}
        </fieldset>
      </div>}
      {result && <div className={`kimi-test-result ${result.tone}`}>{result.tone === "success" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}<span>{result.text}</span></div>}
      <footer><Button variant="ghost" onClick={onClose}>稍后设置</Button><Button onClick={() => void saveAndTest()} disabled={loading || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}{saving ? "正在连接" : "保存并测试连接"}</Button></footer>
    </div>
  </Modal>;
}
export function ProjectContextNav({ projectId }: { projectId: string }) {
  const { path, navigate } = useRouter();
  const { state, dispatch } = useAppStore();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const links = [
    { label: "项目概览", description: "文档、进度与研究问题", icon: LayoutDashboard, path: `/workspace/projects/${projectId}/overview`, active: !path.includes("/materials") && !path.includes("/matrix") && !path.includes("/writing") },
    { label: "项目资料库", description: "观点、案例、规范与引用", icon: Library, path: `/workspace/projects/${projectId}/materials`, active: path.includes("/materials") },
    { label: "引注校对", description: "生成并核对法学脚注", icon: TableProperties, path: `/workspace/projects/${projectId}/matrix`, active: path.includes("/matrix") },
    { label: "开始写作", description: "提纲、段落与引文插入", icon: FilePenLine, path: `/workspace/projects/${projectId}/writing`, active: path.includes("/writing") },
  ];
  return <section className="project-context-nav"><button className="project-context-title" onClick={() => navigate("/workspace")}><span className="project-context-icon"><FolderKanban size={20} /></span><span><small>当前项目</small><strong>{project.title}</strong><em>返回全部项目</em></span></button><nav aria-label="项目导航">{links.map((item) => <button key={item.path} className={item.active ? "is-active" : ""} aria-current={item.active ? "page" : undefined} onClick={() => { dispatch({ type: "SELECT_PROJECT", projectId }); navigate(item.path); }}><item.icon size={20} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.active && <em>当前</em>}</button>)}</nav></section>;
}

export function ProjectSidebar({ mode = "workspace" }: { mode?: "workspace" | "project" }) {
  const { path, navigate } = useRouter();
  const { state, activeProject, dispatch, showToast } = useAppStore();
  const projectLinks = [
    { label: "研究项目总览", icon: FolderKanban, path: `/workspace/projects/${activeProject.id}/overview` },
    { label: "文献与案例", icon: BookOpenText, path: `/workspace/projects/${activeProject.id}/materials` },
  ];

  return <aside className="sidebar">
    {mode === "project" && <button className="sidebar-back" onClick={() => navigate("/workspace")}><span>←</span> 返回工作台</button>}
    <Button className="sidebar-create" onClick={() => IS_DEMO ? showToast(DEMO_FEATURE_MESSAGE) : navigate("/workspace/upload-parse")}><Plus size={17} /> 上传并分析文档</Button>
    <div className="sidebar-section">
      <p className="sidebar-label">{mode === "project" ? activeProject.title : "项目快捷入口"}</p>
      {mode === "workspace" ? state.projects.map((project, index) => <button key={project.id} className={cx("sidebar-item", project.id === state.selectedProjectId && "is-active")} onClick={() => { dispatch({ type: "SELECT_PROJECT", projectId: project.id }); navigate(`/workspace/projects/${project.id}/overview`); }}>
        <span className={`sidebar-glyph tone-${index % 3}`}><FolderKanban size={15} /></span><span>{project.title}</span>{project.id === state.selectedProjectId && <i />}
      </button>) : projectLinks.map((item) => <button key={item.label} className={cx("sidebar-item", !path.includes("materials") && item.label === "研究项目总览" && "is-active", path.includes("materials") && item.label === "文献与案例" && "is-active")} onClick={() => navigate(item.path.split("#")[0])}><item.icon size={16} /><span>{item.label}</span></button>)}
    </div>
    <div className="sidebar-guidance"><Library size={17} /><span>所有 AI 结论都需要回到原文核验。</span></div>
  </aside>;
}

export function AppShell({ children, sidebar = true, projectSidebar = false, full = false }: { children: ReactNode; sidebar?: boolean; projectSidebar?: boolean; full?: boolean }) {
  const { state, activeProject } = useAppStore();
  const { navigate } = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const openHelp = () => setHelpOpen(true);
    window.addEventListener("lexread:open-help", openHelp);
    return () => window.removeEventListener("lexread:open-help", openHelp);
  }, []);
  return <div className="app-root">
    <TopNav />
    {IS_DEMO && <div className="demo-banner" role="status"><strong>在线演示</strong><span>当前使用预置研究数据；上传 PDF、OCR 和 AI 分析请下载完整版体验。</span><a href={FULL_VERSION_URL} download>下载完整版</a></div>}
    <div className={cx("app-layout", !sidebar && "no-sidebar", full && "is-full")}>{sidebar && <ProjectSidebar mode={projectSidebar ? "project" : "workspace"} />}<main className="app-main">{children}</main></div>
    {state.toast && <div className="toast"><span>✓</span>{state.toast}</div>}
    <button className="help-fab" aria-label="打开使用帮助" onClick={() => setHelpOpen(true)}><CircleHelp size={19} /></button>
    {helpOpen && <Modal title="从研究问题到可核验成果" onClose={() => setHelpOpen(false)}>
      <div className="help-center">
        <p>LexRead 的核心不是“自动生成结论”，而是让每个结论都能回到原文。</p>
        <ol>
          <li><span>1</span><div><strong>建立项目</strong><small>确定研究问题，再上传论文或裁判文书。</small></div></li>
          <li><span>2</span><div><strong>阅读并核验</strong><small>查看 AI 提取的要点，逐条绑定和核对原文。</small></div></li>
          <li><span>3</span><div><strong>沉淀研究卡片</strong><small>把已核验的观点、案例和规范归入项目资料库。</small></div></li>
        </ol>
        <div className="help-center-actions">
          <Button variant="secondary" onClick={() => { setHelpOpen(false); window.dispatchEvent(new Event("lexread:open-api-settings")); }}><KeyRound size={16} />配置 AI API</Button>
          <Button onClick={() => { setHelpOpen(false); navigate(`/workspace/projects/${activeProject.id}/overview`); }}><BookOpenCheck size={16} />进入当前项目<ArrowRight size={15} /></Button>
        </div>
        <div className="help-privacy"><ShieldCheck size={16} /><span>API 密钥和上传文档保存在本机研究空间。</span></div>
      </div>
    </Modal>}
  </div>;
}
