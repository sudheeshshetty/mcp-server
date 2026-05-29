/**
 * TEMPLATE: MCP tool that calls an external HTTP API.
 *
 * Copy this file to create your own tool:
 *   1. Rename file and function (e.g. my-api.ts, registerMyTool)
 *   2. Change tool name, description, inputSchema (Zod)
 *   3. Implement fetch logic in the handler
 *   4. Register in tools/index.ts
 *
 * Requires optional sample-server: pnpm dev:sample
 * Or set SAMPLE_API_URL to your own API.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';

function sampleApiBase(): string {
  return (process.env.SAMPLE_API_URL ?? 'http://127.0.0.1:9000').replace(/\/+$/, '');
}

async function fetchEmployees(): Promise<unknown> {
  const url = `${sampleApiBase()}/employees/list`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot reach sample API at ${url}. Run: pnpm dev:sample (${msg})`);
  }
  if (!res.ok) {
    throw new Error(
      `Sample API ${res.status} at ${url}. Is sample-server running? (pnpm dev:sample)`,
    );
  }
  return res.json();
}

export function registerListEmployeesTool(server: McpServer): void {
  server.registerTool(
    // Tool name — Llama will see this in the tool list
    'list_employees',
    {
      // When the model should call this tool
      description:
        'List employees from the company directory. Use when the user asks who works here, team members, or staff list.',
      // Zod schema for arguments (empty = no inputs)
      inputSchema: z.object({}),
    },
    // Handler runs on the MCP server when chat-api calls call_tool
    async () => {
      const data = await fetchEmployees();
      const text = JSON.stringify(data, null, 2);
      return {
        content: [{ type: 'text', text }],
      };
    },
  );
}
