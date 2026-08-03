import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";
import { BRAIN_CREATOR_VERSION } from "../version.js";
import {
  parseBrainCreatorToolProfile,
  registerBrainCreatorTools,
  type BrainCreatorToolProfile
} from "./tools.js";

export function createBrainCreatorServer(
  profile: BrainCreatorToolProfile = parseBrainCreatorToolProfile(
    process.env.BRAIN_CREATOR_TOOL_PROFILE
  )
) {
  const context = createBrainCreatorMcpContext();
  const server = new McpServer({
    name: "brain-creator",
    version: BRAIN_CREATOR_VERSION
  });

  registerBrainCreatorTools(
    server,
    (name, input) => handleBrainCreatorTool(context, name, input),
    profile
  );

  return server;
}

export async function startBrainCreatorServer() {
  const server = createBrainCreatorServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBrainCreatorServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
