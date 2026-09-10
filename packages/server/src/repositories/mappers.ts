import type {
  Area,
  AreaConnection,
  EmptyRackYardObject,
  InboundGateObject,
  OutboundGateObject,
  AreaKind,
  AreaShapeType,
  ConnectionType,
  ForkliftObject,
  GridSizeM,
  Layout,
  LayoutObject,
  Location,
  Product,
  ProductSize,
  RackCategory,
  RackObject,
  RackType,
  Shutter,
  ShutterState,
  Vec2,
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
    ...(optStr(row['area_id']) ? { areaId: str(row['area_id']) } : {}),
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
  if (kind === 'inbound-gate') {
    return { ...base, kind, inboundGate: props['inboundGate'] } as unknown as LayoutObject;
  }
  if (kind === 'outbound-gate') {
    return { ...base, kind, outboundGate: props['outboundGate'] } as unknown as LayoutObject;
  }
  if (kind === 'empty-rack-yard') {
    return { ...base, kind, emptyRackYard: props['emptyRackYard'] } as unknown as LayoutObject;
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
  if (obj.kind === 'inbound-gate') props['inboundGate'] = (obj as InboundGateObject).inboundGate;
  if (obj.kind === 'outbound-gate') props['outboundGate'] = (obj as OutboundGateObject).outboundGate;
  if (obj.kind === 'empty-rack-yard') {
    props['emptyRackYard'] = (obj as EmptyRackYardObject).emptyRackYard;
  }
  const zone = obj as ZoneObject;

  return {
    id: obj.id,
    layout_id: obj.layoutId,
    area_id: obj.areaId ?? null,
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
    ...(optStr(row['area_id']) ? { areaId: str(row['area_id']) } : {}),
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
    area_id: loc.areaId ?? null,
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

/* --------------------------------------------------------------- エリア */

export function rowToArea(row: Row): Area {
  return {
    id: str(row['id']),
    layoutId: str(row['layout_id']),
    warehouseId: str(row['warehouse_id']),
    name: str(row['name']),
    type: str(row['type'], 'rect') as AreaShapeType,
    kind: str(row['kind'], 'building') as AreaKind,
    polygon: JSON.parse(str(row['polygon'], '[]')) as Vec2[],
    x: num(row['x']),
    y: num(row['y']),
    rotationDeg: num(row['rotation_deg']),
    z: num(row['z']),
    ...(optStr(row['color']) ? { color: str(row['color']) } : {}),
    ...(bool(row['locked']) ? { locked: true } : {}),
    ...(optStr(row['note']) ? { note: str(row['note']) } : {}),
    ...(optStr(row['metadata'])
      ? { metadata: JSON.parse(str(row['metadata'])) as Record<string, unknown> }
      : {}),
  };
}

export function areaToRow(area: Area): Row {
  return {
    id: area.id,
    layout_id: area.layoutId,
    warehouse_id: area.warehouseId,
    name: area.name,
    type: area.type,
    kind: area.kind,
    polygon: JSON.stringify(area.polygon),
    x: area.x,
    y: area.y,
    rotation_deg: area.rotationDeg,
    z: area.z,
    color: area.color ?? null,
    locked: area.locked ? 1 : 0,
    note: area.note ?? null,
    metadata: area.metadata ? JSON.stringify(area.metadata) : null,
  };
}

export function rowToConnection(row: Row): AreaConnection {
  return {
    id: str(row['id']),
    layoutId: str(row['layout_id']),
    warehouseId: str(row['warehouse_id']),
    name: str(row['name']),
    fromAreaId: str(row['from_area_id']),
    toAreaId: str(row['to_area_id']),
    x: num(row['x']),
    y: num(row['y']),
    widthM: num(row['width_m']),
    spanM: num(row['span_m']),
    rotationDeg: num(row['rotation_deg']),
    type: str(row['type'], 'opening') as ConnectionType,
    passable: bool(row['passable']),
  };
}

export function connectionToRow(connection: AreaConnection): Row {
  return {
    id: connection.id,
    layout_id: connection.layoutId,
    warehouse_id: connection.warehouseId,
    name: connection.name,
    from_area_id: connection.fromAreaId,
    to_area_id: connection.toAreaId,
    x: connection.x,
    y: connection.y,
    width_m: connection.widthM,
    span_m: connection.spanM,
    rotation_deg: connection.rotationDeg,
    type: connection.type,
    passable: connection.passable ? 1 : 0,
  };
}

export function rowToShutter(row: Row): Shutter {
  return {
    id: str(row['id']),
    connectionId: str(row['connection_id']),
    name: str(row['name']),
    state: str(row['state'], 'open') as ShutterState,
  };
}

export function shutterToRow(shutter: Shutter, layoutId: string): Row {
  return {
    id: shutter.id,
    connection_id: shutter.connectionId,
    layout_id: layoutId,
    name: shutter.name,
    state: shutter.state,
  };
}

/* ----------------------------------------------------------------- マスタ */

export function rowToRackType(row: Row): RackType {
  return {
    id: str(row['id']),
    warehouseId: str(row['warehouse_id']),
    code: str(row['code']),
    name: str(row['name']),
    category: str(row['category'], 'small') as RackCategory,
    widthM: num(row['width_m']),
    depthM: num(row['depth_m']),
    heightM: num(row['height_m']),
    levels: num(row['levels'], 1),
    unitsPerLevel: num(row['units_per_level'], 1),
    maxUnits: num(row['max_units'], 1),
    maxLoadKg: num(row['max_load_kg']),
    maxStackWhenLoaded: num(row['max_stack_when_loaded'], 1),
    maxStackWhenEmpty: num(row['max_stack_when_empty'], 1),
    ...(optStr(row['color']) ? { color: str(row['color']) } : {}),
  };
}

export function rackTypeToRow(type: RackType): Row {
  return {
    id: type.id,
    warehouse_id: type.warehouseId,
    code: type.code,
    name: type.name,
    category: type.category,
    width_m: type.widthM,
    depth_m: type.depthM,
    height_m: type.heightM,
    levels: type.levels,
    units_per_level: type.unitsPerLevel,
    max_units: type.maxUnits,
    max_load_kg: type.maxLoadKg,
    max_stack_when_loaded: type.maxStackWhenLoaded,
    max_stack_when_empty: type.maxStackWhenEmpty,
    color: type.color ?? null,
  };
}

export function rowToProductSize(row: Row): ProductSize {
  return {
    id: str(row['id']),
    warehouseId: str(row['warehouse_id']),
    code: str(row['code']),
    name: str(row['name']),
    rackCategory: str(row['rack_category'], 'small') as RackCategory,
    unitsPerRack: num(row['units_per_rack'], 1),
    weightPerUnitKg: num(row['weight_per_unit_kg']),
    inboundRatioPct: num(row['inbound_ratio_pct']),
    outboundRatioPct: num(row['outbound_ratio_pct']),
    turnover: str(row['turnover'], 'medium') as ProductSize['turnover'],
    ...(optStr(row['preferred_area_tag']) ? { preferredAreaTag: str(row['preferred_area_tag']) } : {}),
    ...(optStr(row['inbound_gate_object_id'])
      ? { inboundGateObjectId: str(row['inbound_gate_object_id']) }
      : {}),
  };
}

export function productSizeToRow(size: ProductSize): Row {
  return {
    id: size.id,
    warehouse_id: size.warehouseId,
    code: size.code,
    name: size.name,
    rack_category: size.rackCategory,
    units_per_rack: size.unitsPerRack,
    weight_per_unit_kg: size.weightPerUnitKg,
    inbound_ratio_pct: size.inboundRatioPct,
    outbound_ratio_pct: size.outboundRatioPct,
    turnover: size.turnover,
    preferred_area_tag: size.preferredAreaTag ?? null,
    inbound_gate_object_id: size.inboundGateObjectId ?? null,
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
