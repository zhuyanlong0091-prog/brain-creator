// @vitest-environment node

import { describe, expect, it } from "vitest";
import { recoverBrowserSurface } from "./browserSurface.js";

describe("browser surface recovery", () => {
  const documentSurface = {
    kind: "document" as const,
    url: "https://system.example/app",
    parentUrl: "https://system.example/app"
  };

  it("recovers an allowed child surface without falling back to the main document", async () => {
    const calls: string[] = [];
    const result = await recoverBrowserSurface({
      surface: {
        kind: "iframe",
        url: "https://system.example/embedded",
        parentUrl: documentSurface.url,
        frameIndex: 1
      },
      currentUrl: documentSurface.url,
      allowedUrls: ["https://system.example/"],
      maxAttempts: 2,
      operations: {
        recoverIframe: async () => {
          calls.push("iframe");
          return { status: "recovered", url: "https://system.example/embedded" };
        },
        recoverDocument: async () => {
          calls.push("document");
          return { status: "recovered", url: documentSurface.url };
        }
      }
    });

    expect(result.status).toBe("recovered");
    expect(result.surface?.kind).toBe("iframe");
    expect(calls).toEqual(["iframe"]);
  });

  it("blocks a cross-origin surface and never hides it as a main-document recovery", async () => {
    const calls: string[] = [];
    const result = await recoverBrowserSurface({
      surface: {
        kind: "iframe",
        url: "https://identity.example/login",
        parentUrl: documentSurface.url,
        frameIndex: 0
      },
      currentUrl: documentSurface.url,
      allowedUrls: ["https://system.example/"],
      operations: {
        recoverIframe: async () => {
          calls.push("iframe");
          return { status: "recovered", url: "https://identity.example/login" };
        },
        recoverDocument: async () => {
          calls.push("document");
          return { status: "recovered", url: documentSurface.url };
        }
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("allowlist");
    expect(result.gapRequired).toBe(true);
    expect(calls).toEqual([]);
  });

  it("returns failed after the bounded recovery budget is exhausted", async () => {
    let attempts = 0;
    const result = await recoverBrowserSurface({
      surface: documentSurface,
      currentUrl: documentSurface.url,
      allowedUrls: ["https://system.example/"],
      maxAttempts: 2,
      operations: {
        recoverDocument: async () => {
          attempts += 1;
          return { status: "failed", reason: "page closed" };
        }
      }
    });

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
    expect(result.gapRequired).toBe(true);
  });
});
