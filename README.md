# Askills

使用 **Rust + Tauri 2** 构建的中文 Agent Skills 桌面管理器。

当前为 **0.1 开发预览**，已实现本地技能库、项目部署和公共 GitHub 来源的首轮完整流程。Windows 为当前验证平台；macOS/Linux、自动翻译与安装包发布仍在后续计划中。

## 可以做什么

- **保存技能**：从原生目录选择器导入完整 skill 文件夹，校验 `SKILL.md` 和附件，保留原目录，生成有来源、许可证和内容摘要的版本快照。支持搜索、Markdown / 原文阅读和版本差异查看。
- **连接项目**：手动登记项目或在指定目录中发现项目，扫描 Codex / Cursor / Claude Code 的已知技能路径，包括嵌套目录和仓库祖先作用域。
- **按项目使用**：预览目标路径后，以符号链接、Windows junction 或复制启用固定版本。可逐个选择项目升级、回滚到前一版本或停用；检测到未知文件、入口替换或外部编辑时停止覆盖。
- **从 GitHub 下载**：解析公共仓库及分支、标签或 commit，选择其中的技能，固定完整 commit 并校验文件内容，保留来源许可。先预览再加入库，项目升级单独确认。

应用不会执行 skill 中的脚本。中文界面已经可用；技能内容当前保留原文，自动翻译尚未实现。

使用步骤见 **[用户指南](docs/user-guide.md)**；架构、当前实现范围和后续里程碑见 **[详细实现方案](docs/architecture.md)**。

## 本地开发

需要 Node.js 24、pnpm 11.22.0、Rust stable，以及系统对应的 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 MSVC C++ 工具链与 WebView2。

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 只启动浏览器预览，文件操作会禁用。桌面版首次启动创建本地应用数据目录，默认技能库在其中的 `library/`；首次导入前可在设置中选择空目录。

```sh
pnpm check
pnpm build
pnpm format:check
pnpm test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
pnpm tauri build --debug --no-bundle -- --locked
```

浏览器测试在 Windows 使用已安装的 Edge，其他平台先运行 `pnpm exec playwright install chromium`。测试中的 IPC 使用 fixture；Rust 测试在临时目录验证真实文件系统行为。

最后一条构建命令生成 `src-tauri/target/debug/askills.exe`，不创建安装包。签名、安装/卸载与 Release 验证尚未完成。

Windows 原生冒烟：构建后执行 `pnpm test:native`；加 `--github` 可验证真实公共 GitHub 导入。测试只使用独立临时数据目录。[逐步本地验收](docs/local-testing.md) 包含导入、部署、升级、回滚及冲突测试。

## 项目结构

```text
src/
  app/                      应用布局、串行任务和交互状态
  features/                 library、projects、sources 页面
  components/               安全 Markdown 阅读器与模态框
  lib/ipc/                  类型和 Tauri 命令调用
src-tauri/src/
  commands/                 IPC 授权、原生目录选择、取消与任务调度
  domain/                   领域数据和错误类型
  services/                 导入校验、项目扫描、部署与恢复
  adapters/                 Agent 路径与共享读取关系
  storage/                  SQLite、manifest、版本快照
  platform/                 路径边界、内容校验和文件操作
  sources/                  GitHub 来源与固定版本下载
tests/ui/                   关键操作流程的浏览器测试
.agents/skills/             本项目开发使用的 Rust / Tauri skills
third-party/skills/         开发 skills 的上游许可和固定来源
docs/                      实现方案、使用说明、验证记录
```

开发 skills 不是应用为用户管理的技能库。它们的来源与哈希见 [开发 Skills 说明](docs/development-skills.md)。

## 当前边界

项目版本固定到快照，导入新版本不会自动升级项目。复制模式适合 Git、容器和跨电脑共享；绝对链接只适合本机使用。已有技能库暂不支持迁移，非空目录不会被直接接管。

GitHub 目前仅支持公共仓库，存在大小限制、API 配额及对链接/子模块的拒绝策略；详情见用户指南。Markdown 不执行 HTML、不加载图片或打开外部链接。路径解析拒绝经过链接的父目录。

已通过的检查与尚未完成的原生、真实 Agent 和平台验收分别记录在 [验证记录](docs/validation.md)。

## 协作与许可

本个人项目日常开发直接在 `main` 提交并推送，无需 PR，参见 [参与开发](CONTRIBUTING.md)。CI 执行前端检查、浏览器测试及 Windows Rust 测试和桌面构建。

Askills 使用 [MIT](LICENSE) 协议。第三方 skills 保留各自的许可与版权声明，依赖遵循各自许可。
