import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FolderGit2,
  GitFork as Github,
  Settings2,
  RefreshCw,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import {
  call,
  errorMessage,
  isTauri,
  shortHash,
  sizeLabel,
} from "../lib/ipc/client";
import type {
  Snapshot,
  RunOperation,
  PreparedImport,
  DirectorySelection,
  DiscoveredProject,
  Revision,
  DeploymentPlan,
  Deployment,
  Skill,
  Project,
} from "../lib/ipc/types";
import { LibraryView } from "../features/library/LibraryView";
import { ProjectsView } from "../features/projects/ProjectsView";
import { ProjectSkillPicker } from "../features/projects/ProjectSkillPicker";
import { SourcesView } from "../features/sources/SourcesView";
import { Modal } from "../components/Modal";
import { Markdown } from "../components/Markdown";
import { OperationContext, type OperationProgress } from "./OperationContext";
import { OperationToast } from "../components/OperationToast";
import "./styles.css";

type Page = "library" | "projects" | "sources" | "settings";
type Dialog =
  | {
      type: "import";
      value: PreparedImport;
      targetProjectId?: string;
      remote?: boolean;
    }
  | { type: "install"; revision: Revision; targetProjectId?: string }
  | { type: "project-add"; project: Project }
  | { type: "plan"; value: DeploymentPlan }
  | { type: "discover"; values: DiscoveredProject[] }
  | { type: "deployment"; value: Deployment; action: "remove" | "rollback" }
  | null;
