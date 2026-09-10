import { createId } from './ids.js';
import { DEFAULT_NAMING_RULE } from './locations.js';
import { getObjectSpec } from './objectSpecs.js';
import type {
  ForkliftSpec,
  GridSizeM,
  Layout,
  LayoutObject,
  LayoutObjectKind,
  LocationNamingRule,
  RackObject,
  RackSpec,
  SimulationConfig,
  Warehouse,
  ZoneObject,
} from './types.js';

const now = (): string => new Date().toISOString();

export function createWarehouse(input: Partial<Warehouse> = {}): Warehouse {
  return {
    id: input.id ?? createId('wh'),
    name: input.name ?? '新しい倉庫',
    widthM: input.widthM ?? 100,
    depthM: input.depthM ?? 80,
    pixelsPerMeter: input.pixelsPerMeter ?? 8,
    gridSizeM: (input.gridSizeM ?? 1) as GridSizeM,
    speedLimitKmh: input.speedLimitKmh ?? 8,
    ...(input.note ? { note: input.note } : {}),
    createdAt: input.createdAt ?? now(),
    updatedAt: input.updatedAt ?? now(),
  };
}

export function createLayout(warehouseId: string, input: Partial<Layout> = {}): Layout {
  return {
    id: input.id ?? createId('lay'),
    warehouseId,
    name: input.name ?? 'レイアウトA',
    ...(input.description ? { description: input.description } : {}),
    ...(input.clonedFromId ? { clonedFromId: input.clonedFromId } : {}),
    createdAt: input.createdAt ?? now(),
    updatedAt: input.updatedAt ?? now(),
  };
}

export function createNamingRule(area: string, overrides: Partial<LocationNamingRule> = {}): LocationNamingRule {
  return { ...DEFAULT_NAMING_RULE, area, ...overrides };
}

export type RackSpecInput = Partial<Omit<RackSpec, 'naming'>> & { naming?: Partial<LocationNamingRule> };

export function createRackSpec(overrides: RackSpecInput = {}): RackSpec {
  const { naming, ...rest } = overrides;
  return {
    levels: 3,
    columns: 8,
    capacityPerLocation: 100,
    face: 'front',
    ...rest,
    naming: createNamingRule(naming?.area ?? 'A', naming ?? {}),
  };
}

export function createForkliftSpec(overrides: Partial<ForkliftSpec> = {}): ForkliftSpec {
  return {
    code: overrides.code ?? 'Forklift-01',
    maxSpeedKmh: overrides.maxSpeedKmh ?? 8,
    accelMps2: overrides.accelMps2 ?? 0.6,
    decelMps2: overrides.decelMps2 ?? 0.8,
    maxPayloadKg: overrides.maxPayloadKg ?? 1500,
    handlingSeconds: overrides.handlingSeconds ?? 20,
    ...(overrides.color ? { color: overrides.color } : {}),
  };
}

export function createSimulationConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    startTime: '09:00:00',
    tickSeconds: 0.2,
    speedLimitKmh: 8,
    pathGridM: 0.5,
    clearanceM: 0.7,
    slottingStrategy: 'turnover',
    ...overrides,
  };
}

export interface CreateObjectInput {
  layoutId: string;
  kind: LayoutObjectKind;
  x: number;
  y: number;
  widthM?: number;
  depthM?: number;
  rotationDeg?: number;
  name?: string;
  z?: number;
  rack?: RackSpecInput;
  forklift?: Partial<ForkliftSpec>;
}

/** 種別ごとの既定値を適用して配置オブジェクトを生成する。 */
export function createLayoutObject(input: CreateObjectInput): LayoutObject {
  const spec = getObjectSpec(input.kind);
  const base = {
    id: createId(input.kind === 'forklift' ? 'fl' : input.kind === 'rack' ? 'rack' : 'obj'),
    layoutId: input.layoutId,
    name: input.name ?? spec.label,
    x: input.x,
    y: input.y,
    widthM: input.widthM ?? spec.defaultWidthM,
    depthM: input.depthM ?? spec.defaultDepthM,
    rotationDeg: input.rotationDeg ?? 0,
    z: input.z ?? 0,
  };

  if (input.kind === 'rack' || input.kind === 'shelf') {
    const rack: RackObject = {
      ...base,
      kind: input.kind,
      rack: createRackSpec(input.rack ?? {}),
    };
    return rack;
  }

  if (input.kind === 'forklift') {
    return {
      ...base,
      kind: 'forklift',
      forklift: createForkliftSpec(input.forklift ?? {}),
    };
  }

  const zone: ZoneObject = {
    ...base,
    kind: input.kind as ZoneObject['kind'],
    traversable: spec.traversable,
    ...(spec.dockPoint ? { isDockPoint: true } : {}),
  };
  return zone;
}
