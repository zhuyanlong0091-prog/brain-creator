// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { capturePageEvidence } from "./pageCapture";

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("capturePageEvidence", () => {
  it("captures DOM text, interactive elements, console errors, and a screenshot", async () => {
    const targetUrl = await serve(`
      <!doctype html>
      <title>Orders Fixture</title>
      <main>
        <h1>Orders</h1>
        <button data-brain-label="create-order">Create Order</button>
        <input aria-label="Search orders" placeholder="Search" />
        <script>console.error("fixture console failure")</script>
      </main>
    `);
    const screenshotDir = await tempDir();

    const result = await capturePageEvidence({ targetUrl, screenshotDir });

    expect(result.title).toBe("Orders Fixture");
    expect(result.finalUrl).toBe(targetUrl);
    expect(result.domText).toContain("Create Order");
    expect(result.interactiveElements.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Create Order", "Search orders"])
    );
    expect(result.consoleErrors).toEqual(expect.arrayContaining(["fixture console failure"]));
    expect(result.issues).toEqual([]);
    expect(existsSync(result.screenshotPath)).toBe(true);
  });

  it("reports an issue when the page has no interactive evidence", async () => {
    const targetUrl = await serve("<!doctype html><title>Empty</title><main>No controls</main>");
    const screenshotDir = await tempDir();

    const result = await capturePageEvidence({ targetUrl, screenshotDir });

    expect(result.interactiveElements).toEqual([]);
    expect(result.issues).toContain("No interactive elements found");
  });

  it("injects token auth when capturing a protected page", async () => {
    const targetUrl = await serveProtectedByToken("private-token");
    const screenshotDir = await tempDir();

    const result = await capturePageEvidence({
      targetUrl,
      screenshotDir,
      auth: {
        loginMethod: "token",
        secrets: {
          token: "private-token"
        }
      }
    });

    expect(result.title).toBe("Private Fixture");
    expect(result.domText).toContain("Private Submit");
    expect(result.interactiveElements.map((item) => item.name)).toContain("Private Submit");
  });
});

async function serve(html: string) {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a port");
  }
  return `http://127.0.0.1:${address.port}/`;
}

async function serveProtectedByToken(expectedToken: string) {
  const server = createServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${expectedToken}`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      authorized
        ? `<!doctype html><title>Private Fixture</title><button data-brain-label="private-submit">Private Submit</button>`
        : `<!doctype html><title>Unauthorized</title><main>Unauthorized</main>`
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a port");
  }
  return `http://127.0.0.1:${address.port}/`;
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-capture-"));
  tempDirs.push(dir);
  return dir;
}
