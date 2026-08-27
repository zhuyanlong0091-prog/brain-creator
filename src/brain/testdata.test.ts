import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import {
  InMemoryTestDataProvider,
  TestDataBrainService
} from "./testdata.js";

describe("Testdata Brain", () => {
  it("keeps entity dependencies explicit and executes the provider lifecycle", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const provider = new InMemoryTestDataProvider("fixture-provider");
    const service = new TestDataBrainService(repository, [provider]);

    const employee = await service.create({
      systemId: "system-hr",
      entityType: "employee",
      key: "testperson001",
      values: { name: "testperson001", status: "active" },
      sourceRefs: ["recipe:employee"]
    });
    const offer = await service.create({
      systemId: "system-hr",
      entityType: "offer",
      key: "offer-001",
      values: { employee: employee.reference },
      sourceRefs: ["recipe:offer"]
    });
    service.linkDependency({
      systemId: "system-hr",
      fromReference: offer.reference,
      toReference: employee.reference,
      relation: "requires",
      sourceRefs: ["case:offer-approval"]
    });

    await service.transition({
      systemId: "system-hr",
      reference: offer.reference,
      transition: "approved",
      sourceRefs: ["workflow:offer-approval"]
    });
    const verified = await service.verify({
      systemId: "system-hr",
      reference: offer.reference,
      expected: { status: "approved" },
      sourceRefs: ["assertion:offer-approved"]
    });
    expect(verified.status).toBe("verified");
    expect(service.graph("system-hr").dependencies).toEqual([
      expect.objectContaining({
        fromReference: offer.reference,
        toReference: employee.reference,
        relation: "requires"
      })
    ]);

    await service.cleanup({ systemId: "system-hr", reference: offer.reference, sourceRefs: ["cleanup:offer"] });
    expect(repository.businessEntityInstances.find((item) => item.id === offer.entityId)?.status).toBe("released");
    expect(provider.calls).toEqual(["create", "create", "transition", "verify", "cleanup"]);
  });

  it("rejects cross-system dependencies and missing providers", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new TestDataBrainService(repository, []);
    await expect(service.lookup({ systemId: "system-orders", entityType: "order", key: "order-1" }))
      .rejects.toThrow(/provider/i);
    expect(() => service.linkDependency({
      systemId: "system-orders",
      fromReference: "system-hr:employee:1",
      toReference: "system-orders:order:1",
      relation: "requires",
      sourceRefs: ["case:cross-system"]
    })).toThrow(/same system/i);
  });

  it("rejects dependencies whose entities belong to another system", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const provider = new InMemoryTestDataProvider("fixture-provider");
    const service = new TestDataBrainService(repository, [provider]);
    const employee = await service.create({
      systemId: "system-hr",
      entityType: "employee",
      key: "employee-1"
    });
    const order = await service.create({
      systemId: "system-orders",
      entityType: "order",
      key: "order-1"
    });

    expect(() => service.linkDependency({
      systemId: "system-orders",
      fromReference: order.reference,
      toReference: employee.reference,
      relation: "requires",
      sourceRefs: ["case:cross-system-entity"]
    })).toThrow(/unknown entity|same system/i);
  });
});
