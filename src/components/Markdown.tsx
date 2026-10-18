import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  // Metadata has its own fields; raw mode retains the original frontmatter.
  const body = text.replace(
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,
    "",
  );
  return (
    <article className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ alt }) => (
            <span className="muted">[图片：{alt || "未加载"}]</span>
          ),
          a: ({ children, href }) => (
            <span className="document-link" title={href}>
              {children}
            </span>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
