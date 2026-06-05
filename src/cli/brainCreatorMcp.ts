#!/usr/bin/env node
import { startBrainCreatorServer } from "../mcp/server.js";

startBrainCreatorServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
