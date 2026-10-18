import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

async function openSources(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
}
async function find(page: Page, address: string) {
  await page.getByLabel("仓库地址").fill(address);
  await page.getByRole("button", { name: "查找技能" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
}
async function addresses(page: Page) {
  return page
    .getByRole("combobox", { name: "仓库历史记录" })
    .locator("option:not([value=''])")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
}

test("只保存最近10个仓库，重复地址前移，选择历史不自动查找且重载后保留", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page);
  await page.goto("/");
  await openSources(page);
  await expect(
    page.getByRole("combobox", { name: "仓库历史记录" }),
  ).toHaveCount(0);
  // Typing alone does not create history entries.
  await page.getByLabel("仓库地址").fill("owner/not-submitted");
  expect(await invocations(page, "remember_repository")).toHaveLength(0);
  for (let index = 0; index < 12; index++)
    await find(page, `owner/repo-${index}`);
  expect(await addresses(page)).toEqual(
    Array.from(
      { length: 10 },
      (_, i) => `https://github.com/owner/repo-${11 - i}`,
    ),
  );
  await find(page, "https://github.com/OWNER/REPO-4.git/");
  expect((await addresses(page))[0]).toBe("https://github.com/owner/repo-4");
  expect(await addresses(page)).toHaveLength(10);
  await page
    .getByLabel("分支、标签或 commit（可选）")
    .fill("feature/old-repository");
  const before = (await invocations(page, "resolve_github")).length;
  await page
    .getByRole("combobox", { name: "仓库历史记录" })
    .selectOption("https://github.com/owner/repo-3");
  await expect(page.getByLabel("仓库地址")).toHaveValue(
    "https://github.com/owner/repo-3",
  );
  await expect(page.getByLabel("分支、标签或 commit（可选）")).toHaveValue("");
  await expect(page.locator(".candidate-row")).toHaveCount(0);
  expect(await invocations(page, "resolve_github")).toHaveLength(before);
  await page.getByRole("button", { name: "本地 Git", exact: true }).click();
  await page.getByRole("button", { name: "查找技能" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  expect(await invocations(page, "resolve_git")).toHaveLength(1);
  const history = await addresses(page);
  expect(history[0]).toBe("https://github.com/owner/repo-3");
  await page.reload();
  await openSources(page);
  expect(await addresses(page)).toEqual(history);
  await page.screenshot({
    path: testInfo.outputPath("repository-history.png"),
    fullPage: true,
  });
});

test("网络失败仍保留合法输入，非法或含凭据地址不记录", async ({ page }) => {
  await installBackendFixture(page, { resolveFailure: true });
  await page.goto("/");
  await openSources(page);
  await page.getByLabel("仓库地址").fill("owner/unreachable");
  await page.getByRole("button", { name: "查找技能" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟来源网络不可用");
  const history = await addresses(page);
  expect(history).toEqual(["https://github.com/owner/unreachable"]);
  await page
    .getByLabel("仓库地址")
    .fill("https://user:secret@github.com/owner/repo");
  await page.getByRole("button", { name: "查找技能" }).click();
  await expect(page.getByRole("alert")).toContainText("有效的 GitHub 仓库地址");
  expect(await addresses(page)).toEqual(history);
  expect(await invocations(page, "resolve_github")).toHaveLength(1);
});

test("项目内云端添加与来源页共用历史记录", async ({ page }) => {
  await installBackendFixture(page, {
    repositoryHistory: ["https://github.com/example/skills"],
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^项目/ })
    .click();
  await page.getByRole("button", { name: /Askills 示例 D:/ }).click();
  await page.getByRole("button", { name: "添加技能", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "为 Askills 示例 添加技能" });
  await dialog.getByRole("tab", { name: "从云端", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "仓库历史记录" })
    .selectOption("https://github.com/example/skills");
  await expect(dialog.getByLabel("仓库地址")).toHaveValue(
    "https://github.com/example/skills",
  );
  await find(page, "owner/project-skills");
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await openSources(page);
  expect(await addresses(page)).toEqual([
    "https://github.com/owner/project-skills",
    "https://github.com/example/skills",
  ]);
});
