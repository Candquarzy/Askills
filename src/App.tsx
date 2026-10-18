import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { zhCN } from "./locales/zh-CN";
import "./App.css";

type AppInfo = { name: string; version: string };

function App() {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const desktop = isTauri();
  async function checkConnection() {
    setChecking(true);
    try {
      const info = await invoke<AppInfo>("get_app_info");
      setStatus(info.name + " " + info.version + " · " + zhCN.connected);
    } catch (error) {
      setStatus(zhCN.connectionFailed + "：" + String(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <main className="shell">
      <header className="brand">
        <span className="mark" aria-hidden="true">
          A
        </span>{" "}
        Askills
      </header>
      <section className="intro" aria-labelledby="app-title">
        <p className="eyebrow">PROJECT BOOTSTRAP / 0.1.0</p>
        <h1 id="app-title">{zhCN.title}</h1>
        <p className="description">{zhCN.description}</p>
        <div className="stack" aria-label="技术栈">
          <span>Rust</span>
          <span>Tauri 2</span>
          <span>React + TypeScript</span>
        </div>
        <div className="status-block">
          <h2>{zhCN.phaseTitle}</h2>
          <p>{zhCN.phaseDescription}</p>
          <button disabled={!desktop || checking} onClick={checkConnection}>
            {checking ? zhCN.checking : zhCN.checkConnection}
          </button>
          <p className="connection-status" role="status">
            {status || (desktop ? zhCN.desktopHint : zhCN.browserHint)}
          </p>
        </div>
      </section>
      <footer>本地优先 · 中文体验 · MIT 开源</footer>
    </main>
  );
}
export default App;
