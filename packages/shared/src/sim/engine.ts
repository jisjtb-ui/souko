import { createId } from '../domain/ids.js';
import {
  distance,
  formatClock,
  kmhToMps,
  parseClock,
} from '../geometry/index.js';
import { objectCenter } from '../geometry/index.js';
import {
  isEmptyRackYardObject,
  isForkliftObject,
  isInboundGateObject,
  isOutboundGateObject,
  isRackObject,
} from '../domain/types.js';
import { NavGrid } from './navGrid.js';
import { findPath } from './astar.js';
import { advanceAlongPath } from './travel.js';
import { Random } from './random.js';
import { generateEventPlan } from './eventGeneration.js';
import {
  addUnits,
  createRackUnit,
  findRackType,
  removeUnits,
} from './racks.js';
import {
  createStacksForYard,
  findStackForRack,
  popRackFromStack,
  pushRackToStack,
  yardAccepts,
} from './stacking.js';
import { buildRackIndex, findFreeLocation, findStoredRackForSize } from './slotting.js';
import { Heatmap } from './heatmap.js';
import type { ID } from '../domain/ids.js';
import type {
  GateStatus,
  LogisticsSimConfig,
  ProductSize,
  RackStack,
  RackType,
  RackUnit,
} from '../domain/logistics.js';
import type { Area, AreaConnection, Shutter } from '../domain/areas.js';
import type { PathResult } from './astar.js';
import type {
  EmptyRackYardObject,
  ForkliftState,
  InboundGateObject,
  LayoutObject,
  Location,
  OutboundGateObject,
  SimulationEvent,
  SimulationEventType,
  Vec2,
  Warehouse,
} from '../domain/types.js';
import type { InboundJob, OutboundJob } from './eventGeneration.js';

/* ============================================================================
 * 物流シミュレーションエンジン (要件14・21)
 * ----------------------------------------------------------------------------
 * 倉入れ口 → フリーロケーション判定 → 保管 → 出庫指示 → 出荷ゲート →
 * 空ラック化 → 空ラック置き場へ搬送 → 積み重ね
 * までを、状態を持つイベント駆動シミュレーションとして実行する。
 *
 * ゲートの設定値（本数・割合・処理能力）が実際にイベントを生み、
 * フォークリフトが動き、在庫・ラック・ロケーション・ゲートの状態が変化する。
 * ========================================================================== */

/** 作業の1ステップ。タスクはステップの列として表現する。 */
type StepKind =
  | 'move' // 目的地まで移動
  | 'gate-load' // 倉入れ口で荷受け（ゲート処理時間を消費）
  | 'gate-unload' // 出荷ゲートで荷降ろし（ゲート処理時間を消費）
  | 'store' // ロケーションへ格納
  | 'pick' // ロケーションからラックを取得
  | 'stack'; // 空ラック置き場へ積み重ね

interface Step {
  kind: StepKind;
  target?: Vec2;
  /** 荷役などの所要時間 (秒) */
  seconds?: number;
  gateObjectId?: ID;
  locationId?: ID;
  stackId?: ID;
  units?: number;
  productSizeId?: ID;
  rackTypeId?: ID;
  rackUnitId?: ID;
  orderCode?: string;
  label?: string;
}

export type TaskKindEx = 'inbound' | 'outbound' | 'empty-return';

interface Task {
  id: ID;
  kind: TaskKindEx;
  steps: Step[];
  createdAtSec: number;
  startedAtSec?: number;
  finishedAtSec?: number;
  orderCode?: string;
  productSizeId?: ID;
  units: number;
  travelledM: number;
  /** この作業が押さえているロケーション（完了・中断時に解放する） */
  reservedLocationIds: ID[];
  /** 出庫元のロケーション（在庫が残った場合の戻し先） */
  sourceLocationId?: ID;
  /** この作業の主目的地（搬送距離ヒートの集計先） */
  focusPoint?: Vec2;
  /** 割当済みのラック（重複割当防止用） */
  claimedRackId?: ID;
}

/** フォークリフトの実行時状態。 */
export interface Vehicle {
  id: ID;
  code: string;
  /** 通路の譲り合いを決める固定の優先順位（結果の再現性のため） */
  priority: number;
  x: number;
  y: number;
  headingDeg: number;
  state: ForkliftState;
  /** 現在の作業内容（画面表示用） */
  activity: string;
  maxSpeedKmh: number;
  accelMps2: number;
  decelMps2: number;
  maxPayloadKg: number;
  widthM: number;
  depthM: number;
  /** 運んでいる可搬ラック */
  carryingRackId?: ID;
  task?: Task;
  path?: PathResult;
  pathIndex: number;
  stepTimer: number;
  travelledM: number;
  workingSeconds: number;
  idleSeconds: number;
  waitingSeconds: number;
  speedViolationSeconds: number;
  speedViolationMeters: number;
  completedTasks: number;
  /** 対向車待ちの連続秒数（デッドロック回避に使う） */
  blockedSeconds: number;
}

/** ゲートの実行時状態。 */
export interface Gate {
  objectId: ID;
  type: 'inbound' | 'outbound';
  code: string;
  name: string;
  point: Vec2;
  /** ゲートの占有範囲（滞留ヒートを面で表すために使う） */
  footprint: { x: number; y: number; widthM: number; depthM: number };
  capacityPerHour: number;
  concurrentSlots: number;
  openFromSec: number;
  openToSec: number;
  status: GateStatus;
  busySlots: number;
  /** 荷役中の車両（バース占有）。短時間で入れ替わる。 */
  serving: ID[];
  queue: ID[];
  /** 入庫: 荷受け処理中のラック */
  receiving: { rackUnitId: ID; remainingSeconds: number; units: number }[];
  /** 入庫: 荷受けが済み、格納待ちのラック */
  readyRacks: ID[];
  /** 出荷: ゲート前で処理を待っているラック（滞留） */
  pendingRacks: { rackUnitId: ID; units: number; orderCode?: string }[];
  /** 出荷: 出荷処理中のラック */
  shipping: { rackUnitId: ID; remainingSeconds: number; units: number; orderCode?: string }[];
  processedUnits: number;
  plannedUnits: number;
  /** ゲート前でラックが滞留した時間の合計（滞留量×秒） */
  totalWaitSeconds: number;
  /** バース待ちでフォークリフトが止まっていた時間の合計 */
  forkliftWaitSeconds: number;
  peakQueueLength: number;
  busySeconds: number;
}

export interface SimulationSnapshot {
  timeSec: number;
  clock: string;
  running: boolean;
  finished: boolean;
  vehicles: Vehicle[];
  rackUnits: RackUnit[];
  stacks: RackStack[];
  gates: Gate[];
  /** ロケーションID -> 格納中ラックID */
  occupancy: Map<ID, ID>;
  events: SimulationEvent[];
  metrics: SimulationKpi;
  /** 走行・渋滞・作業の分布（参照渡し。描画と分析に使う） */
  heatmap: Heatmap;
  pendingInbound: number;
  pendingOutbound: number;
  unfulfilledOutboundUnits: number;
  /** 到達不能などで中断した作業数 */
  abortedTasks: number;
  unreachableCount: number;
}

export interface SimulationKpi {
  elapsedSeconds: number;
  inboundUnits: number;
  outboundUnits: number;
  plannedInboundUnits: number;
  plannedOutboundUnits: number;
  pendingInboundUnits: number;
  pendingOutboundUnits: number;
  totalTravelM: number;
  avgTravelPerTaskM: number;
  completedTasks: number;
  avgTaskSeconds: number;
  forkliftUtilization: number;
  forkliftWaitSeconds: number;
  rackUnitsInUse: number;
  emptyRacks: number;
  stackedRacks: number;
  locationUsageRatio: number;
  storageFillRatio: number;
  speedViolationSeconds: number;
  gates: {
    objectId: ID;
    name: string;
    type: 'inbound' | 'outbound';
    processedUnits: number;
    plannedUnits: number;
    capacityPerHour: number;
    utilization: number;
    /** ゲート前でラックが待った合計時間（滞留） */
    totalWaitSeconds: number;
    /** バース待ちでフォークリフトが止まった時間 */
    forkliftWaitSeconds: number;
    peakQueueLength: number;
    pendingRacks: number;
  }[];
}

