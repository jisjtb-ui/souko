import { create } from 'zustand';
import {
  NavGrid,
  areaSizeM2,
  areasBounds,
  assignAreaIds,
  assignLocationAreaIds,
  computeAreaStats,
  createArea,
  createConnection,
  createId,
  createShutter,
  createLayoutObject,
  createNamingRule,
  findDuplicateCodes,
  findPath,
  generateLocationsForRack,
  getObjectSpec,
  ensureDefaultArea,
  findAreaAt,
  isRackObject,
  objectAABB,
  polygonArea,
  snap as snapValue,
  suggestConnection,
  totalWarehouseArea,
} from '@ws/shared';
import type {
  Area,
  AreaConnection,
  AreaKind,
  AreaStats,
  GridSizeM,
  HeatmapLayerKey,
  Layout,
  LayoutObject,
  LayoutObjectKind,
  LayoutSnapshot,
  Location,
  Path,
  ProductSize,
  RackObject,
  RackSpec,
  RackType,
  Shutter,
  Vec2,
  Warehouse,
} from '@ws/shared';
import { api } from '../api/client';

export type Tool = 'select' | 'pan' | 'route' | 'area-rect' | 'area-polygon' | 'connect';

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
  /** ヒートマップの表示レイヤー（null = 非表示） */
  heatmapLayer: HeatmapLayerKey | null;
  showGrid: boolean;
  showLocations: boolean;
  showLocationCodes: boolean;
  showObstacles: boolean;
  snapToGrid: boolean;
}

interface DocState {
  objects: LayoutObject[];
  locations: Location[];
  areas: Area[];
  connections: AreaConnection[];
  shutters: Shutter[];
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
  /** 倉庫を構成する区画 */
  areas: Area[];
  /** エリア間の接続口 */
  connections: AreaConnection[];
  /** 接続口に設置されたシャッター */
  shutters: Shutter[];
  /** ラック種別マスタ (小型 / 大型) */
  rackTypes: RackType[];
  /** 商品サイズマスタ */
  productSizes: ProductSize[];

  /* --- 状態 --- */
  selectedIds: string[];
  /** 選択中のエリア / 接続口 (オブジェクト選択とは排他) */
  selectedAreaId: string | null;
  selectedConnectionId: string | null;
  /** 多角形エリア作成中の頂点 */
  polygonDraft: Vec2[] | null;
  /** 接続作成時に最初に選んだエリア */
  connectFromAreaId: string | null;
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

  /* --- エリア --- */
  selectArea: (id: string | null) => void;
  selectConnection: (id: string | null) => void;
  addRectArea: (x: number, y: number, widthM: number, depthM: number) => void;
  startPolygonArea: () => void;
  addPolygonVertex: (p: Vec2) => void;
  finishPolygonArea: () => void;
  cancelPolygonArea: () => void;
  updateArea: (id: string, patch: Partial<Area>, options?: { commit?: boolean }) => void;
  moveAreaVertex: (areaId: string, index: number, p: Vec2) => void;
  addAreaVertex: (areaId: string, index: number) => void;
  removeAreaVertex: (areaId: string, index: number) => void;
  /** エリアを重心を中心に拡大・縮小する */
  scaleArea: (areaId: string, factor: number) => void;
  deleteArea: (id: string) => void;
  duplicateArea: (id: string) => void;
  beginConnect: (areaId: string) => void;
  completeConnect: (areaId: string) => void;
  updateConnection: (id: string, patch: Partial<AreaConnection>, options?: { commit?: boolean }) => void;
  deleteConnection: (id: string) => void;
  addShutter: (connectionId: string) => void;
  toggleShutter: (connectionId: string) => void;
  removeShutter: (connectionId: string) => void;
  /** オブジェクト・ロケーションの所属エリアを再計算する */
  reassignAreas: () => void;

