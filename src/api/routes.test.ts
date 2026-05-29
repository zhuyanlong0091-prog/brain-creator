import { beforeEach, describe, expect, it } from "vitest";
import { resetBrainCreatorService } from "./singleton";
import { POST as createAuthProfile } from "../../app/api/auth-profiles/route";
import { POST as verifyAuthProfile } from "../../app/api/auth-profiles/[id]/verify/route";
import { POST as discoverPageModel } from "../../app/api/page-models/discover/route";
import { POST as createTrainingSession } from "../../app/api/training-sessions/route";
import { POST as completeTrainingSession } from "../../app/api/training-sessions/[id]/complete/route";
import { POST as generateCase } from "../../app/api/generated-cases/route";
import { GET as searchAssets } from "../../app/api/assets/search/route";
import { GET as getAssetDetail } from "../../app/api/assets/detail/route";
import { POST as resolveGap } from "../../app/api/gaps/[id]/resolve/route";
import { GET as listGlossaryTerms, POST as createGlossaryTerm } from "../../app/api/glossary-terms/route";
import { GET as listSystemProfiles, POST as createSystemProfile } from "../../app/api/system-profiles/route";
import { GET as getSystemOverview } from "../../app/api/system-profiles/[id]/overview/route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json"
    }
  });
}

async function read(response: Response) {
  return response.json() as Promise<{
    success: boolean;
    data: any;
    errors: string[];
    traceId: string;
  }>;
}

describe("Brain Creator API routes", () => {
  beforeEach(() => resetBrainCreatorService());

  it("creates and lists business systems as reusable onboarding entries", async () => {
    const created = await read(
      await createSystemProfile(
        jsonRequest({
          name: "Orders Console",
          environment: "staging",
          baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
          defaultLocale: "zh-CN",
          urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
        })
      )
    );
    const listed = await read(await listSystemProfiles(new Request("http://localhost/api/system-profiles")));

    expect(created.success).toBe(true);
    expect(created.data.id).toMatch(/^system_/);
    expect(listed.data).toEqual([
      expect.objectContaining({
        id: created.data.id,
        name: "Orders Console",
        environment: "staging"
      })
    ]);
  });

  it("creates and verifies an auth profile without exposing secrets", async () => {
    const created = await read(
      await createAuthProfile(
        jsonRequest({
          projectId: "project-1",
          env: "test",
          role: "qa",
          loginMethod: "token",
          secrets: { token: "secret" }
        })
      )
    );

    expect(created.success).toBe(true);
    expect(created.data.encryptedSecrets.token).toBe("[REDACTED]");

    const verified = await read(
      await verifyAuthProfile(new Request("http://localhost/api"), {
        params: Promise.resolve({ id: created.data.id })
      })
    );

    expect(verified.data.status).toBe("succeeded");
  });

  it("runs the MVP API flow from page discovery to gap resolution", async () => {
    const auth = await read(
      await createAuthProfile(
        jsonRequest({
          projectId: "project-1",
          env: "test",
          role: "qa",
          loginMethod: "cookie",
          secrets: { cookie: "session=abc" }
        })
      )
    );
    const discovery = await read(
      await discoverPageModel(
        jsonRequest({
          projectId: "project-1",
          route: "/orders",
          name: "Orders",
          authProfileId: auth.data.id,
          domText: "Create Order Submit Search"
        })
      )
    );
    const session = await read(
      await createTrainingSession(
        jsonRequest({
          projectId: "project-1",
          pageModelId: discovery.data.pageModel.id
        })
      )
    );
    const completed = await read(
      await completeTrainingSession(
        jsonRequest({
          actions: [
            {
              type: "click",
              targetLocatorId: discovery.data.locatorPoints[0].id,
              inputValue: "",
              assertion: "form opens"
            }
          ],
          apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }]
        }),
        { params: Promise.resolve({ id: session.data.id }) }
      )
    );
    const generated = await read(
      await generateCase(
        jsonRequest({
          projectId: "project-1",
          sourceRequirement: "Unknown approval path",
          pageModelId: discovery.data.pageModel.id
        })
      )
    );
    const assets = await read(
      await searchAssets(new Request("http://localhost/api/assets/search?projectId=project-1&query=order"))
    );
    const resolved = await read(
      await resolveGap(new Request("http://localhost/api"), {
        params: Promise.resolve({ id: generated.data.gaps[0].id })
      })
    );

    expect(completed.data.apiFlow.requests[0].url).toBe("/api/orders");
    expect(generated.data.status).toBe("blocked");
    expect(assets.data.length).toBeGreaterThan(0);
    expect(resolved.data.status).toBe("resolved");
  });

  it("returns system overview and asset detail for the selected business system", async () => {
    const system = await read(
      await createSystemProfile(
        jsonRequest({
          name: "Orders Console",
          environment: "staging",
          baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
          defaultLocale: "zh-CN",
          urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
        })
      )
    );
    const auth = await read(
      await createAuthProfile(
        jsonRequest({
          projectId: system.data.id,
          env: "staging",
          role: "qa",
          loginMethod: "token",
          secrets: { token: "secret" }
        })
      )
    );
    const discovery = await read(
      await discoverPageModel(
        jsonRequest({
          projectId: system.data.id,
          route: "/orders",
          name: "Orders",
          authProfileId: auth.data.id,
          domText: "Create Order Submit"
        })
      )
    );

    const overview = await read(
      await getSystemOverview(new Request("http://localhost/api"), {
        params: Promise.resolve({ id: system.data.id })
      })
    );
    const detail = await read(
      await getAssetDetail(
        new Request(
          `http://localhost/api/assets/detail?projectId=${system.data.id}&type=page-model&id=${discovery.data.pageModel.id}`
        )
      )
    );

    expect(overview.success).toBe(true);
    expect(overview.data.completeness.pageModeled).toBe(true);
    expect(detail.success).toBe(true);
    expect(detail.data.related.locatorPoints).toHaveLength(2);
  });

  it("rejects unsafe browser capture URLs before opening a browser", async () => {
    const discovery = await read(
      await discoverPageModel(
        jsonRequest({
          projectId: "project-1",
          route: "/fallback",
          name: "Fallback",
          authProfileId: "auth_1",
          domText: "",
          captureMode: "browser",
          targetUrl: "data:text/html,<button>Create Order</button>"
        })
      )
    );

    expect(discovery.success).toBe(false);
    expect(discovery.errors[0]).toContain("Only http and https URLs can be captured");
  });

  it("creates glossary terms and exposes them through asset search", async () => {
    const created = await read(
      await createGlossaryTerm(
        jsonRequest({
          projectId: "project-1",
          key: "order.submit",
          zhCN: "提交订单",
          enUS: "Submit order",
          aliases: ["Create Order"],
          pageScope: "/orders"
        })
      )
    );
    const assets = await read(
      await searchAssets(
        new Request("http://localhost/api/assets/search?projectId=project-1&query=submit")
      )
    );

    expect(created.success).toBe(true);
    expect(created.data.key).toBe("order.submit");
    expect(assets.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "glossary-term" })])
    );
  });

  it("lists glossary terms through the glossary API", async () => {
    await read(
      await createGlossaryTerm(
        jsonRequest({
          projectId: "project-1",
          key: "order.submit",
          zhCN: "提交订单",
          enUS: "Submit order",
          aliases: ["Create Order"],
          pageScope: "/orders"
        })
      )
    );

    const listed = await read(
      await listGlossaryTerms(
        new Request("http://localhost/api/glossary-terms?projectId=project-1&query=Create")
      )
    );

    expect(listed.success).toBe(true);
    expect(listed.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "order.submit" })])
    );
  });
});
