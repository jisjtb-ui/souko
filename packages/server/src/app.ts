import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { API_VERSION } from '@ws/shared';
import type { Db } from './db/database.js';
import { errorHandler } from './http.js';
import { layoutRoutes, warehouseRoutes } from './routes/warehouses.js';

export interface AppOptions {
  /** ビルド済みフロントエンド (packages/web/dist) を配信する場合のパス */
  webDist?: string;
}

export function createApp(db: Db, options: AppOptions = {}): express.Express {
  const app = express();
  app.use(cors());
  // レイアウト保存はロケーション数が多いと大きくなるため上限を広げる
  app.use(express.json({ limit: '32mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, apiVersion: API_VERSION });
  });

  app.use('/api', warehouseRoutes(db));
  app.use('/api', layoutRoutes(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API エンドポイントが見つかりません' });
  });

  if (options.webDist && existsSync(options.webDist)) {
    app.use(express.static(options.webDist));
    app.get('*', (_req, res) => {
      res.sendFile('index.html', { root: options.webDist! });
    });
  }

  app.use(errorHandler);
  return app;
}