export interface SimulationInput {
  warehouse: Warehouse;
  objects: LayoutObject[];
  locations: Location[];
  areas?: Area[];
  connections?: AreaConnection[];
  shutters?: Shutter[];
  rackTypes: RackType[];
  productSizes: ProductSize[];
  config: LogisticsSimConfig;
}

/** イベントログの保持上限（1日分の実行を丸ごと保持できる大きさ）。 */
const MAX_EVENTS = 20_000;
/** 対向車に譲り続ける上限（秒）。これを超えたら進む。 */
const MAX_YIELD_SECONDS = 20;
/** ゲートに積み上げておける未処理ラックの上限（バッファ）。 */
const MAX_GATE_BUFFER = 12;

export class LogisticsSimulation {
  private readonly input: SimulationInput;
  private readonly grid: NavGrid;
  private readonly pathCache = new Map<string, PathResult>();
  /**
   * 保管場所選定で使う距離のキャッシュ。
   * 移動用の経路キャッシュ（毎回違う現在地が入り上限に達する）とは分ける。
   * ゲート×ロケーションの組み合わせは固定なので件数は有界。
   */
  private readonly slotDistanceCache = new Map<string, number>();
  private readonly random: Random;
  /** 走行・渋滞・作業の分布 (要件14) */
  private readonly heat: Heatmap;

  private readonly locationsById = new Map<ID, Location>();
  private readonly racksById: ReturnType<typeof buildRackIndex>;
  private readonly rackTypeById = new Map<ID, RackType>();
  private readonly sizeById = new Map<ID, ProductSize>();

  private readonly startSec: number;
  private readonly endSec: number;

  private timeSec = 0;
  private vehicles: Vehicle[] = [];
  private gates = new Map<ID, Gate>();
  private stacks: RackStack[] = [];
  private rackUnits = new Map<ID, RackUnit>();
  /** locationId -> rackUnitId */
  private occupancy = new Map<ID, ID>();
  private reserved = new Set<ID>();
  /** 空きロケーションの索引（毎回の全走査を避けるため差分更新する） */
  private readonly freeLocationIds = new Set<ID>();
  /** 商品サイズ -> 在庫のあるロケーション（出庫対象の検索用） */
  private readonly storedBySize = new Map<ID, Set<ID>>();
  /** エリア -> 在庫本数（フリーロケーションの平準化に使用） */
  private readonly inventoryByAreaCache = new Map<ID, number>();
  /**
   * 空き状況の版番号。空きロケーション・予約が変わるたびに進める。
   * 「同じ状況で空きが見つからなかった」探索を繰り返さないために使う。
   */
  private slottingEpoch = 0;
  /** ラック種別ごとに「この版では空きが無かった」ことを記録する */
  private readonly slottingFailedAt = new Map<ID, number>();
  private events: SimulationEvent[] = [];

  private inboundPlan: InboundJob[] = [];
  private outboundPlan: OutboundJob[] = [];
  private inboundCursor = 0;
  private outboundCursor = 0;
  private inboundQueue: InboundJob[] = [];
  private retrievalQueue: RetrievalRequest[] = [];
  private emptyReturnQueue: EmptyReturn[] = [];
  /** 出荷後に在庫が残ったラックの再格納待ち */
  private putawayQueue: EmptyReturn[] = [];
  /** 格納作業に割り当て済みのラック（二重割当の防止） */
  private claimedRacks = new Set<ID>();

  private inboundUnits = 0;
  private outboundUnits = 0;
  private unfulfilledOutboundUnits = 0;
  private completedTasks = 0;
  private abortedTasks = 0;
  private warnedFull = false;
  /** 分割実行をまたいで通算するループ回数の安全弁 */
  private runGuard = 0;
  private readonly unreachablePoints: Vec2[] = [];
  private totalTaskSeconds = 0;
  private plannedInboundUnits = 0;
  private plannedOutboundUnits = 0;
  private finished = false;

  constructor(input: SimulationInput) {
    this.input = input;
    this.random = new Random(input.config.seed);
    this.startSec = parseClock(input.config.startTime);
    this.endSec = parseClock(input.config.endTime);

    // ヒートマップは 1m 格子で集計する（描画・分析に十分な粒度）
    this.heat = new Heatmap(
      Math.max(input.warehouse.widthM, ...input.locations.map((l) => l.x + 2), 1),
      Math.max(input.warehouse.depthM, ...input.locations.map((l) => l.y + 2), 1),
      1,
    );

    this.grid = NavGrid.fromLayout(input.warehouse, input.objects, {
      cellM: input.config.pathGridM,
      clearanceM: input.config.clearanceM,
      areas: input.areas ?? [],
      connections: input.connections ?? [],
      shutters: input.shutters ?? [],
    });

    for (const location of input.locations) {
      this.locationsById.set(location.id, location);
      if (!location.blocked) this.freeLocationIds.add(location.id);
    }
    this.racksById = buildRackIndex(input.objects);
    for (const type of input.rackTypes) this.rackTypeById.set(type.id, type);
    for (const size of input.productSizes) this.sizeById.set(size.id, size);

    this.setupVehicles();
    this.setupGates();
    this.setupStacks();
    this.generatePlan();
    this.seedInitialInventory();

    this.emit('sim-start', `シミュレーション開始（${input.config.startTime}〜${input.config.endTime}）`);
  }

  /* ------------------------------------------------------------- 初期化 */

  private setupVehicles(): void {
    const forklifts = this.input.objects.filter(isForkliftObject);
    this.vehicles = forklifts.map((obj, index) => {
      const center = objectCenter(obj);
      return {
        id: obj.id,
        code: obj.forklift.code || obj.name,
        priority: index,
        x: center.x,
        y: center.y,
        headingDeg: 0,
        state: 'idle' as ForkliftState,
        activity: '待機',
        maxSpeedKmh: Math.min(obj.forklift.maxSpeedKmh, this.input.config.speedLimitKmh * 1.5),
        accelMps2: obj.forklift.accelMps2,
        decelMps2: obj.forklift.decelMps2,
        maxPayloadKg: obj.forklift.maxPayloadKg,
        widthM: obj.widthM,
        depthM: obj.depthM,
        pathIndex: 0,
        stepTimer: 0,
        travelledM: 0,
        workingSeconds: 0,
        idleSeconds: 0,
        waitingSeconds: 0,
        speedViolationSeconds: 0,
        speedViolationMeters: 0,
        completedTasks: 0,
        blockedSeconds: 0,
      };
    });
  }

  private setupGates(): void {
    for (const obj of this.input.objects) {
      if (isInboundGateObject(obj)) {
        this.gates.set(obj.id, this.buildGate(obj, 'inbound'));
      } else if (isOutboundGateObject(obj)) {
        this.gates.set(obj.id, this.buildGate(obj, 'outbound'));
      }
    }
  }

  private buildGate(obj: InboundGateObject | OutboundGateObject, type: 'inbound' | 'outbound'): Gate {
    const config = type === 'inbound' ? (obj as InboundGateObject).inboundGate : (obj as OutboundGateObject).outboundGate;
    return {
      objectId: obj.id,
      type,
      code: config.code,
      name: obj.name,
      point: objectCenter(obj),
      footprint: { x: obj.x, y: obj.y, widthM: obj.widthM, depthM: obj.depthM },
      capacityPerHour: Math.max(1, config.capacityPerHour),
      concurrentSlots: Math.max(1, config.concurrentSlots),
      openFromSec: parseClock(config.openFrom) - this.startSec,
      openToSec: parseClock(config.openTo) - this.startSec,
      status: 'idle',
      busySlots: 0,
      serving: [],
      queue: [],
      receiving: [],
      readyRacks: [],
      pendingRacks: [],
      shipping: [],
      processedUnits: 0,
      plannedUnits: config.dailyVolume,
      totalWaitSeconds: 0,
      forkliftWaitSeconds: 0,
      peakQueueLength: 0,
      busySeconds: 0,
    };
  }

