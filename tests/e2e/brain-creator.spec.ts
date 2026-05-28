import { expect, test } from "@playwright/test";

test("runs the Preview-aligned Brain Creator workflow", async ({ page }) => {
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

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Brain Creator" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "工作台" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("定位规则说明")).toBeVisible();

  await page.getByRole("tab", { name: "鉴权管理" }).click();
  await page.getByLabel("项目 ID").fill("project-e2e");
  await page.getByLabel("环境").fill("staging");
  await page.getByLabel("角色").fill("qa-admin");
  await page.getByLabel("登录方式").selectOption("token");
  await page.getByLabel("密钥").fill("local-secret-token");
  await page.getByRole("button", { name: "创建鉴权" }).click();
  await expect(page.getByRole("article", { name: "AuthProfile 结果" })).toContainText("[REDACTED]");
  await page.getByRole("button", { name: "验证鉴权" }).click();
  await expect(page.getByRole("article", { name: "AuthProfile 结果" })).toContainText("succeeded");

  await page.getByRole("tab", { name: "页面建模" }).click();
  await page.getByLabel("页面 Route").fill("/orders");
  await page.getByLabel("页面名称").fill("订单页面");
  await page.getByLabel("采集模式").selectOption("browser");
  await page.getByLabel("目标 URL").fill("http://127.0.0.1:3000/fixtures/model-target");
  await page.getByRole("button", { name: "页面建模" }).click();
  await expect(page.getByRole("article", { name: "PageModel 结果" })).toContainText("真实页面建模 Fixture");
  await expect(page.getByRole("article", { name: "PageModel 结果" })).toContainText(".png");
  await expect(page.getByRole("article", { name: "LocatorPoint 结果" })).toContainText("Create Order");
  await expect(page.getByRole("article", { name: "ProbeResult 结果" })).toContainText("browser-capture");
  await expect(page.getByRole("article", { name: "ProbeResult 结果" })).toContainText("fixture console failure");

  await page.getByRole("tab", { name: "资产管理" }).click();
  await page.getByLabel("资产搜索词").fill("Fixture");
  await page.getByRole("button", { name: "搜索资产" }).click();
  await expect(page.getByRole("region", { name: "资产结果" })).toContainText("page-model");

  await page.getByRole("tab", { name: "训练室" }).click();
  await page.getByRole("button", { name: "创建训练" }).click();
  await expect(page.getByRole("article", { name: "TrainingSession 结果" })).toContainText("running");
  await page.getByRole("button", { name: "完成训练" }).click();
  await expect(page.getByRole("article", { name: "ApiFlow 结果" })).toContainText("/api/orders");

  await page.getByRole("tab", { name: "自然语言用例生成" }).click();
  await page.getByLabel("自然语言需求").fill("Unknown approval path");
  await page.getByRole("button", { name: "生成用例" }).click();
  await expect(page.getByRole("article", { name: "GeneratedCase 结果" })).toContainText("blocked");
  await expect(page.getByRole("article", { name: "Gaps 结果" })).toContainText("No locator evidence");
  await page.getByRole("button", { name: "处理缺口" }).click();
  await expect(page.getByRole("article", { name: "Gaps 结果" })).toContainText("resolved");

  await page.getByRole("tab", { name: "i18n 词根" }).click();
  await page.getByLabel("词根 Key").fill("order.submit");
  await page.getByLabel("中文名称").fill("提交订单");
  await page.getByLabel("英文名称").fill("Submit order");
  await page.getByLabel("别名").fill("Create Order, 下单");
  await page.getByRole("button", { name: "保存词根" }).click();
  await expect(page.getByRole("region", { name: "词根结果" })).toContainText("order.submit");
  await expect(page.getByRole("region", { name: "词根结果" })).toContainText("提交订单");
  await page.getByRole("button", { name: "查询词根" }).click();
  await expect(page.getByRole("region", { name: "词根结果" })).toContainText("Submit order");

  await page.getByRole("tab", { name: "资产管理" }).click();
  await page.getByLabel("资产搜索词").fill("order.submit");
  await page.getByRole("button", { name: "搜索资产" }).click();
  await expect(page.getByRole("region", { name: "资产结果" })).toContainText("glossary-term");

  expect(apiResponses).toContain("POST /api/auth-profiles 200");
  expect(apiResponses.some((item) => /^POST \/api\/auth-profiles\/auth_.+\/verify 200$/.test(item))).toBe(true);
  expect(apiResponses).toContain("POST /api/page-models/discover 200");
  expect(apiResponses).toContain("GET /api/assets/search 200");
  expect(apiResponses).toContain("POST /api/training-sessions 200");
  expect(apiResponses.some((item) => /^POST \/api\/training-sessions\/session_.+\/complete 200$/.test(item))).toBe(true);
  expect(apiResponses).toContain("POST /api/generated-cases 200");
  expect(apiResponses.some((item) => /^POST \/api\/gaps\/gap_.+\/resolve 200$/.test(item))).toBe(true);
  expect(apiResponses).toContain("POST /api/glossary-terms 200");
  expect(consoleErrors).toEqual([]);
});