const initial: Snapshot = {
  skills: [],
  projects: [],
  deployments: [],
  libraryRoot: "",
  recovery: [],
};

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [page, setPage] = useState<Page>("library");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sourceSeed, setSourceSeed] = useState<Skill | null>(null);
  const [projectId, setProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [agent, setAgent] = useState("codex");
  const [mode, setMode] = useState("auto");
  const [chosenProjects, setChosenProjects] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const cancelRequested = useRef(false);
  const desktop = isTauri();
  const disabled = !!busy || !desktop || !ready;
  const run: RunOperation = async (label, work) => {
    if (inFlight.current) return;
    inFlight.current = true;
    cancelRequested.current = false;
    setProgress(null);
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await work();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy("");
      setProgress(null);
      inFlight.current = false;
    }
  };
  async function reload() {
    const result = await call<Snapshot>("get_snapshot");
    setSnapshot(result);
    setReady(true);
    return result;
  }
  useEffect(() => {
    if (!initialized.current && desktop) {
      initialized.current = true;
      void run("打开本地技能库", reload);
    }
  }, []);
  async function choose(purpose: string) {
    return call<DirectorySelection | null>("pick_directory", { purpose });
  }
  async function importLocal(targetProjectId?: string) {
    const value = await run("检查本地技能", async () => {
      const selection = await choose("import");
      return selection
        ? call<PreparedImport>("prepare_import", { selectionId: selection.id })
        : null;
    });
    if (value) setDialog({ type: "import", value, targetProjectId });
  }
  async function finishImport() {
    if (dialog?.type !== "import") return;
    const targetProjectId = dialog.targetProjectId;
    const remote = dialog.remote;
    const result = await run("保存技能快照", async () => {
      const skill = await call<Skill>("finish_import", {
        importId: dialog.value.id,
      });
      setDialog(null);
      await reload();
      if (targetProjectId) {
        const versions = await call<Revision[]>("get_revisions", {
          skillId: skill.id,
        });
        const revision = versions.find((r) => r.id === skill.latestRevisionId);
        if (!revision)
          throw new Error(
            "技能已保存，但无法读取安装版本，请从项目技能库重新选择。",
          );
        return { revision };
      }
      return { revision: null };
    });
    if (result) {
      setDialog(null);
      if (result.revision && targetProjectId) {
        beginInstall(result.revision, targetProjectId);
        setNotice("技能已保存，请继续预览当前项目的安装变更。");
      } else {
        if (!remote) setPage("library");
        setNotice("技能已保存到本地库，现有项目的版本保持不变。");
      }
    }
  }
  function recordDownloads(skills: Skill[], targetProjectId?: string) {
    setSnapshot((current) => {
      const updated = new Map(current.skills.map((s) => [s.id, s]));
      for (const skill of skills) updated.set(skill.id, skill);
      return { ...current, skills: [...updated.values()] };
    });
    if (targetProjectId && skills.length === 1) {
      const skill = skills[0];
      void run("读取项目安装版本", () =>
        call<Revision[]>("get_revisions", { skillId: skill.id }),
      ).then((versions) => {
        const revision = versions?.find((r) => r.id === skill.latestRevisionId);
        if (revision) beginInstall(revision, targetProjectId);
      });
    }
  }
  async function closeDialog() {
    if (dialog?.type === "import") {
      try {
        await call("discard_import", { importId: dialog.value.id });
      } catch (e) {
        setError(errorMessage(e));
      }
    }
    setDialog(null);
    setError("");
  }
  async function addProject() {
    const result = await run("添加项目", async () => {
      const selection = await choose("project");
      if (!selection) return null;
      await call("register_project", { selectionId: selection.id });
      return reload();
    });
    if (result) setNotice("项目已登记，可以选择项目扫描技能。");
  }
  async function discover() {
    const result = await run("发现目录中的项目", async () => {
      const selection = await choose("discover");
      return selection
        ? call<DiscoveredProject[]>("discover_projects", {
            selectionId: selection.id,
          })
        : null;
    });
    if (result) {
      setChosenProjects([]);
      setDialog({ type: "discover", values: result });
    }
  }
  async function addDiscovered() {
    const count = chosenProjects.length;
    const result = await run("登记选择的项目", async () => {
      try {
        for (const selectionId of chosenProjects) {
          await call("register_project", { selectionId });
          setChosenProjects((ids) => ids.filter((id) => id !== selectionId));
          setDialog((current) =>
            current?.type === "discover"
              ? {
                  ...current,
                  values: current.values.filter(
                    (p) => p.selectionId !== selectionId,
                  ),
                }
              : current,
          );
        }
      } catch (e) {
        try {
          await reload();
        } catch {
          /* Preserve the original registration error. */
        }
        throw e;
      }
      return reload();
    });
    if (result) {
      setDialog(null);
      setNotice(`已登记 ${count} 个项目。`);
    }
  }
  function beginInstall(revision: Revision, targetProjectId?: string) {
    setProjectId(targetProjectId || snapshot.projects[0]?.id || "");
    setDialog({ type: "install", revision, targetProjectId });
  }
  async function previewInstall() {
    if (dialog?.type !== "install") return;
    const value = await run("检查项目并生成安装计划", () =>
      call<DeploymentPlan>("preview_deployment", {
        projectId: dialog.targetProjectId || projectId,
        revisionId: dialog.revision.id,
        agent,
        mode,
      }),
    );
    if (value) setDialog({ type: "plan", value });
  }
  async function applyInstall() {
    if (dialog?.type !== "plan") return;
    const result = await run("应用并校验项目部署", async () => {
      const deployment = await call<Deployment>("apply_deployment", {
        planId: dialog.value.id,
      });
      setDialog(null);
      await reload();
      return deployment;
    });
    if (result) {
      setDialog(null);
      setNotice(
        `已通过 ${result.mode} 启用技能。请在对应 Agent 中刷新或开启新会话验证加载。`,
      );
    }
  }
  async function changeDeployment() {
    if (dialog?.type !== "deployment") return;
    const result = await run(
      dialog.action === "remove" ? "停用项目技能" : "恢复上一个版本",
      async () => {
        await call(
          dialog.action === "remove"
            ? "remove_deployment"
            : "rollback_deployment",
          { deploymentId: dialog.value.id },
        );
        setDialog(null);
        return reload();
      },
    );
    if (result) {
      setDialog(null);
      setNotice("项目变更已完成，技能库中的版本仍然保留。");
    }
  }
  async function changeLibrary() {
    const result = await run("设置技能库位置", async () => {
      const selection = await choose("library");
      if (!selection) return null;
      await call("set_library_root", { selectionId: selection.id });
      return reload();
    });
    if (result) setNotice("技能库位置已更新。");
  }
  const nav = [
    {
      id: "library",
      title: "技能库",
      Icon: BookOpen,
      count: snapshot.skills.length,
    },
    {
      id: "projects",
      title: "项目",
      Icon: FolderGit2,
      count: snapshot.projects.length,
    },
    { id: "sources", title: "来源", Icon: Github },
    { id: "settings", title: "设置", Icon: Settings2 },
  ] as const;
  function cancel() {
    cancelRequested.current = true;
    void call("cancel_operation")
      .then(() => setNotice("已请求取消；正在完成当前安全步骤。"))
      .catch((e) => setError(errorMessage(e)));
  }
  return (
    <OperationContext
      value={{
        error,
        busy,
        notice,
        cancel,
        progress,
        reportProgress: setProgress,
        notify: setNotice,
        fail: setError,
        isCancellationRequested: () => cancelRequested.current,
        dismissError: () => setError(""),
        dismissNotice: () => setNotice(""),
      }}
    >
      <OperationToast />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">A</span>
            <div>
              Askills<small>让技能各就其位</small>
            </div>
          </div>
          <nav aria-label="主导航">
            {nav.map(({ id, title, Icon, ...item }) => (
              <button
                key={id}
                className={page === id ? "nav-item active" : "nav-item"}
                disabled={!!busy}
                onClick={() => setPage(id)}
              >
                <Icon size={19} />
                <span>{title}</span>
                {"count" in item && <small>{item.count}</small>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="local-dot" /> 本地优先
            <small>Skills 属于你自己的目录</small>
            <span className="version">0.1 · 开发预览</span>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span>
              工作空间 <span className="slash">/</span>{" "}
              {nav.find((n) => n.id === page)?.title}
            </span>
            <button
              className="text-button"
              disabled={!!busy || !desktop}
              onClick={() => void run("刷新数据", reload)}
            >
              <RefreshCw size={15} /> 刷新
            </button>
          </header>
          {!desktop && (
            <div className="banner">
              当前为浏览器预览。运行 <code>pnpm tauri dev</code>{" "}
              使用本地技能管理功能。
            </div>
          )}
          {snapshot.recovery.map((message) => (
            <div className="banner" key={message}>
              {message}
            </div>
          ))}
          <main className="page-content">
            {page === "library" && (
              <LibraryView
                key={snapshot.skills.map((s) => s.latestRevisionId).join(":")}
                skills={snapshot.skills}
                updated={(skill) =>
                  setSnapshot((current) => ({
                    ...current,
                    skills: current.skills.map((s) =>
                      s.id === skill.id ? skill : s,
                    ),
                  }))
                }
                busy={disabled}
                run={run}
                importLocal={() => void importLocal()}
                install={beginInstall}
                checkUpdate={(skill) => {
                  setSourceSeed(skill);
                  setPage("sources");
                }}
              />
            )}
            {page === "projects" && (
              <ProjectsView
                key={snapshot.deployments
                  .map((d) => d.id + d.revisionId)
                  .join(":")}
                projects={snapshot.projects}
                selectedProjectId={selectedProjectId}
                selectProject={setSelectedProjectId}
                addSkills={(project) =>
                  setDialog({ type: "project-add", project })
                }
                deployments={snapshot.deployments}
                busy={disabled}
                run={run}
                addProject={() => void addProject()}
                discover={() => void discover()}
                changeDeployment={(value, action) =>
                  setDialog({ type: "deployment", value, action })
                }
              />
            )}
            {page === "sources" && (
              <SourcesView
                busy={disabled}
                run={run}
                prepared={(value) =>
                  setDialog({ type: "import", value, remote: true })
                }
                downloaded={(values) => recordDownloads(values)}
                seed={sourceSeed}
              />
            )}
            {page === "settings" && (
              <>
                <header className="page-head">
                  <div>
                    <p className="eyebrow">MAKE IT YOURS</p>
                    <h1>设置</h1>
                    <p className="subtitle">本地数据的位置与使用方式。</p>
                  </div>
                </header>
                <section className="settings-section">
                  <h2>本地技能库</h2>
                  <p className="path">
                    {snapshot.libraryRoot || "尚未连接桌面后端"}
                  </p>
                  <button
                    disabled={disabled || snapshot.skills.length > 0}
                    onClick={() => void changeLibrary()}
                  >
                    <FolderOpen size={16} /> 选择技能库位置
                  </button>
                  <p className="footnote">
                    首次导入前可以更换目录。已有技能库的迁移向导将在后续提供。
                  </p>
                </section>
                <section className="settings-section">
                  <h2>项目使用方式</h2>
                  <p>
                    自动模式依次尝试符号链接、Windows 目录 junction
                    和复制。项目固定使用选定版本，升级前先预览变更。
                  </p>
                  <p>
                    Cursor 等工具可能读取共享目录。请结合实际路径判断影响范围。
                  </p>
                </section>
                <section className="settings-section">
                  <h2>中文与阅读</h2>
                  <p>界面使用简体中文，技能正文按原文展示。</p>
                </section>
              </>
            )}
          </main>
        </div>
        {dialog?.type === "project-add" && (
          <ProjectSkillPicker
            project={dialog.project}
            skills={snapshot.skills}
            busy={!!busy}
            run={run}
            downloaded={(values, continueToProject) =>
              recordDownloads(
                values,
                continueToProject ? dialog.project.id : undefined,
              )
            }
            close={() => void closeDialog()}
            select={(revision) => beginInstall(revision, dialog.project.id)}
            importLocal={() => void importLocal(dialog.project.id)}
            prepared={(value) =>
              setDialog({
                type: "import",
                value,
                targetProjectId: dialog.project.id,
                remote: true,
              })
            }
          />
        )}
        {dialog?.type === "import" && (
          <Modal
            title={dialog.remote ? "预览技能" : "确认导入技能"}
            busy={!!busy}
            close={() => void closeDialog()}
            wide
          >
            <div className="modal-body">
              <h3>{dialog.value.preview.name}</h3>
              <p>{dialog.value.preview.description}</p>
              <div className="detail-metrics">
                <span>{dialog.value.preview.fileCount} 个文件</span>
                <span>{sizeLabel(dialog.value.preview.totalBytes)}</span>
                <span>{dialog.value.preview.license || "未声明许可证"}</span>
                <code>
                  {shortHash(
                    dialog.value.source?.commit || dialog.value.preview.hash,
                  )}
                </code>
              </div>
              {dialog.value.preview.warnings.map((w) => (
                <p className="notice" key={w}>
                  {w}
                </p>
              ))}
              <div className="import-reader">
                <Markdown text={dialog.value.preview.markdown} />
              </div>
            </div>
            <footer className="modal-footer">
              <span className="muted">
                完整目录将保存为快照，原始目录不会改动。
              </span>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void finishImport()}
              >
                {dialog.targetProjectId
                  ? "导入并继续"
                  : dialog.remote
                    ? "下载到技能库"
                    : "确认导入"}{" "}
                <ArrowRight size={16} />
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "install" && (
          <Modal
            title="添加到项目"
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              {!snapshot.projects.length ? (
                <p>请先到“项目”页面添加一个项目文件夹。</p>
              ) : (
                <>
                  <label className="field">
                    目标项目
                    <select
                      value={projectId}
                      disabled={!!busy || !!dialog.targetProjectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      {snapshot.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Agent 目录
                    <select
                      value={agent}
                      disabled={!!busy}
                      onChange={(e) => setAgent(e.target.value)}
                    >
                      <option value="codex">Codex · .agents/skills</option>
                      <option value="cursor">Cursor · .cursor/skills</option>
                      <option value="claude-code">
                        Claude Code · .claude/skills
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    部署方式
                    <select
                      value={mode}
                      disabled={!!busy}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="auto">自动选择（推荐）</option>
                      <option value="copy">复制</option>
                      <option value="symlink">符号链接</option>
                      <option value="junction">Windows junction</option>
                    </select>
                  </label>
                  <p className="footnote">
                    用于共享仓库、远程环境或容器时，建议选择复制。
                  </p>
                </>
              )}
            </div>
            <footer className="modal-footer">
              <span className="muted">下一步将预览实际写入路径。</span>
              <button
                className="primary"
                disabled={!!busy || !projectId}
                onClick={() => void previewInstall()}
              >
                预览变更 <ArrowRight size={16} />
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "plan" && (
          <Modal
            title={
              dialog.value.previousRevisionId
                ? "确认升级项目技能"
                : "确认启用项目技能"
            }
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <h3>{dialog.value.name}</h3>
              <p className="path">{dialog.value.targetPath}</p>
              <p>部署方式：{dialog.value.mode}</p>
              {dialog.value.conflict && (
                <p className="notice">{dialog.value.conflict}</p>
              )}
              {dialog.value.warnings.map((w) => (
                <p className="notice" key={w}>
                  {w}
                </p>
              ))}
              <p className="footnote">
                应用前会再次检查版本和目标目录，已有非管理文件不会被覆盖。
              </p>
            </div>
            <footer className="modal-footer">
              <span className="muted">
                版本 {shortHash(dialog.value.revisionId)}
              </span>
              <button
                className="primary"
                disabled={!!busy || !!dialog.value.conflict}
                onClick={() => void applyInstall()}
              >
                确认应用
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "discover" && (
          <Modal
            title="选择要登记的项目"
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <p className="muted">限定深度扫描，跳过依赖目录与链接目录。</p>
              {dialog.values.map((p) => (
                <label className="check-row" key={p.selectionId}>
                  <input
                    type="checkbox"
                    disabled={!!busy}
                    checked={chosenProjects.includes(p.selectionId)}
                    onChange={(e) =>
                      setChosenProjects((prev) =>
                        e.target.checked
                          ? [...prev, p.selectionId]
                          : prev.filter((id) => id !== p.selectionId),
                      )
                    }
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <small className="path">{p.path}</small>
                  </span>
                </label>
              ))}
              {!dialog.values.length && (
                <p>
                  没有发现 Git 工作区或已知技能目录，也可以直接添加项目文件夹。
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <span>{chosenProjects.length} 个已选择</span>
              <button
                className="primary"
                disabled={!!busy || !chosenProjects.length}
                onClick={() => void addDiscovered()}
              >
                登记项目
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "deployment" && (
          <Modal
            title={
              dialog.action === "remove"
                ? "停用这个项目的技能？"
                : "恢复上一个版本？"
            }
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <h3>{dialog.value.name}</h3>
              <p className="path">{dialog.value.targetPath}</p>
              <p>
                {dialog.action === "remove"
                  ? "仅停用 Askills 管理的项目入口，技能库内容保留。检测到外部修改时将停止操作。"
                  : "把当前项目恢复到上一个受管理版本，其他项目保持不变。"}
              </p>
            </div>
            <footer className="modal-footer">
              <button disabled={!!busy} onClick={() => void closeDialog()}>
                取消
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void changeDeployment()}
              >
                确认{dialog.action === "remove" ? "停用" : "回滚"}
              </button>
            </footer>
          </Modal>
        )}
      </div>
    </OperationContext>
  );
}
