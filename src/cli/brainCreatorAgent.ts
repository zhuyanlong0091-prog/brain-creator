#!/usr/bin/env node
import { createBrainCreatorMcpContext } from "../mcp/handlers.js";
import { runBrainCreatorAgent } from "../agentRuntime/runtime.js";

if (
  process.argv[1]?.endsWith("brainCreatorAgent.js") ||
  process.argv[1]?.endsWith("brainCreatorAgent.ts")
) {
  const request = process.argv.slice(2).join(" ").trim();
  if (!request) {
    console.error('Usage: brain-creator-agent "<natural language request>"');
    process.exit(1);
  }
  const context = createBrainCreatorMcpContext();
  runBrainCreatorAgent({
    request,
    repository: context.repository,
    service: context.service,
    workDir: context.workDir
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
