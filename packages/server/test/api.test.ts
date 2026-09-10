import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  createArea,
  createConnection,
  createLayoutObject,
  createSampleWarehouse,
  createShutter,
  generateLocationsForRack,
  type LayoutSnapshot,
} from '@ws/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';

let server: Server;
let base = '';

beforeAll(async () => {
  const db = openDatabase(':memory:');
  const app = createApp(db);
  await new Promise<void>((done) => {
    server = app.listen(0, () => done());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const api = async (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

describe('API', () => {
  it('ヘルスチェック', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it('倉庫を作成して読み込める', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: 'テスト倉庫', widthM: 50, depthM: 30 }),
    });
    expect(created.status).toBe(201);
    const snapshot = (await created.json()) as LayoutSnapshot;
    expect(snapshot.warehouse.name).toBe('テスト倉庫');
    expect(snapshot.layout.name).toBe('レイアウトA');

    const list = await (await api('/api/warehouses')).json();
    expect(list.warehouses.some((w: { id: string }) => w.id === snapshot.warehouse.id)).toBe(true);
  });

  it('不正な倉庫サイズを拒否する', async () => {
    const res = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: 'bad', widthM: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('レイアウトを保存して読み込むと配置とロケーションが復元される', async () => {
    const sample = createSampleWarehouse();
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: '保存テスト', widthM: sample.warehouse.widthM, depthM: sample.warehouse.depthM }),
    });
    const { layout } = (await created.json()) as LayoutSnapshot;

    const objects = sample.objects.map((o) => ({ ...o, layoutId: layout.id }));
    const locations = sample.locations.map((l) => ({ ...l, layoutId: layout.id }));

    const saved = await api(`/api/layouts/${layout.id}`, {
      method: 'PUT',
      body: JSON.stringify({ objects, locations }),
    });
    expect(saved.status).toBe(200);

    const loaded = (await (await api(`/api/layouts/${layout.id}`)).json()) as LayoutSnapshot;
    expect(loaded.objects).toHaveLength(objects.length);
    expect(loaded.locations).toHaveLength(locations.length);

    const rack = loaded.objects.find((o) => o.kind === 'rack');
    expect(rack).toBeDefined();
    // ラック固有の設定 (列数・段数・採番ルール) が失われていないこと
    expect(rack && 'rack' in rack ? rack.rack.columns : 0).toBe(10);
    expect(rack && 'rack' in rack ? rack.rack.naming.area : '').toBe('A');

    const loc = loaded.locations.find((l) => l.code === 'A-01-01');
    expect(loc?.approachY).toBeCloseTo(4.8);
  });

  it('ロケーション番号の重複を警告として返す', async () => {
    const created = await api('/api/warehouses', { method: 'POST', body: JSON.stringify({ name: '重複テスト' }) });
    const { layout } = (await created.json()) as LayoutSnapshot;
    const dup = {
      id: 'loc_1',
      layoutId: layout.id,
      rackId: 'rack_1',
      code: 'A-01-01',
      column: 1,
      level: 1,
      x: 1,
      y: 1,
      approachX: 1,
      approachY: 2,
      widthM: 1,
      depthM: 1,
      capacity: 10,
    };
    const res = await api(`/api/layouts/${layout.id}`, {
      method: 'PUT',
      body: JSON.stringify({ objects: [], locations: [dup, { ...dup, id: 'loc_2' }] }),
    });
    const body = await res.json();
    expect(body.warnings.duplicateLocationCodes).toContain('A-01-01');
  });

  it('レイアウトを複製できる (レイアウト比較用)', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: '複製テスト', sample: true }),
    });
    const source = (await created.json()) as LayoutSnapshot;
    expect(source.locations.length).toBeGreaterThan(100);

    const cloned = await api('/api/layouts', {
      method: 'POST',
      body: JSON.stringify({ cloneFromLayoutId: source.layout.id, name: 'レイアウトB' }),
    });
    const clone = (await cloned.json()) as LayoutSnapshot;
    expect(clone.layout.id).not.toBe(source.layout.id);
    expect(clone.layout.clonedFromId).toBe(source.layout.id);
    expect(clone.objects).toHaveLength(source.objects.length);
    // ラックIDが振り直され、ロケーションの参照も付け替わっていること
    const clonedRackIds = new Set(clone.objects.map((o) => o.id));
    expect(clone.locations.every((l) => clonedRackIds.has(l.rackId))).toBe(true);
  });

  it('CSV をエクスポートできる', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: 'CSVテスト', sample: true }),
    });
    const snapshot = (await created.json()) as LayoutSnapshot;

    const csv = await (await api(`/api/layouts/${snapshot.layout.id}/export?type=locations`)).text();
    expect(csv).toContain('ロケーション番号');
    expect(csv).toContain('A-01-01');

    const objectsCsv = await (await api(`/api/layouts/${snapshot.layout.id}/export?type=objects`)).text();
    expect(objectsCsv).toContain('種別');
  });

  it('商品マスタを登録して取得できる', async () => {
    const created = await api('/api/warehouses', { method: 'POST', body: JSON.stringify({ name: '商品テスト' }) });
    const { warehouse } = (await created.json()) as LayoutSnapshot;

    await api(`/api/warehouses/${warehouse.id}/products`, {
      method: 'POST',
      body: JSON.stringify({
        products: [
          { code: 'P-001', name: '商品A', turnover: 'high', weightKg: 12 },
          { code: 'P-002', name: '商品B', turnover: 'low' },
        ],
      }),
    });
    const body = await (await api(`/api/warehouses/${warehouse.id}/products`)).json();
    expect(body.products).toHaveLength(2);
    expect(body.products[0].code).toBe('P-001');
  });

  it('存在しないレイアウトは404', async () => {
    const res = await api('/api/layouts/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('エリア構成 API', () => {
  it('新規倉庫には既定エリアが1つ用意される', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: 'エリアテスト', widthM: 50, depthM: 30 }),
    });
    const snapshot = (await created.json()) as LayoutSnapshot;
    expect(snapshot.areas).toHaveLength(1);
    expect(snapshot.areas[0]?.name).toBe('エリア1');
    expect(snapshot.areas[0]?.polygon).toHaveLength(4);
    expect(snapshot.connections).toEqual([]);
  });

  it('複数エリア・接続口・シャッターを保存して復元できる', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: '複数エリア', widthM: 80, depthM: 40 }),
    });
    const { warehouse, layout } = (await created.json()) as LayoutSnapshot;

    const areaA = createArea({ warehouseId: warehouse.id, layoutId: layout.id, name: 'A棟', x: 0, y: 0, widthM: 30, depthM: 30 });
    const areaB = createArea({
      warehouseId: warehouse.id,
      layoutId: layout.id,
      name: 'L字棟',
      x: 40,
      y: 0,
      polygon: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
    });
    const connection = createConnection({
      warehouseId: warehouse.id,
      layoutId: layout.id,
      fromAreaId: areaA.id,
      toAreaId: areaB.id,
      x: 35,
      y: 10,
      widthM: 5,
      spanM: 12,
      rotationDeg: 90,
      type: 'shutter',
    });
    const shutter = { ...createShutter(connection.id, '連絡シャッター'), state: 'closed' as const };
    const rack = createLayoutObject({ layoutId: layout.id, kind: 'rack', x: 42, y: 2, widthM: 8, depthM: 1.2 });
    const locations = generateLocationsForRack(rack as never);

    const saved = await api(`/api/layouts/${layout.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        objects: [rack],
        locations,
        areas: [areaA, areaB],
        connections: [connection],
        shutters: [shutter],
      }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as LayoutSnapshot & { totalAreaM2: number };
    // 30x30 + L字300 = 1200 ㎡
    expect(savedBody.totalAreaM2).toBeCloseTo(1200, -1);

    const loaded = (await (await api(`/api/layouts/${layout.id}`)).json()) as LayoutSnapshot;
    expect(loaded.areas).toHaveLength(2);
    expect(loaded.areas.find((a) => a.name === 'L字棟')?.polygon).toHaveLength(6);
    expect(loaded.connections).toHaveLength(1);
    expect(loaded.connections[0]?.type).toBe('shutter');
    expect(loaded.shutters).toHaveLength(1);
    expect(loaded.shutters[0]?.state).toBe('closed');
    // ラックとロケーションにエリアが割り当てられている
    expect(loaded.objects[0]?.areaId).toBe(areaB.id);
    expect(loaded.locations.every((l) => l.areaId === areaB.id)).toBe(true);
  });

  it('エリアを持つレイアウトを複製すると参照が付け替わる', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: '複製エリア', sample: true }),
    });
    const source = (await created.json()) as LayoutSnapshot;
    expect(source.areas.length).toBe(2);
    expect(source.connections).toHaveLength(1);

    const cloned = (await (
      await api('/api/layouts', {
        method: 'POST',
        body: JSON.stringify({ cloneFromLayoutId: source.layout.id, name: 'レイアウトB' }),
      })
    ).json()) as LayoutSnapshot;

    expect(cloned.areas).toHaveLength(2);
    const clonedAreaIds = new Set(cloned.areas.map((a) => a.id));
    expect(cloned.areas.every((a) => !source.areas.some((s) => s.id === a.id))).toBe(true);
    expect(clonedAreaIds.has(cloned.connections[0]!.fromAreaId)).toBe(true);
    expect(clonedAreaIds.has(cloned.connections[0]!.toAreaId)).toBe(true);
    expect(cloned.shutters[0]?.connectionId).toBe(cloned.connections[0]?.id);
    // オブジェクトの所属エリアも複製後のIDを指す
    expect(cloned.objects.every((o) => !o.areaId || clonedAreaIds.has(o.areaId))).toBe(true);
  });

  it('ラック種別・商品サイズマスタを保存できる', async () => {
    const created = await api('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify({ name: 'マスタテスト', sample: true }),
    });
    const { warehouse } = (await created.json()) as LayoutSnapshot;

    const types = (await (await api(`/api/warehouses/${warehouse.id}/rack-types`)).json()) as {
      rackTypes: { category: string; maxStackWhenEmpty: number }[];
    };
    expect(types.rackTypes).toHaveLength(2);
    expect(types.rackTypes.find((t) => t.category === 'small')?.maxStackWhenEmpty).toBe(6);
    expect(types.rackTypes.find((t) => t.category === 'large')?.maxStackWhenEmpty).toBe(4);

    const sizes = (await (await api(`/api/warehouses/${warehouse.id}/product-sizes`)).json()) as {
      productSizes: { code: string }[];
    };
    expect(sizes.productSizes.map((s) => s.code)).toContain('195/65R15');
  });
});
