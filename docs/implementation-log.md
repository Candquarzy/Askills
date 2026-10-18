# 模块交付记录

按模块完成测试后直接提交 `main`；界面接入前保留原有启动页。

## 2026-10-18 · 技能库与只读项目扫描

- 完整目录校验、不可变快照、来源身份、SQLite 索引和 manifest 恢复。
- 原生业务模块独立于 Tauri IPC，可直接在临时目录验证。
- Codex / Cursor / Claude Code 路径识别、指定目录发现项目、嵌套及仓库祖先技能扫描。
- 独立模块状态下 `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`：**16/16 通过**。
- 包括中文路径、链接拒绝、源变更、取消、重复导入、快照漂移、丢失索引恢复与双实例锁。
- 此提交提供 Rust 核心，前端交互由后续模块接入。

## 2026-10-18 · 项目部署与恢复

- 持久化预览计划、固定版本安装、自动链接降级、复制、升级、回滚和停用。
- 项目锁、可分享的 `askills.lock.json`、入口身份校验、外部改动保护与操作日志恢复。
- 单独执行 `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib services::deployments`：**19/19 通过**。
- 验证真实 Windows junction、复制模式、部分复制取消、不同崩溃切点恢复、未知文件保留，以及预览/列表取消。
