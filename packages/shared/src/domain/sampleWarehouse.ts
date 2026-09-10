import {
  assignAreaIds,
  assignLocationAreaIds,
  createArea,
  createConnection,
  createShutter,
} from './areas.js';
import { createLayout, createLayoutObject, createWarehouse } from './factories.js';
import {
  createDefaultProductSizes,
  createDefaultRackTypes,
  createRackMix,
  sizeMixFromProductSizes,
} from './logisticsFactories.js';
import { generateLocationsForRack } from './locations.js';
import { isRackObject } from './types.js';
import type { Area, AreaConnection, Shutter } from './areas.js';
import type { ProductSize, RackType } from './logistics.js';
import type { LayoutObject, LayoutSnapshot, Location, RackObject } from './types.js';

export interface SampleWarehouse extends LayoutSnapshot {
  rackTypes: RackType[];
  productSizes: ProductSize[];
}

/**
 * 初期表示用のサンプル倉庫。
 *
 * 「北側に倉入れ口・南側に出荷ゲート・中央にラック群・中央下に空ラック置き場」
 * という構成で、起動直後からシミュレーションまで試せるようにしてある。
 */
export function createSampleWarehouse(): SampleWarehouse {
  const warehouse = createWarehouse({
    name: 'サンプル倉庫',
    // 敷地サイズ（本棟 60x40 ＋ 東側の増築棟を含む範囲）
    widthM: 84,
    depthM: 42,
    pixelsPerMeter: 14,
    gridSizeM: 1,
    speedLimitKmh: 8,
  });
  const layout = createLayout(warehouse.id, { name: 'レイアウトA' });
  const L = layout.id;
  const rackTypes = createDefaultRackTypes(warehouse.id);
  const productSizes = createDefaultProductSizes(warehouse.id);
  const smallType = rackTypes.find((t) => t.category === 'small')!;
  const largeType = rackTypes.find((t) => t.category === 'large')!;
  const objects: LayoutObject[] = [];

  // --- 北側: 入庫エリアと倉入れ口 -----------------------------------------
  objects.push(
    createLayoutObject({ layoutId: L, kind: 'door', name: '北側 入庫口', x: 6, y: 0, widthM: 5, depthM: 0.4 }),
    createLayoutObject({ layoutId: L, kind: 'inbound-area', name: '入庫エリア', x: 2, y: 1.5, widthM: 14, depthM: 8 }),
    createLayoutObject({ layoutId: L, kind: 'truck-bay', name: '入庫バース', x: 16.2, y: 0.2, widthM: 3.5, depthM: 6 }),
    createLayoutObject({
      layoutId: L,
      kind: 'inbound-gate',
      name: '倉入れ口A',
      x: 4,
      y: 3,
      widthM: 6,
      depthM: 4,
      inboundGate: {
        code: 'IN-A',
        dailyVolume: 3000,
        capacityPerHour: 600,
        concurrentSlots: 2,
        sizeMix: sizeMixFromProductSizes(productSizes),
        rackMix: createRackMix(60, 40),
      },
    }),
  );

  // --- 南側: 出荷エリアと出荷ゲート ---------------------------------------
  objects.push(
    createLayoutObject({ layoutId: L, kind: 'door', name: '南側 出荷口', x: 6, y: 39.6, widthM: 5, depthM: 0.4 }),
    createLayoutObject({ layoutId: L, kind: 'shipping-area', name: '出荷エリア', x: 2, y: 30, widthM: 14, depthM: 8 }),
    createLayoutObject({
      layoutId: L,
      kind: 'outbound-gate',
      name: '出荷ゲートA',
      x: 3,
      y: 31.5,
      widthM: 5,
      depthM: 4,
      outboundGate: {
        code: 'OUT-A',
        dailyVolume: 2000,
        capacityPerHour: 400,
        concurrentSlots: 2,
        rackMix: createRackMix(30, 70),
      },
    }),
    createLayoutObject({
      layoutId: L,
      kind: 'outbound-gate',
      name: '出荷ゲートB',
      x: 9.5,
      y: 31.5,
      widthM: 5,
      depthM: 4,
      outboundGate: {
        code: 'OUT-B',
        dailyVolume: 1000,
        capacityPerHour: 200,
        concurrentSlots: 1,
        rackMix: createRackMix(50, 50),
      },
    }),
    createLayoutObject({ layoutId: L, kind: 'staging-area', name: '出荷待機', x: 2, y: 20, widthM: 8, depthM: 6 }),
  );

  // --- 空ラック置き場 ------------------------------------------------------
  objects.push(
    createLayoutObject({
      layoutId: L,
      kind: 'empty-rack-yard',
      name: '空ラック置き場',
      x: 20,
      y: 26.5,
      widthM: 12,
      depthM: 3.2,
      emptyRackYard: { code: 'STACK', stackColumns: 6, stackRows: 2, acceptedCategory: 'both' },
    }),
  );

  // --- 中央: ラック群 (背中合わせ2列 x 3組) --------------------------------
  // 北側の組は大型ラック、南側の2組は小型ラックを受け入れる。
  const rackAreaCodes = ['A', 'B', 'C', 'D', 'E', 'F'];
  const pairTops = [6, 14, 22];
  let areaIndex = 0;
  for (const [pairIndex, top] of pairTops.entries()) {
    const isNorth = pairIndex === 0;
    const rackType = isNorth ? largeType : smallType;
    for (const [i, y] of [top, top + 1.4].entries()) {
      objects.push(
        createLayoutObject({
          layoutId: L,
          kind: 'rack',
          name: `ラック ${rackAreaCodes[areaIndex]}`,
          x: 20,
          y,
          widthM: 30,
          depthM: 1.2,
          rack: {
            columns: 10,
            levels: 3,
            capacityPerLocation: rackType.maxUnits,
            face: i === 0 ? 'front' : 'back',
            naming: { area: rackAreaCodes[areaIndex]! },
            rackTypeId: rackType.id,
            rackCategory: rackType.category,
            areaTag: isNorth ? '北側' : '南側',
            category: isNorth ? '北側' : '南側',
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
    createLayoutObject({ layoutId: L, kind: 'forklift', name: 'Forklift-03', x: 17, y: 37, forklift: { code: 'Forklift-03' } }),
  );

  // --- 東側: 増築棟 (別エリア) --------------------------------------------
  objects.push(
    createLayoutObject({
      layoutId: L,
      kind: 'rack',
      name: 'ラック G',
      x: 66,
      y: 12,
      widthM: 14,
      depthM: 1.2,
      rack: {
        columns: 6,
        levels: 3,
        capacityPerLocation: smallType.maxUnits,
        face: 'front',
        naming: { area: 'G' },
        rackTypeId: smallType.id,
        rackCategory: smallType.category,
        areaTag: '増築棟',
        category: '増築棟',
      },
    }),
    createLayoutObject({
      layoutId: L,
      kind: 'rack',
      name: 'ラック H',
      x: 66,
      y: 18,
      widthM: 14,
      depthM: 1.2,
      rack: {
        columns: 6,
        levels: 3,
        capacityPerLocation: smallType.maxUnits,
        face: 'back',
        naming: { area: 'H' },
        rackTypeId: smallType.id,
        rackCategory: smallType.category,
        areaTag: '増築棟',
        category: '増築棟',
      },
    }),
    createLayoutObject({
      layoutId: L,
      kind: 'outbound-gate',
      name: '出荷ゲートC',
      x: 68,
      y: 26,
      widthM: 5,
      depthM: 4,
      outboundGate: {
        code: 'OUT-C',
        dailyVolume: 800,
        capacityPerHour: 200,
        concurrentSlots: 1,
        rackMix: createRackMix(70, 30),
      },
    }),
  );

  // --- エリア構成 ----------------------------------------------------------
  // 本棟と、東側に離れて建つ増築棟。両者は接続口（シャッター付き）でつながる。
  const mainArea = createArea({
    warehouseId: warehouse.id,
    layoutId: L,
    name: '本棟',
    x: 0,
    y: 0,
    widthM: 60,
    depthM: 40,
  });
  const annexArea = createArea({
    warehouseId: warehouse.id,
    layoutId: L,
    name: '増築棟',
    kind: 'extension',
    x: 64,
    y: 8,
    widthM: 18,
    depthM: 24,
  });
  const areas: Area[] = [mainArea, annexArea];

  const connection = createConnection({
    warehouseId: warehouse.id,
    layoutId: L,
    name: '本棟⇔増築棟 連絡通路',
    fromAreaId: mainArea.id,
    toAreaId: annexArea.id,
    x: 62,
    y: 20,
    widthM: 5,
    spanM: 6,
    rotationDeg: 90,
    type: 'shutter',
  });
  const connections: AreaConnection[] = [connection];
  const shutters: Shutter[] = [createShutter(connection.id, '連絡通路シャッター')];

  const withAreas = assignAreaIds(objects, areas);
  const locations: Location[] = assignLocationAreaIds(
    withAreas.filter(isRackObject).flatMap((rack: RackObject) => generateLocationsForRack(rack)),
    areas,
    withAreas,
  );

  return {
    warehouse,
    layout,
    areas,
    connections,
    shutters,
    objects: withAreas,
    locations,
    rackTypes,
    productSizes,
  };
}
