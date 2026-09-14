import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { findAreaAt, isRackObject, objectAABB, rectsOverlap, snap as snapValue } from '@ws/shared';
import type { LayoutObjectKind, Vec2 } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';
import { useContainerSize } from './useContainerSize';
import { AreaLayer, PolygonDraftLayer } from './AreaLayer';
import { ConnectionLayer } from './ConnectionLayer';
import { GridLayer } from './GridLayer';
import { LocationLayer } from './LocationLayer';
import { ObjectShape } from './ObjectShape';
import { ObstacleOverlay, RouteOverlay, SelectionBox } from './OverlayLayers';
import { HeatmapOverlay } from './HeatmapLayer';
import { SimulationLayer } from './SimulationLayer';
import { useSimulationStore } from '../store/simulationStore';

interface DragBox {
  x: number;
  y: number;
  widthM: number;
  depthM: number;
}

/**
 * 2D 倉庫マップ。
 *
 * Konva のレイヤー自体を「1m = scale px」で拡大しているため、
 * 子要素はすべてメートル単位の座標をそのまま指定できる。
 */
export function WarehouseCanvas(): JSX.Element {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);

  const warehouse = useEditorStore((s) => s.warehouse);
  const objects = useEditorStore((s) => s.objects);
  const locations = useEditorStore((s) => s.locations);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const placingKind = useEditorStore((s) => s.placingKind);
  const view = useEditorStore((s) => s.view);
  const options = useEditorStore((s) => s.options);
  const routePath = useEditorStore((s) => s.routePath);
  const routeStart = useEditorStore((s) => s.routeStart);
  const routeInfo = useEditorStore((s) => s.routeInfo);
  const areas = useEditorStore((s) => s.areas);
  const connections = useEditorStore((s) => s.connections);
  const shutters = useEditorStore((s) => s.shutters);
  const selectedAreaId = useEditorStore((s) => s.selectedAreaId);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const polygonDraft = useEditorStore((s) => s.polygonDraft);
  const connectFromAreaId = useEditorStore((s) => s.connectFromAreaId);
  const simSnapshot = useSimulationStore((s) => s.snapshot);

  const [selectionBox, setSelectionBox] = useState<DragBox | null>(null);
  const [areaDraftBox, setAreaDraftBox] = useState<DragBox | null>(null);
  const [cursorM, setCursorM] = useState<Vec2 | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const areaDragOrigin = useRef<{ x: number; y: number } | null>(null);
  /** ホイールイベントを1フレーム分まとめるためのバッファ */
  const wheelAccum = useRef<{ factor: number; focus: Vec2; raf: number } | null>(null);
  const dragOrigin = useRef<Vec2 | null>(null);
  const panOrigin = useRef<{ pointer: Vec2; offset: Vec2; moved: boolean } | null>(null);
  /** 2本指ピンチの開始時の指間距離と倍率 */
  const pinchOrigin = useRef<{ distance: number; zoom: number } | null>(null);

  const scale = (warehouse?.pixelsPerMeter ?? 8) * view.zoom;

  /** 画面に映っている範囲（m）。描画のカリングに使う。 */
  const viewport = useMemo(
    () => ({
      x: -view.offsetX / scale,
      y: -view.offsetY / scale,
      widthM: size.width / scale,
      depthM: size.height / scale,
    }),
    [view.offsetX, view.offsetY, scale, size.width, size.height],
  );
  const gridM = options.snapToGrid ? (warehouse?.gridSizeM ?? 0) : 0;

  const fitToScreen = useEditorStore((s) => s.fitToScreen);
  useEffect(() => {
    if (warehouse && size.width > 0) fitToScreen(size.width, size.height);
    // 倉庫を切り替えたときだけ全体表示に合わせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouse?.id, size.width, size.height]);

  /* 未処理のホイール更新を残さない */
  useEffect(
    () => () => {
      if (wheelAccum.current) cancelAnimationFrame(wheelAccum.current.raf);
    },
    [],
  );

  /* スペースキーで一時的にパンモードにする (業務系CADの慣習) */
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* 選択に合わせて変形ハンドルを付け替える */
  useEffect(() => {
    const transformer = transformerRef.current;
    const layer = layerRef.current;
    if (!transformer || !layer) return;
    const nodes = selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((n): n is Konva.Node => Boolean(n));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, objects]);

  const toMeters = useCallback(
    (pointer: Vec2): Vec2 => ({
      x: (pointer.x - view.offsetX) / scale,
      y: (pointer.y - view.offsetY) / scale,
    }),
    [view.offsetX, view.offsetY, scale],
  );

  const pointer = (): Vec2 | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? { x: p.x, y: p.y } : null;
  };

  /**
   * ホイールは1フレームに何度も発火するため、requestAnimationFrame で
   * 1フレーム1回の更新にまとめる（倍率は掛け合わせるので最終結果は同じ）。
   */
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault();
    const p = pointer();
    if (!p) return;
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;

    const pending = wheelAccum.current;
    if (pending) {
      pending.factor *= factor;
      pending.focus = p;
      return;
    }
    wheelAccum.current = {
      factor,
      focus: p,
      raf: requestAnimationFrame(() => {
        const current = wheelAccum.current;
        wheelAccum.current = null;
        if (current) useEditorStore.getState().zoomBy(current.factor, current.focus);
      }),
    };
  };

  const isPanGesture = (e: Konva.KonvaEventObject<MouseEvent>): boolean =>
    tool === 'pan' || spaceHeld || e.evt.button === 1;

  /** 何もない場所を掴んだか（掴んだらドラッグでマップを動かせる） */
  const isEmptyTarget = (target: Konva.Node): boolean =>
    target === target.getStage() || target.name() === 'floor';

  const beginPan = (p: Vec2): void => {
    panOrigin.current = { pointer: p, offset: { x: view.offsetX, y: view.offsetY }, moved: false };
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const p = pointer();
    if (!p) return;
    const meters = toMeters(p);
    const store = useEditorStore.getState();

    if (isPanGesture(e)) {
      beginPan(p);
      return;
    }

    // オブジェクト上のクリックは ObjectShape 側で処理済み
    const clickedEmpty = isEmptyTarget(e.target);

    // 選択ツールで何もない所をドラッグ → マップを動かす（スワイプ）
    // 範囲選択は Shift を押しながらのドラッグに割り当てている
    if (tool === 'select' && !placingKind && clickedEmpty && !e.evt.shiftKey) {
      beginPan(p);
      return;
    }

    if (placingKind) {
      store.placeObject(placingKind, meters);
      return;
    }
    if (tool === 'area-rect') {
      dragOrigin.current = snapPoint(meters);
      setAreaDraftBox({ x: meters.x, y: meters.y, widthM: 0, depthM: 0 });
      return;
    }
    if (tool === 'area-polygon') {
      const snapped = snapPoint(meters);
      const draft = store.polygonDraft ?? [];
      // 始点付近をクリックしたら閉じて確定する
      if (draft.length >= 3) {
        const first = draft[0]!;
        if (Math.hypot(first.x - snapped.x, first.y - snapped.y) < Math.max(1, 8 / scale)) {
          store.finishPolygonArea();
          return;
        }
      }
      store.addPolygonVertex(snapped);
      return;
    }
    if (tool === 'connect') {
      const area = findAreaAt(store.areas, meters);
      if (!area) {
        store.log('エリアの内側をクリックしてください', 'warn');
        return;
      }
      if (store.connectFromAreaId) store.completeConnect(area.id);
      else {
        store.beginConnect(area.id);
        store.log(`「${area.name}」を選択しました。接続先のエリアをクリックしてください`);
      }
      return;
    }
    if (tool === 'route') {
      if (store.routeStart) store.computeRoute(meters);
      else store.setRouteStart(meters);
      return;
    }
    if (clickedEmpty) {
      if (!e.evt.shiftKey) store.clearSelection();
      dragOrigin.current = meters;
      setSelectionBox({ x: meters.x, y: meters.y, widthM: 0, depthM: 0 });
    }
  };

  const snapPoint = (p: Vec2): Vec2 => ({ x: snapValue(p.x, gridM), y: snapValue(p.y, gridM) });

  const handleStageMouseMove = (): void => {
    const p = pointer();
    if (!p) return;
    const meters = toMeters(p);
    setCursorM(snapPoint(meters));

    if (dragOrigin.current && tool === 'area-rect') {
      const origin = dragOrigin.current;
      const current = snapPoint(meters);
      setAreaDraftBox({
        x: Math.min(origin.x, current.x),
        y: Math.min(origin.y, current.y),
        widthM: Math.abs(current.x - origin.x),
        depthM: Math.abs(current.y - origin.y),
      });
      return;
    }

    if (panOrigin.current) {
      const { pointer: origin, offset } = panOrigin.current;
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      // 数ピクセルの揺れはクリック扱いにする（クリックで選択解除できるように）
      if (!panOrigin.current.moved && Math.hypot(dx, dy) > 3) panOrigin.current.moved = true;
      useEditorStore.getState().setView({ offsetX: offset.x + dx, offsetY: offset.y + dy });
      return;
    }
    if (dragOrigin.current) {
      const current = toMeters(p);
      const origin = dragOrigin.current;
      setSelectionBox({
        x: Math.min(origin.x, current.x),
        y: Math.min(origin.y, current.y),
        widthM: Math.abs(current.x - origin.x),
        depthM: Math.abs(current.y - origin.y),
      });
    }
  };

  const handleStageMouseUp = (): void => {
    const pan = panOrigin.current;
    panOrigin.current = null;
    pinchOrigin.current = null;

    // 動かさずに離した＝クリック。選択ツールなら選択を解除する。
    if (pan && !pan.moved && tool === 'select' && !placingKind) {
      useEditorStore.getState().clearSelection();
    }

    if (tool === 'area-rect' && areaDraftBox) {
      const { x, y, widthM, depthM } = areaDraftBox;
      dragOrigin.current = null;
      setAreaDraftBox(null);
      if (widthM >= 0.5 && depthM >= 0.5) {
        useEditorStore.getState().addRectArea(x, y, widthM, depthM);
      }
      return;
    }

    if (dragOrigin.current && selectionBox) {
      if (selectionBox.widthM > 0.3 || selectionBox.depthM > 0.3) {
        const hits = objects.filter((o) => rectsOverlap(objectAABB(o), selectionBox)).map((o) => o.id);
        useEditorStore.getState().select(hits);
      }
      dragOrigin.current = null;
      setSelectionBox(null);
    }
  };

  /* ------------------------------------------------------------ タッチ操作 */

  const touchDistance = (touches: TouchList): number => {
    const a = touches[0]!;
    const b = touches[1]!;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  /** 1本指で何もない所をなぞる → スワイプでマップを動かす。2本指 → ピンチで拡大縮小。 */
  const handleTouchStart = (e: Konva.KonvaEventObject<TouchEvent>): void => {
    const touches = e.evt.touches;
    if (touches.length >= 2) {
      e.evt.preventDefault();
      panOrigin.current = null;
      pinchOrigin.current = { distance: touchDistance(touches), zoom: view.zoom };
      return;
    }
    if (touches.length !== 1) return;
    // オブジェクトの上は Konva のドラッグに任せる（移動できなくなるため）
    if (!isEmptyTarget(e.target)) return;
    const p = pointer();
    if (!p) return;
    e.evt.preventDefault();
    beginPan(p);
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>): void => {
    const touches = e.evt.touches;

    if (pinchOrigin.current && touches.length >= 2) {
      e.evt.preventDefault();
      const { distance, zoom } = pinchOrigin.current;
      if (distance <= 0) return;
      const stage = stageRef.current;
      const rect = stage?.container().getBoundingClientRect();
      const focus = rect
        ? {
            x: (touches[0]!.clientX + touches[1]!.clientX) / 2 - rect.left,
            y: (touches[0]!.clientY + touches[1]!.clientY) / 2 - rect.top,
          }
        : { x: size.width / 2, y: size.height / 2 };
      const next = zoom * (touchDistance(touches) / distance);
      // zoomBy は「現在の倍率に対する係数」を受け取るので割り算で換算する
      useEditorStore.getState().zoomBy(next / view.zoom, focus);
      return;
    }

    if (panOrigin.current && touches.length === 1) {
      e.evt.preventDefault();
      handleStageMouseMove();
    }
  };

  const handleTouchEnd = (): void => {
    handleStageMouseUp();
  };

  const handleSelect = useCallback((id: string, additive: boolean): void => {
    const store = useEditorStore.getState();
    if (additive) store.toggleSelect(id);
    else if (!store.selectedIds.includes(id)) store.select([id]);
  }, []);

  const handleDragStart = useCallback((): void => {
    useEditorStore.getState()._pushHistory();
  }, []);

  const handleDragMove = useCallback(
    (id: string, node: Konva.Node): void => {
      const x = snapValue(node.x(), gridM);
      const y = snapValue(node.y(), gridM);
      node.position({ x, y });
      useEditorStore.getState().updateObject(id, { x, y });
    },
    [gridM],
  );

  const handleDragEnd = useCallback((id: string): void => {
    const obj = useEditorStore.getState().objects.find((o) => o.id === id);
    if (obj) useEditorStore.getState().log(`${obj.name} を移動しました (${obj.x.toFixed(1)}, ${obj.y.toFixed(1)})`);
  }, []);

  const handleObjectDoubleClick = useCallback((id: string): void => {
    const obj = useEditorStore.getState().objects.find((o) => o.id === id);
    if (obj && isRackObject(obj)) useEditorStore.getState().openRackDraft(obj, false);
  }, []);

  /** 変形ハンドル操作の確定: scale を実寸 (m) に反映する。 */
  const handleTransformEnd = (): void => {
    const layer = layerRef.current;
    if (!layer) return;
    const store = useEditorStore.getState();
    store._pushHistory();

    for (const id of store.selectedIds) {
      const node = layer.findOne(`#${id}`);
      if (!node) continue;
      const obj = store.objects.find((o) => o.id === id);
      if (!obj) continue;
      const widthM = Math.max(0.2, snapValue(obj.widthM * node.scaleX(), gridM || 0.1));
      const depthM = Math.max(0.2, snapValue(obj.depthM * node.scaleY(), gridM || 0.1));
      node.scale({ x: 1, y: 1 });
      store.updateObject(id, {
        widthM,
        depthM,
        x: snapValue(node.x(), gridM),
        y: snapValue(node.y(), gridM),
        rotationDeg: Math.round(node.rotation()),
      });
    }
    store.log('サイズ・角度を変更しました');
  };

  const handleAreaDragStart = (id: string): void => {
    const store = useEditorStore.getState();
    store._pushHistory();
    const area = store.areas.find((a) => a.id === id);
    areaDragOrigin.current = area ? { x: area.x, y: area.y } : null;
  };

  const handleAreaDragEnd = (id: string, delta: Vec2): void => {
    const origin = areaDragOrigin.current;
    areaDragOrigin.current = null;
    if (!origin) return;
    const store = useEditorStore.getState();
    store.updateArea(id, {
      x: snapValue(origin.x + delta.x, gridM),
      y: snapValue(origin.y + delta.y, gridM),
    });
    const area = store.areas.find((a) => a.id === id);
    if (area) store.log(`エリア「${area.name}」を移動しました`);
  };

  const handleVertexDrag = (areaId: string, index: number, p: Vec2): void => {
    useEditorStore.getState().moveAreaVertex(areaId, index, {
      x: snapValue(p.x, gridM),
      y: snapValue(p.y, gridM),
    });
  };

  const highlightRackId = useMemo(() => {
    if (selectedIds.length !== 1) return undefined;
    const obj = objects.find((o) => o.id === selectedIds[0]);
    return obj && isRackObject(obj) ? obj.id : undefined;
  }, [selectedIds, objects]);

  const cursor = placingKind
    ? 'copy'
    : tool === 'pan' || spaceHeld
      ? 'grab'
      : tool === 'route' || tool === 'area-rect' || tool === 'area-polygon' || tool === 'connect'
        ? 'crosshair'
        : // 選択ツールでは何もない所をドラッグするとマップが動くので、掴める見た目にする
          'grab';

  /** ツールバーからのドラッグ＆ドロップ配置 */
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/x-ws-kind') as LayoutObjectKind | '';
    if (!kind) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const meters = toMeters({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    useEditorStore.getState().placeObject(kind, meters);
  };

  return (
    <div
      ref={containerRef}
      className="canvas-host"
      style={{ cursor }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {warehouse && size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onMouseLeave={handleStageMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer ref={layerRef} x={view.offsetX} y={view.offsetY} scaleX={scale} scaleY={scale}>
            <GridLayer
              warehouse={warehouse}
              scale={scale}
              visible={options.showGrid}
              viewport={viewport}
            />

            <AreaLayer
              areas={areas}
              scale={scale}
              selectedAreaId={selectedAreaId}
              connectFromAreaId={connectFromAreaId}
              editable={tool === 'select' && !placingKind}
              onSelect={(id) => useEditorStore.getState().selectArea(id)}
              onDragStart={handleAreaDragStart}
              onDragEnd={handleAreaDragEnd}
              onVertexDragStart={() => useEditorStore.getState()._pushHistory()}
              onVertexDrag={handleVertexDrag}
              onVertexDragEnd={(areaId) => {
                const store = useEditorStore.getState();
                store.reassignAreas();
                const area = store.areas.find((a) => a.id === areaId);
                if (area) store.log(`エリア「${area.name}」の形状を変更しました`);
              }}
              onVertexContextMenu={(areaId, index) =>
                useEditorStore.getState().removeAreaVertex(areaId, index)
              }
            />

            <ConnectionLayer
              connections={connections}
              shutters={shutters}
              scale={scale}
              selectedConnectionId={selectedConnectionId}
              onSelect={(id) => useEditorStore.getState().selectConnection(id)}
            />

            {options.showObstacles && (
              <ObstacleOverlay
                warehouse={warehouse}
                objects={objects}
                clearanceM={0.7}
                areas={areas}
                connections={connections}
                shutters={shutters}
              />
            )}

            {objects.map((object) => (
              <ObjectShape
                key={object.id}
                object={object}
                scale={scale}
                selected={selectedIds.includes(object.id)}
                showLabel={scale > 3}
                draggable={tool === 'select' && !spaceHeld && !placingKind}
                passThrough={Boolean(placingKind) || tool !== 'select'}
                onSelect={handleSelect}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDoubleClick={handleObjectDoubleClick}
              />
            ))}

            {options.showLocations && (
              <LocationLayer
                objects={objects}
                locations={locations}
                scale={scale}
                showCodes={options.showLocationCodes}
                highlightRackId={highlightRackId}
                viewport={viewport}
              />
            )}

            {/*
              ヒートマップは配置オブジェクトの上に重ねる。
              渋滞はゲート上で起きるため、下に敷くとゲートの塗りに隠れてしまう。
            */}
            {simSnapshot && options.heatmapLayer && (
              <HeatmapOverlay heatmap={simSnapshot.heatmap} layer={options.heatmapLayer} />
            )}

            {simSnapshot && (
              <SimulationLayer snapshot={simSnapshot} locations={locations} scale={scale} />
            )}

            <RouteOverlay
              path={routePath}
              start={routeStart}
              scale={scale}
              blocked={routeInfo ? !routeInfo.found : false}
            />
            <SelectionBox box={selectionBox} scale={scale} />
            <SelectionBox box={areaDraftBox} scale={scale} />
            <PolygonDraftLayer draft={polygonDraft} cursor={cursorM} scale={scale} />

            <Transformer
              ref={transformerRef}
              rotateEnabled
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              keepRatio={false}
              ignoreStroke
              anchorSize={8}
              borderStroke="#1668dc"
              anchorStroke="#1668dc"
              onTransformEnd={handleTransformEnd}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
            />
          </Layer>
        </Stage>
      )}

      <CanvasHud />
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** 倍率・座標などの小さな表示。 */
function CanvasHud(): JSX.Element {
  const view = useEditorStore((s) => s.view);
  const warehouse = useEditorStore((s) => s.warehouse);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const routeInfo = useEditorStore((s) => s.routeInfo);
  const tool = useEditorStore((s) => s.tool);
  const placingKind = useEditorStore((s) => s.placingKind);

  return (
    <>
      <div className="canvas-hud">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} title="縮小">
          −
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} title="拡大">
          ＋
        </button>
        <span className="hud-sep" />
        <span>
          {warehouse ? `${warehouse.widthM}m × ${warehouse.depthM}m` : '-'} / 1m = {warehouse?.pixelsPerMeter ?? 0}px
        </span>
      </div>

      {tool === 'select' && !placingKind && (
        <div className="canvas-hint subtle">
          ドラッグでマップを移動 / Shift+ドラッグで範囲選択 / ホイールで拡大縮小
        </div>
      )}

      {(placingKind || tool === 'route') && (
        <div className="canvas-hint">
          {placingKind
            ? 'マップ上をクリックして配置します（Escで取消）'
            : routeInfo
              ? routeInfo.found
                ? `走行ルート ${routeInfo.lengthM.toFixed(1)}m — もう一度2点をクリックすると再計算します`
                : '到達できません — 表示中の経路は行き止まりまでです（接続口・シャッターを確認してください）'
              : '走行ルート確認: 出発点 → 目的地 の順にクリックしてください'}
        </div>
      )}
    </>
  );
}
