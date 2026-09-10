import { create } from 'zustand';
import {
  NavGrid,
  createId,
  createLayoutObject,
  createNamingRule,
  findDuplicateCodes,
  findPath,
  generateLocationsForRack,
  getObjectSpec,
  isRackObject,
  objectAABB,
  snap as snapValue,
} from '@ws/shared';
import type {
  GridSizeM,
  Layout,
  LayoutObject,
  LayoutObjectKind,
  LayoutSnapshot,
  Location,
  Path,
  RackObject,
  RackSpec,
  Vec2,
  Warehouse,
} from '@ws/shared';
import { api } from '../api/client';

export type Tool = 'select' | 'pan' | 'route';

export interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Viewport {
  /** 表示倍率 (1 = 倉庫の pixelsPerMeter そのまま) */
  zoom: number;
  /** ステージ上のオフセット (px) */
  offsetX: number;
  offsetY: number;
}

export interface ViewOptions {
  showGrid: boolean;
  showLocations: boolean;
  showLocationCodes: boolean;
  showObstacles: boolean;
  snapToGrid: boolean;
}

interface DocState {
  objects: LayoutObject[];
  locations: Location[];
}

const MAX_HISTORY = 50;
const MAX_LOGS = 300;

export interface EditorState {
  /* --- データ --- */
  warehouse: Warehouse | null;
  layout: Layout | null;
  layouts: Layout[];
  objects: LayoutObject[];
  locations: Location[];

  /* --- 状態 --- */
  selectedIds: string[];
  tool: Tool;
  /** ツールバーで選択中の配置待ちオブジェクト */
  placingKind: LayoutObjectKind | null;
  view: Viewport;
  options: ViewOptions;
  logs: LogEntry[];
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastSavedAt: string | null;

  /* --- 経路プレビュー (Phase 3 の走行検証) --- */
  routeStart: Vec2 | null;
  routePath: Path | null;
  routeInfo: { found: boolean; lengthM: number } | null;

  /* --- ダイアログ --- */
  rackDraft: { object: RackObject; isNew: boolean } | null;

  /* --- アクション --- */
  log: (message: string, level?: LogEntry['level']) => void;
  setTool: (tool: Tool) => void;
  setPlacingKind: (kind: LayoutObjectKind | null) => void;
  setView: (view: Partial<Viewport>) => void;
  zoomBy: (factor: number, focus?: Vec2) => void;
  fitToScreen: (stageWidth: number, stageHeight: number) => void;
  setOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;

  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  placeObject: (kind: LayoutObjectKind, at: Vec2) => void;
  updateObject: (id: string, patch: Partial<LayoutObject>, options?: { commit?: boolean }) => void;
  commitObjectChange: (label: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  rotateSelected: (deg: number) => void;
  nudgeSelected: (dx: number, dy: number) => void;

  openRackDraft: (rack: RackObject, isNew: boolean) => void;
  cancelRackDraft: () => void;
  applyRackDraft: (draft: { object: RackObject; spec: RackSpec }) => void;
  regenerateRackLocations: (rackId: string) => void;

  setRouteStart: (p: Vec2 | null) => void;
  computeRoute: (to: Vec2) => void;
  clearRoute: () => void;

  undo: () => void;
  redo: () => void;

  loadSnapshot: (snapshot: LayoutSnapshot, layouts?: Layout[]) => void;
  bootstrap: () => Promise<void>;
  openWarehouse: (warehouseId: string) => Promise<void>;
  openLayout: (layoutId: string) => Promise<void>;
  createWarehouse: (input: Partial<Warehouse> & { sample?: boolean }) => Promise<void>;
  updateWarehouseSettings: (patch: Partial<Warehouse>) => void;
  createLayout: (name: string, cloneCurrent: boolean) => Promise<void>;
  save: () => Promise<void>;

  /** 内部: 履歴 */
  _past: DocState[];
  _future: DocState[];
  _pushHistory: () => void;
}

const nowClock = (): string => new Date().toLocaleTimeString('ja-JP', { hour12: false });

function docOf(state: EditorState): DocState {
  return { objects: state.objects, locations: state.locations };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  warehouse: null,
  layout: null,
  layouts: [],
  objects: [],
  locations: [],

  selectedIds: [],
  tool: 'select',
  placingKind: null,
  view: { zoom: 1, offsetX: 40, offsetY: 40 },
  options: {
    showGrid: true,
    showLocations: true,
    showLocationCodes: false,
    showObstacles: false,
    snapToGrid: true,
  },
  logs: [],
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  lastSavedAt: null,

  routeStart: null,
  routePath: null,
  routeInfo: null,
  rackDraft: null,

  _past: [],
  _future: [],

  log: (message, level = 'info') =>
    set((s) => ({
      logs: [{ id: createId('log'), time: nowClock(), level, message }, ...s.logs].slice(0, MAX_LOGS),
    })),

  setTool: (tool) => set({ tool, placingKind: null, routeStart: null }),
  setPlacingKind: (placingKind) => set({ placingKind, tool: 'select' }),
  setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),

