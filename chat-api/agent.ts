/**
 * MCP host agent loop:
 * - Loads tools from MCP server (list_tools)
 * - Sends every user message to Ollama with those tools available
 * - When Ollama returns tool_calls, runs call_tool on MCP server
 * - Returns Llama's final plain-language reply
 */

import { callMcpTool, getOllamaToolsFromMcp } from './mcp-client.js';

const ollamaUrl = () =>
  (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const model = () => (process.env.OLLAMA_MODEL ?? 'llama3.1').trim();

const SYSTEM = `You are a friendly assistant.

Always write a direct reply to the user in the "content" field when you are not calling tools.

When the user's question needs data from a tool, call the appropriate tool. After tool results arrive, summarize for the user in plain language using only facts from those results.

Never put tool-call JSON in "content". Use the tool-calling API for tools.`;

const BAD_REPLY =
  /no response is needed|no response needed|do not respond|don't respond|i will not respond|no need to respond|no tools? (are|were) (required|needed)/i;

type OllamaToolCall = { function: { name: string; arguments: unknown } };

/** Llama sometimes emits tool JSON in content instead of tool_calls. */
export function looksLikeToolJsonInContent(content: string): boolean {
  const t = content.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    const parsed: unknown = JSON.parse(t);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        'name' in item &&
        ('parameters' in item || 'arguments' in item),
    );
  } catch {
    return false;
  }
}

export function parseToolCallsFromContent(content: string | undefined): OllamaToolCall[] {
  if (!content?.trim() || !looksLikeToolJsonInContent(content)) return [];
  try {
    const parsed: unknown = JSON.parse(content.trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string',
      )
      .map((item) => ({
        function: {
          name: String(item.name),
          arguments: item.parameters ?? item.arguments ?? {},
        },
      }));
  } catch {
    return [];
  }
}

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

function mergeToolCalls(
  fromApi: OllamaToolCall[] | undefined,
  fromContent: OllamaToolCall[],
): OllamaToolCall[] {
  const seen = new Set<string>();
  const merged: OllamaToolCall[] = [];
  for (const call of [...(fromApi ?? []), ...fromContent]) {
    const key = `${call.function.name}:${JSON.stringify(call.function.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(call);
  }
  return merged;
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
      tool_calls?: OllamaToolCall[];
    };
  };
}

export async function chat(userMessage: string): Promise<{ reply: string; toolsUsed: string[] }> {
  const ollamaTools = await getOllamaToolsFromMcp();
  const knownTools = new Set(ollamaTools.map((t) => t.function.name));
  const toolsUsed: string[] = [];
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < 8; round++) {
    const { message } = await ollamaChat({ messages, tools: ollamaTools });
    if (!message) throw new Error('Empty Ollama response');

    const rawCalls = mergeToolCalls(
      message.tool_calls,
      parseToolCallsFromContent(message.content),
    );
    const calls = rawCalls.filter((c) => knownTools.has(c.function.name));

    if (calls.length > 0) {
      const assistantContent = looksLikeToolJsonInContent(message.content ?? '')
        ? ''
        : (message.content ?? '');
      messages.push({ role: 'assistant', content: assistantContent, tool_calls: calls });

      for (const { function: fn } of calls) {
        toolsUsed.push(fn.name);
        let text: string;
        try {
          text = await callMcpTool(fn.name, parseArgs(fn.arguments));
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          text = `Error: ${err}`;
        }
        messages.push({ role: 'tool', tool_name: fn.name, content: text });
      }
      continue;
    }

    const reply = (message.content ?? '').trim();
    const needsRetry =
      !reply || BAD_REPLY.test(reply) || looksLikeToolJsonInContent(reply);

    if (needsRetry) {
      if (round >= 7) {
        throw new Error('Model returned no usable reply after tool rounds');
      }
      messages.push({ role: 'assistant', content: looksLikeToolJsonInContent(reply) ? '' : reply });
      continue;
    }

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