  /* --- マスタ --- */
  loadMasters: (warehouseId: string) => Promise<void>;
  updateRackType: (id: string, patch: Partial<RackType>) => void;
  updateProductSize: (id: string, patch: Partial<ProductSize>) => void;
  addProductSize: () => void;
  removeProductSize: (id: string) => void;
  saveMasters: () => Promise<void>;

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
  return {
    objects: state.objects,
    locations: state.locations,
    areas: state.areas,
    connections: state.connections,
    shutters: state.shutters,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  warehouse: null,
  layout: null,
  layouts: [],
  objects: [],
  locations: [],
  areas: [],
  connections: [],
  shutters: [],
  rackTypes: [],
  productSizes: [],

  selectedIds: [],
  selectedAreaId: null,
  selectedConnectionId: null,
  polygonDraft: null,
  connectFromAreaId: null,
  tool: 'select',
  placingKind: null,
  view: { zoom: 1, offsetX: 40, offsetY: 40 },
  options: {
    heatmapLayer: null,
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

  setTool: (tool) =>
    set({ tool, placingKind: null, routeStart: null, polygonDraft: null, connectFromAreaId: null }),
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
    // 全エリアを含む範囲に合わせる（全体表示）
    const { areas } = get();
    const bounds = areas.length > 0 ? areasBounds(areas) : { x: 0, y: 0, widthM: 0, depthM: 0 };
    const extentX = Math.max(warehouse.widthM, bounds.x + bounds.widthM);
    const extentY = Math.max(warehouse.depthM, bounds.y + bounds.depthM);
    const zoom = Math.min(
      (stageWidth - padding * 2) / (extentX * ppm),
      (stageHeight - padding * 2) / (extentY * ppm),
    );
    const safeZoom = Math.max(0.05, zoom);
    set({
      view: {
        zoom: safeZoom,
        offsetX: (stageWidth - extentX * ppm * safeZoom) / 2,
        offsetY: (stageHeight - extentY * ppm * safeZoom) / 2,
      },
    });
  },

  setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),