  zoomBy: (factor, focus) =>
    set((s) => {
      const zoom = Math.min(8, Math.max(0.1, s.view.zoom * factor));
      if (!focus) return { view: { ...s.view, zoom } };
      const ratio = zoom / s.view.zoom;
      return {
        view: {
          zoom,
          offsetX: focus.x - (focus.x - s.view.offsetX) * ratio,
          offsetY: focus.y - (focus.y - s.view.offsetY) * ratio,
        },
      };
    }),

  fitToScreen: (stageWidth, stageHeight) => {
    const { warehouse } = get();
    if (!warehouse || stageWidth <= 0 || stageHeight <= 0) return;
    const padding = 48;
    const ppm = warehouse.pixelsPerMeter;
    const zoom = Math.min(
      (stageWidth - padding * 2) / (warehouse.widthM * ppm),
      (stageHeight - padding * 2) / (warehouse.depthM * ppm),
    );
    const safeZoom = Math.max(0.05, zoom);
    set({
      view: {
        zoom: safeZoom,
        offsetX: (stageWidth - warehouse.widthM * ppm * safeZoom) / 2,
        offsetY: (stageHeight - warehouse.depthM * ppm * safeZoom) / 2,
      },
    });
  },

  setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),

  select: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
    })),
  clearSelection: () => set({ selectedIds: [] }),

  _pushHistory: () =>
    set((s) => ({
      _past: [...s._past, docOf(s)].slice(-MAX_HISTORY),
      _future: [],
      dirty: true,
    })),

  placeObject: (kind, at) => {
    const { layout, warehouse, options } = get();
    if (!layout || !warehouse) return;
    const spec = getObjectSpec(kind);
    const grid = options.snapToGrid ? warehouse.gridSizeM : 0;
    const x = snapValue(at.x - spec.defaultWidthM / 2, grid);
    const y = snapValue(at.y - spec.defaultDepthM / 2, grid);

    const object = createLayoutObject({ layoutId: layout.id, kind, x, y });
    const count = get().objects.filter((o) => o.kind === kind).length + 1;
    object.name = kind === 'forklift' ? `Forklift-${String(count).padStart(2, '0')}` : `${spec.label}${count}`;

    if (isRackObject(object)) {
      // ラックは配置直後に設定ダイアログを開き、ロケーションを自動生成する
      const area = String.fromCharCode('A'.charCodeAt(0) + ((count - 1) % 26));
      object.rack = { ...object.rack, naming: createNamingRule(area) };
      set({ rackDraft: { object, isNew: true }, placingKind: null });
      return;
    }
    if (object.kind === 'forklift') {
      object.forklift = { ...object.forklift, code: object.name };
    }

    get()._pushHistory();
    set((s) => ({ objects: [...s.objects, object], selectedIds: [object.id], placingKind: null }));
    get().log(`${spec.label}「${object.name}」を配置しました`);
  },

  updateObject: (id, patch, opts) => {
    if (opts?.commit) get()._pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as LayoutObject) : o)),
      dirty: true,
    }));
    // ラックの形状が変わったらロケーション座標を追従させる
    const target = get().objects.find((o) => o.id === id);
    if (target && isRackObject(target)) get().regenerateRackLocations(id);
  },

  commitObjectChange: (label) => {
    get()._pushHistory();
    get().log(label);
  },

  deleteSelected: () => {
    const { selectedIds, objects } = get();
    if (selectedIds.length === 0) return;
    const removed = objects.filter((o) => selectedIds.includes(o.id));
    if (removed.length === 0) return;
    get()._pushHistory();
    set((s) => ({
      objects: s.objects.filter((o) => !selectedIds.includes(o.id)),
      locations: s.locations.filter((l) => !selectedIds.includes(l.rackId)),
      selectedIds: [],
    }));
    get().log(`${removed.map((o) => o.name).join(', ')} を削除しました`);
  },

  duplicateSelected: () => {
    const { selectedIds, objects, locations, warehouse } = get();
    if (selectedIds.length === 0 || !warehouse) return;
    get()._pushHistory();
    const offset = warehouse.gridSizeM * 2;
    const newObjects: LayoutObject[] = [];
    const newLocations: Location[] = [];

    for (const obj of objects.filter((o) => selectedIds.includes(o.id))) {
      const copy = {
        ...obj,
        id: createId(obj.kind === 'forklift' ? 'fl' : obj.kind === 'rack' ? 'rack' : 'obj'),
        name: `${obj.name} コピー`,
        x: obj.x + offset,
        y: obj.y + offset,
      } as LayoutObject;
      newObjects.push(copy);
      if (isRackObject(copy)) {
        newLocations.push(...generateLocationsForRack(copy));
      }
    }
    set((s) => ({
      objects: [...s.objects, ...newObjects],
      locations: [...s.locations, ...newLocations],
      selectedIds: newObjects.map((o) => o.id),
    }));
    get().log(`${newObjects.length}件を複製しました`);
    const dups = findDuplicateCodes(get().locations);
    if (dups.size > 0) {
      get().log(`ロケーション番号が${dups.size}件重複しています。エリア記号を変更してください`, 'warn');
    }
  },

  rotateSelected: (deg) => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    get()._pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        selectedIds.includes(o.id) ? { ...o, rotationDeg: (o.rotationDeg + deg + 360) % 360 } : o,
      ),
    }));
    for (const id of selectedIds) {
      const obj = get().objects.find((o) => o.id === id);
      if (obj && isRackObject(obj)) get().regenerateRackLocations(id);
    }
    get().log(`${deg}度回転しました`);
  },

  nudgeSelected: (dx, dy) => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    set((s) => ({
      objects: s.objects.map((o) => (selectedIds.includes(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o)),
      dirty: true,
    }));
    for (const id of selectedIds) {
      const obj = get().objects.find((o) => o.id === id);
      if (obj && isRackObject(obj)) get().regenerateRackLocations(id);
    }
  },

  openRackDraft: (rack, isNew) => set({ rackDraft: { object: rack, isNew } }),
  cancelRackDraft: () => set({ rackDraft: null }),

  applyRackDraft: ({ object, spec }) => {
    const { rackDraft } = get();
    const isNew = rackDraft?.isNew ?? false;
    get()._pushHistory();

    const rack: RackObject = { ...object, rack: spec };
    const generated = generateLocationsForRack(rack);

    set((s) => {
      const objects = isNew ? [...s.objects, rack] : s.objects.map((o) => (o.id === rack.id ? rack : o));
      const locations = [...s.locations.filter((l) => l.rackId !== rack.id), ...generated];
      return { objects, locations, rackDraft: null, selectedIds: [rack.id] };
    });

    get().log(
      `${isNew ? '配置' : '更新'}: ${rack.name} — ${spec.columns}列 × ${spec.levels}段 = ${generated.length}ロケーションを自動生成`,
    );
    const dups = findDuplicateCodes(get().locations);
    if (dups.size > 0) {
      get().log(`ロケーション番号が重複しています: ${[...dups.keys()].slice(0, 5).join(', ')}`, 'warn');
    }
  },

  regenerateRackLocations: (rackId) => {
    const rack = get().objects.find((o) => o.id === rackId);
    if (!rack || !isRackObject(rack)) return;
    const previous = get().locations.filter((l) => l.rackId === rackId);
    const byCode = new Map(previous.map((l) => [l.code, l]));
    // 同じロケーション番号は ID を引き継ぐ (在庫の紐付けを維持するため)
    const regenerated = generateLocationsForRack(rack).map((loc) => {
      const old = byCode.get(loc.code);
      return old ? { ...loc, id: old.id } : loc;
    });
    set((s) => ({
      locations: [...s.locations.filter((l) => l.rackId !== rackId), ...regenerated],
    }));
  },

  setRouteStart: (p) => set({ routeStart: p, routePath: null, routeInfo: null }),

  computeRoute: (to) => {
    const { warehouse, objects, routeStart } = get();
    if (!warehouse || !routeStart) return;
    const grid = NavGrid.fromLayout(warehouse, objects, { cellM: 0.5, clearanceM: 0.7 });
    const result = findPath(grid, routeStart, to);
    set({ routePath: result, routeInfo: { found: result.found, lengthM: result.lengthM }, routeStart: null });
    get().log(
      result.found
        ? `走行ルート: ${result.lengthM.toFixed(1)}m (通路を通って到達可能)`
        : '走行ルートが見つかりません。通路が塞がれていないか確認してください',
      result.found ? 'info' : 'warn',
    );
  },

  clearRoute: () => set({ routePath: null, routeInfo: null, routeStart: null }),

  undo: () => {
    const { _past } = get();
    const previous = _past[_past.length - 1];
    if (!previous) return;
    set((s) => ({
      objects: previous.objects,
      locations: previous.locations,
      _past: s._past.slice(0, -1),
      _future: [docOf(s), ...s._future].slice(0, MAX_HISTORY),
      selectedIds: [],
      dirty: true,
    }));
    get().log('元に戻しました');
  },

  redo: () => {
    const { _future } = get();
    const next = _future[0];
    if (!next) return;
    set((s) => ({
      objects: next.objects,
      locations: next.locations,
      _past: [...s._past, docOf(s)].slice(-MAX_HISTORY),
      _future: s._future.slice(1),
      selectedIds: [],
      dirty: true,
    }));
    get().log('やり直しました');
  },

  loadSnapshot: (snapshot, layouts) =>
    set({
      warehouse: snapshot.warehouse,
      layout: snapshot.layout,
      objects: snapshot.objects,
      locations: snapshot.locations,
      layouts: layouts ?? get().layouts,
      selectedIds: [],
      _past: [],
      _future: [],
      dirty: false,
      error: null,
      routePath: null,
      routeStart: null,
    }),

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const { warehouses } = await api.listWarehouses();
      if (warehouses.length === 0) {
        // 初回起動: すぐ操作を試せるようサンプル倉庫を用意する
        const snapshot = await api.createWarehouse({ sample: true });
        get().loadSnapshot(snapshot, [snapshot.layout]);
        get().log('サンプル倉庫を作成しました。ラックをクリックすると設定を変更できます');
      } else {
        await get().openWarehouse(warehouses[0]!.id);
      }
    } catch (error) {
      set({ error: (error as Error).message });
      get().log(`読み込みに失敗しました: ${(error as Error).message}`, 'error');
    } finally {
      set({ loading: false });
    }
  },

  openWarehouse: async (warehouseId) => {
    set({ loading: true, error: null });
    try {
      const { layouts } = await api.getWarehouse(warehouseId);
      const first = layouts[0];
      if (!first) throw new Error('レイアウトがありません');
      const snapshot = await api.getLayout(first.id);
      get().loadSnapshot(snapshot, layouts);
      get().log(`倉庫「${snapshot.warehouse.name}」を読み込みました (ロケーション ${snapshot.locations.length}件)`);
    } catch (error) {
      set({ error: (error as Error).message });
      get().log(`読み込みに失敗しました: ${(error as Error).message}`, 'error');
    } finally {
      set({ loading: false });
    }
  },

  openLayout: async (layoutId) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await api.getLayout(layoutId);
      get().loadSnapshot(snapshot);
      get().log(`レイアウト「${snapshot.layout.name}」を読み込みました`);
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  createWarehouse: async (input) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await api.createWarehouse(input);
      get().loadSnapshot(snapshot, [snapshot.layout]);
      get().log(`倉庫「${snapshot.warehouse.name}」を作成しました`);
    } catch (error) {
      set({ error: (error as Error).message });
      get().log(`作成に失敗しました: ${(error as Error).message}`, 'error');
    } finally {
      set({ loading: false });
    }
  },

  updateWarehouseSettings: (patch) => {
    const { warehouse } = get();
    if (!warehouse) return;
    set({ warehouse: { ...warehouse, ...patch }, dirty: true });
  },

  createLayout: async (name, cloneCurrent) => {
    const { warehouse, layout, dirty } = get();
    if (!warehouse) return;
    if (cloneCurrent && dirty) await get().save();
    try {
      const snapshot = await api.createLayout(
        cloneCurrent && layout
          ? { cloneFromLayoutId: layout.id, name }
          : { warehouseId: warehouse.id, name },
      );
      const { layouts } = await api.getWarehouse(warehouse.id);
      get().loadSnapshot(snapshot, layouts);
      get().log(`レイアウト「${name}」を${cloneCurrent ? '複製' : '作成'}しました`);
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  save: async () => {
    const { layout, warehouse, objects, locations } = get();
    if (!layout || !warehouse) return;
    set({ saving: true, error: null });
    try {
      const result = await api.saveLayout(layout.id, { objects, locations, warehouse });
      set({
        dirty: false,
        lastSavedAt: nowClock(),
        objects: result.objects,
        locations: result.locations,
        warehouse: result.warehouse,
      });
      get().log(`保存しました (配置 ${result.objects.length}件 / ロケーション ${result.locations.length}件)`);
      const dup = result.warnings?.duplicateLocationCodes;
      if (dup && dup.length > 0) {
        get().log(`重複したロケーション番号: ${dup.slice(0, 5).join(', ')}`, 'warn');
      }
    } catch (error) {
      set({ error: (error as Error).message });
      get().log(`保存に失敗しました: ${(error as Error).message}`, 'error');
    } finally {
      set({ saving: false });
    }
  },
}));

