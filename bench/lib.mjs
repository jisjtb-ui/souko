import {
  assignAreaIds,
  assignLocationAreaIds,
  createArea,
  createDefaultProductSizes,
  createDefaultRackTypes,
  createLayout,
  createLayoutObject,
  createRackMix,
  createWarehouse,
  generateLocationsForRack,
  isRackObject,
  sizeMixFromProductSizes,
} from '@ws/shared';

/**
 * ベンチマーク用の倉庫を生成する。
 * ラック本数・列数・段数からロケーション数をスケールさせる。
 */
export function buildWarehouse({ rackRows = 6, racksPerRow = 1, columns = 10, levels = 3, forklifts = 3 } = {}) {
  const rackCount = rackRows * racksPerRow;
  // ラック1本あたり 30m、通路 4m を確保した敷地
  const rackWidth = columns * 3;
  const widthM = Math.max(60, 20 + racksPerRow * (rackWidth + 6));
  const depthM = Math.max(40, 12 + rackRows * 4 + 20);

  const warehouse = createWarehouse({ name: 'ベンチ倉庫', widthM, depthM, pixelsPerMeter: 8 });
  const layout = createLayout(warehouse.id, { name: 'レイアウトA' });
  const L = layout.id;
  const rackTypes = createDefaultRackTypes(warehouse.id);
  const productSizes = createDefaultProductSizes(warehouse.id);
  const smallType = rackTypes.find((t) => t.category === 'small');
  const objects = [];

  objects.push(
    createLayoutObject({
      layoutId: L, kind: 'inbound-gate', name: '倉入れ口A', x: 2, y: 2, widthM: 6, depthM: 4,
      inboundGate: {
        code: 'IN-A', dailyVolume: 3000, capacityPerHour: 600, concurrentSlots: 2,
        sizeMix: sizeMixFromProductSizes(productSizes), rackMix: createRackMix(60, 40),
      },
    }),
    createLayoutObject({
      layoutId: L, kind: 'outbound-gate', name: '出荷ゲートA', x: 2, y: depthM - 8, widthM: 6, depthM: 4,
      outboundGate: { code: 'OUT-A', dailyVolume: 3000, capacityPerHour: 800, concurrentSlots: 2, rackMix: createRackMix(50, 50) },
    }),
    createLayoutObject({
      layoutId: L, kind: 'empty-rack-yard', name: '空ラック置き場', x: 10, y: depthM - 8, widthM: 12, depthM: 3.2,
      emptyRackYard: { code: 'STACK', stackColumns: 6, stackRows: 2, acceptedCategory: 'both' },
    }),
  );

  let area = 0;
  for (let row = 0; row < rackRows; row++) {
    for (let col = 0; col < racksPerRow; col++) {
      objects.push(
        createLayoutObject({
          layoutId: L, kind: 'rack', name: `ラック${area}`,
          x: 12 + col * (rackWidth + 6), y: 10 + row * 4, widthM: rackWidth, depthM: 1.2,
          rack: {
            columns, levels, capacityPerLocation: smallType.maxUnits, face: 'front',
            naming: { area: `R${area}`, pattern: '{area}-{column}-{level}', columnDigits: 3 },
            rackTypeId: smallType.id, rackCategory: smallType.category,
          },
        }),
      );
      area++;
    }
  }

  for (let i = 0; i < forklifts; i++) {
    objects.push(
      createLayoutObject({
        layoutId: L, kind: 'forklift', name: `Forklift-${i + 1}`,
        x: 4, y: depthM - 14 - i * 2.5, forklift: { code: `Forklift-${i + 1}` },
      }),
    );
  }

  const areas = [createArea({ warehouseId: warehouse.id, layoutId: L, name: '本棟', x: 0, y: 0, widthM, depthM })];
  const withAreas = assignAreaIds(objects, areas);
  const locations = assignLocationAreaIds(
    withAreas.filter(isRackObject).flatMap((r) => generateLocationsForRack(r)),
    areas,
    withAreas,
  );

  return {
    warehouse, layout, areas, connections: [], shutters: [],
    objects: withAreas, locations, rackTypes, productSizes,
    meta: { rackCount, locationCount: locations.length, widthM, depthM },
  };
}

export const SIZES = {
  small: { rackRows: 6, racksPerRow: 1, columns: 10, levels: 3 },      // ~180 ロケーション
  medium: { rackRows: 20, racksPerRow: 3, columns: 15, levels: 4 },    // ~3,600
  large: { rackRows: 40, racksPerRow: 5, columns: 20, levels: 5 },     // ~20,000
  xlarge: { rackRows: 60, racksPerRow: 8, columns: 25, levels: 5 },    // ~60,000
};

export function measure(label, fn, runs = 1) {
  const times = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { label, median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1), result };
}

export const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`);