  private setupStacks(): void {
    const yards = this.input.objects.filter(isEmptyRackYardObject);
    const defaultMax = Math.max(1, ...this.input.rackTypes.map((t) => t.maxStackWhenEmpty));
    this.stacks = yards.flatMap((yard) => createStacksForYard(yard, { defaultMaxLevels: defaultMax }));
  }

  private generatePlan(): void {
    const inboundGates = this.input.objects.filter(isInboundGateObject);
    const outboundGates = this.input.objects.filter(isOutboundGateObject);
    const plan = generateEventPlan(inboundGates, outboundGates, this.input.productSizes, {
      seed: this.input.config.seed,
      startTime: this.input.config.startTime,
      endTime: this.input.config.endTime,
    });
    this.inboundPlan = plan.inbound;
    this.outboundPlan = plan.outbound;
    this.plannedInboundUnits = plan.plannedInboundUnits;
    this.plannedOutboundUnits = plan.plannedOutboundUnits;
    for (const warning of plan.warnings) this.emit('error', warning);
  }

  /** 開始時点の在庫を用意する（出庫がすぐ始められるように）。 */
  private seedInitialInventory(): void {
    const ratio = Math.max(0, Math.min(1, this.input.config.initialFillRatio));
    if (ratio <= 0) return;

    const eligible = this.input.locations.filter((l) => !l.blocked);
    const target = Math.floor(eligible.length * ratio);
    const sizes = this.input.productSizes;
    if (sizes.length === 0) return;

    const weights = sizes.map((s) => Math.max(0.01, s.outboundRatioPct));
    let filled = 0;

    for (const location of eligible) {
      if (filled >= target) break;
      const rack = this.racksById.get(location.rackId);
      if (!rack) continue;

      // このロケーションが受け入れられるラック種別
      const rackType =
        this.rackTypeById.get(rack.rack.rackTypeId ?? '') ??
        findRackType(this.input.rackTypes, rack.rack.rackCategory ?? 'small');
      if (!rackType) continue;

      // ラック種別に適合する商品サイズを選ぶ
      const candidates = sizes.filter((s) =>
        rackType.category === 'large' ? true : s.rackCategory === 'small',
      );
      if (candidates.length === 0) continue;
      const index = this.random.weightedIndex(
        candidates.map((s) => weights[sizes.indexOf(s)] ?? 1),
      );
      const size = candidates[index < 0 ? 0 : index]!;

      const units = Math.min(rackType.maxUnits, size.unitsPerRack);
      const unit = createRackUnit({
        rackType,
        productSizeId: size.id,
        units,
        x: location.x,
        y: location.y,
      });
      unit.locationId = location.id;
      unit.storedAtSec = -1;
      this.rackUnits.set(unit.id, unit);
      this.indexStore(location.id, unit);
      filled++;
    }
  }

  /* ------------------------------------------------------------- 進行 */

  /** 実行が完了しているか（スナップショットを作らずに確認できる）。 */
  get isFinished(): boolean {
    return this.finished;
  }

  /** 現在のシミュレーション内経過秒（進捗表示用）。 */
  get elapsedSeconds(): number {
    return this.timeSec;
  }

  /** シミュレーションを dt 秒進める。 */
  step(dtSec: number): void {
    if (this.finished) return;
    const dt = Math.max(0.05, dtSec);
    this.timeSec += dt;

    this.releaseJobs();
    this.updateGates(dt);
    this.assignTasks();
    this.advanceVehicles(dt);

    if (this.timeSec >= this.endSec - this.startSec && this.isDrained()) {
      this.finished = true;
      this.emit('sim-end', `シミュレーション終了（入庫 ${this.inboundUnits.toLocaleString()}本 / 出荷 ${this.outboundUnits.toLocaleString()}本）`);
    }
  }

  /**
   * 指定した実時間(ms)だけ実行する。分割実行の単位。
   *
   * 終了条件（打ち切り時間・ガード）は runToEnd と共通なので、
   * 一気に実行しても分割して実行しても結果は同じになる。
   *
   * @returns 実行が完了したか
   */
  runFor(budgetMs: number, options: { maxSeconds?: number; tickSeconds?: number } = {}): boolean {
    if (this.finished) return true;
    const tick = options.tickSeconds ?? this.input.config.tickSeconds;
    const limit = options.maxSeconds ?? (this.endSec - this.startSec) * 1.5;
    const startedAt = Date.now();

    while (!this.finished && this.timeSec < limit && this.runGuard < 400_000) {
      this.step(tick);
      this.runGuard++;
      if (Date.now() - startedAt >= budgetMs) return this.finished;
    }

    if (!this.finished) {
      this.finished = true;
      this.emit('sim-end', 'シミュレーション終了（時間切れ：未処理が残っています）');
    }
    return true;
  }

  /** 終了まで一気に実行する（KPI算出・レイアウト比較用）。 */
  runToEnd(options: { maxSeconds?: number; tickSeconds?: number } = {}): SimulationSnapshot {
    this.runFor(Number.POSITIVE_INFINITY, options);
    return this.snapshot();
  }

  /** 打ち切りまでの残り割合を求める（進捗表示用, 0-1）。 */
  progressRatio(maxSeconds?: number): number {
    const limit = maxSeconds ?? (this.endSec - this.startSec) * 1.5;
    if (this.finished) return 1;
    return Math.max(0, Math.min(0.999, this.timeSec / Math.max(1, limit)));
  }

  private isDrained(): boolean {
    return (
      this.inboundCursor >= this.inboundPlan.length &&
      this.outboundCursor >= this.outboundPlan.length &&
      this.inboundQueue.length === 0 &&
      this.retrievalQueue.length === 0 &&
      this.emptyReturnQueue.length === 0 &&
      this.vehicles.every((v) => !v.task)
    );
  }

  /** 予定時刻を過ぎたイベントをキューへ流す。 */
  private releaseJobs(): void {
    while (
      this.inboundCursor < this.inboundPlan.length &&
      this.inboundPlan[this.inboundCursor]!.atSec <= this.timeSec
    ) {
      const job = this.inboundPlan[this.inboundCursor]!;
      this.inboundCursor++;
      this.inboundQueue.push(job);
      this.emit('inbound-start', `倉入れ予定 ${job.units}本（${this.sizeLabel(job.productSizeId)}）`, {
        productId: job.productSizeId,
        quantity: job.units,
      });
    }

    while (
      this.outboundCursor < this.outboundPlan.length &&
      this.outboundPlan[this.outboundCursor]!.atSec <= this.timeSec
    ) {
      const order = this.outboundPlan[this.outboundCursor]!;
      this.outboundCursor++;
      this.emit('outbound-start', `出荷指示 ${order.code}（${order.totalUnits}本）`, {
        orderId: order.id,
        quantity: order.totalUnits,
      });
      for (const line of order.lines) {
        this.retrievalQueue.push({
          id: createId('req'),
          orderCode: order.code,
          gateObjectId: order.gateObjectId,
          productSizeId: line.productSizeId,
          remainingUnits: line.units,
        });
      }
    }
  }

  /* --------------------------------------------------------- タスク割当 */

