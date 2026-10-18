import { test, expect } from "@playwright/test";
import { installBackendFixture } from "./fixtures";

test("内置MiSans实际渲染中文，表单、路径和代码字体统一，许可可查看", async ({
  page,
}) => {
  await installBackendFixture(page);
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("MiSansVF") && request.url().includes(".ttf"))
      fonts.push(request.url());
  });
  await page.goto("/");
  await page.evaluate(() =>
    document.fonts.load('400 14px "MiSans"', "skills 库 ABC 012"),
  );
  const loaded = await page.evaluate(() =>
    Array.from(document.fonts).some(
      (font) => font.family === "MiSans" && font.status === "loaded",
    ),
  );
  expect(loaded).toBe(true);
  expect(fonts.length).toBeGreaterThan(0);
  expect(
    fonts.every((url) => new URL(url).origin === new URL(page.url()).origin),
  ).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".page-head h1",
  });
  const actual = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(
    actual.fonts.some(
      (font) =>
        font.familyName.startsWith("MiSans") &&
        font.isCustomFont &&
        font.glyphCount > 0,
    ),
  ).toBe(true);
  await cdp.detach();
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(page.locator(".markdown code").first()).toBeVisible();
  for (const selector of [
    "button",
    "input",
    "select",
    ".path",
    ".markdown code",
    ".markdown pre",
  ]) {
    const families = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).fontFamily),
      );
    expect(families.length).toBeGreaterThan(0);
    expect(
      families.every(
        (value) => value.startsWith("MiSans") || value.startsWith('"MiSans"'),
      ),
    ).toBe(true);
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByText("MiSans 字体许可", { exact: true }).click();
  await expect(page.locator(".font-license")).toContainText(
    "字体知识产权许可协议",
  );
});
