import { test, expect } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

for (const source of ["从技能库", "从本地", "从云端"]) {
  test(`项目内${source}添加时始终绑定所选项目，确认前不部署`, async ({
    page,
  }) => {
    await installBackendFixture(page, { extraProject: true });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^项目/ })
      .click();
    await page.getByRole("button", { name: /第二个项目 D:/ }).click();
    await page.getByRole("button", { name: "添加技能", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "为 第二个项目 添加技能" });
    await picker.getByRole("tab", { name: source, exact: true }).click();
    if (source === "从技能库") {
      await picker.getByRole("button", { name: /rust-async-patterns/ }).click();
      await picker.getByRole("button", { name: "下一步" }).click();
    } else {
      if (source === "从本地")
        await picker.getByRole("button", { name: "选择本地技能" }).click();
      else {
        await picker
          .getByLabel("仓库地址")
          .fill("https://github.com/example/skills");
        await picker.getByRole("button", { name: "查找技能" }).click();
        await picker.getByRole("button", { name: "下载并预览" }).click();
      }
      expect(await invocations(page, "apply_deployment")).toHaveLength(0);
      await page.getByRole("button", { name: "导入并继续" }).click();
    }
    const install = page.getByRole("dialog", {
      name: "添加到项目",
      exact: true,
    });
    await expect(install.getByLabel("目标项目")).toHaveValue("project-second");
    await expect(install.getByLabel("目标项目")).toBeDisabled();
    await install.getByRole("button", { name: "预览变更" }).click();
    expect(
      (await invocations(page, "preview_deployment"))[0].args.projectId,
    ).toBe("project-second");
    expect(await invocations(page, "apply_deployment")).toHaveLength(0);
    await page.getByRole("button", { name: "确认应用", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".project-detail")).toContainText("第二个项目");
    await expect(page.locator(".deployment-row")).toContainText(
      "rust-async-patterns",
    );
  });
}
