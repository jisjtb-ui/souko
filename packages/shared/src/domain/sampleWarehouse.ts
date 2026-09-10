import { createLayout, createLayoutObject, createWarehouse } from './factories.js';
import { generateLocationsForRack } from './locations.js';
import { isRackObject } from './types.js';
import type { LayoutObject, LayoutSnapshot, Location } from './types.js';

/**
 * 初期表示用のサンプル倉庫。
 *
 * 「北側に入庫口・南側に出荷口・中央にラック群・その間に走行通路」という
 * 一般的な倉庫レイアウトを再現しており、起動直後から操作を試せる。
 */
export function createSampleWarehouse(): LayoutSnapshot {
  const warehouse = createWarehouse({
    name: 'サンプル倉庫',
    widthM: 60,
    depthM: 40,
    pixelsPerMeter: 14,
    gridSizeM: 1,
    speedLimitKmh: 8,
  });
  const layout = createLayout(warehouse.id, { name: 'レイアウトA' });
  const L = layout.id;
  const objects: LayoutObject[] = [];

  // --- 北側: 入庫口 -------------------------------------------------------
  objects.push(
    createLayoutObject({ layoutId: L, kind: 'door', name: '北側 入庫口', x: 6, y: 0, widthM: 5, depthM: 0.4 }),
    createLayoutObject({ layoutId: L, kind: 'inbound-area', name: '入庫エリア', x: 2, y: 1.5, widthM: 14, depthM: 8 }),
    createLayoutObject({ layoutId: L, kind: 'truck-bay', name: '入庫バース', x: 16.2, y: 0.2, widthM: 3.5, depthM: 6 }),
  );

  // --- 南側: 出荷口 -------------------------------------------------------
  objects.push(
    createLayoutObject({ layoutId: L, kind: 'door', name: '南側 出荷口', x: 6, y: 39.6, widthM: 5, depthM: 0.4 }),
    createLayoutObject({ layoutId: L, kind: 'shipping-area', name: '出荷エリア', x: 2, y: 30, widthM: 14, depthM: 8 }),
    createLayoutObject({ layoutId: L, kind: 'staging-area', name: '出荷待機', x: 2, y: 20, widthM: 8, depthM: 6 }),
  );

  // --- 中央: ラック群 (背中合わせ2列 x 3組) --------------------------------
  const areas = ['A', 'B', 'C', 'D', 'E', 'F'];
  const pairTops = [6, 14, 22];
  let areaIndex = 0;
  for (const top of pairTops) {
    for (const [i, y] of [top, top + 1.4].entries()) {
      objects.push(
        createLayoutObject({
          layoutId: L,
          kind: 'rack',
          name: `ラック ${areas[areaIndex]}`,
          x: 20,
          y,
          widthM: 30,
          depthM: 1.2,
          rack: {
            columns: 10,
            levels: 3,
            capacityPerLocation: 120,
            face: i === 0 ? 'front' : 'back',
            naming: { area: areas[areaIndex]! },
          },
        }),
      );
      areaIndex++;
    }
  }

  // --- 構造物・設備 -------------------------------------------------------
  objects.push(
    createLayoutObject({ layoutId: L, kind: 'pillar', name: '柱1', x: 17.5, y: 12, widthM: 0.6, depthM: 0.6 }),
    createLayoutObject({ layoutId: L, kind: 'pillar', name: '柱2', x: 52, y: 26, widthM: 0.6, depthM: 0.6 }),
    createLayoutObject({ layoutId: L, kind: 'pedestrian-area', name: '歩行者通路', x: 55.5, y: 2, widthM: 1.2, depthM: 36 }),
    createLayoutObject({ layoutId: L, kind: 'work-area', name: '検品エリア', x: 44, y: 31, widthM: 10, depthM: 6 }),
    createLayoutObject({ layoutId: L, kind: 'forklift', name: 'Forklift-01', x: 17, y: 32, forklift: { code: 'Forklift-01' } }),
    createLayoutObject({ layoutId: L, kind: 'forklift', name: 'Forklift-02', x: 17, y: 34.5, forklift: { code: 'Forklift-02' } }),
  );

  const locations: Location[] = objects
    .filter(isRackObject)
    .flatMap((rack) => generateLocationsForRack(rack));

  return { warehouse, layout, objects, locations };
}
