import { getMcpServerUrl } from '@mcp-chat-template/mcp-server/config';
import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, ollamaUp } from './agent.js';
import { closeMcpClient, connectMcpClient } from './mcp-client.js';

const root = dirname(fileURLToPath(import.meta.url));
config({ path: join(root, '../.env') });

function corsOptions(): cors.CorsOptions {
  const raw = (process.env.CORS_ORIGINS ?? '*').trim();
  if (raw === '*') return { origin: true };
  return { origin: raw.split(',').map((s) => s.trim()) };
}

await connectMcpClient({ retries: 30, retryDelayMs: 500 });

async function warnIfSampleApiDown(): Promise<void> {
  const base = (process.env.SAMPLE_API_URL ?? 'http://127.0.0.1:9000').replace(/\/+$/, '');
  try {
    const ok = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok;
    if (!ok) {
      console.error(`Sample API unhealthy at ${base} — list_employees will fail until you run pnpm dev:sample`);
    }
  } catch {
    console.error(
      `Sample API not reachable at ${base}. Employee tool needs it — run pnpm dev:sample or pnpm dev`,
    );
  }
}
void warnIfSampleApiDown();

const app = express();
app.use(cors(corsOptions()));
app.use(express.json());

const widgetDir = join(root, '../widget/dist');
const widgetJs = join(widgetDir, 'chat-widget.js');
const widgetCss = join(widgetDir, 'widget.css');
if (existsSync(widgetJs)) {
  app.get('/chat-widget.js', (_req, res) => res.sendFile(widgetJs));
  if (existsSync(widgetCss)) {
    app.get('/chat-widget.css', (_req, res) => res.sendFile(widgetCss));
  }
}

app.get('/health', async (_req, res) => {
  let mcpOk = false;
  try {
    await connectMcpClient();
    mcpOk = true;
  } catch {
    mcpOk = false;
  }
  res.json({
    ok: (await ollamaUp()) && mcpOk,
    ollama: await ollamaUp(),
    mcp: mcpOk,
  });
});

app.post('/chat', async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  try {
    res.json(await chat(message));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.CHAT_API_PORT ?? 8787);
const server = app.listen(port, '127.0.0.1', () => {
  console.error(`Chat API http://127.0.0.1:${port}  POST /chat`);
  console.error(`MCP server ${getMcpServerUrl()}`);
  if (existsSync(widgetJs)) {
    console.error(`Widget   http://127.0.0.1:${port}/chat-widget.js`);
  }
});

const shutdown = async () => {
  await closeMcpClient();
  server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
