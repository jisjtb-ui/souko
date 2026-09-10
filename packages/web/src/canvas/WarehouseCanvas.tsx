import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { isRackObject, objectAABB, rectsOverlap, snap as snapValue } from '@ws/shared';
import type { LayoutObjectKind, Vec2 } from '@ws/shared';
import { useEditorStore } from '../store/editorStore';
import { useContainerSize } from './useContainerSize';
import { GridLayer } from './GridLayer';
import { LocationLayer } from './LocationLayer';
import { ObjectShape } from './ObjectShape';
import { ObstacleOverlay, RouteOverlay, SelectionBox } from './OverlayLayers';

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

  const [selectionBox, setSelectionBox] = useState<DragBox | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const dragOrigin = useRef<Vec2 | null>(null);
  const panOrigin = useRef<{ pointer: Vec2; offset: Vec2 } | null>(null);

  const scale = (warehouse?.pixelsPerMeter ?? 8) * view.zoom;
  const gridM = options.snapToGrid ? (warehouse?.gridSizeM ?? 0) : 0;

  const fitToScreen = useEditorStore((s) => s.fitToScreen);
  useEffect(() => {
    if (warehouse && size.width > 0) fitToScreen(size.width, size.height);
    // 倉庫を切り替えたときだけ全体表示に合わせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouse?.id, size.width, size.height]);

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

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault();
    const p = pointer();
    if (!p) return;
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    useEditorStore.getState().zoomBy(factor, p);
  };

  const isPanGesture = (e: Konva.KonvaEventObject<MouseEvent>): boolean =>
    tool === 'pan' || spaceHeld || e.evt.button === 1;

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const p = pointer();
    if (!p) return;
    const meters = toMeters(p);
    const store = useEditorStore.getState();

    if (isPanGesture(e)) {
      panOrigin.current = { pointer: p, offset: { x: view.offsetX, y: view.offsetY } };
      return;
    }

    // オブジェクト上のクリックは ObjectShape 側で処理済み
    const clickedEmpty = e.target === e.target.getStage() || e.target.name() === 'floor';

    if (placingKind) {
      store.placeObject(placingKind, meters);
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

  const handleStageMouseMove = (): void => {
    const p = pointer();
    if (!p) return;

    if (panOrigin.current) {
      const { pointer: origin, offset } = panOrigin.current;
      useEditorStore.getState().setView({
        offsetX: offset.x + (p.x - origin.x),
        offsetY: offset.y + (p.y - origin.y),
      });
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
    panOrigin.current = null;
    if (dragOrigin.current && selectionBox) {
      if (selectionBox.widthM > 0.3 || selectionBox.depthM > 0.3) {
        const hits = objects.filter((o) => rectsOverlap(objectAABB(o), selectionBox)).map((o) => o.id);
        useEditorStore.getState().select(hits);
      }
      dragOrigin.current = null;
      setSelectionBox(null);
    }
  };

  const handleSelect = (id: string, additive: boolean): void => {
    const store = useEditorStore.getState();
    if (additive) store.toggleSelect(id);
    else if (!store.selectedIds.includes(id)) store.select([id]);
  };

  const handleDragStart = (): void => {
    useEditorStore.getState()._pushHistory();
  };

  const handleDragMove = (id: string, node: Konva.Node): void => {
    const x = snapValue(node.x(), gridM);
    const y = snapValue(node.y(), gridM);
    node.position({ x, y });
    useEditorStore.getState().updateObject(id, { x, y });
  };

  const handleDragEnd = (id: string): void => {
    const obj = useEditorStore.getState().objects.find((o) => o.id === id);
    if (obj) useEditorStore.getState().log(`${obj.name} を移動しました (${obj.x.toFixed(1)}, ${obj.y.toFixed(1)})`);
  };

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

  const highlightRackId = useMemo(() => {
    if (selectedIds.length !== 1) return undefined;
    const obj = objects.find((o) => o.id === selectedIds[0]);
    return obj && isRackObject(obj) ? obj.id : undefined;
  }, [selectedIds, objects]);

  const cursor = placingKind
    ? 'copy'
    : tool === 'pan' || spaceHeld
      ? 'grab'
      : tool === 'route'
        ? 'crosshair'
        : 'default';

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
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer ref={layerRef} x={view.offsetX} y={view.offsetY} scaleX={scale} scaleY={scale}>
            <GridLayer warehouse={warehouse} scale={scale} visible={options.showGrid} />

            {options.showObstacles && (
              <ObstacleOverlay warehouse={warehouse} objects={objects} clearanceM={0.7} />
            )}

            {objects.map((object) => (
              <ObjectShape
                key={object.id}
                object={object}
                scale={scale}
                selected={selectedIds.includes(object.id)}
                showLabel={scale > 3}
                draggable={tool === 'select' && !spaceHeld && !placingKind}
                passThrough={Boolean(placingKind) || tool === 'route'}
                onSelect={handleSelect}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDoubleClick={(id) => {
                  const obj = useEditorStore.getState().objects.find((o) => o.id === id);
                  if (obj && isRackObject(obj)) useEditorStore.getState().openRackDraft(obj, false);
                }}
              />
            ))}

            {options.showLocations && (
              <LocationLayer
                objects={objects}
                locations={locations}
                scale={scale}
                showCodes={options.showLocationCodes}
                highlightRackId={highlightRackId}
              />
            )}

            <RouteOverlay path={routePath} start={routeStart} scale={scale} />
            <SelectionBox box={selectionBox} scale={scale} />

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

      {(placingKind || tool === 'route') && (
        <div className="canvas-hint">
          {placingKind
            ? 'マップ上をクリックして配置します（Escで取消）'
            : routeInfo
              ? `走行ルート ${routeInfo.lengthM.toFixed(1)}m — もう一度2点をクリックすると再計算します`
              : '走行ルート確認: 出発点 → 目的地 の順にクリックしてください'}
        </div>
      )}
    </>
  );
}
