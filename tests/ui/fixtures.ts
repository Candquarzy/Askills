import type { Page } from "@playwright/test";
import type {
  DeploymentPlan,
  PreparedImport,
  Project,
  Revision,
  Skill,
  SkillDocument,
  Snapshot,
} from "../../src/lib/ipc/types";

type Invocation = { command: string; args: Record<string, unknown> };
type FixtureOptions = {
  emptyLibrary?: boolean;
  importFailures?: number;
  registrationFailure?: boolean;
  deploymentConflict?: boolean;
};

declare global {
  interface Window {
    isTauri: boolean;
    __TAURI_INTERNALS__: {
      invoke: (
        command: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    __ASKILLS_TEST__: { invocations: Invocation[]; committedImports: number };
    __markdownExecuted?: boolean;
  }
}

const localSource = {
  kind: "local",
  url: null,
  reference: null,
  commit: null,
  subpath: null,
  localPath: "D:/Example/skills/rust-async-patterns",
};
const rust: Skill = {
  id: "skill-rust",
  name: "rust-async-patterns",
  description: "掌握 Rust 异步任务、取消和错误处理，构建可靠的并发程序。",
  license: "MIT",
  latestRevisionId: "revision-rust-1",
  source: localSource,
  revisionCount: 1,
  createdAt: "1792281600",
};
const security: Skill = {
  ...rust,
  id: "skill-security",
  name: "tauri-security",
  description: "检查 Tauri 原生接口、权限范围和不可信内容边界。",
  latestRevisionId: "revision-security-1",
  source: {
    kind: "github",
    url: "https://github.com/example/skills",
    reference: "main",
    commit: "c".repeat(40),
    subpath: "skills/tauri-security",
    localPath: null,
  },
};

function revision(skill: Skill, hash: string): Revision {
  return {
    id: skill.latestRevisionId,
    skillId: skill.id,
    hash: hash.repeat(64),
    path: `D:/Example/library/${skill.id}/${hash.repeat(64)}`,
    source: skill.source,
    fileCount: 4,
    totalBytes: 4096,
    createdAt: skill.createdAt,
  };
}

/**
 * Only the IPC boundary is replaced. No native dialog, local filesystem, shell,
 * GitHub request, or personal project is touched by these browser fixtures.
 */
export async function installBackendFixture(
  page: Page,
  options: FixtureOptions = {},
) {
  await page.addInitScript(
    ({ options, rust, security, revisions }) => {
      const skills = options.emptyLibrary ? [] : [rust, security];
      const projects: Project[] = [
        {
          id: "project-askills",
          name: "Askills 示例",
          path: "D:/Example/Askills",
        },
      ];
      const documents: Record<string, string> = {
        "skill-rust":
          '# Rust 异步技能\n\n使用 Tokio 管理任务生命周期，清楚地区分并发与并行。\n\n## 实施顺序\n\n1. 为每个任务定义取消边界。\n2. 保留错误上下文。\n3. 验证资源是否释放。\n\n```rust\nlet result = task.await?;\n```\n\n![跟踪图片](https://tracking.invalid/pixel.png)\n\n[外部文档](https://example.invalid/docs)\n\n<script>window.__markdownExecuted = true</script>\n<img src=x onerror="window.__markdownExecuted=true">',
        "skill-security":
          "# Tauri 安全检查\n\n仅授权必要的本地接口，校验所有跨进程输入。",
      };
      const state = { invocations: [] as Invocation[], committedImports: 0 };
      window.__ASKILLS_TEST__ = state;
      window.isTauri = true;
      let failedImports = 0;
      let failedRegistration = false;
      let selectionNumber = 0;
      let previewNumber = 0;
      let operationInFlight = false;
      const selected = new Map<string, string>();
      const previews = new Map<string, PreparedImport>();
      const discoveries = [
        {
          selectionId: "discover-alpha",
          name: "Alpha 项目",
          path: "D:/Example/Alpha",
          reason: "Git 工作区",
        },
        {
          selectionId: "discover-beta",
          name: "Beta 项目",
          path: "D:/Example/Beta",
          reason: "Git 工作区",
        },
      ];
      const error = (code: string, message: string) => ({ code, message });
      const prepare = (source: Skill["source"] | null): PreparedImport => {
        const value: PreparedImport = {
          id: `preview-${++previewNumber}`,
          source,
          preview: {
            name: rust.name,
            description: rust.description,
            license: "MIT",
            hash: "d".repeat(64),
            fileCount: 4,
            totalBytes: 4096,
            markdown: documents["skill-rust"],
            warnings: [],
          },
        };
        previews.set(value.id, value);
        return value;
      };

      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args = {}) => {
          state.invocations.push({ command, args });
          const isCancellation = command === "cancel_operation";
          // Mirror the native global busy gate so accidental Promise.all IPC fails.
          if (!isCancellation) {
            if (operationInFlight)
              throw error("Busy", "模拟后端拒绝并发 IPC 操作");
            operationInFlight = true;
          }
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            switch (command) {
              case "get_snapshot": {
                const snapshot: Snapshot = {
                  skills,
                  projects,
                  deployments: [],
                  libraryRoot: "D:/Example/Askills Library",
                  recovery: [],
                };
                return structuredClone(snapshot);
              }
              case "get_document": {
                const item = revisions.find(
                  (item) => item.id === args.revisionId,
                );
                if (!item) throw error("RevisionNotFound", "版本不存在");
                const skill = skills.find((skill) => skill.id === item.skillId);
                if (!skill) throw error("SkillNotFound", "技能不存在");
                const document: SkillDocument = {
                  skill,
                  revision: item,
                  markdown: documents[skill.id],
                  warnings: [],
                };
                return structuredClone(document);
              }
              case "get_revisions":
                return structuredClone(
                  revisions
                    .filter((item) => item.skillId === args.skillId)
                    .reverse(),
                );
              case "pick_directory": {
                const id = `selection-${++selectionNumber}`;
                selected.set(id, String(args.purpose));
                return { id, path: `D:/Example/${args.purpose}` };
              }
              case "prepare_import": {
                if (selected.get(String(args.selectionId)) !== "import")
                  throw error("SelectionExpired", "目录选择已失效");
                selected.delete(String(args.selectionId));
                return structuredClone(prepare(null));
              }
              case "discard_import":
                previews.delete(String(args.importId));
                return null;
              case "finish_import": {
                const preview = previews.get(String(args.importId));
                if (!preview) throw error("PreviewExpired", "导入预览已失效");
                if (failedImports++ < (options.importFailures || 0))
                  throw error("PermissionDenied", "模拟写入失败，请重试");
                state.committedImports++;
                const current = skills.find((skill) => skill.id === rust.id);
                const nextNumber = current ? current.revisionCount + 1 : 1;
                const next = {
                  ...rust,
                  revisionCount: nextNumber,
                  latestRevisionId: `revision-rust-${nextNumber}`,
                };
                const index = skills.findIndex((skill) => skill.id === rust.id);
                if (index >= 0) skills[index] = next;
                else skills.push(next);
                if (
                  !revisions.some((item) => item.id === next.latestRevisionId)
                )
                  revisions.push({
                    ...revisions[0],
                    id: next.latestRevisionId,
                    hash: "d".repeat(64),
                  });
                previews.delete(preview.id);
                return structuredClone(next);
              }
              case "preview_deployment": {
                const plan: DeploymentPlan = {
                  id: "plan-one",
                  projectId: String(args.projectId),
                  revisionId: String(args.revisionId),
                  skillId: rust.id,
                  name: rust.name,
                  agent: String(args.agent),
                  mode: String(args.mode),
                  targetPath:
                    "D:/Example/Askills/.agents/skills/rust-async-patterns",
                  previousRevisionId: null,
                  conflict: options.deploymentConflict
                    ? "目标已有非 Askills 管理的目录，不能覆盖。"
                    : null,
                  warnings: [],
                };
                return plan;
              }
              case "apply_deployment":
                throw error(
                  "UnexpectedMutation",
                  "测试不允许发生未确认的部署操作",
                );
              case "discover_projects":
                selected.delete(String(args.selectionId));
                for (const item of discoveries)
                  selected.set(item.selectionId, "project");
                return structuredClone(discoveries);
              case "discard_selections": {
                for (const id of (args.selectionIds as string[]) || [])
                  selected.delete(id);
                return null;
              }
              case "register_project": {
                const id = String(args.selectionId);
                if (selected.get(id) !== "project")
                  throw error(
                    "SelectionExpired",
                    "成功项的目录选择已经消耗，不能重复登记",
                  );
                if (
                  id === "discover-beta" &&
                  options.registrationFailure &&
                  !failedRegistration
                ) {
                  failedRegistration = true;
                  throw error("PermissionDenied", "Beta 模拟登记失败，请重试");
                }
                const found = discoveries.find(
                  (item) => item.selectionId === id,
                );
                if (!found)
                  throw error("UnexpectedSelection", "未预期的项目目录");
                selected.delete(id);
                const project = { id, name: found.name, path: found.path };
                projects.push(project);
                return project;
              }
              case "resolve_github":
                return {
                  id: "catalog-one",
                  repository: String(args.repository),
                  reference: String(args.reference),
                  commit: "e".repeat(40),
                  candidates: [
                    {
                      path: "skills/rust",
                      name: "rust-async-patterns",
                      fileCount: 4,
                      totalBytes: 4096,
                    },
                  ],
                };
              case "prepare_github":
                if (
                  args.catalogId !== "catalog-one" ||
                  args.skillPath !== "skills/rust"
                )
                  throw error("InvalidCandidate", "未知技能候选");
                return structuredClone(
                  prepare({
                    ...security.source,
                    commit: "e".repeat(40),
                    subpath: "skills/rust",
                  }),
                );
              case "cancel_operation":
                return null;
              default:
                throw error("UnexpectedCommand", `测试未定义 IPC：${command}`);
            }
          } finally {
            if (!isCancellation) operationInFlight = false;
          }
        },
      };
    },
    {
      options,
      rust,
      security,
      revisions: [revision(rust, "a"), revision(security, "b")],
    },
  );
}

export async function invocations(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      window.__ASKILLS_TEST__.invocations.filter(
        (item) => item.command === command,
      ),
    command,
  );
}
