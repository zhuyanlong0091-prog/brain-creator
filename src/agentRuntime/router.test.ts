import { describe, expect, it } from "vitest";
import { routeIntent } from "./router.js";

describe("routeIntent", () => {
  it("routes Chinese and English system connection requests", () => {
    expect(routeIntent("用 Brain Creator 接入 https://test6-ghr.eminxing.com/index 系统")).toEqual(
      expect.objectContaining({
        intent: "connect_system",
        targetUrl: "https://test6-ghr.eminxing.com/index"
      })
    );

    expect(routeIntent("Use Brain Creator to connect https://orders.example.test")).toEqual(
      expect.objectContaining({
        intent: "connect_system",
        targetUrl: "https://orders.example.test"
      })
    );
  });

  it("routes plan, run, asset, and gap requests without tool-level wording", () => {
    expect(routeIntent("为当前系统生成合同模板测试计划").intent).toBe("generate_plan");
    expect(routeIntent("批准刚才的测试计划").intent).toBe("approve_plan");
    expect(routeIntent("运行已审批的链路").intent).toBe("run_chain");
    expect(routeIntent("查看当前系统资产").intent).toBe("show_assets");
    expect(routeIntent("有哪些未处理 Gap").intent).toBe("show_gaps");
  });
});
