# Askills 软件标志

- `ASkills.source.svg`：用户提供的原始矢量稿，按原字节保留。
- `../../public/askills.svg`：用于界面和浏览器图标的可移植版本。保留原稿的颜色、布局和变换，将 MiSans SemiBold（可变字体 `wght=600`）的 `S`、`kills` 转为路径，不依赖目标系统安装字体。
- `../../src-tauri/icons/`：由上述可移植 SVG 生成的 Windows、macOS 和 PNG 桌面图标。

字体来源和许可见 [MiSans 说明](../../third-party/fonts/README.md)。原字体文件未改动。

重新生成桌面图标：

```sh
pnpm tauri icon public/askills.svg --output .askills/generated-icons
```

将生成目录顶层的桌面图标文件复制到 `src-tauri/icons/`。Android/iOS 子目录不属于当前桌面项目的打包范围。
