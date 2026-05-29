/**
 * MCP host agent loop:
 * - Loads tools from MCP server (list_tools)
 * - Sends them to Ollama (Llama)
 * - When Ollama returns tool_calls, runs call_tool on MCP server
 * - Llama writes the final plain-language reply
 */

import { callMcpTool, getOllamaToolsFromMcp } from './mcp-client.js';

const ollamaUrl = () =>
  (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const model = () => (process.env.OLLAMA_MODEL ?? 'llama3.1').trim();

const SYSTEM = `You are a friendly assistant.

Always write a direct reply to the user in the "content" field. Never say "no response needed".

Use list_employees ONLY when the user asks about employees, staff, or team members.
For greetings (hi, hello), thanks, or general chat — reply warmly WITHOUT calling any tool.

After tool results, summarize in plain English. Use ONLY names and facts from the tool JSON — never invent employees or data.`;

const BAD_REPLY =
  /no response is needed|no response needed|do not respond|don't respond|i will not respond|no need to respond|no tools? (are|were) (required|needed)/i;

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

type EmployeeRow = { name?: string; role?: string; department?: string };

/** Format list_employees JSON so the UI always shows real API data, not model guesses. */
export function formatListEmployeesReply(toolContent: string): string | null {
  try {
    const data = JSON.parse(toolContent) as { employees?: EmployeeRow[] };
    const employees = data.employees;
    if (!Array.isArray(employees) || employees.length === 0) return null;

    const lines = employees.map((e, i) => {
      const name = e.name?.trim() || 'Unknown';
      const meta = [e.role, e.department].filter(Boolean).join(', ');
      return meta ? `${i + 1}. ${name} (${meta})` : `${i + 1}. ${name}`;
    });

    return `Here are ${employees.length} employees:\n\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

function isListEmployeesRound(calls: Array<{ function: { name: string } }>): boolean {
  return calls.length > 0 && calls.every((c) => c.function.name === 'list_employees');
}

/**
 * After list_employees runs, always return a host-authored reply (never ask Ollama to
 * interpret tool errors — it often invents "no employees in database").
 */
function finalizeListEmployees(
  calls: Array<{ function: { name: string } }>,
  results: string[],
): string | null {
  if (calls.length !== results.length || !isListEmployeesRound(calls)) return null;

  const errors = results.filter((r) => r.startsWith('Error:'));
  if (errors.length > 0) {
    const detail = errors[0]!.replace(/^Error:\s*/, '');
    return (
      `Could not load the employee directory.\n\n` +
      `${detail}\n\n` +
      `Start the sample API: run \`pnpm dev:sample\` or use \`pnpm dev\` / \`pnpm dev:all\`.`
    );
  }

  const parts = results.map((r) => formatListEmployeesReply(r)).filter(Boolean);
  if (parts.length === results.length) {
    return parts.join('\n\n');
  }

  return (
    `Received employee data but could not parse it. ` +
    `Check that sample-server is running (\`pnpm dev:sample\`).`
  );
}

async function ollamaChat(body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model(), stream: false, ...body }),
    });
  } catch {
    throw new Error(
      `Cannot reach Ollama at ${ollamaUrl()}. Run: ollama serve && ollama pull ${model()}`,
    );
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json()) as {
    message?: {
      content?: string;
      tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
    };
  };
}

async function chatPlain(userMessage: string): Promise<string> {
  const { message } = await ollamaChat({
    messages: [
      {
        role: 'system',
        content: 'You are a friendly assistant. Reply directly and briefly.',
      },
      { role: 'user', content: userMessage },
    ],
  });
  return (message?.content ?? '').trim();
}

export async function chat(userMessage: string): Promise<{ reply: string; toolsUsed: string[] }> {
  const ollamaTools = await getOllamaToolsFromMcp();
  const toolsUsed: string[] = [];
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < 8; round++) {
    const { message } = await ollamaChat({ messages, tools: ollamaTools });
    if (!message) throw new Error('Empty Ollama response');

    const calls = message.tool_calls;
    if (calls?.length) {
      messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls });
      const toolResults: string[] = [];
      for (const { function: fn } of calls) {
        toolsUsed.push(fn.name);
        let text: string;
        try {
          text = await callMcpTool(fn.name, parseArgs(fn.arguments));
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          text = `Error: ${err}`;
        }
        toolResults.push(text);
        // Ollama requires tool_name so the model links results to the call (see docs.ollama.com tool calling).
        messages.push({ role: 'tool', tool_name: fn.name, content: text });
      }

      const employeeReply = finalizeListEmployees(calls, toolResults);
      if (employeeReply) {
        return { reply: employeeReply, toolsUsed };
      }
      continue;
    }

    let reply = (message.content ?? '').trim();
    if (!reply || BAD_REPLY.test(reply)) {
      if (toolsUsed.length > 0) {
        throw new Error('Empty reply from Ollama after tool results');
      }
      reply = await chatPlain(userMessage);
    }
    if (!reply) throw new Error('Empty reply from Ollama');
    return { reply, toolsUsed };
  }

  throw new Error('Too many tool rounds');
}

export async function ollamaUp(): Promise<boolean> {
  try {
    return (await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
