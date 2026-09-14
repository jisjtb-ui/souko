import type { ID } from './ids.js';
import type { Area, AreaConnection, Shutter } from './areas.js';
import type {
  EmptyRackYardConfig,
  InboundGateConfig,
  OutboundGateConfig,
  RackCategory,
} from './logistics.js';

/* ============================================================================
 * 座標系について
 * ----------------------------------------------------------------------------
 * ドメイン層の座標・寸法はすべて「メートル(m)」で保持する。
 * ピクセル変換は表示層(Web)だけが行う (geometry/scale.ts)。
 * 原点は倉庫の左上 (x: 右方向, y: 下方向)。
 * rotationDeg は Konva と同じく (x, y) を中心とした時計回りの回転。
 * ========================================================================== */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  widthM: number;
  depthM: number;
}

export interface Rect extends Vec2, Size {}

/* ---------------------------------------------------------------- Warehouse */

/** グリッド分解能 (m)。表示グリッド兼スナップ単位。 */
export type GridSizeM = 1 | 0.5 | 0.25 | 0.1;

export interface Warehouse {
  id: ID;
  name: string;
  /** 実寸 幅 (m) — 東西方向 */
  widthM: number;
  /** 実寸 奥行 (m) — 南北方向 */
  depthM: number;
  /** 表示縮尺の初期値: 1m = N px */
  pixelsPerMeter: number;
  /** グリッド/スナップ単位 (m) */
  gridSizeM: GridSizeM;
  /** 倉庫内の安全上限速度 (km/h)。超過は違反として記録する。 */
  speedLimitKmh: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------- Layout */

/**
 * レイアウトは倉庫の「配置案」。同一倉庫に複数のレイアウト(A/B)を持たせ、
 * 同じ入出庫データで比較シミュレーションできるようにする (Phase 7)。
 */
export interface Layout {
  id: ID;
  warehouseId: ID;
  name: string;
  description?: string;
  /** 比較のベースにした元レイアウト */
  clonedFromId?: ID;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------ LayoutObject  */

export type LayoutObjectKind =
  | 'rack'
  | 'shelf'
  | 'pillar'
  | 'wall'
  | 'door'
  | 'truck-bay'
  | 'inbound-area'
  | 'shipping-area'
  | 'staging-area'
  | 'work-area'
  | 'pedestrian-area'
  | 'no-entry-area'
  | 'forklift'
  // --- 物流シミュレーション用 ---
  | 'inbound-gate' // 倉入れ口
  | 'outbound-gate' // 出荷ゲート
  | 'empty-rack-yard'; // 空ラック置き場

/** 全配置オブジェクト共通のプロパティ。 */
export interface LayoutObjectBase {
  id: ID;
  layoutId: ID;
  /** 所属エリア。中心座標を含むエリアから自動判定される。 */
  areaId?: ID;
  kind: LayoutObjectKind;
  name: string;
  /** 左上座標 (m) */
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  /** (x, y) を軸とした時計回り回転 (度) */
  rotationDeg: number;
  /** 重なり順 */
  z: number;
  locked?: boolean;
  color?: string;
  note?: string;
}

/** ロケーション採番ルール。 */
export interface LocationNamingRule {
  /**
   * トークン: {area} {column} {level} {depth} {index}
   * 例: "{area}-{column}-{level}" -> "A-01-02"
   */
  pattern: string;
  /** エリア記号 (A, B, ...) */
  area: string;
  columnStart: number;
  columnDigits: number;
  /** 列の採番方向: 左(local -X)から or 右から */
  columnOrder: 'asc' | 'desc';
  levelStart: number;
  levelDigits: number;
  /** 段の採番方向: 下段から or 上段から */
  levelOrder: 'bottom-up' | 'top-down';
}

/** ラックのピッキング面 (どちら側の通路から作業するか)。ラックのローカル座標基準。 */
export type RackFace = 'front' | 'back' | 'both';

/**
 * 自動生成されたロケーション住所であることを示す情報。
 *
 * 住所 "001-1" は「縦の物理列をまとめた1つの保管場所」であり、
 * 物理列そのもの (RackSpec.columns) とは別の概念 として扱う。
 */
export interface LocationBlockRef {
  /** 生成元のロケーショングループ */
  groupId: ID;
  /** ロケーション住所 ("001-1") */
  locationCode: string;
  /** 横方向の位置 (1始まり) */
  blockIndex: number;
  /** この住所には1つの商品サイズだけを入れる */
  singleSize: boolean;
}

export interface RackSpec {
  /** 段数 */
  levels: number;
  /** 列数 (間口数) */
  columns: number;
  /** 1ロケーションあたりの最大収納数 */
  capacityPerLocation: number;
  /** 取扱いカテゴリ (任意) */
  category?: string;
  /** ピッキング面 */
  face: RackFace;
  naming: LocationNamingRule;
  /**
   * この保管ラック構造が受け入れる可搬ラックの種別 (RackType.id)。
   * 未設定なら category で判定し、それも無ければ全種別を受け入れる。
   */
  rackTypeId?: ID;
  /** 受け入れるラックサイズ区分 (rackTypeId 未設定時のフォールバック) */
  rackCategory?: RackCategory;
  /** 優先保管エリアのタグ (商品サイズの preferredAreaTag と突き合わせる) */
  areaTag?: string;
  /**
   * 縦列をどちらの向きに並べるか。
   *   'width' … ラックの横幅を列数で割る（既定・従来どおり）
   *   'depth' … ラックの奥行方向に列を重ねる（自動生成したロケーションブロック）
   */
  columnAxis?: 'width' | 'depth';
  /**
   * 自動生成されたロケーション住所である場合の情報。
   * 住所 "001-1" と、その中の物理列を分けて扱うために使う。
   */
  block?: LocationBlockRef;
  /**
   * 奥行きレーン数。1レーン (= 1列) に何本分の深さがあるか。
   *
   * 未設定は 1 (奥行き方向の段積みなし) として扱う。既存レイアウトは
   * この値を持たないため、従来どおりの挙動になる。
   * 参照は必ず laneDepthOf() を通すこと。
   */
  laneDepth?: number;
}

export interface RackObject extends LayoutObjectBase {
  kind: 'rack' | 'shelf';
  rack: RackSpec;
}

/** ゾーン系 (エリア/壁/柱/出入口など) の追加属性。 */
export interface ZoneObject extends LayoutObjectBase {
  kind: Exclude<
    LayoutObjectKind,
    'rack' | 'shelf' | 'forklift' | 'inbound-gate' | 'outbound-gate' | 'empty-rack-yard'
  >;
  /** 走行可能か (壁・柱・立入禁止は false) */
  traversable: boolean;
  /** 入庫/出荷/一時置きの受け渡し点として使えるか */
  isDockPoint?: boolean;
}

export interface ForkliftObject extends LayoutObjectBase {
  kind: 'forklift';
  forklift: ForkliftSpec;
}

/** 倉入れ口 (入庫ゲート)。 */
export interface InboundGateObject extends LayoutObjectBase {
  kind: 'inbound-gate';
  inboundGate: InboundGateConfig;
}

/** 出荷ゲート。 */
export interface OutboundGateObject extends LayoutObjectBase {
  kind: 'outbound-gate';
  outboundGate: OutboundGateConfig;
}

/** 空ラック置き場。 */
export interface EmptyRackYardObject extends LayoutObjectBase {
  kind: 'empty-rack-yard';
  emptyRackYard: EmptyRackYardConfig;
}

export type GateObject = InboundGateObject | OutboundGateObject;

export type LayoutObject =
  | RackObject
  | ZoneObject
  | ForkliftObject
  | InboundGateObject
  | OutboundGateObject
  | EmptyRackYardObject;

export function isRackObject(o: LayoutObject): o is RackObject {
  return o.kind === 'rack' || o.kind === 'shelf';
}
export function isForkliftObject(o: LayoutObject): o is ForkliftObject {
  return o.kind === 'forklift';
}
export function isInboundGateObject(o: LayoutObject): o is InboundGateObject {
  return o.kind === 'inbound-gate';
}
export function isOutboundGateObject(o: LayoutObject): o is OutboundGateObject {
  return o.kind === 'outbound-gate';
}
export function isEmptyRackYardObject(o: LayoutObject): o is EmptyRackYardObject {
  return o.kind === 'empty-rack-yard';
}
export function isGateObject(o: LayoutObject): o is GateObject {
  return isInboundGateObject(o) || isOutboundGateObject(o);
}
export function isZoneObject(o: LayoutObject): o is ZoneObject {
  return (
    !isRackObject(o) && !isForkliftObject(o) && !isGateObject(o) && !isEmptyRackYardObject(o)
  );
}

/** 既定の奥行きレーン数 (奥行き方向の段積みなし)。 */
export const DEFAULT_LANE_DEPTH = 1;

/**
 * ラックの奥行きレーン数を取得する。
 *
 * laneDepth を持たない既存レイアウトは 1 として扱うため、
 * この関数を通す限り従来の挙動は変わらない。
 */
export function laneDepthOf(rack: RackSpec): number {
  const depth = rack.laneDepth;
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return DEFAULT_LANE_DEPTH;
  return Math.max(DEFAULT_LANE_DEPTH, Math.floor(depth));
}

/* ------------------------------------------------------------------ Location */

export interface Location {
  id: ID;
  layoutId: ID;
  /** 所属エリア（ラックのエリアを継承する） */
  areaId?: ID;
  rackId: ID;
  /** ロケーション番号 (A-01-02 など)。レイアウト内で一意。 */
  code: string;
  column: number;
  level: number;
  /** ロケーション中心のワールド座標 (m) */
  x: number;
  y: number;
  /** フォークリフトが停車する通路側の作業位置 (m) */
  approachX: number;
  approachY: number;
  widthM: number;
  depthM: number;
  /** 最大収納数 */
  capacity: number;
  category?: string;
  blocked?: boolean;
}

/* ------------------------------------------------------------------- Product */

export type TurnoverClass = 'high' | 'medium' | 'low';

export interface Product {
  id: ID;
  warehouseId: ID;
  /** 商品コード (ユーザー入力) */
  code: string;
  name: string;
  janCode?: string;
  category?: string;
  /** 1個あたりの外形 (m) */
  widthM: number;
  depthM: number;
  heightM: number;
  /** 1個あたり重量 (kg) */
  weightKg: number;
  /** 出荷頻度 — 保管場所最適化に使う */
  turnover: TurnoverClass;
  /** 1パレット(1回の荷役)あたりの個数 */
  unitsPerPallet: number;
  note?: string;
}

/* ----------------------------------------------------------------- Inventory */

export interface Inventory {
  id: ID;
  layoutId: ID;
  locationId: ID;
  productId: ID;
  quantity: number;
  /** 入庫日 (ISO) */
  storedAt?: string;
  lotNo?: string;
}

/* ------------------------------------------------------------------ Forklift */

export type ForkliftState =
  | 'idle' // 待機
  | 'moving' // 移動中
  | 'handling' // 荷役中
  | 'carrying' // 搬送中
  | 'charging' // 充電中
  | 'blocked' // 停止(待機/譲り)
  | 'done'; // 作業完了

export interface ForkliftSpec {
  /** 表示・識別用コード (Forklift-01) */
  code: string;
  /** 最大速度 (km/h) */
  maxSpeedKmh: number;
  /** 加速度 (m/s^2) */
  accelMps2: number;
  /** 減速度 (m/s^2) */
  decelMps2: number;
  /** 最大積載重量 (kg) */
  maxPayloadKg: number;
  /** 荷役 (フォーク差込〜持ち上げ) 時間 (秒) */
  handlingSeconds: number;
  /** 車体サイズ (m) は LayoutObjectBase の widthM/depthM を使う */
  color?: string;
}

/** シミュレーション実行時のフォークリフト状態 (永続化はスナップショットのみ)。 */
export interface ForkliftRuntime {
  id: ID;
  code: string;
  x: number;
  y: number;
  /** 車体向き (度, 0 = +X方向) */
  headingDeg: number;
  speedMps: number;
  state: ForkliftState;
  /** 現在の積載重量 (kg) */
  loadKg: number;
  carryingProductId?: ID;
  carryingQty: number;
  currentTaskId?: ID;
  /** 実行中の経路 */
  path?: Path;
  pathIndex: number;
  /** 累積指標 */
  travelledM: number;
  workingSeconds: number;
  idleSeconds: number;
  speedViolationSeconds: number;
  speedViolationMeters: number;
}

/* ---------------------------------------------------------------------- Task */

export type TaskKind = 'putaway' | 'retrieve' | 'move' | 'charge';
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'done' | 'failed';

/**
 * フォークリフト1台に割り当てる作業単位。
 * putaway: 入庫口 -> ロケーション / retrieve: ロケーション -> 出荷エリア
 */
export interface Task {
  id: ID;
  simulationId: ID;
  kind: TaskKind;
  status: TaskStatus;
  productId?: ID;
  quantity: number;
  /** 取りに行く地点 (m) */
  fromX: number;
  fromY: number;
  /** 運ぶ先 (m) */
  toX: number;
  toY: number;
  fromLocationId?: ID;
  toLocationId?: ID;
  orderId?: ID;
  assignedForkliftId?: ID;
  /** シミュレーション内秒 */
  createdAtSec: number;
  startedAtSec?: number;
  finishedAtSec?: number;
  travelledM?: number;
}

/* ------------------------------------------------------------------- Orders */

export type OrderStatus = 'planned' | 'in-progress' | 'completed' | 'cancelled';

export interface InboundOrderLine {
  productId: ID;
  quantity: number;
  /** 指定がなければ空きロケーションを自動検索 */
  targetLocationId?: ID;
}

export interface InboundOrder {
  id: ID;
  layoutId: ID;
  code: string;
  /** 予定時刻 "09:00" */
  scheduledAt: string;
  /** 入庫口として使うオブジェクト */
  gateObjectId?: ID;
  lines: InboundOrderLine[];
  status: OrderStatus;
}

export interface OutboundOrderLine {
  productId: ID;
  quantity: number;
}

export interface OutboundOrder {
  id: ID;
  layoutId: ID;
  code: string;
  scheduledAt: string;
  /** 出荷エリアとして使うオブジェクト */
  gateObjectId?: ID;
  lines: OutboundOrderLine[];
  status: OrderStatus;
  priority: number;
}

/* --------------------------------------------------------------- Simulation */

export interface SimulationConfig {
  /** 開始時刻 "09:00:00" */
  startTime: string;
  /** 物理更新の刻み (秒) */
  tickSeconds: number;
  /** 倉庫内制限速度 (km/h) */
  speedLimitKmh: number;
  /** 経路探索のグリッド分解能 (m) */
  pathGridM: number;
  /** 通路の最小クリアランス (m) — 車体半幅として障害物を膨張させる */
  clearanceM: number;
  /** 空きロケーション選択の方針 */
  slottingStrategy: 'nearest' | 'turnover' | 'category';
}

export interface Simulation {
  id: ID;
  layoutId: ID;
  name: string;
  config: SimulationConfig;
  status: 'idle' | 'running' | 'paused' | 'finished';
  createdAt: string;
  /** 集計結果 (終了後) */
  metrics?: SimulationMetrics;
}

export interface SimulationMetrics {
  /** シミュレーション経過秒 */
  elapsedSeconds: number;
  totalTravelM: number;
  totalTasks: number;
  completedTasks: number;
  inboundUnits: number;
  outboundUnits: number;
  pendingOutboundOrders: number;
  activeForklifts: number;
  avgTravelPerTaskM: number;
  avgTaskSeconds: number;
  /** 稼働率 0-1 */
  utilization: number;
  totalWaitSeconds: number;
  speedViolationSeconds: number;
}

export type SimulationEventType =
  | 'sim-start'
  | 'sim-end'
  | 'task-created'
  | 'task-assigned'
  | 'move-start'
  | 'arrived'
  | 'pick'
  | 'drop'
  | 'task-done'
  | 'inbound-start'
  | 'inbound-done'
  | 'outbound-start'
  | 'outbound-done'
  | 'wait'
  | 'speed-violation'
  | 'error';

export interface SimulationEvent {
  id: ID;
  simulationId: ID;
  /** シミュレーション内経過秒 */
  atSec: number;
  /** 表示用時刻 "09:04:12" */
  atClock: string;
  type: SimulationEventType;
  forkliftId?: ID;
  taskId?: ID;
  orderId?: ID;
  locationCode?: string;
  productId?: ID;
  quantity?: number;
  message: string;
}

/* ---------------------------------------------------------------------- Path */

export interface Path {
  /** 通過点 (m)。始点を含む。 */
  points: Vec2[];
  /** 総距離 (m) */
  lengthM: number;
  /** 探索したノード数 (デバッグ/性能計測用) */
  expandedNodes?: number;
}

/* ------------------------------------------------------------ Layout bundle */

/**
 * レイアウト1件分の完全なスナップショット。
 * 保存/読込・CSVエクスポート・シミュレーション入力の共通単位。
 */
export interface LayoutSnapshot {
  warehouse: Warehouse;
  layout: Layout;
  /** 倉庫を構成する区画。空の場合は倉庫矩形全体が1エリア扱い（旧データ互換）。 */
  areas: Area[];
  /** エリア間の接続口 */
  connections: AreaConnection[];
  /** 接続口に設置されたシャッター */
  shutters: Shutter[];
  objects: LayoutObject[];
  locations: Location[];
}

export interface WarehouseBundle extends LayoutSnapshot {
  products: Product[];
  inventory: Inventory[];
}
