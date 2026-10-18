# Askills

一个使用 **Rust + Tauri 2** 构建的中文 Agent Skills 桌面管理器。

**当前状态：工程初始化与方案评审，业务功能尚未实现。**
目前只有中文启动页面和只读的 Rust 通信检查，不包含技能扫描、安装、下载或翻译功能。

## 实现方案

完整设计请阅读 **[详细实现方案](docs/architecture.md)**，涵盖：

1. 本地统一技能库：完整目录、内容快照、来源版本、标签和许可证。
2. 项目管理：手动添加或扫描指定根目录，识别 Codex / Cursor 等工具的技能路径。
3. 项目启用：符号链接 → Windows junction → 复制的兼容策略，固定版本并支持恢复。
4. GitHub 来源：候选技能选择、固定 commit 下载、变更预览与按项目升级。
5. 中文阅读：中文界面、按需自动翻译、原文对照、缓存及本地 Ollama / 兼容 API。
6. 实施阶段：P0 初始化 → P1 本地库与扫描 → P2 安装与绑定 → P3 来源管理 → P4 翻译 → P5 发布。

Windows 为首个验收平台；macOS/Linux 在各自验证完成前仅视为计划支持。
翻译只用于阅读，不覆盖 Agent 执行的原始 `SKILL.md`。

## 本地开发

需要 Node.js 24、pnpm 11.22.0、Rust stable，以及系统对应的 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。
Windows 需要 MSVC C++ 工具链与 WebView2。Rust 组件通过 `rust-toolchain.toml` 声明。

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

仅浏览器预览：`pnpm dev`。浏览器中 Rust 通信按钮会禁用。
桌面应用点击“检查 Rust 连接”可检查 IPC；此操作不读取或修改用户项目。

```sh
pnpm check
pnpm build
pnpm format:check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
pnpm tauri build --debug --no-bundle -- --locked
```

最后一条命令生成本地调试可执行文件，不创建安装包。正式打包入口为 `pnpm tauri build`；
签名、安装包升级和三平台发行测试属于后续阶段，不代表本轮已经通过。

## 目录

```text
src/                       React 界面与中文资源
src-tauri/                 Rust 入口、Tauri 配置、权限和模板图标
.agents/skills/            本项目开发时使用的 Rust / Tauri skills
third-party/skills/        上游许可证、固定提交与文件哈希
docs/architecture.md       详细实现方案与阶段验收
docs/development-skills.md  开发 skills 的来源、安装方式与修改记录
.github/                   CI 和 PR 模板
```

开发 skills 是工程辅助资料，**不是未来应用为用户管理的本地技能库**。
已加入 `rust-async-patterns`、`tauri-setup`、`tauri-security`；详情见 [开发 Skills 说明](docs/development-skills.md)。

## 协作与许可

使用分支和 PR 开发，由仓库所有者决定合并。参考 [参与开发](CONTRIBUTING.md)。
GitHub Actions 配置了前端检查和 Windows 桌面构建；实际通过情况以 Actions 结果为准。
本轮本地构建与检查的证据、尚未验证内容见 [初始化验证记录](docs/validation.md)。

Askills 使用 [MIT](LICENSE) 协议。第三方 skills 保留各自的许可证与版权声明；依赖遵循各自许可。
