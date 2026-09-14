import { SIZES, buildWarehouse } from './lib.mjs';

/** ベンチ用の倉庫をAPIへ投入する。 */
const size = process.argv[2] ?? 'medium';
const base = process.env.API ?? 'http://localhost:5178';
const wh = buildWarehouse(SIZES[size]);

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const created = await post('/api/warehouses', {
  name: `ベンチ倉庫(${size})`, widthM: wh.warehouse.widthM, depthM: wh.warehouse.depthM,
  pixelsPerMeter: wh.warehouse.pixelsPerMeter,
});

const layoutId = created.layout.id;
const areas = wh.areas.map((a) => ({ ...a, warehouseId: created.warehouse.id, layoutId }));
const objects = wh.objects.map((o) => ({ ...o, layoutId }));
const locations = wh.locations.map((l) => ({ ...l, layoutId }));

const t0 = performance.now();
const payload = JSON.stringify({ objects, locations, areas, connections: [], shutters: [] });
const res = await fetch(`${base}/api/layouts/${layoutId}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: payload,
});
if (!res.ok) throw new Error(`save: ${res.status} ${await res.text()}`);
const saveMs = performance.now() - t0;

await fetch(`${base}/api/warehouses/${created.warehouse.id}/rack-types`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rackTypes: wh.rackTypes.map((t) => ({ ...t, warehouseId: created.warehouse.id })) }),
});
await fetch(`${base}/api/warehouses/${created.warehouse.id}/product-sizes`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ productSizes: wh.productSizes.map((p) => ({ ...p, warehouseId: created.warehouse.id })) }),
});

console.log(JSON.stringify({
  size, warehouseId: created.warehouse.id, layoutId,
  locations: wh.meta.locationCount, racks: wh.meta.rackCount,
  payloadMB: +(payload.length / 1024 / 1024).toFixed(2), saveMs: Math.round(saveMs),
}));
