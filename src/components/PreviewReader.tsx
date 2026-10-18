import { useState } from "react";
import { Languages } from "lucide-react";
import { Markdown } from "./Markdown";
import { call } from "../lib/ipc/client";
import type { RunOperation } from "../lib/ipc/types";

export function PreviewReader({
  importId,
  markdown,
  busy,
  run,
}: {
  importId: string;
  markdown: string;
  busy: boolean;
  run: RunOperation;
}) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [language, setLanguage] = useState<"original" | "zh">("original");
  async function translate() {
    if (translated !== null) {
      setLanguage("zh");
      return;
    }
    const result = await run("正在翻译为简体中文", () =>
      call<string>("translate_preview", { importId }),
    );
    if (result !== undefined) {
      setTranslated(result);
      setLanguage("zh");
    }
  }
  return (
    <>
      <div className="preview-reader-actions">
        <button disabled={busy} onClick={() => void translate()}>
          <Languages size={16} />
          翻译为简体中文
        </button>
        {translated !== null && (
          <div className="reader-tabs" role="tablist" aria-label="预览语言">
            <button
              role="tab"
              aria-selected={language === "original"}
              className={language === "original" ? "active" : ""}
              onClick={() => setLanguage("original")}
            >
              原文
            </button>
            <button
              role="tab"
              aria-selected={language === "zh"}
              className={language === "zh" ? "active" : ""}
              onClick={() => setLanguage("zh")}
            >
              简体中文
            </button>
          </div>
        )}
      </div>
      <p className="footnote translation-notice">
        点击翻译会将正文片段发送至 MyMemory，服务可能长期保存内容。免
        Key，匿名额度每天 5,000
        字符；代码块、行内代码和技能元数据保留原样。译文仅用于阅读，下载与安装始终使用原文。
      </p>
      <div className="import-reader" data-preview-language={language}>
        <Markdown
          text={
            language === "zh" && translated !== null ? translated : markdown
          }
        />
      </div>
    </>
  );
}
