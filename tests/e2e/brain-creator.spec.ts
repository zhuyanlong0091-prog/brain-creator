import { expect, test } from "@playwright/test";

test("runs the local Brain Creator workbench loop", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Brain Creator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "配置鉴权" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "自然语言用例生成" })).toBeVisible();

  await page.getByRole("button", { name: "运行本地闭环" }).click();

  await expect(page.locator(".stat").filter({ hasText: "AuthProfile" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "PageModel" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "LocatorPoint" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "Gap" })).toBeVisible();
  await expect(page.locator(".stat strong").filter({ hasText: "3" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
