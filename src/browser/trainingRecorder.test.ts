// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { recordTrainingEvidence } from "./trainingRecorder";

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

describe("recordTrainingEvidence", () => {
  it("records a browser action with trace, HAR, screenshot, and API requests", async () => {
    const targetUrl = await serveTrainingPage();
    const artifactDir = await tempDir();

    const result = await recordTrainingEvidence({
      targetUrl,
      artifactDir,
      action: {
        type: "click",
        selector: "[data-brain-label=\"private-submit\"]",
        targetLocatorId: "locator_1",
        assertion: "request captured"
      }
    });

    expect(existsSync(result.traceUrl)).toBe(true);
    expect(existsSync(result.harUrl)).toBe(true);
    expect(existsSync(result.screenshotUrl)).toBe(true);
    expect(result.actionSteps[0]).toEqual(
      expect.objectContaining({
        type: "click",
        targetLocatorId: "locator_1",
        assertion: "request captured"
      })
    );
    expect(result.apiRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          status: 201
        })
      ])
    );
  });
});

async function serveTrainingPage() {
  const server = createServer((request, response) => {
    if (request.url === "/api/orders" && request.method === "POST") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <title>Training Fixture</title>
      <button data-brain-label="private-submit">Private Submit</button>
      <script>
        document.querySelector("button").addEventListener("click", () => {
          fetch("/api/orders", { method: "POST" });
        });
      </script>
    `);
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
  const dir = await mkdtemp(join(tmpdir(), "brain-training-"));
  tempDirs.push(dir);
  return dir;
}
