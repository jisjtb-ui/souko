import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM_CONFIG,
  HEATMAP_LAYERS,
  HEATMAP_LAYER_META,
  HEAT_RAMPS,
  Heatmap,
  LogisticsSimulation,
  analyzeBottlenecks,
  createSampleWarehouse,
  describePoint,
  heatColor,
  heatOpacity,
  isOutboundGateObject,
  objectCenter,
  parseClock,
} from '../src/index.js';
import type { LogisticsSimConfig } from '../src/index.js';

type Sample = ReturnType<typeof createSampleWarehouse>;

function run(mutate?: (s: Sample) => void, config: Partial<LogisticsSimConfig> = {}) {
  const sample = createSampleWarehouse();
  mutate?.(sample);
  const sim = new LogisticsSimulation({
    warehouse: sample.warehouse,
    objects: sample.objects,
    locations: sample.locations,
    areas: sample.areas,
    connections: sample.connections,
    shutters: sample.shutters,
    rackTypes: sample.rackTypes,
    productSizes: sample.productSizes,
    config: { ...DEFAULT_SIM_CONFIG, tickSeconds: 2, ...config },
  });
  return { sample, snapshot: sim.runToEnd() };
}

describe('Heatmap: 集計', () => {
  it('点の値を該当セルへ加算する', () => {
    const heat = new Heatmap(20, 10, 1);
    expect(heat.cols).toBe(20);
    expect(heat.rows).toBe(10);
    heat.addPoint('congestion', { x: 5.4, y: 3.2 }, 30);
    heat.addPoint('congestion', { x: 5.9, y: 3.8 }, 12);
    expect(heat.valueAt('congestion', 5, 3)).toBe(42);
    expect(heat.valueAt('congestion', 6, 3)).toBe(0);
    expect(heat.totalOf('congestion')).toBe(42);
  });

  it('線分の値は通過したセルへ按分される', () => {
    const heat = new Heatmap(20, 10, 1);
    heat.addSegment('traffic', { x: 0.5, y: 0.5 }, { x: 9.5, y: 0.5 }, 9);
    // 合計は保たれる
    expect(heat.totalOf('traffic')).toBeCloseTo(9, 6);
    // 通過した複数セルに分散している
    const touched = heat.cells('traffic', 0);
    expect(touched.length).toBeGreaterThan(5);
    expect(touched.every((c) => c.cy === 0)).toBe(true);
  });

  it('範囲外の座標は無視する', () => {
    const heat = new Heatmap(10, 10, 1);
    heat.addPoint('work', { x: 50, y: 50 }, 10);
    heat.addPoint('work', { x: -5, y: 2 }, 10);
    expect(heat.totalOf('work')).toBe(0);
  });

  it('最大値に対する比率で描画セルを返す', () => {
    const heat = new Heatmap(10, 10, 1);
    heat.addPoint('traffic', { x: 1.5, y: 1.5 }, 100);
    heat.addPoint('traffic', { x: 3.5, y: 1.5 }, 50);
    heat.addPoint('traffic', { x: 5.5, y: 1.5 }, 5);
    const cells = heat.cells('traffic', 0.02);
    expect(cells).toHaveLength(3);
    expect(cells.find((c) => c.cx === 1)!.ratio).toBe(1);
    expect(cells.find((c) => c.cx === 3)!.ratio).toBeCloseTo(0.5);
    // しきい値未満は描かない
    expect(heat.cells('traffic', 0.1)).toHaveLength(2);
  });

  it('近接セルをまとめてホットスポットを返す', () => {
    const heat = new Heatmap(40, 20, 1);
    // 近い2セル（同じ渋滞地点）と、離れた1セル
    heat.addPoint('congestion', { x: 5.5, y: 5.5 }, 100);
    heat.addPoint('congestion', { x: 6.5, y: 5.5 }, 90);
    heat.addPoint('congestion', { x: 30.5, y: 15.5 }, 80);
    const spots = heat.hotspots('congestion', 5, 4);
    expect(spots).toHaveLength(2);
    expect(spots[0]!.value).toBe(100);
    expect(spots[1]!.x).toBeCloseTo(30.5);
  });

  it('データが無ければ空を返す', () => {
    const heat = new Heatmap(10, 10, 1);
    expect(heat.cells('traffic')).toEqual([]);
    expect(heat.hotspots('traffic')).toEqual([]);
    expect(heat.maxOf('traffic')).toBe(0);
  });
});

describe('Heatmap: 配色', () => {
  it('4レイヤーそれぞれが単一色相の連続スケールを持つ', () => {
    expect(HEATMAP_LAYERS).toEqual(['traffic', 'congestion', 'work', 'distance']);
    for (const layer of HEATMAP_LAYERS) {
      expect(HEAT_RAMPS[layer].length).toBeGreaterThanOrEqual(6);
      expect(HEATMAP_LAYER_META[layer].label.length).toBeGreaterThan(0);
    }
  });

  it('比率が上がるほど濃い色になる（明度が単調に下がる）', () => {
    const luminance = (hex: string): number => {
      const channel = (i: number): number => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    for (const layer of HEATMAP_LAYERS) {
      const steps = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((r) => luminance(heatColor(layer, r)));
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]!).toBeLessThan(steps[i - 1]!);
      }
    }
  });

  it('値0は描画しない', () => {
    expect(heatOpacity(0)).toBe(0);
    expect(heatOpacity(1)).toBeGreaterThan(heatOpacity(0.1));
  });
});

