# 浏览器集成测试

执行 `pnpm exec playwright test`。Windows 默认使用已安装的 Microsoft Edge；其他平台使用 Playwright Chromium，CI 需先安装对应浏览器依赖。

测试通过 `page.addInitScript` 在真实应用加载前替换 Tauri IPC 边界。模拟后端保留全局互斥、一次性目录授权和可重试导入预览语义；浏览器实际运行 React 页面。测试不访问真实技能库、项目目录、原生选择框或 GitHub。

这些结果验证前端行为及 IPC 参数，不能替代 Rust 文件系统测试、真实 GitHub 下载测试或 Tauri 原生窗口验收。

当前覆盖 25 个流程，包括显示名称、项目内添加、API/Git 切换、独立下载/预览/多选、顶部进度、部分失败/取消，以及仓库历史的最近10条、去重、重载和项目共用。预览按原文显示，翻译功能已移除。原生联网测试使用 `pnpm test:native --github` 或 `--git`，详见 [本地验收](../../docs/local-testing.md)。

可选环境变量：

- `ASKILLS_UI_BROWSER_CHANNEL`：覆盖浏览器通道，例如 `msedge` 或 `chromium`。
- `ASKILLS_UI_BASE_URL`：覆盖页面地址，默认 `http://localhost:1420`。
- `ASKILLS_UI_SERVER_COMMAND`：覆盖服务器命令，默认 `pnpm dev --host localhost`；自定义端口时应与页面地址同步。

本地可复用已启动的服务器；CI 每次启动独立服务器。测试报告保存到 `playwright-report/`，失败跟踪和技能库示例截图保存到 `test-results/`。
