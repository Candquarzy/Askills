import { useEffect, useState } from "react";
import {
  GitFork as Github,
  ArrowDownToLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import { call, shortHash } from "../../lib/ipc/client";
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
  seed,
}: {
  busy: boolean;
  run: RunOperation;
  prepared: (value: PreparedImport) => void;
  seed: Skill | null;
}) {
  const [repository, setRepository] = useState(seed?.source.url || "");
  const [reference, setReference] = useState(seed?.source.reference || "");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    if (seed) {
      setRepository(seed.source.url || "");
      setReference(seed.source.reference || "");
      setCatalog(null);
    }
  }, [seed]);
  async function resolve() {
    setCatalog(null);
    const result = await run("解析 GitHub 固定版本", () =>
      call<Catalog>("resolve_github", { repository, reference }),
    );
    if (result) setCatalog(result);
  }
  async function download(path: string) {
    if (!catalog) return;
    const result = await run("下载并校验技能文件", () =>
      call<PreparedImport>("prepare_github", {
        catalogId: catalog.id,
        skillPath: path,
      }),
    );
    if (result) prepared(result);
  }
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">DISCOVER & BRING HOME</p>
          <h1>来源</h1>
          <p className="subtitle">
            从 GitHub 公共仓库获取技能，保存到自己的本地库。
          </p>
        </div>
        <span className="pill">
          <Github size={15} /> GitHub 公共仓库
        </span>
      </header>
      <section className="source-form">
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
              onChange={(e) => setRepository(e.target.value)}
            />
          </label>
          <div className="form-inline">
            <label className="field">
              分支、标签或 commit（可选）
              <input
                disabled={busy}
                placeholder="留空使用默认分支"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
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
          {!catalog.candidates.length && (
            <p className="subtle-empty">该版本没有找到 SKILL.md。</p>
          )}
          {catalog.candidates.map((candidate) => (
            <div key={candidate.path} className="candidate-row">
              <div>
                <strong>{candidate.name}</strong>
                <p className="path">{candidate.path || "仓库根目录"}</p>
              </div>
              <button
                disabled={busy}
                onClick={() => void download(candidate.path)}
              >
                <ArrowDownToLine size={15} /> 下载并预览
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="source-note">
        <ShieldCheck size={22} />
        <div>
          <h3>保留来源，也保留选择权</h3>
          <p>
            记录来源、提交和许可证；导入前查看内容，选择需要升级的项目。可追溯来源不等同于对技能内容的安全认证。
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
