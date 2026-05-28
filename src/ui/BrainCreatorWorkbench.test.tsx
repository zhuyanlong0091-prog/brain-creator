import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainCreatorWorkbench } from "./BrainCreatorWorkbench";

describe("BrainCreatorWorkbench", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the MVP workbench workflow and core operating panels", () => {
    render(<BrainCreatorWorkbench />);

    expect(screen.getByRole("heading", { name: "Brain Creator" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "工作台" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "页面建模" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "训练室" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "自然语言用例生成" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "资产管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "鉴权管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "i18n 词根" })).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("配置鉴权")).toBeInTheDocument();
    expect(screen.getByText("定位规则说明")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行本地闭环" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看资产" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "AuthProfile 结果" })).not.toBeInTheDocument();
  });

  it("switches between Preview modules and creates glossary terms from the i18n view", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === "/api/glossary-terms") {
          return json({
            id: "term_1",
            projectId: "project-1",
            key: "order.submit",
            zhCN: "提交订单",
            enUS: "Submit order",
            aliases: ["Create Order"],
            pageScope: "/orders"
          });
        }
        if (url.startsWith("/api/glossary-terms?")) {
          return json([
            {
              id: "term_1",
              projectId: "project-1",
              key: "order.submit",
              zhCN: "提交订单",
              enUS: "Submit order",
              aliases: ["Create Order"],
              pageScope: "/orders"
            }
          ]);
        }
        if (url.startsWith("/api/assets/search")) {
          return json([{ id: "term_1", type: "glossary-term", label: "order.submit" }]);
        }
        return json(null, false, ["unexpected route"], 404);
      })
    );

    render(<BrainCreatorWorkbench />);

    await user.click(screen.getByRole("tab", { name: "页面建模" }));
    expect(screen.getByLabelText("采集模式")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "ProbeResult 结果" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "资产管理" }));
    expect(screen.getByRole("heading", { name: "资产管理" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "i18n 词根" }));
    await user.clear(screen.getByLabelText("词根 Key"));
    await user.type(screen.getByLabelText("词根 Key"), "order.submit");
    await user.clear(screen.getByLabelText("中文名称"));
    await user.type(screen.getByLabelText("中文名称"), "提交订单");
    await user.clear(screen.getByLabelText("英文名称"));
    await user.type(screen.getByLabelText("英文名称"), "Submit order");
    await user.click(screen.getByRole("button", { name: "保存词根" }));

    await waitFor(() => expect(screen.getByText("order.submit")).toBeInTheDocument());
    expect(screen.getByText("提交订单")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查询词根" }));
    await waitFor(() => expect(screen.getByText("Submit order")).toBeInTheDocument());
  });

  it("runs the real API-backed local loop from the workbench", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const requestBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        calls.push(url);
        if (init?.body) {
          requestBodies.push(JSON.parse(init.body.toString()));
        }
        if (url === "/api/auth-profiles") {
          return json({ id: "auth_1", status: "pending", encryptedSecrets: { token: "[REDACTED]" } });
        }
        if (url === "/api/auth-profiles/auth_1/verify") {
          return json({ id: "auth_1", status: "succeeded", encryptedSecrets: { token: "[REDACTED]" } });
        }
        if (url === "/api/page-models/discover") {
          return json({
            pageModel: { id: "page_1", name: "订单页面", status: "succeeded" },
            locatorPoints: [
              { id: "locator_1", name: "Create Order" },
              { id: "locator_2", name: "Submit" },
              { id: "locator_3", name: "Search" }
            ],
            probeResult: { id: "probe_1", issues: [] }
          });
        }
        if (url === "/api/training-sessions") {
          return json({ id: "session_1", status: "running" });
        }
        if (url === "/api/training-sessions/session_1/complete") {
          return json({
            session: { id: "session_1", status: "succeeded" },
            actionSteps: [{ id: "step_1" }],
            apiFlow: { id: "flow_1", requests: [{ url: "/api/orders" }] }
          });
        }
        if (url === "/api/generated-cases") {
          return json({
            id: "case_1",
            status: "blocked",
            steps: [],
            gaps: [{ id: "gap_1", reason: "No locator evidence can satisfy requirement" }]
          });
        }
        if (url.startsWith("/api/assets/search")) {
          return json([{ id: "page_1", type: "page-model", label: "订单页面" }]);
        }
        if (url === "/api/gaps/gap_1/resolve") {
          return json({ id: "gap_1", status: "resolved" });
        }
        return json(null, false, ["unexpected route"], 404);
      })
    );

    render(<BrainCreatorWorkbench />);

    await user.selectOptions(screen.getByLabelText("采集模式"), "browser");
    await user.clear(screen.getByLabelText("目标 URL"));
    await user.type(screen.getByLabelText("目标 URL"), "http://127.0.0.1:3000/fixtures/model-target");
    await user.click(screen.getByRole("button", { name: "创建鉴权" }));
    await user.click(screen.getByRole("button", { name: "验证鉴权" }));
    await user.click(screen.getByRole("button", { name: "页面建模" }));
    await user.click(screen.getByRole("button", { name: "创建训练" }));
    await user.click(screen.getByRole("button", { name: "完成训练" }));
    await user.click(screen.getByRole("button", { name: "生成用例" }));
    await user.click(screen.getByRole("button", { name: "搜索资产" }));
    await user.click(screen.getByRole("button", { name: "处理缺口" }));

    await waitFor(() => expect(screen.getAllByText(/gap_1/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/resolved/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/page-model/).length).toBeGreaterThan(0);
    expect(calls).toEqual([
      "/api/auth-profiles",
      "/api/auth-profiles/auth_1/verify",
      "/api/page-models/discover",
      "/api/training-sessions",
      "/api/training-sessions/session_1/complete",
      "/api/generated-cases",
      "/api/assets/search?projectId=project-1&query=%E8%AE%A2%E5%8D%95",
      "/api/gaps/gap_1/resolve"
    ]);
    expect(requestBodies).toContainEqual(
      expect.objectContaining({
        captureMode: "browser",
        targetUrl: "http://127.0.0.1:3000/fixtures/model-target"
      })
    );
  });

  it("runs the one-click local loop without losing upstream API results", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        calls.push(url);
        if (url === "/api/auth-profiles") {
          return json({ id: "auth_1", status: "pending", encryptedSecrets: { token: "[REDACTED]" } });
        }
        if (url === "/api/auth-profiles/auth_1/verify") {
          return json({ id: "auth_1", status: "succeeded", encryptedSecrets: { token: "[REDACTED]" } });
        }
        if (url === "/api/page-models/discover") {
          return json({
            pageModel: { id: "page_1", name: "订单页面", status: "succeeded" },
            locatorPoints: [{ id: "locator_1", name: "Create Order" }],
            probeResult: { id: "probe_1", issues: [] }
          });
        }
        if (url === "/api/training-sessions") {
          return json({ id: "session_1", status: "running" });
        }
        if (url === "/api/training-sessions/session_1/complete") {
          return json({
            session: { id: "session_1", status: "succeeded" },
            actionSteps: [{ id: "step_1" }],
            apiFlow: { id: "flow_1", requests: [{ url: "/api/orders" }] }
          });
        }
        if (url === "/api/generated-cases") {
          return json({
            id: "case_1",
            status: "blocked",
            steps: [],
            gaps: [{ id: "gap_1", reason: "No locator evidence can satisfy requirement" }]
          });
        }
        if (url.startsWith("/api/assets/search")) {
          return json([{ id: "page_1", type: "page-model", label: "订单页面" }]);
        }
        return json(null, false, ["unexpected route"], 404);
      })
    );

    render(<BrainCreatorWorkbench />);

    await user.click(screen.getByRole("button", { name: "运行本地闭环" }));

    await waitFor(() => expect(screen.getByText(/flow_1/)).toBeInTheDocument());
    expect(screen.getAllByText(/gap_1/).length).toBeGreaterThan(0);
    expect(calls).toEqual([
      "/api/auth-profiles",
      "/api/auth-profiles/auth_1/verify",
      "/api/page-models/discover",
      "/api/training-sessions",
      "/api/training-sessions/session_1/complete",
      "/api/generated-cases",
      "/api/assets/search?projectId=project-1&query=%E8%AE%A2%E5%8D%95"
    ]);
  });
});

function json(data: unknown, success = true, errors: string[] = [], status = 200) {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        success,
        data,
        errors,
        traceId: "test-trace"
      }),
      { status }
    )
  );
}
