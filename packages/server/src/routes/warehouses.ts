import { Router } from 'express';
import {
  createLayout,
  createSampleWarehouse,
  createWarehouse,
  findDuplicateCodes,
  isRackObject,
  locationsToCsv,
  objectsToLayoutCsv,
} from '@ws/shared';
import type { LayoutObject, Location, Warehouse } from '@ws/shared';
import type { Db } from '../db/database.js';
import { badRequest, notFound, wrap } from '../http.js';
import * as repo from '../repositories/layoutRepository.js';
import * as products from '../repositories/productRepository.js';

export function warehouseRoutes(db: Db): Router {
  const router = Router();

  /* 倉庫一覧 */
  router.get(
    '/warehouses',
    wrap((_req, res) => {
      res.json({ warehouses: repo.listWarehouses(db) });
    }),
  );

  /**
   * 倉庫を新規作成する。
   * body.sample = true でサンプルレイアウト付きの倉庫を作る。
   */
  router.post(
    '/warehouses',
    wrap((req, res) => {
      const body = req.body as Partial<Warehouse> & { sample?: boolean };

      if (body.sample) {
        const snapshot = createSampleWarehouse();
        if (body.name) snapshot.warehouse.name = body.name;
        repo.insertWarehouse(db, snapshot.warehouse);
        repo.insertLayout(db, snapshot.layout);
        repo.replaceLayoutContents(db, snapshot.layout.id, snapshot.objects, snapshot.locations);
        res.status(201).json(snapshot);
        return;
      }

      if (body.widthM !== undefined && body.widthM <= 0) throw badRequest('倉庫の幅は0より大きい値にしてください');
      if (body.depthM !== undefined && body.depthM <= 0) throw badRequest('倉庫の奥行は0より大きい値にしてください');

      const warehouse = createWarehouse(body);
      const layout = createLayout(warehouse.id, { name: 'レイアウトA' });
      repo.insertWarehouse(db, warehouse);
      repo.insertLayout(db, layout);
      res.status(201).json({ warehouse, layout, objects: [], locations: [] });
    }),
  );

  /* 倉庫詳細 (レイアウト一覧付き) */
  router.get(
    '/warehouses/:id',
    wrap((req, res) => {
      const warehouse = repo.getWarehouse(db, req.params.id!);
      if (!warehouse) throw notFound('倉庫');
      res.json({ warehouse, layouts: repo.listLayouts(db, warehouse.id) });
    }),
  );

  router.patch(
    '/warehouses/:id',
    wrap((req, res) => {
      const updated = repo.updateWarehouse(db, req.params.id!, req.body as Partial<Warehouse>);
      if (!updated) throw notFound('倉庫');
      res.json({ warehouse: updated });
    }),
  );

  router.delete(
    '/warehouses/:id',
    wrap((req, res) => {
      if (!repo.deleteWarehouse(db, req.params.id!)) throw notFound('倉庫');
      res.status(204).end();
    }),
  );

  /* 商品マスタ (Phase 2) */
  router.get(
    '/warehouses/:id/products',
    wrap((req, res) => {
      res.json({ products: products.listProducts(db, req.params.id!) });
    }),
  );

  router.post(
    '/warehouses/:id/products',
    wrap((req, res) => {
      const body = req.body as { products?: unknown };
      const list = Array.isArray(body.products) ? body.products : [req.body];
      const saved = products.saveProducts(db, req.params.id!, list);
      res.status(201).json({ products: saved });
    }),
  );

  return router;
}

export function layoutRoutes(db: Db): Router {
  const router = Router();

  router.get(
    '/layouts/:id',
    wrap((req, res) => {
      const snapshot = repo.getSnapshot(db, req.params.id!);
      if (!snapshot) throw notFound('レイアウト');
      res.json(snapshot);
    }),
  );

  /* 新規レイアウト (レイアウト比較用) */
  router.post(
    '/layouts',
    wrap((req, res) => {
      const body = req.body as { warehouseId?: string; name?: string; cloneFromLayoutId?: string };

      if (body.cloneFromLayoutId) {
        const snapshot = repo.cloneLayout(db, body.cloneFromLayoutId, body.name ?? 'レイアウトB');
        if (!snapshot) throw notFound('複製元レイアウト');
        res.status(201).json(snapshot);
        return;
      }

      if (!body.warehouseId) throw badRequest('warehouseId は必須です');
      const warehouse = repo.getWarehouse(db, body.warehouseId);
      if (!warehouse) throw notFound('倉庫');
      const layout = createLayout(warehouse.id, { name: body.name ?? 'レイアウトB' });
      repo.insertLayout(db, layout);
      res.status(201).json({ warehouse, layout, objects: [], locations: [] });
    }),
  );

  router.patch(
    '/layouts/:id',
    wrap((req, res) => {
      const updated = repo.updateLayoutMeta(db, req.params.id!, req.body as { name?: string });
      if (!updated) throw notFound('レイアウト');
      res.json({ layout: updated });
    }),
  );

  router.delete(
    '/layouts/:id',
    wrap((req, res) => {
      if (!repo.deleteLayout(db, req.params.id!)) throw notFound('レイアウト');
      res.status(204).end();
    }),
  );

  /**
   * レイアウトの保存。エディタの状態 (配置オブジェクト + ロケーション) を丸ごと置き換える。
   * 倉庫サイズなどのメタ情報も同時に更新できる。
   */
  router.put(
    '/layouts/:id',
    wrap((req, res) => {
      const layoutId = req.params.id!;
      const layout = repo.getLayout(db, layoutId);
      if (!layout) throw notFound('レイアウト');

      const body = req.body as {
        warehouse?: Partial<Warehouse>;
        objects?: LayoutObject[];
        locations?: Location[];
        name?: string;
      };
      if (!Array.isArray(body.objects) || !Array.isArray(body.locations)) {
        throw badRequest('objects と locations は配列で指定してください');
      }

      if (body.warehouse) repo.updateWarehouse(db, layout.warehouseId, body.warehouse);
      if (body.name) repo.updateLayoutMeta(db, layoutId, { name: body.name });
      repo.replaceLayoutContents(db, layoutId, body.objects, body.locations);

      const snapshot = repo.getSnapshot(db, layoutId)!;
      const duplicates = [...findDuplicateCodes(snapshot.locations).keys()];
      res.json({ ...snapshot, warnings: duplicates.length > 0 ? { duplicateLocationCodes: duplicates } : undefined });
    }),
  );

  /* CSV エクスポート */
  router.get(
    '/layouts/:id/export',
    wrap((req, res) => {
      const snapshot = repo.getSnapshot(db, req.params.id!);
      if (!snapshot) throw notFound('レイアウト');
      const type = String(req.query['type'] ?? 'locations');

      if (type === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="layout-${snapshot.layout.id}.json"`);
        res.send(JSON.stringify(snapshot, null, 2));
        return;
      }

      const rackNames = new Map(snapshot.objects.filter(isRackObject).map((r) => [r.id, r.name]));
      const csv =
        type === 'objects' ? objectsToLayoutCsv(snapshot.objects) : locationsToCsv(snapshot.locations, rackNames);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-${snapshot.layout.id}.csv"`);
      res.send(csv);
    }),
  );

  return router;
}
