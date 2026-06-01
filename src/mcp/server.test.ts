import { describe, expect, it } from "vitest";
import { createBrainCreatorServer } from "./server.js";

describe("createBrainCreatorServer", () => {
  it("creates a named MCP server instance", () => {
    const server = createBrainCreatorServer();

    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });
});
