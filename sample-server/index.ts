import { config } from 'dotenv';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const EMPLOYEES = [
  { id: '1', name: 'Alex Chen', role: 'Engineer', department: 'Platform' },
  { id: '2', name: 'Jordan Lee', role: 'Designer', department: 'Product' },
  { id: '3', name: 'Sam Rivera', role: 'Manager', department: 'Operations' },
  { id: '4', name: 'Taylor Kim', role: 'Engineer', department: 'Frontend' },
  { id: '5', name: 'Morgan Blake', role: 'Analyst', department: 'Data' },
  { id: '6', name: 'Casey Wong', role: 'Engineer', department: 'Backend' },
  { id: '7', name: 'Riley Patel', role: 'Support', department: 'Customer Success' },
  { id: '8', name: 'Jamie Fox', role: 'Engineer', department: 'Infra' },
  { id: '9', name: 'Quinn Adams', role: 'HR', department: 'People' },
  { id: '10', name: 'Drew Martinez', role: 'Sales', department: 'Revenue' },
];

const app = express();

app.get('/employees/list', (_req, res) => {
  res.json({ employees: EMPLOYEES });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.SAMPLE_PORT ?? 9000);
const server = app.listen(port, '127.0.0.1', () => {
  console.error(`Sample API http://127.0.0.1:${port}/employees/list`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use (EADDRINUSE). ` +
        `Another sample-server may still be running.\n` +
        `  lsof -i :${port}\n` +
        `  kill <PID>\n` +
        `Or set a different SAMPLE_PORT in .env`,
    );
    process.exit(1);
  }
  throw err;
});
