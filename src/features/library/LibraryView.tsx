import { useState } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  FolderPlus,
  History,
  Search,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { call, shortHash } from "../../lib/ipc/client";
import type {
  Skill,
  SkillDocument,
  Revision,
  RunOperation,
  RevisionDiff,
} from "../../lib/ipc/types";
import { Markdown } from "../../components/Markdown";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";

export function LibraryView({
  skills,
  busy,
  run,
  importLocal,
  install,
  checkUpdate,
  updated,
}: {
  skills: Skill[];
  busy: boolean;
  run: RunOperation;
  importLocal: () => void;
  install: (revision: Revision) => void;
  checkUpdate: (skill: Skill) => void;
  updated: (skill: Skill) => void;
}) {
  const [query, setQuery] = useState("");
  const [doc, setDoc] = useState<SkillDocument | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [raw, setRaw] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const currentSkill = skills.find((s) => s.id === doc?.skill.id) || doc?.skill;
  const filtered = skills.filter((s) =>
    [s.name, s.displayName || "", s.description, s.source.url || ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  async function open(skill: Skill, revisionId = skill.latestRevisionId) {
    const data = await run("读取技能与版本", async () => {
      const document = await call<SkillDocument>("get_document", {
        revisionId,
      });
      const versions = await call<Revision[]>("get_revisions", {
        skillId: skill.id,
      });
      return [document, versions] as const;
    });
    if (data) {
      setDoc(data[0]);
      setRevisions(data[1]);
    }
  }
  async function compare() {
    if (!doc) return;
    const latest = skills.find((s) => s.id === doc.skill.id)?.latestRevisionId;
    const other = revisions.find((r) => r.id !== doc.revision.id);
    const beforeId = latest !== doc.revision.id ? doc.revision.id : other?.id;
    if (!beforeId || !latest) return;
    const result = await run("比较版本内容", () =>
      call<RevisionDiff>("get_revision_diff", { beforeId, afterId: latest }),
    );
    if (result) setDiff(result);
  }
  async function saveName(displayName: string) {
    if (!currentSkill) return;
    const result = await run("保存显示名称", () =>
      call<Skill>("set_skill_display_name", {
        skillId: currentSkill.id,
        displayName,
      }),
    );
    if (result) {
      updated(result);
      setRenaming(false);
    }
  }
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">YOUR SKILL LIBRARY</p>
          <h1>
            技能库 <span className="count">{skills.length}</span>
          </h1>
          <p className="subtitle">集中保存，按项目使用。每个版本都可以追溯。</p>
        </div>
        <button className="primary" disabled={busy} onClick={importLocal}>
          <FolderPlus size={17} /> 导入本地技能
        </button>
      </header>
      <div className="search-row">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="搜索技能"
            placeholder="搜索名称、描述或来源…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="muted">{filtered.length} 个技能</span>
      </div>
      <div className={doc ? "library-layout with-detail" : "library-layout"}>
        <section className="skill-list" aria-label="技能列表">
          {filtered.map((skill) => (
            <button
              key={skill.id}
              disabled={busy}
              className={
                doc?.skill.id === skill.id
                  ? "skill-card selected"
                  : "skill-card"
              }
              onClick={() => void open(skill)}
            >
              <span className="skill-symbol">
                <BookOpen size={20} />
              </span>
              <span className="skill-card-content">
                <strong>{skill.displayName || skill.name}</strong>
                {skill.displayName && (
                  <small className="path">{skill.name}</small>
                )}
                <span className="skill-description">{skill.description}</span>
                <span className="skill-meta">
                  <span>
                    {skill.source.kind === "github" ? "GitHub" : "本地导入"}
                  </span>
                  <span>{skill.license || "许可未声明"}</span>
                  <span>{skill.revisionCount} 个版本</span>
                </span>
              </span>
            </button>
          ))}
          {!filtered.length && (
            <EmptyState
              icon={<BookOpen size={28} />}
              title={query ? "没有匹配的技能" : "你的技能库，从一个文件夹开始"}
            >
              {query
                ? "试试其他名称或描述。"
                : "选择包含 SKILL.md 的文件夹，或前往来源页从 GitHub 导入。"}
            </EmptyState>
          )}
        </section>
        {doc && (
          <aside className="detail-panel">
            <div className="detail-heading">
              <h2>{currentSkill?.displayName || doc.skill.name}</h2>
              <button className="text-button" onClick={() => setDoc(null)}>
                收起
              </button>
            </div>
            <div className="button-row">
              <span className="path">原始名称：{doc.skill.name}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setNameDraft(currentSkill?.displayName || "");
                  setRenaming(true);
                }}
              >
                <Pencil size={14} /> 编辑显示名称
              </button>
            </div>
            <p className="muted">{doc.skill.description}</p>
            <div className="detail-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => install(doc.revision)}
              >
                <ArrowDownToLine size={15} /> 添加到项目
              </button>
              {doc.skill.source.kind === "github" && (
                <button disabled={busy} onClick={() => checkUpdate(doc.skill)}>
                  <RefreshCw size={15} /> 检查更新
                </button>
              )}
            </div>
            <label className="field">
              阅读版本
              <select
                disabled={busy}
                value={doc.revision.id}
                onChange={(e) => void open(doc.skill, e.target.value)}
              >
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {shortHash(r.source.commit || r.hash)} ·{" "}
                    {new Date(Number(r.createdAt) * 1000).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            <div className="meta-line">
              <span>{doc.revision.fileCount} 个文件</span>
              <code>{shortHash(doc.revision.hash)}</code>
              {revisions.length > 1 && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void compare()}
                >
                  <History size={14} /> 对比最新版本
                </button>
              )}
            </div>
            <p className="path">
              {doc.revision.source.url || doc.revision.source.localPath}
            </p>
            {doc.warnings.map((w) => (
              <p className="notice" key={w}>
                {w}
              </p>
            ))}
            <div className="reader-tabs">
              <button
                className={!raw ? "active" : ""}
                onClick={() => setRaw(false)}
              >
                阅读
              </button>
              <button
                className={raw ? "active" : ""}
                onClick={() => setRaw(true)}
              >
                原始 Markdown
              </button>
            </div>
            {raw ? (
              <pre className="raw-document">{doc.markdown}</pre>
            ) : (
              <Markdown text={doc.markdown} />
            )}
          </aside>
        )}
      </div>
      {renaming && (
        <Modal
          title="编辑技能显示名称"
          busy={busy}
          close={() => setRenaming(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName(nameDraft);
            }}
          >
            <div className="modal-body">
              <label className="field">
                显示名称
                <input
                  autoFocus
                  maxLength={80}
                  disabled={busy}
                  value={nameDraft}
                  placeholder={doc?.skill.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
              <p className="footnote">
                仅改变 Askills 中的显示，原始名称、SKILL.md
                和项目安装路径保持不变。留空可恢复原名。
              </p>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveName("")}
              >
                恢复原名
              </button>
              <button className="primary" disabled={busy} type="submit">
                保存名称
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {diff && (
        <Modal
          title="版本差异 · 较早版本 → 最新版本"
          wide
          close={() => setDiff(null)}
        >
          <div className="diff-summary">
            <span>新增 {diff.added.length}</span>
            <span>删除 {diff.removed.length}</span>
            <span>修改 {diff.changed.length}</span>
          </div>
          <div className="file-diff">
            {diff.added.map((p) => (
              <div key={p}>+ {p}</div>
            ))}
            {diff.removed.map((p) => (
              <div key={p}>− {p}</div>
            ))}
            {diff.changed.map((p) => (
              <div key={p}>~ {p}</div>
            ))}
          </div>
          <div className="diff-columns">
            <section>
              <h3>原版本 SKILL.md</h3>
              <pre>{diff.before}</pre>
            </section>
            <section>
              <h3>新版本 SKILL.md</h3>
              <pre>{diff.after}</pre>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
