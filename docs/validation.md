# 验证记录

日期：2026-10-18。范围：技能库、项目部署与恢复、GitHub 来源、IPC 和中文桌面流程的开发预览。

## 仓库历史的最新验证

完整 Rust **68 项通过，2 项联网测试默认跳过**；Edge 界面 **25 项通过**。新增存储测试验证最近10条、去重前移、非法地址不存、重启保留、旧数据库兼容、写入失败回滚；界面测试验证历史选择、API/Git共享、失败输入、跨页面与重载。类型、前端构建与 Clippy 通过。

独立 Windows Tauri/WebView2 原生验证通过：真实 Git 查询/下载、翻译 IPC 不可用、SQLite 保存历史、页面重载后从历史填入地址且不自动查询。测试使用隔离数据目录，未更改用户真实技能库；独立原生构建通过。

## 移除翻译后的验证范围

翻译功能已按用户要求移除，预览仅显示原文。当前源码不包含翻译服务和翻译 IPC 权限；历史交付记录中的翻译结果不代表当前能力。

移除后 Rust 65 项回归、Edge 22 项流程通过；前端构建与 Clippy 通过。其余联网用例仍默认跳过。

## 之前三项优化的历史验证

- **61 项 Rust 回归通过，0 失败**；2 项显式联网测试在普通回归中默认跳过。新增覆盖别名兼容/恢复/原文不变，以及 Git 原始字节、固定提交、许可证、恶意参数/路径、缓存释放、缺失安装、输出限额、超时、运行中取消和仓库规模。
- **14 项 Edge 界面测试通过**，使用 IPC fixture，覆盖别名搜索/恢复、项目内库/本地/云端添加、云端 Git 添加、方式切换和 Git 未安装提示；确认前不部署、非默认目标项目保持固定。
- `cargo test ... native_git_public_smoke -- --ignored --nocapture` 实际通过公共 GitHub 下载。真实 Windows Tauri / WebView2 的 `pnpm test:native --git` 与 `--github` 均通过：Git 版本检测、固定提交 `4c0f5723f37b72fb741882fe7f3e3e5ea6161511` 的技能预览/确认导入、Markdown 阅读，以及通过真实 IPC 保存中文别名、重新加载页面后验证原名称和 revision 保持不变。
- TypeScript、前端生产构建、Prettier、Rust fmt 与 Clippy 通过；用 `extra-filename=-verify` 构建独立原生程序，避免覆盖运行中的应用。实际 Git 来源页面截图与原生窗口截图已检查。
- 原生测试数据在独立临时目录，未安装到用户真实项目。原生目录选择仍需人工验收；项目部署的真实文件操作由 Rust 测试覆盖，浏览器中的项目选择流程由 fixture 覆盖。
- 仅公共仓库和本机 Windows Git 2.55.0 实测；私有仓库/其他凭据助手、macOS/Linux 尚未验证。下面记录初次核心模块交付时的历史结果。

## 本机环境

