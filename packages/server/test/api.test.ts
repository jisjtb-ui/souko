import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createSampleWarehouse, type LayoutSnapshot } from '@ws/shared';
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
