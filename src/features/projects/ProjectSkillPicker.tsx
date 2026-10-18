import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Modal } from "../../components/Modal";
import { SourcesView } from "../sources/SourcesView";
import { call, shortHash } from "../../lib/ipc/client";
import type {
  Project,
  Skill,
  Revision,
  RunOperation,
  PreparedImport,
} from "../../lib/ipc/types";

export function ProjectSkillPicker({
  project,
  skills,
  busy,
  run,
  close,
  select,
  importLocal,
  prepared,
  downloaded,
  repositoryHistory,
  historyChanged,
}: {
  project: Project;
  skills: Skill[];
  busy: boolean;
  run: RunOperation;
  close: () => void;
  select: (revision: Revision) => void;
  importLocal: () => void;
  prepared: (value: PreparedImport) => void;
  downloaded: (values: Skill[], continueToProject: boolean) => void;
  repositoryHistory: string[];
  historyChanged: (values: string[]) => void;
}) {
  const [tab, setTab] = useState("library");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [versions, setVersions] = useState<Revision[]>([]);
  const [revisionId, setRevisionId] = useState("");
  async function choose(skill: Skill) {
    const result = await run("读取可安装版本", () =>
      call<Revision[]>("get_revisions", { skillId: skill.id }),
    );
    if (result) {
      setSelected(skill);
      setVersions(result);
      setRevisionId(skill.latestRevisionId);
    }
  }
  const revision = versions.find((r) => r.id === revisionId);
  return (
    <Modal title={`为 ${project.name} 添加技能`} busy={busy} close={close} wide>
      <div className="modal-body">
        <p className="path">目标项目：{project.path}</p>
        <div className="reader-tabs" role="tablist" aria-label="技能添加来源">
          {[
            { id: "library", label: "从技能库" },
            { id: "cloud", label: "从云端" },
            { id: "local", label: "从本地" },
          ].map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              disabled={busy}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "library" && (
          <section className="picker-content">
            <label className="field">
              查找库中技能
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名称、别名或描述"
              />
            </label>
            <div className="picker-list">
              {skills
                .filter((s) =>
                  [s.name, s.displayName || "", s.description]
                    .join(" ")
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
                )
                .map((skill) => (
                  <button
                    className={
                      selected?.id === skill.id
                        ? "skill-card selected"
                        : "skill-card"
                    }
                    key={skill.id}
                    disabled={busy}
                    onClick={() => void choose(skill)}
                  >
                    <span className="skill-card-content">
                      <strong>{skill.displayName || skill.name}</strong>
                      <small className="path">{skill.name}</small>
                    </span>
                    <span>{skill.revisionCount} 个版本</span>
                  </button>
                ))}
            </div>
            {!skills.length && (
              <p className="subtle-empty">
                技能库还是空的，可以切换到“从云端”或“从本地”。
              </p>
            )}
            {selected && (
              <label className="field">
                安装版本
                <select
                  value={revisionId}
                  disabled={busy}
                  onChange={(e) => setRevisionId(e.target.value)}
                >
                  {versions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {shortHash(r.source.commit || r.hash)}
                      {r.id === selected.latestRevisionId ? " · 最新版本" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}
        {tab === "cloud" && (
          <div className="picker-content">
            <SourcesView
              repositoryHistory={repositoryHistory}
              historyChanged={historyChanged}
              busy={busy}
              run={run}
              prepared={prepared}
              downloaded={downloaded}
              seed={null}
              embedded
            />
          </div>
        )}
        {tab === "local" && (
          <div className="picker-content">
            <h3>选择本地技能文件夹</h3>
            <p>
              选择包含 SKILL.md
              的完整目录，预览并保存到技能库，然后继续为当前项目安装。
            </p>
            <button className="primary" disabled={busy} onClick={importLocal}>
              <FolderPlus size={16} />
              选择本地技能
            </button>
          </div>
        )}
      </div>
      {tab === "library" && (
        <footer className="modal-footer">
          <span className="muted">接下来选择部署方式并预览目标路径。</span>
          <button
            className="primary"
            disabled={busy || !revision}
            onClick={() => revision && select(revision)}
          >
            下一步
          </button>
        </footer>
      )}
    </Modal>
  );
}
