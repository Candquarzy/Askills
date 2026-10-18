import { useI18n } from "../../app/i18n";
import { useState } from "react";
import {
  FolderGit2,
  FolderPlus,
  ScanSearch,
  RefreshCw,
  RotateCcw,
  Unplug,
} from "lucide-react";
import { call, shortHash } from "../../lib/ipc/client";
import type {
  Project,
  Deployment,
  DetectedSkill,
  RunOperation,
} from "../../lib/ipc/types";
import { EmptyState } from "../../components/EmptyState";
const statusLabels: Record<string, string> = {
  installed: "已启用",
  MissingEntry: "安装入口已丢失",
  EntryReplaced: "安装入口被替换",
  LocalChangesDetected: "副本被外部修改",
  RevisionModified: "库内版本被修改",
  UnsafePath: "路径需要检查",
  FileSystemError: "文件读取失败",
  valid: "已识别",
  external: "外部技能",
  linked: "链接技能",
  broken: "链接失效",
  broken_link: "链接失效",
  invalid: "格式无效",
  ready: "正常",
  active: "已启用",
  drifted: "内容已变化",
  healthy: "正常",
};
export function ProjectsView({
  projects,
  deployments,
  busy,
  run,
  addProject,
  discover,
  changeDeployment,
  addSkills,
  selectedProjectId,
  selectProject,
}: {
  projects: Project[];
  deployments: Deployment[];
  busy: boolean;
  run: RunOperation;
  addProject: () => void;
  discover: () => void;
  changeDeployment: (
    deployment: Deployment,
    action: "remove" | "rollback",
  ) => void;
  addSkills: (project: Project) => void;
  selectedProjectId: string;
  selectProject: (id: string) => void;
}) {
  const { t } = useI18n();
  const selected = projects.find((p) => p.id === selectedProjectId) || null;
  const [entries, setEntries] = useState<DetectedSkill[] | null>(null);
  async function scan(project: Project) {
    selectProject(project.id);
    setEntries(null);
    const result = await run(t("扫描项目技能"), () =>
      call<DetectedSkill[]>("scan_project", { projectId: project.id }),
    );
    if (result) setEntries(result);
  }
  const installed = deployments.filter((d) => d.projectId === selected?.id);
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">PROJECT WORKSPACES</p>
          <h1>
            {t("项目")}
            <span className="count">{projects.length}</span>
          </h1>
          <p className="subtitle">
            {t("查看项目现有技能，管理每个项目使用的版本。")}
          </p>
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={discover}>
            <ScanSearch size={17} />
            {t("扫描目录")}
          </button>
          <button className="primary" disabled={busy} onClick={addProject}>
            <FolderPlus size={17} />
            {t("添加项目")}
          </button>
        </div>
      </header>
      <div className="projects-layout">
        <section className="project-list" aria-label={t("项目列表")}>
          {projects.map((project) => (
            <button
              disabled={busy}
              key={project.id}
              className={
                selected?.id === project.id
                  ? "project-card selected"
                  : "project-card"
              }
              onClick={() => void scan(project)}
            >
              <FolderGit2 size={22} />
              <span>
                <strong>{project.name}</strong>
                <small className="path">{project.path}</small>
                <small>
                  {t("{count} 个受管理技能", {
                    count: deployments.filter((d) => d.projectId === project.id)
                      .length,
                  })}
                </small>
              </span>
            </button>
          ))}
          {!projects.length && (
            <EmptyState
              icon={<FolderGit2 size={28} />}
              title={t("连接你的第一个项目")}
            >
              {t("选择项目文件夹，自动识别 Codex、Cursor 等工具的技能目录。")}
            </EmptyState>
          )}
        </section>
        {selected ? (
          <section className="project-detail">
            <div className="detail-heading">
              <h2>{selected.name}</h2>
              <button
                className="primary"
                disabled={busy}
                onClick={() => addSkills(selected)}
              >
                <FolderPlus size={16} />
                {t("添加技能")}
              </button>
              <button disabled={busy} onClick={() => void scan(selected)}>
                <RefreshCw size={15} />
                {t("重新扫描")}
              </button>
            </div>
            <p className="path">{selected.path}</p>
            <h3 className="section-title">
              {t("由 Askills 管理")}
              <span>{installed.length}</span>
            </h3>
            {installed.map((item) => (
              <div className="deployment-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.agent} · {item.mode} ·{" "}
                    {t(statusLabels[item.status] || item.status)}
                  </p>
                  <code className="path">{item.targetPath}</code>
                  <small>
                    {t("版本 {hash}", { hash: shortHash(item.revisionId) })}
                  </small>
                </div>
                <div className="button-column">
                  <button
                    disabled={busy || !item.previousRevisionId}
                    onClick={() => changeDeployment(item, "rollback")}
                  >
                    <RotateCcw size={14} />
                    {t("回滚")}
                  </button>
                  <button
                    className="danger-quiet"
                    disabled={busy}
                    onClick={() => changeDeployment(item, "remove")}
                  >
                    <Unplug size={14} />
                    {t("停用")}
                  </button>
                </div>
              </div>
            ))}
            {!installed.length && (
              <p className="subtle-empty">
                {t("从技能库选择一个技能，点击“添加到项目”。")}
              </p>
            )}
            <h3 className="section-title">
              {t("扫描发现")}
              <span>{entries?.length ?? "—"}</span>
            </h3>
            {entries?.map((entry, index) => (
              <div className="detected-row" key={entry.path + index}>
                <div className="detail-heading">
                  <strong>{entry.name}</strong>
                  <span className="badge">
                    {t(statusLabels[entry.status] || entry.status)}
                  </span>
                </div>
                <p className="path">{entry.path}</p>
                <p className="muted">
                  {t("可能读取：")}
                  {entry.consumers.join(" / ") || t("未知工具")}
                </p>
                {entry.resolvedPath && entry.resolvedPath !== entry.path && (
                  <p className="path">
                    {t("目标：")}
                    {entry.resolvedPath}
                  </p>
                )}
                {entry.diagnostics.map((d) => (
                  <p className="notice" key={d}>
                    {t(d)}
                  </p>
                ))}
              </div>
            ))}
            {entries?.length === 0 && (
              <p className="subtle-empty">
                {t("没有发现现有技能目录。可以从技能库添加。")}
              </p>
            )}
            <p className="footnote">
              {t("扫描只读取文件。多个工具可能同时读取同一个兼容目录。")}
            </p>
          </section>
        ) : (
          projects.length > 0 && (
            <EmptyState
              icon={<ScanSearch size={28} />}
              title={t("选择项目查看技能")}
            >
              {t("同时展示已管理的部署和项目中的现有技能。")}
            </EmptyState>
          )
        )}
      </div>
    </>
  );
}
