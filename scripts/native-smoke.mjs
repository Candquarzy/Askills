// Windows WebView2 smoke against the built debug executable. No IPC mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

assert.equal(process.platform, "win32", "This smoke uses Windows WebView2.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "test-results", "native");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "askills-native-"));
const data = path.join(temporary, "data");
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const executable = process.env.ASKILLS_SMOKE_EXE
  ? path.resolve(root, process.env.ASKILLS_SMOKE_EXE)
  : path.join(root, "src-tauri/target/debug/askills.exe");
const child = spawn(executable, [], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    ASKILLS_TEST_DATA_DIR: data,
    WEBVIEW2_USER_DATA_FOLDER: path.join(temporary, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  },
});
let processLog = "";
child.stdout.on("data", (bytes) => (processLog += bytes));
child.stderr.on("data", (bytes) => (processLog += bytes));
let launchError;
child.on("error", (error) => (launchError = error));
let browser;
let page;
const errors = [];
const useGit = process.argv.includes("--git");
const report = {
  native: true,
  github: false,
  transport: useGit ? "git" : "api",
  checks: [],
};
console.log("Starting isolated native window smoke…");
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null)
      throw new Error(`App exited: ${child.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/json/list`);
      if (response.ok && (await response.json()).length) {
        ready = true;
        break;
      }
    } catch {
      /* WebView2 starts asynchronously. */
    }
    await delay(500);
  }
  assert(ready, "Native WebView2 debugging endpoint did not start.");
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  await expect(
    page.getByRole("button", { name: "导入本地技能" }),
  ).toBeEnabled();
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  const snapshot = await invoke("get_snapshot");
  assert.equal(snapshot.skills.length, 0);
  assert.equal(snapshot.projects.length, 0);
  assert.equal(
    path.toNamespacedPath(snapshot.libraryRoot),
    path.toNamespacedPath(path.join(data, "library")),
  );
  report.checks.push("native startup, real IPC, isolated empty SQLite/library");
  const denied = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("register_project", {
        selectionId: "untrusted-path",
      });
      return null;
    } catch (error) {
      return error;
    }
  });
  assert.equal(denied?.code, "SelectionExpired");
  await assert.rejects(
    invoke("plugin:fs|read_text_file", { path: "SKILL.md" }),
  );
  report.checks.push(
    "expired directory grant and ungranted fs plugin rejected",
  );
  const invalidTranslation = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("translate_preview", {
        importId: "expired-preview",
      });
      return null;
    } catch (error) {
      return error;
    }
  });
  assert.equal(invalidTranslation?.code, "PreviewExpired");
  report.checks.push(
    "translation IPC registered and expired preview rejected without external request",
  );
  if (process.argv.includes("--github") || useGit) {
    console.log(
      "Testing public GitHub preview and import through the native UI…",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "来源", exact: true })
      .click();
    if (useGit) {
      await page.getByRole("button", { name: "本地 Git", exact: true }).click();
      await page.getByRole("button", { name: "检查 Git 安装" }).click();
      await expect(page.getByText(/^git version /)).toBeVisible();
    }
    await page
      .getByLabel("仓库地址")
      .fill("https://github.com/Candquarzy/Askills");
    await page.getByLabel("分支、标签或 commit（可选）").fill("main");
    await page.getByRole("button", { name: "查找技能" }).click();
    const candidate = page
      .locator(".candidate-row")
      .filter({ hasText: ".agents/skills/tauri-setup" });
    await expect(candidate).toBeVisible({ timeout: 150_000 });
    if (process.argv.includes("--download")) {
      await candidate
        .getByRole("button", { name: "下载", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText("正在下载");
      await expect(
        page.getByRole("progressbar", { name: "操作进度" }),
      ).toBeVisible();
      await expect(
        candidate.getByRole("button", { name: "已下载", exact: true }),
      ).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      report.checks.push(
        "direct download saves to library without preview; fixed toast and progress are visible",
      );
    } else {
      await candidate
        .getByRole("button", { name: "预览", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "预览技能" });
      await expect(dialog).toBeVisible({ timeout: 90_000 });
      assert.equal((await invoke("get_snapshot")).skills.length, 0);
      if (process.argv.includes("--translate")) {
        const original = await dialog.locator(".import-reader").innerText();
        await dialog
          .getByRole("button", { name: "翻译为简体中文", exact: true })
          .click();
        await expect(
          dialog.getByRole("tab", { name: "简体中文", exact: true }),
        ).toBeVisible({ timeout: 150_000 });
        assert.match(
          await dialog.locator(".import-reader").innerText(),
          /[\u4e00-\u9fff]/,
        );
        await dialog.getByRole("tab", { name: "原文", exact: true }).click();
        await expect(dialog.locator(".import-reader")).toHaveText(original);
        assert.equal((await invoke("get_snapshot")).skills.length, 0);
        report.checks.push(
          "public built-in skill translated through native IPC and MyMemory; original toggle and no automatic import verified",
        );
      }
      await dialog
        .getByRole("button", { name: "下载到技能库", exact: true })
        .click();
      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    }
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^技能库/ })
      .click();
    await page.getByRole("button", { name: /^tauri-setup Create/ }).click();
    await expect(
      page.getByRole("heading", { name: "Tauri setup", exact: true }),
    ).toBeVisible();
    const imported = await invoke("get_snapshot");
    assert.equal(imported.skills.length, 1);
    assert.equal(imported.projects.length, 0);
    assert.match(imported.skills[0].source.commit, /^[0-9a-f]{40}$/);
    report.commit = imported.skills[0].source.commit;
    report.github = true;
    report.checks.push(
      `public GitHub ${report.transport} lookup/download, confirm-only import, native Markdown reading`,
    );
    await page.getByRole("button", { name: "编辑显示名称" }).click();
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill("我的 Tauri 工具");
    await page.getByRole("button", { name: "保存名称" }).click();
    await expect(
      page.getByRole("heading", { name: "我的 Tauri 工具", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^我的 Tauri 工具/ }).click();
    await expect(
      page.getByRole("button", { name: "编辑显示名称" }),
    ).toBeEnabled();
    const renamed = (await invoke("get_snapshot")).skills[0];
    assert.equal(renamed.displayName, "我的 Tauri 工具");
    assert.equal(renamed.name, imported.skills[0].name);
    assert.equal(renamed.latestRevisionId, imported.skills[0].latestRevisionId);
    report.checks.push(
      "display name persisted through real SQLite IPC and frontend reload; original name and revision preserved",
    );
  }
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(output, "window.png"),
    fullPage: true,
  });
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ ...report, errors, processLog }, null, 2),
  );
  await browser?.close().catch(() => {});
  if (child.exitCode === null && !launchError) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  // Verify the exact unique temporary root before recursive cleanup; never use
  // arbitrary user input or a project/library path as the deletion target.
  const target = await realpath(temporary);
  const tempRoot = await realpath(tmpdir());
  assert.equal(path.dirname(target).toLowerCase(), tempRoot.toLowerCase());
  assert(path.basename(target).startsWith("askills-native-"));
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 500,
  });
}
