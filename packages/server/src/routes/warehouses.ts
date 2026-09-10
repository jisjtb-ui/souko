import { Router } from 'express';
import {
  assignAreaIds,
  assignLocationAreaIds,
  createDefaultProductSizes,
  createDefaultRackTypes,
  createLayout,
  createSampleWarehouse,
  createWarehouse,
  ensureDefaultArea,
  findDuplicateCodes,
  isRackObject,
  locationsToCsv,
  objectsToLayoutCsv,
  totalWarehouseArea,
} from '@ws/shared';
import type {
  Area,
  AreaConnection,
  LayoutObject,
  Location,
  ProductSize,
  RackType,
  Shutter,
  Warehouse,
} from '@ws/shared';
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
        const sample = createSampleWarehouse();
        if (body.name) sample.warehouse.name = body.name;
        repo.insertWarehouse(db, sample.warehouse);
        repo.insertLayout(db, sample.layout);
        repo.replaceLayoutContents(db, sample.layout.id, sample);
        repo.replaceRackTypes(db, sample.warehouse.id, sample.rackTypes);
        repo.replaceProductSizes(db, sample.warehouse.id, sample.productSizes);
        res.status(201).json(repo.getSnapshot(db, sample.layout.id));
        return;
      }

      if (body.widthM !== undefined && body.widthM <= 0) throw badRequest('倉庫の幅は0より大きい値にしてください');
      if (body.depthM !== undefined && body.depthM <= 0) throw badRequest('倉庫の奥行は0より大きい値にしてください');

      const warehouse = createWarehouse(body);
      const layout = createLayout(warehouse.id, { name: 'レイアウトA' });
      repo.insertWarehouse(db, warehouse);
      repo.insertLayout(db, layout);
      // 新規倉庫は「倉庫全体を覆うエリア1つ」から始める
      const areas = ensureDefaultArea(warehouse, layout.id, []);
      repo.replaceLayoutContents(db, layout.id, { objects: [], locations: [], areas });
      repo.replaceRackTypes(db, warehouse.id, createDefaultRackTypes(warehouse.id));
      repo.replaceProductSizes(db, warehouse.id, createDefaultProductSizes(warehouse.id));
      res.status(201).json(repo.getSnapshot(db, layout.id));
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

  /* ラック種別マスタ (小型 / 大型) */
  router.get(
    '/warehouses/:id/rack-types',
    wrap((req, res) => {
      res.json({ rackTypes: repo.listRackTypes(db, req.params.id!) });
    }),
  );

  router.put(
    '/warehouses/:id/rack-types',
    wrap((req, res) => {
      const body = req.body as { rackTypes?: RackType[] };
      if (!Array.isArray(body.rackTypes)) throw badRequest('rackTypes は配列で指定してください');
      res.json({ rackTypes: repo.replaceRackTypes(db, req.params.id!, body.rackTypes) });
    }),
  );

  /* 商品サイズマスタ */
  router.get(
    '/warehouses/:id/product-sizes',
    wrap((req, res) => {
      res.json({ productSizes: repo.listProductSizes(db, req.params.id!) });
    }),
  );

  router.put(
    '/warehouses/:id/product-sizes',
    wrap((req, res) => {
      const body = req.body as { productSizes?: ProductSize[] };
      if (!Array.isArray(body.productSizes)) throw badRequest('productSizes は配列で指定してください');
      res.json({ productSizes: repo.replaceProductSizes(db, req.params.id!, body.productSizes) });
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
      repo.replaceLayoutContents(db, layout.id, {
        objects: [],
        locations: [],
        areas: ensureDefaultArea(warehouse, layout.id, []),
      });
      res.status(201).json(repo.getSnapshot(db, layout.id));
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
        areas?: Area[];
        connections?: AreaConnection[];
        shutters?: Shutter[];
        name?: string;
      };
      if (!Array.isArray(body.objects) || !Array.isArray(body.locations)) {
        throw badRequest('objects と locations は配列で指定してください');
      }

      if (body.warehouse) repo.updateWarehouse(db, layout.warehouseId, body.warehouse);
      if (body.name) repo.updateLayoutMeta(db, layoutId, { name: body.name });

      // エリアが未指定・空の場合は倉庫全体を覆う既定エリアを補う（旧クライアント互換）
      const warehouse = repo.getWarehouse(db, layout.warehouseId)!;
      const areas = ensureDefaultArea(warehouse, layoutId, body.areas ?? []);
      const objects = assignAreaIds(body.objects, areas);
      const locations = assignLocationAreaIds(body.locations, areas, objects);

      repo.replaceLayoutContents(db, layoutId, {
        objects,
        locations,
        areas,
        connections: body.connections ?? [],
        shutters: body.shutters ?? [],
      });

      const snapshot = repo.getSnapshot(db, layoutId)!;
      const duplicates = [...findDuplicateCodes(snapshot.locations).keys()];
      res.json({
        ...snapshot,
        totalAreaM2: totalWarehouseArea(snapshot.areas),
        warnings: duplicates.length > 0 ? { duplicateLocationCodes: duplicates } : undefined,
      });
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