- Windows x86_64，MSVC Visual Studio Community 2022，WebView2 155.0.4283.62。
- Node.js 24.20.0、pnpm 11.22.0，Rust / Cargo 1.99.0。
- Tauri Rust / JS API 2.12.4、CLI 2.12.3；React 19.3.1、Vite 8.3.4、TypeScript 6.0.3。
- 依赖的精确版本见 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock`。

## 按模块验证后提交

| 模块                 | 本地结果          | 证据范围                                                                        |
| -------------------- | ----------------- | ------------------------------------------------------------------------------- |
| 技能库与只读项目扫描 | 16 项通过         | 真实临时目录、来源身份、原文保持、版本、索引恢复、路径与链接边界                |
| 项目部署与恢复       | 19 项通过         | copy、Windows junction、自动模式、升级回滚停用、冲突、取消、崩溃切点恢复        |
| GitHub 来源          | 15 项离线测试通过 | 固定 commit、完整目录、blob 摘要、许可证、恶意路径、限额与响应失败              |
| IPC 边界             | 4 项通过          | 目录用途/过期、预览后来源变更、TempDir 释放、Busy 互斥、取消与错误后释放        |
| 中文前端流程         | 7 项通过          | Edge 真实页面 + IPC fixture，搜索、确认、错误重试、冲突、部分失败重试、版本刷新 |

组合后的 `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`：**54 通过、0 失败、1 个显式联网测试默认跳过**。跳过项为 `public_github_smoke`，不把外网可用性纳入普通回归。真实联网另由下述原生测试覆盖。

模块提交与范围见 [模块交付记录](implementation-log.md)。测试不是对零缺陷的保证；未覆盖的运行环境在下面单列。

## 原生窗口与真实 GitHub

`pnpm tauri build --debug --no-bundle -- --locked` 构建成功，生成 `src-tauri/target/debug/askills.exe`。

`pnpm test:native --github` 实测通过，使用真实 Tauri / WebView2，没有替换 IPC：

1. 启动独立应用数据目录和独立 WebView2 缓存，确认初始 SQLite / 库为空。
2. 真实 `get_snapshot` 返回隔离库；未授权目录 token 返回 `SelectionExpired`，未授权文件插件调用被拒绝。
3. 在原生页面输入公共仓库 `Candquarzy/Askills` 和 `main`，解析到 `e34a61764fec38508c4275f5af1e1d8bfb99f6c4`。
4. 选择 `.agents/skills/tauri-setup`，下载并校验。预览阶段库仍为空，确认后出现 1 个技能与固定 commit。
5. 打开原生 Markdown 阅读器，页面没有 JavaScript 异常。已查看实际窗口页面截图。

测试结束关闭该测试进程并清理其临时目录，未对真实用户项目进行安装。运行证据保存在忽略目录 `test-results/native/`，包含 `report.json` 与 `window.png`；再次运行会覆盖。截图只包含 WebView 页面，不包括操作系统窗口边框。

浏览器测试的示例数据截图与原生截图分别生成，不把 fixture 当成真实导入证据。原生目录选择框的人工选择交互尚未自动化；本轮原生完整导入走 GitHub 流程。

## 静态与构建检查

- `pnpm check` 与前端生产构建通过。
- `pnpm format:check` 通过，开发 skills 与上游许可证排除自动格式化。
- Rust format 与 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` 通过。
- Windows debug no-bundle 编译与链接通过；不等于正式安装包验证。
- 本轮没有修改已固定来源的开发 skills 文件。

初次在受限执行沙箱中运行文件锁/junction测试时遇到 Windows `PermissionDenied`，本机浏览器连接也曾被沙箱拒绝。相同测试在获准使用真实本机权限后通过；没有为绕过测试而放宽应用路径检查或 Tauri capability。

## CI 与未覆盖内容

CI 已加入前端类型/格式/构建、Chromium 浏览器测试，以及 Windows Rust format/clippy/test 和原生构建。实时执行结果请查看 [仓库 Actions](https://github.com/Candquarzy/Askills/actions)，本文件记录本地证据，不将配置存在视为远端已通过。

尚未验证或未实现：

- 真实 Codex / Cursor / Claude Code 版本下的发现、刷新和调用；需要按 [本地验收步骤](local-testing.md) 实际确认。
- macOS / Linux 原生编译、链接行为和交互；网络磁盘、跨卷、高 DPI 与大规模库的完整矩阵。
- MSI / NSIS 正式安装、签名、升级、卸载和 GitHub Release。
- 已有库迁移、批量升级向导、备份/恢复界面、锁文件异机重建、未知文件接管及损坏库局部隔离。
- 故障恢复用持久化日志切点模拟中断，未进行硬件断电试验。

项目当前仍标为开发预览。日常修改按模块测试、独立提交到 `main`，不堆成大提交。