/* ------------------------------------------------------------- セレクタ */

export interface LayoutStats {
  rackCount: number;
  locationCount: number;
  totalCapacity: number;
  forkliftCount: number;
  objectCount: number;
  floorAreaM2: number;
  rackAreaM2: number;
  duplicateCodes: number;
}

/**
 * レイアウトの集計。
 *
 * zustand v5 のセレクタは毎回新しいオブジェクトを返すと再描画ループになるため、
 * ストア購読ではなく、購読した配列から useMemo で計算する形にしている。
 */
export function computeStats(
  objects: readonly LayoutObject[],
  locations: readonly Location[],
  warehouse: Warehouse | null,
): LayoutStats {
  const racks = objects.filter(isRackObject);
  const rackArea = racks.reduce((sum, r) => sum + r.widthM * r.depthM, 0);
  return {
    rackCount: racks.length,
    locationCount: locations.length,
    totalCapacity: locations.reduce((sum, l) => sum + l.capacity, 0),
    forkliftCount: objects.filter((o) => o.kind === 'forklift').length,
    objectCount: objects.length,
    floorAreaM2: warehouse ? warehouse.widthM * warehouse.depthM : 0,
    rackAreaM2: rackArea,
    duplicateCodes: findDuplicateCodes(locations).size,
  };
}

export function selectSelectedObject(state: EditorState): LayoutObject | undefined {
  if (state.selectedIds.length !== 1) return undefined;
  return state.objects.find((o) => o.id === state.selectedIds[0]);
}

/** 倉庫の外にはみ出した配置を検出する (保存前の注意喚起用)。 */
export function findOutOfBounds(
  objects: readonly LayoutObject[],
  warehouse: Warehouse | null,
): LayoutObject[] {
  if (!warehouse) return [];
  return objects.filter((o) => {
    const box = objectAABB(o);
    return (
      box.x < -0.01 ||
      box.y < -0.01 ||
      box.x + box.widthM > warehouse.widthM + 0.01 ||
      box.y + box.depthM > warehouse.depthM + 0.01
    );
  });
}

export type { GridSizeM, Layout, LayoutObject, Location, RackObject, Warehouse };
