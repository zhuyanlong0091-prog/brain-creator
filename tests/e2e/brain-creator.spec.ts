import { expect, test } from "@playwright/test";

test("runs the local Brain Creator workbench loop", async ({ page }) => {
  const consoleErrors: string[] = [];
  const apiResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      apiResponses.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    }
  });
  const resultCard = (name: string) => page.getByRole("article", { name: `${name} 结果` });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Brain Creator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "配置鉴权" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "自然语言用例生成" })).toBeVisible();

  await page.getByLabel("项目 ID").fill("project-e2e");
  await page.getByLabel("环境").fill("staging");
  await page.getByLabel("角色").fill("qa-admin");
  await page.getByLabel("登录方式").selectOption("token");
  await page.getByLabel("密钥").fill("local-secret-token");
  await page.getByLabel("页面 Route").fill("/orders");
  await page.getByLabel("页面名称").fill("订单页面");
  await page.getByLabel("采集模式").selectOption("browser");
  await page.getByLabel("目标 URL").fill("http://127.0.0.1:3000/fixtures/model-target");
  await page.getByLabel("资产搜索词").fill("Fixture");
  await page.getByLabel("DOM 文本").fill("Create Order Submit Search");
  await page.getByLabel("自然语言需求").fill("Unknown approval path");

  await page.getByRole("button", { name: "创建鉴权" }).click();
  await expect(resultCard("AuthProfile")).toContainText("[REDACTED]");

  await page.getByRole("button", { name: "验证鉴权" }).click();
  await expect(resultCard("AuthProfile")).toContainText("succeeded");

  await page.getByRole("button", { name: "页面建模" }).click();
  await expect(resultCard("PageModel")).toContainText("真实页面建模 Fixture");
  await expect(resultCard("PageModel")).toContainText(".png");
  await expect(resultCard("LocatorPoint")).toContainText("Create Order");
  await expect(resultCard("ProbeResult")).toContainText("browser-capture");
  await expect(resultCard("ProbeResult")).toContainText("fixture console failure");

  await page.getByRole("button", { name: "创建训练" }).click();
  await expect(resultCard("TrainingSession")).toContainText("running");

  await page.getByRole("button", { name: "完成训练" }).click();
  await expect(resultCard("ApiFlow")).toContainText("/api/orders");

  await page.getByRole("button", { name: "生成用例" }).click();
  await expect(resultCard("GeneratedCase")).toContainText("blocked");
  await expect(resultCard("Gaps")).toContainText("No locator evidence");

  await page.getByRole("button", { name: "搜索资产" }).click();
  await expect(resultCard("Assets")).toContainText("page-model");

  await page.getByRole("button", { name: "处理缺口" }).click();
  await expect(resultCard("Gaps")).toContainText("resolved");

  await expect(page.locator(".stat").filter({ hasText: "AuthProfile" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "PageModel" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "LocatorPoint" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "Gap" })).toBeVisible();
  await expect(page.locator(".stat strong").filter({ hasText: "2" })).toBeVisible();
  expect(apiResponses).toContain("POST /api/auth-profiles 200");
  expect(apiResponses.some((item) => /^POST \/api\/auth-profiles\/auth_.+\/verify 200$/.test(item))).toBe(true);
  expect(apiResponses).toContain("POST /api/page-models/discover 200");
  expect(apiResponses).toContain("POST /api/training-sessions 200");
  expect(apiResponses.some((item) => /^POST \/api\/training-sessions\/session_.+\/complete 200$/.test(item))).toBe(true);
  expect(apiResponses).toContain("POST /api/generated-cases 200");
  expect(apiResponses).toContain("GET /api/assets/search 200");
  expect(apiResponses.some((item) => /^POST \/api\/gaps\/gap_.+\/resolve 200$/.test(item))).toBe(true);
  expect(consoleErrors).toEqual([]);
});