  private assignTasks(): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.task) continue;
      const task =
        this.buildEmptyReturnTask(vehicle) ??
        this.buildPutawayReturnTask(vehicle) ??
        this.buildOutboundTask(vehicle) ??
        this.buildInboundTask(vehicle);
      if (!task) continue;
      vehicle.task = task;
      task.startedAtSec = this.timeSec;
      vehicle.state = 'moving';
      this.beginStep(vehicle);
      this.emit('task-assigned', `${vehicle.code} に${this.taskLabel(task.kind)}を割当`, {
        forkliftId: vehicle.id,
        taskId: task.id,
      });
    }
  }

  private taskLabel(kind: TaskKindEx): string {
    return kind === 'inbound' ? '倉入れ作業' : kind === 'outbound' ? '出庫作業' : '空ラック搬送';
  }

  /** 倉入れ: 倉入れ口で荷受け済みのラックを空きロケーションへ格納する。 */
  private buildInboundTask(vehicle: Vehicle): Task | undefined {
    for (const gate of this.gates.values()) {
      if (gate.type !== 'inbound') continue;
      const rackId = gate.readyRacks.find((id) => !this.claimedRacks.has(id));
      if (!rackId) continue;
      const rack = this.rackUnits.get(rackId);
      if (!rack) {
        gate.readyRacks = gate.readyRacks.filter((id) => id !== rackId);
        continue;
      }
      const task = this.buildPutawayTask(vehicle, rack, gate.point, gate.objectId, '倉入れ');
      if (task) return task;
      // 空きロケーションが無い場合は保留（満杯としてKPIに現れる）
      return undefined;
    }
    return undefined;
  }

  /** 再格納: 出荷後に在庫が残ったラックを倉庫へ戻す。 */
  private buildPutawayReturnTask(vehicle: Vehicle): Task | undefined {
    while (this.putawayQueue.length > 0) {
      const entry = this.putawayQueue[0]!;
      const rack = this.rackUnits.get(entry.rackUnitId);
      if (!rack) {
        this.putawayQueue.shift();
        continue;
      }
      const task = this.buildPutawayTask(vehicle, rack, { x: entry.x, y: entry.y }, rack.gateObjectId, '再格納');
      if (!task) return undefined;
      this.putawayQueue.shift();
      return task;
    }
    return undefined;
  }

  /** 「ラックを拾って空きロケーションへ格納する」作業を組み立てる。 */
  private buildPutawayTask(
    vehicle: Vehicle,
    rack: RackUnit,
    fromPoint: Vec2,
    gateObjectId: ID | undefined,
    label: string,
  ): Task | undefined {
    const size = rack.productSizeId ? this.sizeById.get(rack.productSizeId) : undefined;
    const rackType = this.rackTypeById.get(rack.rackTypeId);
    if (!size || !rackType) return undefined;

    // 空き状況が前回の失敗時から変わっていなければ、同じ結果になるため探索しない
    if (this.slottingFailedAt.get(rackType.id) === this.slottingEpoch) return undefined;

    const candidate = findFreeLocation(
      {
        locations: this.input.locations,
        candidateIds: this.freeLocationIds,
        locationById: this.locationsById,
        occupancy: this.occupancy,
        reserved: this.reserved,
        racksById: this.racksById,
        size,
        rackType,
        fromPoint,
        outboundPoints: [...this.gates.values()]
          .filter((g) => g.type === 'outbound')
          .map((g) => g.point),
        distanceFn: (a, b) => this.pathDistance(a, b),
        inventoryByArea: this.inventoryByAreaCache,
      },
      this.input.config.slottingStrategy,
    );
    if (!candidate) {
      this.slottingFailedAt.set(rackType.id, this.slottingEpoch);
      if (!this.warnedFull) {
        this.warnedFull = true;
        this.emit('error', '空きロケーションがありません（倉庫が満杯です）');
      }
      return undefined;
    }

    this.reserve(candidate.location.id);
    this.claimedRacks.add(rack.id);

    return {
      id: createId('task'),
      kind: 'inbound',
      createdAtSec: this.timeSec,
      productSizeId: size.id,
      units: rack.currentUnits,
      travelledM: 0,
      reservedLocationIds: [candidate.location.id],
      claimedRackId: rack.id,
      focusPoint: { x: candidate.location.x, y: candidate.location.y },
      steps: [
        { kind: 'move', target: fromPoint, label: `${label}: ラックを取りに移動` },
        {
          kind: 'gate-load',
          gateObjectId,
          seconds: this.input.config.handlingSeconds,
          units: rack.currentUnits,
          productSizeId: size.id,
          rackTypeId: rackType.id,
          rackUnitId: rack.id,
          label: `${label}: ラックを積込み`,
        },
        {
          kind: 'move',
          target: { x: candidate.location.approachX, y: candidate.location.approachY },
          label: `${candidate.location.code}へ搬送`,
        },
        {
          kind: 'store',
          locationId: candidate.location.id,
          seconds: this.input.config.handlingSeconds,
          label: `${candidate.location.code}へ格納`,
        },
      ],
    };
  }

  /** 出庫: 保管ロケーション → 出荷ゲート → 空ラック置き場。 */
  private buildOutboundTask(vehicle: Vehicle): Task | undefined {
    while (this.retrievalQueue.length > 0) {
      const request = this.retrievalQueue[0]!;
      const gate = this.gates.get(request.gateObjectId);
      if (!gate) {
        this.retrievalQueue.shift();
        continue;
      }

      const found = findStoredRackForSize(this.storedRacksOfSize(request.productSizeId), request.productSizeId, {
        excludeLocationIds: this.reserved,
      });
      if (!found) {
        // 在庫切れ: 未処理として記録し、次の要求へ回す
        this.retrievalQueue.shift();
        this.unfulfilledOutboundUnits += request.remainingUnits;
        this.emit('error', `在庫不足のため出荷できません（${this.sizeLabel(request.productSizeId)} ${request.remainingUnits}本）`, {
          orderId: request.id,
          quantity: request.remainingUnits,
        });
        continue;
      }

      const location = this.locationsById.get(found.locationId);
      if (!location) {
        this.retrievalQueue.shift();
        continue;
      }

      // ゲート前が滞留している場合は他の作業を優先する（無駄な行列を作らない）
      if (gate.pendingRacks.length + gate.shipping.length >= MAX_GATE_BUFFER) return undefined;

      const units = Math.min(request.remainingUnits, found.rack.currentUnits);
      request.remainingUnits -= units;
      if (request.remainingUnits <= 0) this.retrievalQueue.shift();

      this.reserve(location.id);

      const task: Task = {
        id: createId('task'),
        kind: 'outbound',
        createdAtSec: this.timeSec,
        orderCode: request.orderCode,
        productSizeId: request.productSizeId,
        units,
        travelledM: 0,
        reservedLocationIds: [location.id],
        sourceLocationId: location.id,
        focusPoint: { x: location.x, y: location.y },
        steps: [
          {
            kind: 'move',
            target: { x: location.approachX, y: location.approachY },
            label: `${location.code}へ移動`,
          },
          {
            kind: 'pick',
            locationId: location.id,
            seconds: this.input.config.handlingSeconds,
            label: `${location.code}からラックを取得`,
          },
          { kind: 'move', target: gate.point, label: `${gate.name}へ搬送` },
          {
            kind: 'gate-unload',
            gateObjectId: gate.objectId,
            seconds: this.input.config.handlingSeconds,
            units,
            orderCode: request.orderCode,
            label: `${gate.name}へラックを引き渡し`,
          },
        ],
      };
      return task;
    }
    return undefined;
  }

  /** 空ラック搬送: 出荷ゲート → 空ラック置き場へ積み重ね。 */
  private buildEmptyReturnTask(vehicle: Vehicle): Task | undefined {
    while (this.emptyReturnQueue.length > 0) {
      const entry = this.emptyReturnQueue[0]!;
      const rack = this.rackUnits.get(entry.rackUnitId);
      if (!rack) {
        this.emptyReturnQueue.shift();
        continue;
      }
      const rackType = this.rackTypeById.get(rack.rackTypeId);
      if (!rackType) {
        this.emptyReturnQueue.shift();
        continue;
      }
      const target = this.findStackTarget(rack, rackType);
      if (!target) {
        // 置き場が満杯: 保留して警告（ボトルネックとして現れる）
        return undefined;
      }
      this.emptyReturnQueue.shift();

      return {
        id: createId('task'),
        kind: 'empty-return',
        createdAtSec: this.timeSec,
        units: 0,
        travelledM: 0,
        reservedLocationIds: [],
        steps: [
          { kind: 'move', target: { x: entry.x, y: entry.y }, label: '空ラックの位置へ移動' },
          {
            kind: 'pick',
            seconds: this.input.config.handlingSeconds * 0.5,
            label: '空ラックを持ち上げ',
            rackUnitId: entry.rackUnitId,
          },
          { kind: 'move', target: { x: target.stack.x, y: target.stack.y }, label: '空ラック置き場へ搬送' },
          {
            kind: 'stack',
            stackId: target.stack.id,
            seconds: this.input.config.handlingSeconds * 0.6,
            label: '空ラックを積み重ね',
          },
        ],
        productSizeId: undefined,
      } as Task;
    }
    return undefined;
  }

  private findStackTarget(rack: RackUnit, rackType: RackType): { stack: RackStack } | undefined {
    const yards = this.input.objects.filter(isEmptyRackYardObject);
    const accepted = new Set(
      yards.filter((yard) => yardAccepts(yard, rack.category)).map((yard) => yard.id),
    );
    const stacks = this.stacks.filter((stack) => accepted.has(stack.yardObjectId));
    const found = findStackForRack(stacks, rack, rackType);
    return found ? { stack: found.stack } : undefined;
  }

  /* ------------------------------------------------------- 車両の進行 */

  private beginStep(vehicle: Vehicle): void {
    const step = vehicle.task?.steps[0];
    if (!step) return;
    vehicle.activity = step.label ?? '';

    if (step.kind === 'move' && step.target) {
      const path = this.getPath({ x: vehicle.x, y: vehicle.y }, step.target);
      vehicle.path = path;
      vehicle.pathIndex = path.points.length > 1 ? 1 : 0;
      vehicle.state = vehicle.carryingRackId ? 'carrying' : 'moving';
      if (!path.found) {
        // 到達できない（シャッター閉鎖・通路の遮断など）場合はその場で作業を打ち切る
        this.emit('error', `${vehicle.code}: 目的地へ到達できません（${step.label ?? ''}）`, {
          forkliftId: vehicle.id,
        });
        if (step.target) this.unreachablePoints.push({ ...step.target });
        this.abortTask(vehicle);
      }
      return;
    }

    vehicle.stepTimer = step.seconds ?? 0;
    vehicle.state = step.kind === 'stack' ? 'handling' : 'handling';
  }

  private abortTask(vehicle: Vehicle): void {
    const task = vehicle.task;
    if (!task) return;
    this.leaveGateQueues(vehicle);
    for (const id of task.reservedLocationIds) this.release(id);
    if (task.claimedRackId) this.claimedRacks.delete(task.claimedRackId);
    if (task.kind === 'outbound') this.unfulfilledOutboundUnits += task.units;
    this.abortedTasks += 1;
    vehicle.task = undefined;
    vehicle.path = undefined;
    vehicle.state = 'idle';
    vehicle.activity = '待機';
  }

  private advanceVehicles(dt: number): void {
    for (const vehicle of this.vehicles) {
      const task = vehicle.task;
      if (!task) {
        vehicle.idleSeconds += dt;
        vehicle.state = 'idle';
        vehicle.activity = '待機';
        continue;
      }

      const step = task.steps[0];
      if (!step) {
        this.completeTask(vehicle);
        continue;
      }

      vehicle.workingSeconds += dt;

      if (step.kind === 'move') {
        this.advanceMove(vehicle, dt);
        continue;
      }

      if (step.kind === 'gate-load' || step.kind === 'gate-unload') {
        this.advanceGateStep(vehicle, step, dt);
        continue;
      }

      // 荷役系（格納 / 取得 / 積み重ね）
      vehicle.stepTimer -= dt;
      vehicle.state = 'handling';
      this.heat.addPoint('work', { x: vehicle.x, y: vehicle.y }, dt);
      if (vehicle.stepTimer <= 0) {
        this.finishStep(vehicle, step);
      }
    }
  }

  private advanceMove(vehicle: Vehicle, dt: number): void {
    const path = vehicle.path;
    if (!path || path.points.length === 0) {
      this.finishStep(vehicle, vehicle.task!.steps[0]!);
      return;
    }

    // 追突回避: 進行方向の近くに他車がいれば停止して待つ
    if (this.input.config.collisionAvoidance && this.isBlockedByOther(vehicle)) {
      vehicle.blockedSeconds += dt;
      // 待ち続けて動けないまま止まらないよう、一定時間で通行を再開する
      if (vehicle.blockedSeconds < MAX_YIELD_SECONDS) {
        vehicle.state = 'blocked';
        vehicle.activity = '通路待ち（対向車）';
        vehicle.waitingSeconds += dt;
        this.heat.addPoint('congestion', { x: vehicle.x, y: vehicle.y }, dt);
        return;
      }
    } else {
      vehicle.blockedSeconds = 0;
    }

    const speedMps = kmhToMps(vehicle.maxSpeedKmh);
    const limitMps = kmhToMps(this.input.config.speedLimitKmh);
    const travel = speedMps * dt;

    const previous = { x: vehicle.x, y: vehicle.y };
    const result = advanceAlongPath(path.points, { x: vehicle.x, y: vehicle.y }, vehicle.pathIndex, travel);
    // 走行距離を通過セルへ按分する（よく通る場所＝主要動線）
    this.heat.addSegment('traffic', previous, result.position, result.movedM);
    vehicle.x = result.position.x;
    vehicle.y = result.position.y;
    vehicle.headingDeg = result.headingDeg;
    vehicle.pathIndex = result.index;
    vehicle.travelledM += result.movedM;
    vehicle.task!.travelledM += result.movedM;
    vehicle.state = vehicle.carryingRackId ? 'carrying' : 'moving';

    if (speedMps > limitMps) {
      vehicle.speedViolationSeconds += dt;
      vehicle.speedViolationMeters += result.movedM;
    }

    // 運搬中のラックを追従させる
    if (vehicle.carryingRackId) {
      const rack = this.rackUnits.get(vehicle.carryingRackId);
      if (rack) this.rackUnits.set(rack.id, { ...rack, x: vehicle.x, y: vehicle.y });
    }

    if (result.finished) {
      this.finishStep(vehicle, vehicle.task!.steps[0]!);
    }
  }

  /** 進行方向の直前に他車がいるか（簡易的な渋滞・衝突回避）。 */
  private isBlockedByOther(vehicle: Vehicle): boolean {
    const safeM = Math.max(1.5, vehicle.widthM * 1.2);
    const rad = (vehicle.headingDeg * Math.PI) / 180;
    const ahead = { x: vehicle.x + Math.cos(rad) * safeM, y: vehicle.y + Math.sin(rad) * safeM };

    for (const other of this.vehicles) {
      if (other.id === vehicle.id) continue;
      // 停車中の車両は障害物扱いにしない（経路上に居座って永久待ちになるのを防ぐ）
      if (other.state !== 'moving' && other.state !== 'carrying') continue;
      if (distance(ahead, { x: other.x, y: other.y }) < safeM * 0.8) {
        // 同時停止を避けるため、固定の優先順位で譲る側を決める
        return vehicle.priority > other.priority;
      }
    }
    return false;
  }

  /**
   * ゲートでの荷役（ラックの受け取り・引き渡し）。
   * バース（同時処理台数）が空くまでフォークリフトは待機する (要件15)。
   */
  private advanceGateStep(vehicle: Vehicle, step: Step, dt: number): void {
    const gate = step.gateObjectId ? this.gates.get(step.gateObjectId) : undefined;
    if (!gate) {
      vehicle.stepTimer -= dt;
      if (vehicle.stepTimer <= 0) this.finishStep(vehicle, step);
      return;
    }

    const alreadyServing = gate.serving.includes(vehicle.id);
    if (!alreadyServing) {
      if (!gate.queue.includes(vehicle.id)) gate.queue.push(vehicle.id);
      const canStart = gate.serving.length < gate.concurrentSlots && gate.queue[0] === vehicle.id;
      if (!canStart) {
        vehicle.state = 'blocked';
        vehicle.activity = `${gate.name}のバース待ち`;
        vehicle.waitingSeconds += dt;
        gate.forkliftWaitSeconds += dt;
        this.heat.addPoint('congestion', { x: vehicle.x, y: vehicle.y }, dt);
        return;
      }
      gate.queue = gate.queue.filter((id) => id !== vehicle.id);
      gate.serving.push(vehicle.id);
      gate.busySlots = gate.serving.length;
      vehicle.state = 'handling';
      vehicle.activity = step.label ?? '';
    }

    vehicle.stepTimer -= dt;
    this.heat.addPoint('work', { x: vehicle.x, y: vehicle.y }, dt);
    if (vehicle.stepTimer <= 0) {
      gate.serving = gate.serving.filter((id) => id !== vehicle.id);
      gate.busySlots = gate.serving.length;
      this.finishStep(vehicle, step);
    }
  }

  /** ステップ完了時の状態変化。 */
  private finishStep(vehicle: Vehicle, step: Step): void {
    const task = vehicle.task!;

    switch (step.kind) {
      case 'move':
        this.emit('arrived', `${vehicle.code} ${step.label ?? ''}`, { forkliftId: vehicle.id });
        break;

      case 'gate-load': {
        // ゲートで荷受け済みのラックを積み込む（ラック生成はゲート側で完了している）
        const gate = step.gateObjectId ? this.gates.get(step.gateObjectId) : undefined;
        const rackId = step.rackUnitId;
        if (rackId) {
          const rack = this.rackUnits.get(rackId);
          if (rack) {
            this.rackUnits.set(rackId, {
              ...rack,
              status: 'carrying',
              forkliftId: vehicle.id,
              gateObjectId: undefined,
              x: vehicle.x,
              y: vehicle.y,
            });
            vehicle.carryingRackId = rackId;
          }
          if (gate) gate.readyRacks = gate.readyRacks.filter((id) => id !== rackId);
        }
        this.emit('pick', `${vehicle.code} ${step.label ?? ''}（${step.units ?? 0}本）`, {
          forkliftId: vehicle.id,
          quantity: step.units ?? 0,
          productId: step.productSizeId,
        });
        break;
      }

      case 'store': {
        const location = this.locationsById.get(step.locationId!);
        const rackId = vehicle.carryingRackId;
        if (location && rackId) {
          const rack = this.rackUnits.get(rackId);
          if (rack) {
            this.rackUnits.set(rackId, {
              ...rack,
              status: rack.currentUnits >= rack.capacityUnits ? 'full' : 'stored',
              locationId: location.id,
              forkliftId: undefined,
              x: location.x,
              y: location.y,
              storedAtSec: this.timeSec,
            });
            this.indexStore(location.id, this.rackUnits.get(rackId)!);
          }
          this.emit('drop', `${vehicle.code} ${location.code}へ格納完了`, {
            forkliftId: vehicle.id,
            locationCode: location.code,
            quantity: task.units,
          });
        }
        vehicle.carryingRackId = undefined;
        break;
      }

      case 'pick': {
        if (step.locationId) {
          const location = this.locationsById.get(step.locationId);
          const rackId = this.occupancy.get(step.locationId);
          if (location && rackId) {
            const rack = this.rackUnits.get(rackId);
            if (rack) {
              this.rackUnits.set(rackId, {
                ...rack,
                status: 'carrying',
                locationId: undefined,
                forkliftId: vehicle.id,
              });
              vehicle.carryingRackId = rackId;
            }
            this.indexRemove(step.locationId);
            this.emit('pick', `${vehicle.code} ${location.code}からラックを取得`, {
              forkliftId: vehicle.id,
              locationCode: location.code,
            });
          }
        } else if (step.rackUnitId) {
          // ゲート脇に置かれた空ラックを持ち上げる
          const rack = this.rackUnits.get(step.rackUnitId);
          if (rack) {
            this.rackUnits.set(step.rackUnitId, {
              ...rack,
              status: 'carrying',
              forkliftId: vehicle.id,
              gateObjectId: undefined,
            });
            vehicle.carryingRackId = step.rackUnitId;
          }
        }
        break;
      }

      case 'gate-unload': {
        // ラックをゲート前へ置いて離れる。出荷処理はゲート側が能力に従って進める。
        const gate = step.gateObjectId ? this.gates.get(step.gateObjectId) : undefined;
        const rackId = vehicle.carryingRackId;
        if (gate && rackId) {
          const rack = this.rackUnits.get(rackId);
          if (rack) {
            this.rackUnits.set(rackId, {
              ...rack,
              status: 'waiting',
              forkliftId: undefined,
              gateObjectId: gate.objectId,
              x: gate.point.x,
              y: gate.point.y,
            });
          }
          gate.pendingRacks.push({
            rackUnitId: rackId,
            units: step.units ?? 0,
            orderCode: step.orderCode,
          });
          this.emit('drop', `${vehicle.code} ${gate.name}へラックを引き渡し（${step.units ?? 0}本）`, {
            forkliftId: vehicle.id,
            quantity: step.units ?? 0,
            orderId: step.orderCode,
          });
        }
        vehicle.carryingRackId = undefined;
        break;
      }

      case 'stack': {
        const stackIndex = this.stacks.findIndex((s) => s.id === step.stackId);
        const rackId = vehicle.carryingRackId;
        if (stackIndex >= 0 && rackId) {
          const rack = this.rackUnits.get(rackId)!;
          const rackType = this.rackTypeById.get(rack.rackTypeId);
          if (rackType) {
            const result = pushRackToStack(this.stacks[stackIndex]!, rack, rackType);
            this.stacks[stackIndex] = result.stack;
            this.rackUnits.set(rackId, result.rack);
            this.emit(
              'task-done',
              `空ラックを積み重ねました（${result.stack.rackUnitIds.length}/${result.stack.maxLevels}段）`,
              { forkliftId: vehicle.id },
            );
          }
        }
        vehicle.carryingRackId = undefined;
        break;
      }
    }

    task.steps.shift();
    if (task.steps.length === 0) {
      this.completeTask(vehicle);
    } else {
      this.beginStep(vehicle);
    }
  }

  private completeTask(vehicle: Vehicle): void {
    const task = vehicle.task;
    if (!task) return;
    this.leaveGateQueues(vehicle);
    for (const id of task.reservedLocationIds) this.release(id);
    if (task.claimedRackId) this.claimedRacks.delete(task.claimedRackId);
    task.finishedAtSec = this.timeSec;
    // 「どの保管場所が遠いか」を見るため、走行距離を目的地へ集計する
    if (task.focusPoint && task.travelledM > 0) {
      this.heat.addPoint('distance', task.focusPoint, task.travelledM);
    }
    this.completedTasks++;
    this.totalTaskSeconds += this.timeSec - (task.startedAtSec ?? this.timeSec);
    vehicle.completedTasks++;
    vehicle.task = undefined;
    vehicle.path = undefined;
    vehicle.state = 'idle';
    vehicle.activity = '待機';
    this.emit('task-done', `${vehicle.code} ${this.taskLabel(task.kind)}完了`, {
      forkliftId: vehicle.id,
      taskId: task.id,
    });
  }

  /** 作業が終わった車両をゲートの待機列・処理中リストから外す（滞留の防止）。 */
  private leaveGateQueues(vehicle: Vehicle): void {
    for (const gate of this.gates.values()) {
      if (gate.queue.includes(vehicle.id)) {
        gate.queue = gate.queue.filter((id) => id !== vehicle.id);
      }
      if (gate.serving.includes(vehicle.id)) {
        gate.serving = gate.serving.filter((id) => id !== vehicle.id);
        gate.busySlots = gate.serving.length;
      }
    }
  }

  /**
   * ゲートの処理を進める。
   *
   * フォークリフトはラックを置いて離れ、ゲート側が能力(本/時)に従って
   * 処理する。処理待ちのラックが「ゲート前の滞留」になる (要件15)。
   */
  private updateGates(dt: number): void {
    for (const gate of this.gates.values()) {
      const open = this.timeSec >= gate.openFromSec && this.timeSec <= gate.openToSec;

      if (gate.type === 'inbound') {
        this.updateInboundGate(gate, dt, open);
      } else {
        this.updateOutboundGate(gate, dt, open);
      }

      const load = gate.pendingRacks.length + gate.queue.length;
      gate.status = !open
        ? 'idle'
        : load > gate.concurrentSlots
          ? 'congested'
          : gate.receiving.length + gate.shipping.length > 0
            ? gate.type === 'inbound'
              ? 'receiving'
              : 'shipping'
            : load > 0
              ? 'queued'
              : 'idle';

      if (load > 0) {
        gate.totalWaitSeconds += load * dt;
        // ゲート前の滞留もヒートマップの「詰まり」として記録する（面で按分）
        this.heat.addRect('congestion', gate.footprint, load * dt);
      }
      gate.peakQueueLength = Math.max(gate.peakQueueLength, load);
    }
  }

  /** 倉入れ口: トラックから荷受けして、格納待ちのラックを作る。 */
  private updateInboundGate(gate: Gate, dt: number, open: boolean): void {
    // 処理中の荷受けを進める
    for (const entry of [...gate.receiving]) {
      entry.remainingSeconds -= dt;
      gate.busySeconds += dt;
      if (entry.remainingSeconds <= 0) {
        gate.receiving = gate.receiving.filter((e) => e !== entry);
        gate.readyRacks.push(entry.rackUnitId);
        gate.processedUnits += entry.units;
        this.inboundUnits += entry.units;
        const rack = this.rackUnits.get(entry.rackUnitId);
        if (rack) {
          this.rackUnits.set(rack.id, { ...rack, status: 'waiting' });
        }
        this.emit('inbound-done', `${gate.name} 荷受け完了（${entry.units}本）`, {
          quantity: entry.units,
        });
      }
    }

    // 空きスロットがあれば次の倉入れを開始する
    while (
      open &&
      gate.receiving.length < gate.concurrentSlots &&
      gate.readyRacks.length + gate.receiving.length < MAX_GATE_BUFFER
    ) {
      const jobIndex = this.inboundQueue.findIndex((job) => job.gateObjectId === gate.objectId);
      if (jobIndex < 0) break;
      const job = this.inboundQueue.splice(jobIndex, 1)[0]!;
      const rackType = findRackType(this.input.rackTypes, job.rackCategory);
      if (!rackType) continue;

      // 空ラック置き場に同種別の空ラックがあれば再利用する（空ラックの循環）
      const rack = this.reuseEmptyRack(rackType, job.productSizeId, job.units, gate) ??
        createRackUnit({
          rackType,
          productSizeId: job.productSizeId,
          units: job.units,
          x: gate.point.x,
          y: gate.point.y,
          status: 'loading',
        });
      rack.gateObjectId = gate.objectId;
      this.rackUnits.set(rack.id, rack);
      gate.receiving.push({
        rackUnitId: rack.id,
        remainingSeconds: (job.units / gate.capacityPerHour) * 3600,
        units: job.units,
      });
    }
  }

  /**
   * 空ラック置き場から同種別の空ラックを取り出して再利用する。
   * 使われた空ラックはスタックから減るため、置き場が際限なく埋まらない。
   */
  private reuseEmptyRack(
    rackType: RackType,
    productSizeId: ID,
    units: number,
    gate: Gate,
  ): RackUnit | undefined {
    const index = this.stacks.findIndex(
      (stack) => stack.rackTypeId === rackType.id && stack.rackUnitIds.length > 0,
    );
    if (index < 0) return undefined;

    const result = popRackFromStack(this.stacks[index]!);
    this.stacks[index] = result.stack;
    if (!result.rackUnitId) return undefined;

    const rack = this.rackUnits.get(result.rackUnitId);
    if (!rack) return undefined;

    this.emit('inbound-start', `${gate.name} 空ラックを再利用しました`, {});
    return {
      ...rack,
      productSizeId,
      currentUnits: Math.min(units, rack.capacityUnits),
      status: 'loading',
      stackId: undefined,
      stackLevel: undefined,
      x: gate.point.x,
      y: gate.point.y,
    };
  }

  /** 出荷ゲート: 置かれたラックから商品を出荷する。 */
  private updateOutboundGate(gate: Gate, dt: number, open: boolean): void {
    for (const entry of [...gate.shipping]) {
      entry.remainingSeconds -= dt;
      gate.busySeconds += dt;
      if (entry.remainingSeconds > 0) continue;

      gate.shipping = gate.shipping.filter((e) => e !== entry);
      const rack = this.rackUnits.get(entry.rackUnitId);
      if (!rack) continue;

      const result = removeUnits(rack, entry.units);
      this.outboundUnits += result.removed;
      gate.processedUnits += result.removed;
      this.emit('outbound-done', `${gate.name} 出荷完了 ${entry.orderCode ?? ''}（${result.removed}本）`, {
        quantity: result.removed,
        orderId: entry.orderCode,
      });

      if (result.rack.currentUnits <= 0) {
        // 空になったラックは空ラック置き場へ (要件9・11)
        this.rackUnits.set(rack.id, {
          ...result.rack,
          status: 'empty',
          gateObjectId: gate.objectId,
          x: gate.point.x,
          y: gate.point.y,
        });
        this.emptyReturnQueue.push({ rackUnitId: rack.id, x: gate.point.x, y: gate.point.y });
        this.emit('drop', `${gate.name} ラックが空になりました → 空ラック置き場へ`, {});
      } else {
        // 在庫が残ったラックは倉庫へ戻す（再格納）
        this.rackUnits.set(rack.id, {
          ...result.rack,
          status: 'waiting',
          gateObjectId: gate.objectId,
          x: gate.point.x,
          y: gate.point.y,
        });
        this.putawayQueue.push({ rackUnitId: rack.id, x: gate.point.x, y: gate.point.y });
      }
    }

    // 滞留しているラックを能力の範囲で処理開始する
    while (open && gate.shipping.length < gate.concurrentSlots && gate.pendingRacks.length > 0) {
      const next = gate.pendingRacks.shift()!;
      gate.shipping.push({
        rackUnitId: next.rackUnitId,
        remainingSeconds: (next.units / gate.capacityPerHour) * 3600,
        units: next.units,
        orderCode: next.orderCode,
      });
      const rack = this.rackUnits.get(next.rackUnitId);
      if (rack) this.rackUnits.set(rack.id, { ...rack, status: 'unloading' });
    }
  }

  /** 予約の増減も空き状況の変化として扱う。 */
  private reserve(locationId: ID): void {
    this.reserved.add(locationId);
    this.slottingEpoch++;
  }

  private release(locationId: ID): void {
    if (this.reserved.delete(locationId)) this.slottingEpoch++;
  }

  /* --------------------------------------------------- 在庫索引の差分更新 */

  /**
   * ロケーションへラックを格納したときの索引更新。
   * 毎回全件から作り直す代わりに、変化した分だけ反映する。
   */
  private indexStore(locationId: ID, rack: RackUnit): void {
    this.occupancy.set(locationId, rack.id);
    this.freeLocationIds.delete(locationId);
    this.slottingEpoch++;

    if (rack.productSizeId) {
      let set = this.storedBySize.get(rack.productSizeId);
      if (!set) {
        set = new Set<ID>();
        this.storedBySize.set(rack.productSizeId, set);
      }
      set.add(locationId);
    }

    const areaId = this.locationsById.get(locationId)?.areaId;
    if (areaId) {
      this.inventoryByAreaCache.set(
        areaId,
        (this.inventoryByAreaCache.get(areaId) ?? 0) + rack.currentUnits,
      );
    }
  }

  /** ロケーションからラックを取り出したときの索引更新。 */
  private indexRemove(locationId: ID): void {
    const rackId = this.occupancy.get(locationId);
    const rack = rackId ? this.rackUnits.get(rackId) : undefined;
    this.occupancy.delete(locationId);
    if (!this.locationsById.get(locationId)?.blocked) this.freeLocationIds.add(locationId);
    this.slottingEpoch++;

    if (rack?.productSizeId) {
      this.storedBySize.get(rack.productSizeId)?.delete(locationId);
    }
    const areaId = this.locationsById.get(locationId)?.areaId;
    if (areaId && rack) {
      const next = (this.inventoryByAreaCache.get(areaId) ?? 0) - rack.currentUnits;
      this.inventoryByAreaCache.set(areaId, Math.max(0, next));
    }
  }

  /* ------------------------------------------------------------- 補助 */

  /**
   * 出庫対象の検索に使う「ロケーション -> 格納中ラック」。
   * 指定サイズの在庫だけを対象にするため、全件を作り直さない。
   */
  private storedRacksOfSize(productSizeId: ID): Map<ID, RackUnit> {
    const map = new Map<ID, RackUnit>();
    const locationIds = this.storedBySize.get(productSizeId);
    if (!locationIds) return map;
    for (const locationId of locationIds) {
      const rackId = this.occupancy.get(locationId);
      const rack = rackId ? this.rackUnits.get(rackId) : undefined;
      if (rack) map.set(locationId, rack);
    }
    return map;
  }

  /** 経路をキャッシュしつつ探索する。 */
  private getPath(from: Vec2, to: Vec2): PathResult {
    const key = `${from.x.toFixed(1)},${from.y.toFixed(1)}->${to.x.toFixed(1)},${to.y.toFixed(1)}`;
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    const path = findPath(this.grid, from, to);
    if (this.pathCache.size < 20_000) this.pathCache.set(key, path);
    return path;
  }

  /** 経路長（フリーロケーションの距離評価に使う）。 */
  private pathDistance(a: Vec2, b: Vec2): number {
    const key = `${a.x.toFixed(1)},${a.y.toFixed(1)}>${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    const cached = this.slotDistanceCache.get(key);
    if (cached !== undefined) return cached;
    const path = findPath(this.grid, a, b);
    const value = path.found ? path.lengthM : distance(a, b) * 3 + 1000;
    this.slotDistanceCache.set(key, value);
    return value;
  }

  private sizeLabel(id?: ID): string {
    if (!id) return '';
    return this.sizeById.get(id)?.code ?? id;
  }

  private emit(
    type: SimulationEventType,
    message: string,
    extra: Partial<SimulationEvent> = {},
  ): void {
    this.events.push({
      id: createId('ev'),
      simulationId: 'sim',
      atSec: this.timeSec,
      atClock: formatClock(this.startSec + this.timeSec),
      type,
      message,
      ...extra,
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /* ------------------------------------------------------------- 出力 */

  snapshot(): SimulationSnapshot {
    return {
      timeSec: this.timeSec,
      clock: formatClock(this.startSec + this.timeSec),
      running: !this.finished,
      finished: this.finished,
      vehicles: this.vehicles.map((v) => ({ ...v })),
      rackUnits: [...this.rackUnits.values()],
      stacks: this.stacks.map((s) => ({ ...s })),
      gates: [...this.gates.values()].map((g) => ({ ...g })),
      occupancy: new Map(this.occupancy),
      events: this.events,
      metrics: this.kpi(),
      heatmap: this.heat,
      pendingInbound: this.inboundPlan.length - this.inboundCursor + this.inboundQueue.length,
      pendingOutbound:
        this.outboundPlan.length - this.outboundCursor + this.retrievalQueue.length,
      unfulfilledOutboundUnits: this.unfulfilledOutboundUnits,
      abortedTasks: this.abortedTasks,
      unreachableCount: this.unreachablePoints.length,
    };
  }

  kpi(): SimulationKpi {
    const elapsed = Math.max(1, this.timeSec);
    const totalTravel = this.vehicles.reduce((sum, v) => sum + v.travelledM, 0);
    const working = this.vehicles.reduce((sum, v) => sum + v.workingSeconds, 0);
    const waiting = this.vehicles.reduce((sum, v) => sum + v.waitingSeconds, 0);
    const capacityTotal = this.input.locations.length;
    const used = this.occupancy.size;
    const storedUnits = [...this.occupancy.values()]
      .map((id) => this.rackUnits.get(id)?.currentUnits ?? 0)
      .reduce((a, b) => a + b, 0);
    const totalCapacityUnits = this.input.locations.reduce((sum, l) => sum + l.capacity, 0);

    const emptyRacks = [...this.rackUnits.values()].filter((r) => r.status === 'empty').length;
    const stackedRacks = this.stacks.reduce((sum, s) => sum + s.rackUnitIds.length, 0);

    return {
      elapsedSeconds: this.timeSec,
      inboundUnits: this.inboundUnits,
      outboundUnits: this.outboundUnits,
      plannedInboundUnits: this.plannedInboundUnits,
      plannedOutboundUnits: this.plannedOutboundUnits,
      pendingInboundUnits: this.inboundPlan
        .slice(this.inboundCursor)
        .reduce((sum, j) => sum + j.units, 0) + this.inboundQueue.reduce((sum, j) => sum + j.units, 0),
      pendingOutboundUnits:
        this.outboundPlan.slice(this.outboundCursor).reduce((sum, j) => sum + j.totalUnits, 0) +
        this.retrievalQueue.reduce((sum, r) => sum + r.remainingUnits, 0),
      totalTravelM: totalTravel,
      avgTravelPerTaskM: this.completedTasks === 0 ? 0 : totalTravel / this.completedTasks,
      completedTasks: this.completedTasks,
      avgTaskSeconds: this.completedTasks === 0 ? 0 : this.totalTaskSeconds / this.completedTasks,
      forkliftUtilization:
        this.vehicles.length === 0 ? 0 : working / (elapsed * this.vehicles.length),
      forkliftWaitSeconds: waiting,
      rackUnitsInUse: used,
      emptyRacks,
      stackedRacks,
      locationUsageRatio: capacityTotal === 0 ? 0 : used / capacityTotal,
      storageFillRatio: totalCapacityUnits === 0 ? 0 : storedUnits / totalCapacityUnits,
      speedViolationSeconds: this.vehicles.reduce((sum, v) => sum + v.speedViolationSeconds, 0),
      gates: [...this.gates.values()].map((gate) => ({
        objectId: gate.objectId,
        name: gate.name,
        type: gate.type,
        processedUnits: gate.processedUnits,
        plannedUnits: gate.plannedUnits,
        capacityPerHour: gate.capacityPerHour,
        utilization: gate.busySeconds / Math.max(1, elapsed * gate.concurrentSlots),
        totalWaitSeconds: gate.totalWaitSeconds,
        forkliftWaitSeconds: gate.forkliftWaitSeconds,
        peakQueueLength: gate.peakQueueLength,
        pendingRacks: gate.pendingRacks.length,
      })),
    };
  }
}

interface RetrievalRequest {
  id: ID;
  orderCode: string;
  gateObjectId: ID;
  productSizeId: ID;
  remainingUnits: number;
}

interface EmptyReturn {
  rackUnitId: ID;
  x: number;
  y: number;
}
