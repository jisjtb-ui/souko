import { createId } from './ids.js';
import type {
  EmptyRackYardConfig,
  InboundGateConfig,
  OutboundGateConfig,
  ProductSize,
  RackCategory,
  RackMixSetting,
  RackType,
  SizeMixEntry,
  TimeBandSetting,
  VolumeClassSetting,
} from './logistics.js';

/** 標準的な時間帯配分（要件の例に合わせた既定値）。 */
export const DEFAULT_TIME_BANDS: TimeBandSetting[] = [
  { from: '08:00', to: '10:00', ratioPct: 15 },
  { from: '10:00', to: '12:00', ratioPct: 25 },
  { from: '12:00', to: '15:00', ratioPct: 20 },
  { from: '15:00', to: '17:00', ratioPct: 40 },
];

/** 出荷ボリューム区分の既定値（小口/中口/大口/特大口）。 */
export const DEFAULT_VOLUME_MIX: VolumeClassSetting[] = [
  { key: 'small', label: '小口', ratioPct: 10, unitsPerOrder: 20 },
  { key: 'medium', label: '中口', ratioPct: 30, unitsPerOrder: 60 },
  { key: 'large', label: '大口', ratioPct: 40, unitsPerOrder: 120 },
  { key: 'xlarge', label: '特大口', ratioPct: 20, unitsPerOrder: 240 },
];

export function createRackMix(smallPct = 50, largePct = 50): RackMixSetting {
  return { smallPct, largePct };
}

/** 小型 / 大型の標準ラック種別を作る。 */
export function createDefaultRackTypes(warehouseId: string): RackType[] {
  return [
    {
      id: createId('rt'),
      warehouseId,
      code: 'SMALL',
      name: '小型ラック',
      category: 'small',
      widthM: 1.2,
      depthM: 1.0,
      heightM: 1.1,
      levels: 3,
      unitsPerLevel: 8,
      maxUnits: 24,
      maxLoadKg: 300,
      maxStackWhenLoaded: 1,
      maxStackWhenEmpty: 6,
      color: '#8fb8e8',
    },
    {
      id: createId('rt'),
      warehouseId,
      code: 'LARGE',
      name: '大型ラック',
      category: 'large',
      widthM: 1.8,
      depthM: 1.2,
      heightM: 1.6,
      levels: 4,
      unitsPerLevel: 10,
      maxUnits: 40,
      maxLoadKg: 800,
      maxStackWhenLoaded: 1,
      maxStackWhenEmpty: 4,
      color: '#5d8fce',
    },
  ];
}

/** タイヤ倉庫を想定した標準的な商品サイズ。 */
export function createDefaultProductSizes(warehouseId: string): ProductSize[] {
  const base = (
    code: string,
    name: string,
    rackCategory: RackCategory,
    unitsPerRack: number,
    weight: number,
    inbound: number,
    outbound: number,
    turnover: ProductSize['turnover'],
    areaTag?: string,
  ): ProductSize => ({
    id: createId('psz'),
    warehouseId,
    code,
    name,
    rackCategory,
    unitsPerRack,
    weightPerUnitKg: weight,
    inboundRatioPct: inbound,
    outboundRatioPct: outbound,
    turnover,
    ...(areaTag ? { preferredAreaTag: areaTag } : {}),
  });

  return [
    base('195/65R15', '195/65R15 小型', 'small', 24, 8.5, 30, 30, 'high', '南側'),
    base('205/60R16', '205/60R16 中型', 'small', 20, 10.5, 40, 40, 'high', '南側'),
    base('225/45R18', '225/45R18 大型', 'large', 32, 12.5, 20, 20, 'medium', '北側'),
    base('265/70R17', '265/70R17 特大', 'large', 24, 18.0, 10, 10, 'low', '北側'),
  ];
}

export function createInboundGateConfig(overrides: Partial<InboundGateConfig> = {}): InboundGateConfig {
  return {
    code: 'IN-GATE',
    dailyVolume: 10000,
    capacityPerHour: 1500,
    concurrentSlots: 2,
    openFrom: '08:00',
    openTo: '17:00',
    timeBands: DEFAULT_TIME_BANDS.map((b) => ({ ...b })),
    sizeMix: [],
    rackMix: createRackMix(60, 40),
    ...overrides,
  };
}

export function createOutboundGateConfig(overrides: Partial<OutboundGateConfig> = {}): OutboundGateConfig {
  return {
    code: 'OUT-GATE',
    dailyVolume: 8000,
    capacityPerHour: 1200,
    concurrentSlots: 2,
    openFrom: '08:00',
    openTo: '17:00',
    volumeMix: DEFAULT_VOLUME_MIX.map((v) => ({ ...v })),
    timeBands: DEFAULT_TIME_BANDS.map((b) => ({ ...b })),
    rackMix: createRackMix(30, 70),
    productSizeIds: [],
    ...overrides,
  };
}

export function createEmptyRackYardConfig(overrides: Partial<EmptyRackYardConfig> = {}): EmptyRackYardConfig {
  return {
    code: 'STACK',
    stackColumns: 4,
    stackRows: 3,
    acceptedCategory: 'both',
    ...overrides,
  };
}

/** 商品サイズ一覧から倉入れ口のサイズ別割合を作る。 */
export function sizeMixFromProductSizes(sizes: readonly ProductSize[]): SizeMixEntry[] {
  return sizes.map((s) => ({ productSizeId: s.id, ratioPct: s.inboundRatioPct }));
}
