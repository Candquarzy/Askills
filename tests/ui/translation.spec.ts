import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

const original =
  "## English instructions\n\nRead the reference before running this skill.\n\n```rust\nlet result = task.await?;\n```\n\nKeep `task.await` unchanged.";

async function openPreview(page: Page) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await page.getByRole("button", { name: "查找技能" }).click();
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "预览技能", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("翻译仅在点击后发送，语言切换复用结果且下载仍保存原文", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page, {
    emptyLibrary: true,
    previewMarkdown: original,
  });
  const dialog = await openPreview(page);
  await expect(dialog.locator(".translation-notice")).toContainText("MyMemory");
  await expect(dialog.locator(".translation-notice")).toContainText("发送");
  await expect(dialog.locator(".translation-notice")).toContainText(
    "可能长期保存",
  );
  await expect(dialog.locator(".translation-notice")).toContainText("5,000");
  const reader = dialog.locator(".import-reader");
  await expect(
    reader.getByRole("heading", { name: "English instructions", exact: true }),
  ).toBeVisible();
  const originalText = await reader.textContent();
  const originalCode = await reader.locator("pre code").textContent();
  expect(await invocations(page, "translate_preview")).toHaveLength(0);
  const translate = dialog.getByRole("button", {
    name: "翻译为简体中文",
    exact: true,
  });
  await translate.click();
  await expect(
    reader.getByRole("heading", { name: "中文说明", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "简体中文", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await reader.locator("pre code").textContent()).toBe(originalCode);
  await dialog.getByRole("tab", { name: "原文", exact: true }).click();
  await expect(reader).toHaveText(originalText!);
  await translate.click();
  await expect(
    reader.getByRole("heading", { name: "中文说明", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "原文", exact: true }).click();
  await dialog.getByRole("tab", { name: "简体中文", exact: true }).click();
  expect(await invocations(page, "translate_preview")).toEqual([
    {
      command: "translate_preview",
      args: { importId: "preview-1" },
    },
  ]);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("translated-preview.png"),
  });
  await dialog
    .getByRole("button", { name: "下载到技能库", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^技能库/ })
    .click();
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(
    page.getByRole("heading", { name: "English instructions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "中文说明", exact: true }),
  ).toHaveCount(0);
  expect(await invocations(page, "finish_import")).toHaveLength(1);
});

test("翻译失败仍显示原文与错误提示，可使用同一预览重试", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page, {
    previewMarkdown: original,
    translationFailure: true,
  });
  const dialog = await openPreview(page);
  const reader = dialog.locator(".import-reader");
  const originalText = await reader.textContent();
  const translate = dialog.getByRole("button", {
    name: "翻译为简体中文",
    exact: true,
  });
  await translate.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "模拟翻译服务暂时不可用，请重试",
  );
  await expect(reader).toHaveText(originalText!);
  await expect(
    dialog.getByRole("tab", { name: "简体中文", exact: true }),
  ).toHaveCount(0);
  await expect(translate).toBeEnabled();
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("translation-failed-preview.png"),
  });
  await translate.click();
  await expect(
    reader.getByRole("heading", { name: "中文说明", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  const attempts = await invocations(page, "translate_preview");
  expect(attempts).toHaveLength(2);
  expect(attempts[0].args.importId).toBe(attempts[1].args.importId);
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  expect(await invocations(page, "discard_import")).toHaveLength(1);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
});

test("关闭已翻译预览后打开另一个技能，不会复用旧预览的译文", async ({
  page,
}) => {
  await installBackendFixture(page, {
    previewMarkdown: original,
    sourceCandidateCount: 2,
  });
  const dialog = await openPreview(page);
  await dialog
    .getByRole("button", { name: "翻译为简体中文", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "中文说明", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await page
    .locator(".candidate-row")
    .nth(1)
    .getByRole("button", { name: "预览", exact: true })
    .click();
  await expect(dialog).toContainText("tauri-security");
  await expect(
    dialog.getByRole("heading", { name: "English instructions", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "简体中文", exact: true }),
  ).toHaveCount(0);
  expect(await invocations(page, "translate_preview")).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "翻译为简体中文", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "中文说明", exact: true }),
  ).toBeVisible();
  const attempts = await invocations(page, "translate_preview");
  expect(attempts).toHaveLength(2);
  expect(attempts[0].args.importId).not.toBe(attempts[1].args.importId);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
});
