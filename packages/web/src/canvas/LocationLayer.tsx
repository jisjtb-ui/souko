import { useMemo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import { isRackObject } from '@ws/shared';
import type { LayoutObject, Location } from '@ws/shared';

interface Props {
  objects: LayoutObject[];
  locations: Location[];
  scale: number;
  showCodes: boolean;
  highlightRackId?: string | undefined;
}

interface Cell {
  key: string;
  rackId: string;
  /** ロケーション中心 (ワールド座標) */
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  rotationDeg: number;
  code: string;
  levels: number;
}

/**
 * ラック内のロケーションを平面図に描く。
 * 2D では同じ列の各段が重なるため、列ごとに1マスとしてまとめて表示する
 * (段数は在庫パネル側で確認する)。
 */
export function LocationLayer({ objects, locations, scale, showCodes, highlightRackId }: Props): JSX.Element {
  const cells = useMemo<Cell[]>(() => {
    const rackById = new Map(objects.filter(isRackObject).map((r) => [r.id, r]));
    const byColumn = new Map<string, Location[]>();
    for (const loc of locations) {
      const key = `${loc.rackId}#${loc.column}`;
      const list = byColumn.get(key);
      if (list) list.push(loc);
      else byColumn.set(key, [loc]);
    }

    const out: Cell[] = [];
    for (const [key, list] of byColumn) {
      const first = [...list].sort((a, b) => a.level - b.level)[0]!;
      const rack = rackById.get(first.rackId);
      if (!rack) continue;
      out.push({
        key,
        rackId: first.rackId,
        x: first.x,
        y: first.y,
        widthM: first.widthM,
        depthM: first.depthM,
        rotationDeg: rack.rotationDeg,
        code: first.code,
        levels: list.length,
      });
    }
    return out;
  }, [objects, locations]);

  const fontSize = 9 / scale;
  const showText = showCodes && scale > 5;

  return (
    <Group listening={false}>
      {cells.map((cell) => (
        <Group key={cell.key} x={cell.x} y={cell.y} rotation={cell.rotationDeg}>
          <Rect
            x={-cell.widthM / 2}
            y={-cell.depthM / 2}
            width={cell.widthM}
            height={cell.depthM}
            stroke={cell.rackId === highlightRackId ? '#1668dc' : '#8fa6c4'}
            strokeWidth={0.6 / scale}
            fill={cell.rackId === highlightRackId ? 'rgba(22,104,220,0.12)' : undefined}
          />
          {showText && (
            <Text
              x={-cell.widthM / 2 + 0.05}
              y={-fontSize / 2}
              width={cell.widthM - 0.1}
              text={cell.code}
              fontSize={fontSize}
              fill="#33465e"
              align="center"
              ellipsis
              wrap="none"
            />
          )}
        </Group>
      ))}
    </Group>
  );
}
