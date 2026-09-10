import type {
  ForkliftObject,
  GridSizeM,
  Layout,
  LayoutObject,
  Location,
  Product,
  RackObject,
  TurnoverClass,
  Warehouse,
  ZoneObject,
} from '@ws/shared';

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : Number(v ?? fallback) || fallback);
const bool = (v: unknown): boolean => num(v) !== 0;
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function rowToWarehouse(row: Row): Warehouse {
  return {
    id: str(row['id']),
    name: str(row['name']),
    widthM: num(row['width_m']),
    depthM: num(row['depth_m']),
    pixelsPerMeter: num(row['pixels_per_meter'], 8),
    gridSizeM: num(row['grid_size_m'], 1) as GridSizeM,
    speedLimitKmh: num(row['speed_limit_kmh'], 8),
    ...(optStr(row['note']) ? { note: str(row['note']) } : {}),
    createdAt: str(row['created_at']),
    updatedAt: str(row['updated_at']),
  };
}

export function rowToLayout(row: Row): Layout {
  return {
    id: str(row['id']),
    warehouseId: str(row['warehouse_id']),
    name: str(row['name']),
    ...(optStr(row['description']) ? { description: str(row['description']) } : {}),
    ...(optStr(row['cloned_from_id']) ? { clonedFromId: str(row['cloned_from_id']) } : {}),
    createdAt: str(row['created_at']),
    updatedAt: str(row['updated_at']),
  };
}

export function rowToLayoutObject(row: Row): LayoutObject {
  const kind = str(row['kind']) as LayoutObject['kind'];
  const base = {
    id: str(row['id']),
    layoutId: str(row['layout_id']),
    name: str(row['name']),
    x: num(row['x']),
    y: num(row['y']),
    widthM: num(row['width_m']),
    depthM: num(row['depth_m']),
    rotationDeg: num(row['rotation_deg']),
    z: num(row['z']),
    ...(bool(row['locked']) ? { locked: true } : {}),
    ...(optStr(row['color']) ? { color: str(row['color']) } : {}),
    ...(optStr(row['note']) ? { note: str(row['note']) } : {}),
  };
  const props = optStr(row['props']) ? (JSON.parse(str(row['props'])) as Record<string, unknown>) : {};

  if (kind === 'rack' || kind === 'shelf') {
    return { ...base, kind, rack: props['rack'] } as RackObject;
  }
  if (kind === 'forklift') {
    return { ...base, kind, forklift: props['forklift'] } as ForkliftObject;
  }
  return {
    ...base,
    kind,
    traversable: bool(row['traversable']),
    ...(bool(row['is_dock_point']) ? { isDockPoint: true } : {}),
  } as ZoneObject;
}

export function layoutObjectToRow(obj: LayoutObject): Row {
  const props: Record<string, unknown> = {};
  if (obj.kind === 'rack' || obj.kind === 'shelf') props['rack'] = (obj as RackObject).rack;
  if (obj.kind === 'forklift') props['forklift'] = (obj as ForkliftObject).forklift;
  const zone = obj as ZoneObject;

  return {
    id: obj.id,
    layout_id: obj.layoutId,
    kind: obj.kind,
    name: obj.name,
    x: obj.x,
    y: obj.y,
    width_m: obj.widthM,
    depth_m: obj.depthM,
    rotation_deg: obj.rotationDeg,
    z: obj.z,
    locked: obj.locked ? 1 : 0,
    color: obj.color ?? null,
    note: obj.note ?? null,
    traversable: typeof zone.traversable === 'boolean' ? (zone.traversable ? 1 : 0) : null,
    is_dock_point: zone.isDockPoint ? 1 : 0,
    props: Object.keys(props).length > 0 ? JSON.stringify(props) : null,
  };
}

export function rowToLocation(row: Row): Location {
  return {
    id: str(row['id']),
    layoutId: str(row['layout_id']),
    rackId: str(row['rack_id']),
    code: str(row['code']),
    column: num(row['column_no']),
    level: num(row['level_no']),
    x: num(row['x']),
    y: num(row['y']),
    approachX: num(row['approach_x']),
    approachY: num(row['approach_y']),
    widthM: num(row['width_m']),
    depthM: num(row['depth_m']),
    capacity: num(row['capacity']),
    ...(optStr(row['category']) ? { category: str(row['category']) } : {}),
    ...(bool(row['blocked']) ? { blocked: true } : {}),
  };
}

export function locationToRow(loc: Location): Row {
  return {
    id: loc.id,
    layout_id: loc.layoutId,
    rack_id: loc.rackId,
    code: loc.code,
    column_no: loc.column,
    level_no: loc.level,
    x: loc.x,
    y: loc.y,
    approach_x: loc.approachX,
    approach_y: loc.approachY,
    width_m: loc.widthM,
    depth_m: loc.depthM,
    capacity: loc.capacity,
    category: loc.category ?? null,
    blocked: loc.blocked ? 1 : 0,
  };
}

export function rowToProduct(row: Row): Product {
  return {
    id: str(row['id']),
    warehouseId: str(row['warehouse_id']),
    code: str(row['code']),
    name: str(row['name']),
    ...(optStr(row['jan_code']) ? { janCode: str(row['jan_code']) } : {}),
    ...(optStr(row['category']) ? { category: str(row['category']) } : {}),
    widthM: num(row['width_m']),
    depthM: num(row['depth_m']),
    heightM: num(row['height_m']),
    weightKg: num(row['weight_kg']),
    turnover: str(row['turnover'], 'medium') as TurnoverClass,
    unitsPerPallet: num(row['units_per_pallet'], 1),
    ...(optStr(row['note']) ? { note: str(row['note']) } : {}),
  };
}
