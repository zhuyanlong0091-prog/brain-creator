import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";
import { registerBrainCreatorTools } from "./tools.js";

export function createBrainCreatorServer() {
  const context = createBrainCreatorMcpContext();
  const server = new McpServer({
    name: "brain-creator",
    version: "2.0.2"
  });

  registerBrainCreatorTools(server, (name, input) =>
    handleBrainCreatorTool(context, name, input)
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