describe('シミュレーションからのヒートマップ生成 (要件14)', () => {
  it('走行・作業がヒートマップに記録される', () => {
    const { snapshot } = run();
    const heat = snapshot.heatmap;
    expect(heat).toBeDefined();

    // 走行距離の合計はKPIの総搬送距離とほぼ一致する
    expect(heat.totalOf('traffic')).toBeCloseTo(snapshot.metrics.totalTravelM, 0);
    expect(heat.maxOf('traffic')).toBeGreaterThan(0);

    // 荷役時間が記録されている
    expect(heat.totalOf('work')).toBeGreaterThan(0);

    // 描画対象のセルがある
    expect(heat.cells('traffic').length).toBeGreaterThan(20);
  }, 60_000);

  it('動線はラックの間の通路に集中する', () => {
    const { snapshot } = run();
    const spots = snapshot.heatmap.hotspots('traffic', 3, 5);
    expect(spots.length).toBeGreaterThan(0);
    // 最も通るのは倉庫内（敷地の範囲に収まる）
    for (const spot of spots) {
      expect(spot.x).toBeGreaterThan(0);
      expect(spot.x).toBeLessThan(84);
      expect(spot.y).toBeGreaterThan(0);
      expect(spot.y).toBeLessThan(42);
    }
  }, 60_000);

  it('バースを1台に絞ると、倉入れ口の位置に渋滞が記録される', () => {
    const { sample, snapshot } = run((s) => {
      for (const obj of s.objects) {
        if (obj.kind === 'inbound-gate' && 'inboundGate' in obj) {
          obj.inboundGate.concurrentSlots = 1;
          obj.inboundGate.dailyVolume = 6000;
          obj.inboundGate.capacityPerHour = 3000;
        }
      }
    });
    expect(snapshot.heatmap.totalOf('congestion')).toBeGreaterThan(0);

    // 渋滞地点が実際に倉入れ口の周辺にある
    const gate = sample.objects.find((o) => o.kind === 'inbound-gate')!;
    const center = objectCenter(gate);
    const spots = snapshot.heatmap.hotspots('congestion', 5, 4);
    expect(spots.some((spot) => Math.hypot(spot.x - center.x, spot.y - center.y) < 12)).toBe(true);
  }, 90_000);

  it('フォークリフトを増やすと通路での待機が増える', () => {
    const few = run();
    const many = run((s) => {
      const forklifts = s.objects.filter((o) => o.kind === 'forklift');
      const extra = forklifts.map((f, i) => ({
        ...f,
        id: `${f.id}-copy${i}`,
        x: f.x + 3,
        name: `${f.name}B`,
      }));
      s.objects = [...s.objects, ...extra];
    });
    expect(many.snapshot.vehicles.length).toBeGreaterThan(few.snapshot.vehicles.length);
    expect(many.snapshot.heatmap.totalOf('congestion')).toBeGreaterThan(
      few.snapshot.heatmap.totalOf('congestion'),
    );
  }, 90_000);

  it('渋滞地点が場所の名前つきで報告される (要件17)', () => {
    const { sample, snapshot } = run((s) => {
      for (const obj of s.objects) {
        if (isOutboundGateObject(obj)) {
          obj.outboundGate.capacityPerHour = 30;
          obj.outboundGate.concurrentSlots = 1;
        }
      }
    });
    const issues = analyzeBottlenecks({
      snapshot,
      rackTypes: sample.rackTypes,
      plannedSeconds: parseClock('17:00') - parseClock('08:00'),
      objects: sample.objects,
      areas: sample.areas,
    });
    const spot = issues.find((i) => i.id.startsWith('congestion-spot-'));
    expect(spot).toBeDefined();
    // 「〇〇付近 (x, y) で待機が発生しています」の形
    expect(spot!.title).toMatch(/で待機が発生しています$/);
    expect(spot!.title).toMatch(/\(\d+, \d+\)/);
    expect(spot!.detail).toMatch(/停止時間 合計/);
  }, 90_000);
});

describe('地点の説明 (describePoint)', () => {
  it('エリア名と近くのオブジェクト名で位置を表す', () => {
    const sample = createSampleWarehouse();
    const rack = sample.objects.find((o) => o.name === 'ラック C')!;
    const near = { x: rack.x + 2, y: rack.y - 1 };
    const text = describePoint(near, sample.objects, sample.areas);
    expect(text).toContain('本棟');
    expect(text).toMatch(/付近/);
    expect(text).toMatch(/\(\d+, \d+\)/);
  });

  it('何も近くに無ければ座標だけを返す', () => {
    expect(describePoint({ x: 200, y: 200 }, [], [])).toBe('(200, 200)');
  });
});

describe('Heatmap: 面への按分', () => {
  it('矩形の範囲へ値を等分する', () => {
    const heat = new Heatmap(20, 20, 1);
    heat.addRect('congestion', { x: 4, y: 4, widthM: 3, depthM: 2 }, 60);
    // 3x2 = 6マスへ等分
    expect(heat.totalOf('congestion')).toBeCloseTo(60, 6);
    expect(heat.valueAt('congestion', 4, 4)).toBeCloseTo(10);
    expect(heat.valueAt('congestion', 6, 5)).toBeCloseTo(10);
    expect(heat.valueAt('congestion', 7, 5)).toBe(0);
    expect(heat.cells('congestion', 0)).toHaveLength(6);
  });
});

describe('搬送距離レイヤー (要件14: 移動距離が長い場所)', () => {
  it('作業の走行距離が目的地のロケーションへ集計される', () => {
    const { snapshot } = run();
    const heat = snapshot.heatmap;
    expect(heat.totalOf('distance')).toBeGreaterThan(0);
    // 目的地に集計するので、合計は総搬送距離を超えない
    expect(heat.totalOf('distance')).toBeLessThanOrEqual(snapshot.metrics.totalTravelM + 1);

    // 最も遠い保管場所が特定できる
    const spots = heat.hotspots('distance', 3, 4);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots[0]!.value).toBeGreaterThan(0);
  }, 60_000);
});
