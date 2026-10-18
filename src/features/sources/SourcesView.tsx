import { useContext, useEffect, useState } from "react";
import {
  GitFork as Github,
  ArrowDownToLine,
  Search,
  ShieldCheck,
  Eye,
  Check,
} from "lucide-react";
import { call, errorMessage, shortHash } from "../../lib/ipc/client";
import { prepareDownload } from "../../lib/ipc/download";
import { OperationContext } from "../../app/OperationContext";
import type {
  Catalog,
  PreparedImport,
  RunOperation,
  Skill,
} from "../../lib/ipc/types";

export function SourcesView({
  busy,
  run,
  prepared,
  downloaded,
  repositoryHistory,
  historyChanged,
  seed,
  embedded = false,
}: {
  busy: boolean;
  run: RunOperation;
  prepared: (value: PreparedImport) => void;
  downloaded: (values: Skill[], continueToProject: boolean) => void;
  repositoryHistory: string[];
  historyChanged: (values: string[]) => void;
  seed: Skill | null;
  embedded?: boolean;
}) {
  const [repository, setRepository] = useState(seed?.source.url || "");
  const [reference, setReference] = useState(seed?.source.reference || "");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [method, setMethod] = useState<"api" | "git">("api");
  const [gitVersion, setGitVersion] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<
    Record<
      string,
      { state: "downloading" | "done" | "error"; message?: string }
    >
  >({});
  const operation = useContext(OperationContext);
  useEffect(() => {
    setSelected([]);
    setResults({});
  }, [catalog]);
  useEffect(() => {
    if (seed) {
      setRepository(seed.source.url || "");
      setReference(seed.source.reference || "");
      setCatalog(null);
    }
  }, [seed]);
  async function resolve() {
    setCatalog(null);
    const result = await run(
      method === "git" ? "使用本机 Git 拉取固定版本" : "解析 GitHub 固定版本",
      async () => {
        const history = await call<string[]>("remember_repository", {
          repository,
        });
        historyChanged(history);
        return call<Catalog>(
          method === "git" ? "resolve_git" : "resolve_github",
          {
            repository,
            reference,
          },
        );
      },
    );
    if (result) setCatalog(result);
  }
  async function preview(path: string) {
    if (!catalog) return;
    const result = await run("正在获取技能预览", () =>
      prepareDownload(catalog.id, path, operation.reportProgress),
    );
    if (result) prepared(result);
  }
  async function download(paths: string[]) {
    if (!catalog || !paths.length) return;
    const outcome = await run(
      `正在下载 ${paths.length} 个技能到技能库`,
      async () => {
        const saved: Skill[] = [];
        let failures = 0;
        for (const path of paths) {
          if (operation.isCancellationRequested()) break;
          setResults((values) => ({
            ...values,
            [path]: { state: "downloading" },
          }));
          let pending: PreparedImport | undefined;
          try {
            pending = await prepareDownload(
              catalog.id,
              path,
              operation.reportProgress,
            );
            if (operation.isCancellationRequested())
              throw new Error("下载已取消");
            const skill = await call<Skill>("finish_import", {
              importId: pending.id,
            });
            pending = undefined;
            saved.push(skill);
            setResults((values) => ({ ...values, [path]: { state: "done" } }));
            setSelected((values) => values.filter((value) => value !== path));
          } catch (error) {
            failures++;
            setResults((values) => ({
              ...values,
              [path]: { state: "error", message: errorMessage(error) },
            }));
            if (pending) {
              try {
                await call("discard_import", { importId: pending.id });
              } catch {
                /* bounded backend preview expiry also cleans it */
              }
            }
            if (operation.isCancellationRequested()) break;
          }
        }
        return {
          saved,
          failures,
          cancelled: operation.isCancellationRequested(),
        };
      },
    );
    if (!outcome) return;
    if (outcome.saved.length)
      downloaded(
        outcome.saved,
        paths.length === 1 && outcome.failures === 0 && !outcome.cancelled,
      );
    const summary = `${outcome.cancelled ? "下载已停止。" : "下载结束。"}已保存 ${outcome.saved.length} / ${paths.length} 个技能${outcome.failures ? `，${outcome.failures} 项未完成，可在列表重试` : ""}。`;
    if (!outcome.saved.length && outcome.failures && !outcome.cancelled)
      operation.fail(summary);
    else operation.notify(summary);
  }
  function toggle(path: string) {
    setSelected((values) =>
      values.includes(path)
        ? values.filter((v) => v !== path)
        : [...values, path],
    );
  }
  return (
    <>
      {!embedded && (
        <header className="page-head">
          <div>
            <p className="eyebrow">DISCOVER & BRING HOME</p>
            <h1>来源</h1>
            <p className="subtitle">从 GitHub 获取技能，保存到自己的本地库。</p>
          </div>
          <span className="pill">
            <Github size={15} /> GitHub 来源
          </span>
        </header>
      )}
      <section className="source-form">
        <div className="source-methods" role="group" aria-label="获取方式">
          <button
            aria-pressed={method === "api"}
            className={method === "api" ? "primary" : ""}
            disabled={busy}
            onClick={() => {
              setMethod("api");
              setCatalog(null);
            }}
          >
            GitHub API
          </button>
          <button
            aria-pressed={method === "git"}
            className={method === "git" ? "primary" : ""}
            disabled={busy}
            onClick={() => {
              setMethod("git");
              setCatalog(null);
            }}
          >
            本地 Git
          </button>
        </div>
        {method === "git" ? (
          <div className="source-method-note">
            <p className="footnote">
              使用已安装的
              Git，沿用本机代理和凭据配置。在独立临时仓库拉取固定提交，不合并或改动你的项目；无需
              GitHub API 配额。请填写 HTTPS 仓库地址，交互登录提示不会弹出。
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run("检查本机 Git", async () => {
                  const value = await call<string>("get_git_version");
                  setGitVersion(value);
                })
              }
            >
              检查 Git 安装
            </button>
            {gitVersion && <span className="muted">{gitVersion}</span>}
          </div>
        ) : (
          <p className="footnote">
            通过 GitHub API 获取公共仓库，不需要安装 Git。
          </p>
        )}
        <div className="source-title">
          <Github size={24} />
          <div>
            <h2>
              {seed ? `检查 ${seed.name} 的来源版本` : "导入 GitHub 技能"}
            </h2>
            <p className="muted">
              输入仓库地址，选择版本，再预览需要导入的技能。
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resolve();
          }}
        >
          <label className="field">
            仓库地址
            <input
              required
              disabled={busy}
              placeholder="https://github.com/owner/repository"
              value={repository}
              onChange={(e) => {
                setRepository(e.target.value);
                setCatalog(null);
              }}
            />
          </label>
          {!!repositoryHistory.length && (
            <label className="field repository-history">
              最近使用的仓库（最多 10 个）
              <select
                aria-label="仓库历史记录"
                value=""
                disabled={busy}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setRepository(event.target.value);
                  setReference("");
                  setCatalog(null);
                }}
              >
                <option value="" disabled>
                  选择历史地址填入上方
                </option>
                {repositoryHistory.map((address) => (
                  <option key={address} value={address}>
                    {address}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-inline">
            <label className="field">
              分支、标签或 commit（可选）
              <input
                disabled={busy}
                placeholder="留空使用默认分支"
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                  setCatalog(null);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !repository.trim()}
              type="submit"
            >
              <Search size={16} /> 查找技能
            </button>
          </div>
        </form>
        <p className="footnote">
          下载固定到完整 commit。不会执行仓库脚本，项目不会跟随来源自动升级。
        </p>
      </section>
      {catalog && (
        <section className="catalog">
          <div className="detail-heading">
            <h2>找到 {catalog.candidates.length} 个技能</h2>
            <span className="badge">{shortHash(catalog.commit)}</span>
          </div>
          <p className="path">
            {catalog.repository} · {catalog.reference}
          </p>
          {!!catalog.candidates.length && (
            <div className="source-selection-bar">
              <span>已选择 {selected.length} 项</span>
              <button
                disabled={busy}
                onClick={() =>
                  setSelected(
                    catalog.candidates
                      .filter((c) => results[c.path]?.state !== "done")
                      .map((c) => c.path),
                  )
                }
              >
                全选
              </button>
              <button
                disabled={busy || !selected.length}
                onClick={() => setSelected([])}
              >
                清空选择
              </button>
              <button
                className="primary"
                disabled={busy || !selected.length}
                onClick={() => void download(selected)}
              >
                下载所选（{selected.length}）
              </button>
            </div>
          )}
          {!catalog.candidates.length && (
            <p className="subtle-empty">该版本没有找到 SKILL.md。</p>
          )}
          {catalog.candidates.map((candidate) => (
            <div
              key={candidate.path}
              className={`candidate-row${selected.includes(candidate.path) ? " candidate-selected" : ""}`}
            >
              <div>
                <strong>{candidate.name}</strong>
                <p className="path">{candidate.path || "仓库根目录"}</p>
                {results[candidate.path]?.state === "error" && (
                  <p className="candidate-error">
                    {results[candidate.path].message}
                  </p>
                )}
              </div>
              <div className="candidate-actions">
                <button
                  disabled={busy || results[candidate.path]?.state === "done"}
                  onClick={() => void download([candidate.path])}
                >
                  <ArrowDownToLine size={15} />{" "}
                  {results[candidate.path]?.state === "done"
                    ? "已下载"
                    : results[candidate.path]?.state === "downloading"
                      ? "下载中…"
                      : "下载"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void preview(candidate.path)}
                >
                  <Eye size={15} />
                  预览
                </button>
                <button
                  disabled={busy || results[candidate.path]?.state === "done"}
                  aria-pressed={selected.includes(candidate.path)}
                  onClick={() => toggle(candidate.path)}
                >
                  <Check size={15} />
                  {selected.includes(candidate.path) ? "取消选择" : "多选"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="source-note">
        <ShieldCheck size={22} />
        <div>
          <h3>保留来源，也保留选择权</h3>
          <p>
            下载会保存到技能库；预览仅临时读取内容，关闭后不会入库。记录来源、提交和许可证，项目安装与升级仍由你确认。
          </p>
        </div>
      </div>
      <section className="source-examples">
        <h3>可以从这些社区仓库开始</h3>
        <div className="example-buttons">
          {["wshobson/agents", "fxckcode/tauri-skills"].map((repo) => (
            <button
              disabled={busy}
              key={repo}
              onClick={() => {
                setRepository(`https://github.com/${repo}`);
                setReference("");
                setCatalog(null);
              }}
            >
              <Github size={16} /> {repo}
            </button>
          ))}
        </div>
        <p className="footnote">
          这些是本项目开发 skills 的来源，属于第三方社区内容。
        </p>
      </section>
    </>
  );
}
