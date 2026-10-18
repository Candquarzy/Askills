import license from "../../third-party/fonts/MiSans.LICENSE.txt?raw";

export function FontNotice() {
  return (
    <section className="settings-section">
      <h2>界面字体</h2>
      <p>本应用使用 MiSans 字体，由小米提供。原版字体随应用内置，离线可用。</p>
      <details>
        <summary>MiSans 字体许可</summary>
        <pre className="font-license">{license}</pre>
      </details>
    </section>
  );
}
