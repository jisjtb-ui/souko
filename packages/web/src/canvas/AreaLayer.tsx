import { Circle, Group, Line, Text } from 'react-konva';
import type Konva from 'konva';
import { areaCentroid, areaSizeM2, areaWorldPolygon } from '@ws/shared';
import type { Area, Vec2 } from '@ws/shared';

interface Props {
  areas: Area[];
  scale: number;
  selectedAreaId: string | null;
  /** 接続作成中に始点として選ばれているエリア */
  connectFromAreaId: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  /** ドラッグ確定時に移動量 (m) を渡す */
  onDragEnd: (id: string, delta: Vec2) => void;
  onVertexDragStart: () => void;
  onVertexDrag: (areaId: string, index: number, p: Vec2) => void;
  onVertexDragEnd: (areaId: string) => void;
  onVertexContextMenu: (areaId: string, index: number) => void;
}

const KIND_COLOR: Record<string, string> = {
  building: '#ffffff',
  extension: '#fbf7ee',
  'outdoor-yard': '#f2f6ef',
  mezzanine: '#f5f1fa',
};

/**
 * エリア（倉庫を構成する自由形状の区画）の描画。
 *
 * 床として一番下に描き、外周を「壁」として太線で表現する。
 * 選択中のエリアは頂点ハンドルを表示し、ドラッグで形状を編集できる。
 */
export function AreaLayer({
  areas,
  scale,
  selectedAreaId,
  connectFromAreaId,
  editable,
  onSelect,
  onDragStart,
  onDragEnd,
  onVertexDragStart,
  onVertexDrag,
  onVertexDragEnd,
  onVertexContextMenu,
}: Props): JSX.Element {
  return (
    <Group>
      {areas.map((area) => {
        const world = areaWorldPolygon(area);
        const points = world.flatMap((p) => [p.x, p.y]);
        const selected = area.id === selectedAreaId;
        const isConnectSource = area.id === connectFromAreaId;
        const centroid = areaCentroid(area);
        const fontSize = 13 / scale;

        return (
          <Group key={area.id}>
            <Line
              points={points}
              closed
              fill={area.color ?? KIND_COLOR[area.kind] ?? '#ffffff'}
              stroke={isConnectSource ? '#f59e0b' : selected ? '#1668dc' : '#3d4854'}
              strokeWidth={(selected || isConnectSource ? 4 : 2.5) / scale}
              lineJoin="round"
              draggable={editable && selected && !area.locked}
              onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
                if (!editable) return;
                e.cancelBubble = true;
                onSelect(area.id);
              }}
              onDragStart={() => onDragStart(area.id)}
              onDragEnd={(e) => {
                const delta = { x: e.target.x(), y: e.target.y() };
                e.target.position({ x: 0, y: 0 });
                onDragEnd(area.id, delta);
              }}
            />

            <Text
              x={centroid.x - 6}
              y={centroid.y - fontSize}
              width={12}
              align="center"
              text={`${area.name}\n${areaSizeM2(area).toFixed(0)} ㎡`}
              fontSize={fontSize}
              fill={selected ? '#1668dc' : '#7c8794'}
              listening={false}
            />

            {selected && editable && (
              <Group>
                {world.map((vertex, index) => (
                  <Circle
                    key={index}
                    x={vertex.x}
                    y={vertex.y}
                    radius={5 / scale}
                    fill="#ffffff"
                    stroke="#1668dc"
                    strokeWidth={2 / scale}
                    draggable
                    onDragStart={onVertexDragStart}
                    onDragMove={(e) => onVertexDrag(area.id, index, { x: e.target.x(), y: e.target.y() })}
                    onDragEnd={() => onVertexDragEnd(area.id)}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      onVertexContextMenu(area.id, index);
                    }}
                  />
                ))}
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** 多角形エリアを作図中のプレビュー。 */
export function PolygonDraftLayer({
  draft,
  cursor,
  scale,
}: {
  draft: Vec2[] | null;
  cursor: Vec2 | null;
  scale: number;
}): JSX.Element | null {
  if (!draft || draft.length === 0) return null;
  const preview = cursor ? [...draft, cursor] : draft;
  const points = preview.flatMap((p) => [p.x, p.y]);

  return (
    <Group listening={false}>
      <Line
        points={points}
        closed={draft.length >= 3}
        stroke="#1668dc"
        strokeWidth={2 / scale}
        dash={[0.6, 0.4]}
        fill={draft.length >= 3 ? 'rgba(22,104,220,0.10)' : undefined}
      />
      {draft.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={(i === 0 ? 7 : 4) / scale}
          fill={i === 0 ? '#1668dc' : '#ffffff'}
          stroke="#1668dc"
          strokeWidth={1.5 / scale}
        />
      ))}
    </Group>
  );
}
