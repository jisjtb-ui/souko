import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { initDb } from './db/database.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const port = Number(process.env['PORT'] ?? 5178);
const dbFile = process.env['DB_FILE'] ?? resolve(repoRoot, 'data/warehouse.db');
const webDist = resolve(repoRoot, 'packages/web/dist');

const db = initDb(dbFile);
const app = createApp(db, { webDist });

app.listen(port, () => {
  console.log(`[warehouse-simulator] API listening on http://localhost:${port}`);
  console.log(`[warehouse-simulator] database: ${dbFile}`);
});
