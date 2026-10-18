# 初始化验证记录

日期：2026-10-18。范围：P0 工程骨架与实现方案，尚未实现任何技能管理业务。

## 本机环境

- Windows x86_64，MSVC Visual Studio Community 2022，WebView2 155.0.4283.62。
- Node.js 24.20.0、pnpm 11.22.0。
- rustc / cargo 1.99.0，stable-x86_64-pc-windows-msvc。
- Tauri Rust / JS API 2.12.4，CLI 2.12.3；React 19.3.1、Vite 8.3.4、TypeScript 6.0.3。
- 具体依赖由 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock` 记录。

## 已通过

- `pnpm install`：成功安装依赖并生成锁文件。
- `pnpm check`：TypeScript 检查通过。
- `pnpm build`：前端生产构建通过。
- `pnpm format:check`：项目文本格式检查通过，上游 skills 与许可材料排除在自动格式化之外。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：Rust 格式检查通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `pnpm tauri build --debug --no-bundle`：Windows 原生编译、链接成功，输出 `src-tauri/target/debug/askills.exe`。
- 9 个开发 skill 文件与来源清单中的 SHA-256 一致；来源均固定到完整 commit，并保留许可。
- 独立只读复核后，修正开发服务器/CSP 地址不一致，补充跨 skill 根目录引用的处理设计。

## 尚未验证

- 未进行原生窗口的人工交互、截图或按钮点击验收；构建通过不能代替 UI 与 IPC 运行时验收。
- 未生成或安装正式 MSI/NSIS 安装包，未签名，也未建立 Release。
- macOS / Linux 的编译、打包与交互尚未验证。
- 尚无业务功能，未执行技能安装、项目扫描、真实 Agent 加载、网络下载或翻译验收。
- 初始化阶段不为静态页面编写重复实现的单元测试；后续按实现方案添加有意义的行为测试。

GitHub Actions 的实时结果请查看仓库 Actions；本文件只记录本地证据，不把 CI 配置存在视为 CI 已通过。