  select: (ids) => set({ selectedIds: ids, selectedAreaId: null, selectedConnectionId: null }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
    })),
  clearSelection: () =>
    set({ selectedIds: [], selectedAreaId: null, selectedConnectionId: null }),

  _pushHistory: () =>
    set((s) => ({
      _past: [...s._past, docOf(s)].slice(-MAX_HISTORY),
      _future: [],
      dirty: true,
    })),


  /* ------------------------------------------------------------- エリア */

  selectArea: (id) => set({ selectedAreaId: id, selectedIds: [], selectedConnectionId: null }),
  selectConnection: (id) => set({ selectedConnectionId: id, selectedIds: [], selectedAreaId: null }),

  addRectArea: (x, y, widthM, depthM) => {
    const { warehouse, layout, areas } = get();
    if (!warehouse || !layout) return;
    if (widthM < 0.5 || depthM < 0.5) return;
    get()._pushHistory();
    const area = createArea({
      warehouseId: warehouse.id,
      layoutId: layout.id,
      name: `エリア${areas.length + 1}`,
      x,
      y,
      widthM,
      depthM,
      z: areas.length,
    });
    set((s) => ({ areas: [...s.areas, area], selectedAreaId: area.id, tool: 'select' }));
    get().reassignAreas();
    get().log(`矩形エリア「${area.name}」を追加しました（${areaSizeM2(area).toFixed(1)} ㎡）`);
  },

  startPolygonArea: () => set({ tool: 'area-polygon', polygonDraft: [], placingKind: null }),

  addPolygonVertex: (p) =>
    set((s) => ({ polygonDraft: [...(s.polygonDraft ?? []), { x: p.x, y: p.y }] })),

  finishPolygonArea: () => {
    const { polygonDraft, warehouse, layout, areas } = get();
    if (!polygonDraft || polygonDraft.length < 3 || !warehouse || !layout) {
      set({ polygonDraft: null, tool: 'select' });
      return;
    }
    // 最初の頂点を原点にした相対座標で保持する
    const origin = polygonDraft[0]!;
    const polygon = polygonDraft.map((v) => ({ x: v.x - origin.x, y: v.y - origin.y }));
    if (polygonArea(polygon) < 0.5) {
      get().log('面積が小さすぎます。頂点を置き直してください', 'warn');
      set({ polygonDraft: null, tool: 'select' });
      return;
    }
    get()._pushHistory();
    const area = createArea({
      warehouseId: warehouse.id,
      layoutId: layout.id,
      name: `エリア${areas.length + 1}`,
      x: origin.x,
      y: origin.y,
      polygon,
      z: areas.length,
    });
    set((s) => ({
      areas: [...s.areas, area],
      polygonDraft: null,
      tool: 'select',
      selectedAreaId: area.id,
    }));
    get().reassignAreas();
    get().log(
      `多角形エリア「${area.name}」を追加しました（${polygon.length}頂点 / ${areaSizeM2(area).toFixed(1)} ㎡）`,
    );
  },

  cancelPolygonArea: () => set({ polygonDraft: null, tool: 'select' }),

  updateArea: (id, patch, opts) => {
    if (opts?.commit) get()._pushHistory();
    set((s) => ({ areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)), dirty: true }));
    get().reassignAreas();
  },

  moveAreaVertex: (areaId, index, p) => {
    set((s) => ({
      areas: s.areas.map((a) => {
        if (a.id !== areaId) return a;
        const polygon = a.polygon.map((v, i) =>
          i === index ? { x: p.x - a.x, y: p.y - a.y } : v,
        );
        return { ...a, polygon, type: 'polygon' as const };
      }),
      dirty: true,
    }));
  },

  addAreaVertex: (areaId, index) => {
    get()._pushHistory();
    set((s) => ({
      areas: s.areas.map((a) => {
        if (a.id !== areaId) return a;
        const next = a.polygon[(index + 1) % a.polygon.length]!;
        const current = a.polygon[index]!;
        const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
        const polygon = [...a.polygon];
        polygon.splice(index + 1, 0, mid);
        return { ...a, polygon, type: 'polygon' as const };
      }),
    }));
    get().log('頂点を追加しました');
  },

  removeAreaVertex: (areaId, index) => {
    const area = get().areas.find((a) => a.id === areaId);
    if (!area || area.polygon.length <= 3) {
      get().log('頂点は3つ以上必要です', 'warn');
      return;
    }
    get()._pushHistory();
    set((s) => ({
      areas: s.areas.map((a) =>
        a.id === areaId
          ? { ...a, polygon: a.polygon.filter((_, i) => i !== index), type: 'polygon' as const }
          : a,
      ),
    }));
    get().log('頂点を削除しました');
  },

  scaleArea: (areaId, factor) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const area = get().areas.find((a) => a.id === areaId);
    if (!area) return;
    get()._pushHistory();
    // ローカル多角形の重心を基準に拡大縮小する（位置は動かさない）
    const cx = area.polygon.reduce((sum, v) => sum + v.x, 0) / area.polygon.length;
    const cy = area.polygon.reduce((sum, v) => sum + v.y, 0) / area.polygon.length;
    set((s) => ({
      areas: s.areas.map((a) =>
        a.id === areaId
          ? {
              ...a,
              polygon: a.polygon.map((v) => ({
                x: cx + (v.x - cx) * factor,
                y: cy + (v.y - cy) * factor,
              })),
            }
          : a,
      ),
    }));
    get().reassignAreas();
    get().log(`エリア「${area.name}」を ${Math.round(factor * 100)}% に変更しました`);
  },

  deleteArea: (id) => {
    const area = get().areas.find((a) => a.id === id);
    if (!area) return;
    get()._pushHistory();
    const removedConnections = get().connections.filter(
      (c) => c.fromAreaId === id || c.toAreaId === id,
    );
    const removedIds = new Set(removedConnections.map((c) => c.id));
    set((s) => ({
      areas: s.areas.filter((a) => a.id !== id),
      connections: s.connections.filter((c) => !removedIds.has(c.id)),
      shutters: s.shutters.filter((sh) => !removedIds.has(sh.connectionId)),
      selectedAreaId: null,
    }));
    get().reassignAreas();
    get().log(
      `エリア「${area.name}」を削除しました${removedConnections.length > 0 ? `（接続口 ${removedConnections.length} 件も削除）` : ''}`,
    );
  },

  duplicateArea: (id) => {
    const { areas, warehouse } = get();
    const area = areas.find((a) => a.id === id);
    if (!area || !warehouse) return;
    get()._pushHistory();
    const copy: Area = {
      ...area,
      id: createId('area'),
      name: `${area.name} コピー`,
      x: area.x + warehouse.gridSizeM * 4,
      y: area.y + warehouse.gridSizeM * 4,
      z: areas.length,
      polygon: area.polygon.map((v) => ({ ...v })),
    };
    set((s) => ({ areas: [...s.areas, copy], selectedAreaId: copy.id }));
    get().log(`エリア「${area.name}」を複製しました`);
  },

  beginConnect: (areaId) => set({ connectFromAreaId: areaId }),

  completeConnect: (areaId) => {
    const { connectFromAreaId, areas, warehouse, layout } = get();
    if (!connectFromAreaId || !warehouse || !layout) return;
    if (connectFromAreaId === areaId) {
      get().log('同じエリア同士は接続できません', 'warn');
      return;
    }
    const from = areas.find((a) => a.id === connectFromAreaId);
    const to = areas.find((a) => a.id === areaId);
    if (!from || !to) return;

    get()._pushHistory();
    const suggestion = suggestConnection(from, to);
    const connection = createConnection({
      warehouseId: warehouse.id,
      layoutId: layout.id,
      name: `${from.name} ⇔ ${to.name}`,
      fromAreaId: from.id,
      toAreaId: to.id,
      x: suggestion.x,
      y: suggestion.y,
      widthM: suggestion.widthM,
      spanM: suggestion.spanM,
      rotationDeg: suggestion.rotationDeg,
    });
    set((s) => ({
      connections: [...s.connections, connection],
      connectFromAreaId: null,
      tool: 'select',
      selectedConnectionId: connection.id,
      selectedAreaId: null,
      selectedIds: [],
    }));
    get().log(
      `接続口「${connection.name}」を作成しました（幅 ${connection.widthM}m / 離隔 ${suggestion.distance.toFixed(1)}m）`,
    );
  },

  updateConnection: (id, patch, opts) => {
    if (opts?.commit) get()._pushHistory();
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      dirty: true,
    }));
  },

  deleteConnection: (id) => {
    const connection = get().connections.find((c) => c.id === id);
    if (!connection) return;
    get()._pushHistory();
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      shutters: s.shutters.filter((sh) => sh.connectionId !== id),
      selectedConnectionId: null,
    }));
    get().log(`接続口「${connection.name}」を削除しました`);
  },

  addShutter: (connectionId) => {
    if (get().shutters.some((s) => s.connectionId === connectionId)) return;
    get()._pushHistory();
    const shutter = createShutter(connectionId);
    set((s) => ({
      shutters: [...s.shutters, shutter],
      connections: s.connections.map((c) =>
        c.id === connectionId ? { ...c, type: 'shutter' as const } : c,
      ),
    }));
    get().log('シャッターを設置しました（初期状態: 開）');
  },

  toggleShutter: (connectionId) => {
    get()._pushHistory();
    let nextState: 'open' | 'closed' = 'open';
    set((s) => ({
      shutters: s.shutters.map((sh) => {
        if (sh.connectionId !== connectionId) return sh;
        nextState = sh.state === 'open' ? 'closed' : 'open';
        return { ...sh, state: nextState };
      }),
    }));
    const connection = get().connections.find((c) => c.id === connectionId);
    get().log(
      `${connection?.name ?? '接続口'} のシャッターを${nextState === 'open' ? '開' : '閉'}にしました`,
      nextState === 'open' ? 'info' : 'warn',
    );
    get().clearRoute();
  },

  removeShutter: (connectionId) => {
    get()._pushHistory();
    set((s) => ({ shutters: s.shutters.filter((sh) => sh.connectionId !== connectionId) }));
    get().log('シャッターを撤去しました');
  },

  loadMasters: async (warehouseId) => {
    try {
      const [types, sizes] = await Promise.all([
        api.listRackTypes(warehouseId),
        api.listProductSizes(warehouseId),
      ]);
      set({ rackTypes: types.rackTypes, productSizes: sizes.productSizes });
    } catch {
      // マスタ未登録でもエディタは動作するため、失敗しても致命的ではない
      set({ rackTypes: [], productSizes: [] });
    }
  },

  updateRackType: (id, patch) =>
    set((s) => ({
      rackTypes: s.rackTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      dirty: true,
    })),

  updateProductSize: (id, patch) =>
    set((s) => ({
      productSizes: s.productSizes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      dirty: true,
    })),

  addProductSize: () => {
    const { warehouse, productSizes } = get();
    if (!warehouse) return;
    const size: ProductSize = {
      id: createId('psz'),
      warehouseId: warehouse.id,
      code: `SIZE-${productSizes.length + 1}`,
      name: '新しいサイズ',
      rackCategory: 'small',
      unitsPerRack: 20,
      weightPerUnitKg: 10,
      inboundRatioPct: 0,
      outboundRatioPct: 0,
      turnover: 'medium',
    };
    set((s) => ({ productSizes: [...s.productSizes, size], dirty: true }));
  },

  removeProductSize: (id) =>
    set((s) => ({ productSizes: s.productSizes.filter((p) => p.id !== id), dirty: true })),

  saveMasters: async () => {
    const { warehouse, rackTypes, productSizes } = get();
    if (!warehouse) return;
    try {
      const [types, sizes] = await Promise.all([
        api.saveRackTypes(warehouse.id, rackTypes),
        api.saveProductSizes(warehouse.id, productSizes),
      ]);
      set({ rackTypes: types.rackTypes, productSizes: sizes.productSizes });
      get().log('マスタ（ラック種別・商品サイズ）を保存しました');
    } catch (error) {
      get().log(`マスタの保存に失敗しました: ${(error as Error).message}`, 'error');
    }
  },

  reassignAreas: () => {
    const { areas } = get();
    if (areas.length === 0) return;
    set((s) => {
      const objects = assignAreaIds(s.objects, areas);
      return { objects, locations: assignLocationAreaIds(s.locations, areas, objects) };
    });
  },

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
    const { warehouse, objects, routeStart, areas, connections, shutters } = get();
    if (!warehouse || !routeStart) return;
    const grid = NavGrid.fromLayout(warehouse, objects, {
      cellM: 0.5,
      clearanceM: 0.7,
      areas,
      connections,
      shutters,
    });
    const result = findPath(grid, routeStart, to);
    set({ routePath: result, routeInfo: { found: result.found, lengthM: result.lengthM }, routeStart: null });
    get().log(
      result.found
        ? `走行ルート: ${result.lengthM.toFixed(1)}m (通路を通って到達可能)`
        : '走行ルートが見つかりません。通路の確保・エリアの接続口・シャッターの開閉を確認してください',
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
      areas: previous.areas,
      connections: previous.connections,
      shutters: previous.shutters,
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
      areas: next.areas,
      connections: next.connections,
      shutters: next.shutters,
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
      // エリア未設定の旧データは倉庫全体を覆うエリア1つへ移行する
      areas: ensureDefaultArea(snapshot.warehouse, snapshot.layout.id, snapshot.areas ?? []),
      connections: snapshot.connections ?? [],
      shutters: snapshot.shutters ?? [],
      objects: snapshot.objects,
      locations: snapshot.locations,
      layouts: layouts ?? get().layouts,
      selectedIds: [],
      selectedAreaId: null,
      selectedConnectionId: null,
      polygonDraft: null,
      connectFromAreaId: null,
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
        await get().loadMasters(snapshot.warehouse.id);
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
      await get().loadMasters(snapshot.warehouse.id);
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
      await get().loadMasters(snapshot.warehouse.id);
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
    const { layout, warehouse, objects, locations, areas, connections, shutters } = get();
    if (!layout || !warehouse) return;
    set({ saving: true, error: null });
    try {
      const result = await api.saveLayout(layout.id, {
        objects,
        locations,
        areas,
        connections,
        shutters,
        warehouse,
      });
      set({
        dirty: false,
        lastSavedAt: nowClock(),
        objects: result.objects,
        locations: result.locations,
        areas: result.areas,
        connections: result.connections,
        shutters: result.shutters,
        warehouse: result.warehouse,
      });
      await get().saveMasters();
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

/** エリアごとの集計。 */
export function computeAreaStatsList(
  areas: readonly Area[],
  objects: readonly LayoutObject[],
  locations: readonly Location[],
): AreaStats[] {
  return areas.map((area) => computeAreaStats(area, objects, locations));
}

/** 倉庫総面積（重なりを二重計上しない）。 */
export function computeTotalArea(areas: readonly Area[]): number {
  return totalWarehouseArea(areas);
}

/** 座標からエリアを特定する（キャンバスのクリック判定用）。 */
export function areaAtPoint(areas: readonly Area[], p: Vec2): Area | undefined {
  return findAreaAt(areas, p);
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

export type {
  Area,
  AreaConnection,
  AreaKind,
  AreaStats,
  ProductSize,
  RackType,
  GridSizeM,
  Layout,
  LayoutObject,
  Location,
  RackObject,
  Shutter,
  Warehouse,
};
