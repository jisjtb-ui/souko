import { useMemo } from 'react';
import { Circle, Group, Line, Shape } from 'react-konva';
import { NavGrid } from '@ws/shared';
import type { LayoutObject, Path, Vec2, Warehouse } from '@ws/shared';

/**
 * 走行不可エリアの可視化。
 * セル数が多いため、1つの Shape 内でまとめて描画して負荷を抑える。
 */
export function ObstacleOverlay({
  warehouse,
  objects,
  clearanceM,
}: {
  warehouse: Warehouse;
  objects: LayoutObject[];
  clearanceM: number;
}): JSX.Element {
  const grid = useMemo(
    () => NavGrid.fromLayout(warehouse, objects, { cellM: 0.5, clearanceM }),
    [warehouse, objects, clearanceM],
  );

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.fillStyle = 'rgba(200, 60, 60, 0.18)';
        const size = grid.cellM;
        for (let cy = 0; cy < grid.rows; cy++) {
          for (let cx = 0; cx < grid.cols; cx++) {
            if (grid.isBlocked(cx, cy)) ctx.fillRect(cx * size, cy * size, size, size);
          }
        }
      }}
    />
  );
}

/** A* が返した走行ルートの表示。 */
export function RouteOverlay({
  path,
  start,
  scale,
}: {
  path: Path | null;
  start: Vec2 | null;
  scale: number;
}): JSX.Element | null {
  if (!path && !start) return null;
  const points = path?.points.flatMap((p) => [p.x, p.y]) ?? [];
  const last = path?.points.at(-1);

  return (
    <Group listening={false}>
      {points.length >= 4 && (
        <Line points={points} stroke="#1668dc" strokeWidth={3 / scale} lineCap="round" lineJoin="round" dash={[1, 0.5]} />
      )}
      {start && <Circle x={start.x} y={start.y} radius={0.5} fill="#1668dc" opacity={0.8} />}
      {path?.points[0] && <Circle x={path.points[0].x} y={path.points[0].y} radius={0.45} fill="#1668dc" />}
      {last && <Circle x={last.x} y={last.y} radius={0.45} fill="#c0392b" />}
    </Group>
  );
}

/** 範囲選択の矩形。 */
export function SelectionBox({ box, scale }: { box: { x: number; y: number; widthM: number; depthM: number } | null; scale: number }): JSX.Element | null {
  if (!box) return null;
  return (
    <Line
      listening={false}
      closed
      points={[
        box.x,
        box.y,
        box.x + box.widthM,
        box.y,
        box.x + box.widthM,
        box.y + box.depthM,
        box.x,
        box.y + box.depthM,
      ]}
      stroke="#1668dc"
      strokeWidth={1 / scale}
      dash={[0.4, 0.3]}
      fill="rgba(22,104,220,0.08)"
    />
  );
}
