#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

const baseUrl = process.env["OFD_API_URL"];
const apiKey = process.env["OFD_API_KEY"];
if (!baseUrl || !apiKey) {
  console.error("OFD_API_URL and OFD_API_KEY are required");
  process.exit(1);
}

// stdout carries the protocol: anything human-readable must go to stderr.
await createMcpServer({ baseUrl, apiKey }).connect(new StdioServerTransport());
console.error(`OpenFrontDesk MCP server ready (${baseUrl})`);
