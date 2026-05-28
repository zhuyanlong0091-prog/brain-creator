import { beforeEach, describe, expect, it } from "vitest";
import { resetBrainCreatorService } from "./singleton";
import { POST as createAuthProfile } from "../../app/api/auth-profiles/route";
import { POST as verifyAuthProfile } from "../../app/api/auth-profiles/[id]/verify/route";
import { POST as discoverPageModel } from "../../app/api/page-models/discover/route";
import { POST as createTrainingSession } from "../../app/api/training-sessions/route";
import { POST as completeTrainingSession } from "../../app/api/training-sessions/[id]/complete/route";
import { POST as generateCase } from "../../app/api/generated-cases/route";
import { GET as searchAssets } from "../../app/api/assets/search/route";
import { POST as resolveGap } from "../../app/api/gaps/[id]/resolve/route";

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

  it("discovers a page model through browser capture mode", async () => {
    const targetUrl = `data:text/html,${encodeURIComponent(`
      <!doctype html>
      <title>Browser API Fixture</title>
      <main>
        <button data-brain-label="create-order">Create Order</button>
        <input aria-label="Search orders" />
      </main>
    `)}`;

    const discovery = await read(
      await discoverPageModel(
        jsonRequest({
          projectId: "project-1",
          route: "/fallback",
          name: "Fallback",
          authProfileId: "auth_1",
          domText: "",
          captureMode: "browser",
          targetUrl
        })
      )
    );

    expect(discovery.success).toBe(true);
    expect(discovery.data.pageModel.name).toBe("Browser API Fixture");
    expect(discovery.data.probeResult.type).toBe("browser-capture");
    expect(discovery.data.locatorPoints.map((point: any) => point.name)).toEqual(
      expect.arrayContaining(["Create Order", "Search orders"])
    );
  });
});
