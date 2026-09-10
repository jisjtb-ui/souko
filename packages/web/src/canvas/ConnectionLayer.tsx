import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { connectionPolygon, isConnectionPassable } from '@ws/shared';
import type { AreaConnection, Shutter } from '@ws/shared';

interface Props {
  connections: AreaConnection[];
  shutters: Shutter[];
  scale: number;
  selectedConnectionId: string | null;
  onSelect: (id: string) => void;
}

/**
 * エリア間の接続口とシャッターの描画。
 *
 * 通行可能な接続口は緑、シャッターが閉じている（または通行不可の）接続口は赤で表示し、
 * 「どこが通れてどこが壁なのか」が一目で分かるようにする。
 */
export function ConnectionLayer({
  connections,
  shutters,
  scale,
  selectedConnectionId,
  onSelect,
}: Props): JSX.Element {
  return (
    <Group>
      {connections.map((connection) => {
        const polygon = connectionPolygon(connection);
        const points = polygon.flatMap((p) => [p.x, p.y]);
        const shutter = shutters.find((s) => s.connectionId === connection.id);
        const passable = isConnectionPassable(connection, shutters);
        const selected = connection.id === selectedConnectionId;
        const color = passable ? '#2f9e5f' : '#c0392b';
        const fontSize = 11 / scale;

        return (
          <Group key={connection.id}>
            <Line
              points={points}
              closed
              fill={passable ? 'rgba(47,158,95,0.18)' : 'rgba(192,57,43,0.18)'}
              stroke={selected ? '#1668dc' : color}
              strokeWidth={(selected ? 3 : 1.6) / scale}
              dash={passable ? undefined : [0.5, 0.35]}
              onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
                e.cancelBubble = true;
                onSelect(connection.id);
              }}
            />

            {/* 開口線（実際に通れる幅） */}
            <Line
              points={[polygon[0]!.x, polygon[0]!.y, polygon[1]!.x, polygon[1]!.y]}
              stroke={color}
              strokeWidth={3 / scale}
              listening={false}
            />
            <Line
              points={[polygon[2]!.x, polygon[2]!.y, polygon[3]!.x, polygon[3]!.y]}
              stroke={color}
              strokeWidth={3 / scale}
              listening={false}
            />

            {shutter && (
              <Rect
                x={connection.x - connection.widthM / 2}
                y={connection.y - 0.35}
                width={connection.widthM}
                height={0.7}
                rotation={connection.rotationDeg}
                offsetX={0}
                fill={shutter.state === 'open' ? 'rgba(47,158,95,0.35)' : 'rgba(192,57,43,0.75)'}
                stroke={color}
                strokeWidth={1 / scale}
                listening={false}
              />
            )}

            <Text
              x={connection.x - 6}
              y={connection.y - fontSize * 2.2}
              width={12}
              align="center"
              text={shutter ? `${shutter.state === 'open' ? '⬍ 開' : '⛔ 閉'}` : '⬍ 開口'}
              fontSize={fontSize}
              fill={color}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
