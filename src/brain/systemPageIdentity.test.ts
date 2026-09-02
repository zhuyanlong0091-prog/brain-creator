import { describe, expect, it, vi } from "vitest";
import type { SystemBrainPage } from "../knowledge/systemBrain.js";
import {
  SystemPageIdentityService,
  canonicalPageIdentityKey,
  pageSemanticRole
} from "./systemPageIdentity.js";

function page(overrides: Partial<SystemBrainPage> = {}): SystemBrainPage {
  return {
    pageModelId: "page-orders-v1",
    name: "订单列表",
    route: "https://example.test/orders?tenant=demo",
    version: 1,
    screenshotId: "shot-orders",
    locatorCount: 1,
    probeIssueCount: 0,
    locators: [],
    probeResultIds: [],
    sourceRefs: ["page-model:page-orders-v1"],
    ...overrides
  };
}

function store() {
  return {
    systemPageIdentities: [],
    persist: vi.fn()
  };
}

describe("System Page Identity", () => {
  it("uses a canonical route identity across query changes and page renames", () => {
    expect(canonicalPageIdentityKey("https://example.test/orders?tenant=one")).toBe(
      canonicalPageIdentityKey("https://example.test/orders?tenant=two")
    );
    expect(canonicalPageIdentityKey("/orders/123/detail")).toBe(
      canonicalPageIdentityKey("/orders/456/detail")
    );
    expect(pageSemanticRole("订单列表")).toBe("list");
    expect(pageSemanticRole("Order details")).toBe("detail");
  });

  it("reuses one identity while advancing the observed page revision", () => {
    const repository = store();
    const service = new SystemPageIdentityService(repository);
    const first = service.sync({
      systemId: "system-orders",
      pages: [page()]
    });
    const second = service.sync({
      systemId: "system-orders",
      pages: [page({
        pageModelId: "page-orders-v2",
        name: "Order list",
        route: "https://example.test/orders?tenant=changed",
        version: 2,
        sourceRefs: ["page-model:page-orders-v2"]
      })]
    });

    expect(first[0].id).toBe(second[0].id);
    expect(second[0]).toEqual(expect.objectContaining({
      latestPageModelId: "page-orders-v2",
      revision: 2,
      status: "candidate"
    }));
    expect(repository.persist).toHaveBeenCalledTimes(2);
  });

  it("confirms only identities represented by the approved snapshot", () => {
    const repository = store();
    const service = new SystemPageIdentityService(repository);
    const identities = service.sync({
      systemId: "system-orders",
      pages: [page(), page({
        pageModelId: "page-order-detail",
        route: "https://example.test/orders/123/detail",
        name: "订单详情",
        version: 1
      })]
    });

    service.confirmSnapshotIdentities({
      systemId: "system-orders",
      assetIdentityKeys: [identities[0].identityKey],
      confirmedBy: "tester"
    });

    expect(repository.systemPageIdentities).toEqual([
      expect.objectContaining({ id: identities[0].id, status: "confirmed" }),
      expect.objectContaining({ id: identities[1].id, status: "candidate" })
    ]);
  });

  it("keeps identity ids unique when two systems expose the same route", () => {
    const repository = store();
    const service = new SystemPageIdentityService(repository);
    const first = service.sync({ systemId: "system-orders", pages: [page()] });
    const second = service.sync({ systemId: "system-billing", pages: [page()] });

    expect(first[0].id).not.toBe(second[0].id);
    expect(repository.systemPageIdentities).toHaveLength(2);
  });
});
