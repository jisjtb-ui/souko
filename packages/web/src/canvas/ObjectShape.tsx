import { memo } from 'react';
import { Group, Line, Rect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { getObjectSpec, isForkliftObject, isRackObject } from '@ws/shared';
import type { LayoutObject } from '@ws/shared';

interface Props {
  object: LayoutObject;
  scale: number;
  selected: boolean;
  showLabel: boolean;
  draggable: boolean;
  /** 配置ツール/経路ツール使用中は、クリックをステージ側へ通す */
  passThrough: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, node: Konva.Node) => void;
  onDragEnd: (id: string) => void;
  onDoubleClick: (id: string) => void;
}

/**
 * 配置オブジェクト1件の描画。
 * 座標系はメートル。Konva の Group を (x, y) 回転中心として使う。
 */
function ObjectShapeBase({
  object,
  scale,
  selected,
  showLabel,
  draggable,
  passThrough,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
}: Props): JSX.Element {
  const spec = getObjectSpec(object.kind);
  const stroke = selected ? '#1668dc' : spec.stroke;
  const strokeWidth = (selected ? 2.5 : 1.2) / scale;
  const fontSize = 12 / scale;
  const isArea = spec.group === 'area';
  // ラックの内側はロケーション表示に使うため、名前は枠の外に出す。
  // 細長い・幅の狭いオブジェクトも文字が潰れるので同様に外へ出す。
  // (全角前提で1文字あたり fontSize 分の幅を見込む)
  const labelOutside =
    isRackObject(object) || object.depthM * scale < 18 || object.name.length * fontSize > object.widthM;
  // 背中合わせのラックは上に出すと相手のラックに重なるため、通路側(下)へ出す
  const labelBelow = labelOutside && isRackObject(object) && object.rack.face === 'back';

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (passThrough) return; // 配置/経路指定はステージ側で処理する
    e.cancelBubble = true;
    onSelect(object.id, e.evt.shiftKey);
  };

  return (
    <Group
      id={object.id}
      name="layout-object"
      x={object.x}
      y={object.y}
      rotation={object.rotationDeg}
      draggable={draggable && !object.locked}
      onMouseDown={handleClick}
      onTap={handleClick}
      onDblClick={() => onDoubleClick(object.id)}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => onDragMove(object.id, e.target)}
      onDragEnd={() => onDragEnd(object.id)}
    >
      <Rect
        width={object.widthM}
        height={object.depthM}
        fill={object.color ?? spec.fill}
        opacity={isArea ? 0.55 : 1}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={isArea ? [0.6, 0.4] : undefined}
        cornerRadius={object.kind === 'forklift' ? 0.15 : 0}
      />

      {isRackObject(object) && <RackDetail object={object} scale={scale} />}
      {isForkliftObject(object) && <ForkliftDetail object={object} scale={scale} />}

      {showLabel && (
        <Text
          x={labelOutside ? 0 : 0.2}
          y={labelBelow ? object.depthM + fontSize * 0.3 : labelOutside ? -fontSize * 1.3 : 0.15}
          width={labelOutside ? Math.max(object.widthM, 8) : Math.max(object.widthM - 0.4, 1)}
          text={object.name}
          fontSize={fontSize}
          fill={labelOutside ? '#55606c' : '#2b333b'}
          listening={false}
          ellipsis={!labelOutside}
          wrap="none"
        />
      )}
    </Group>
  );
}

/**
 * 配置オブジェクトは数百〜数千件になり得るため、props が変わらない限り
 * 再描画しない（パン・ドラッグ時に動いていないオブジェクトを作り直さない）。
 */
export const ObjectShape = memo(ObjectShapeBase);

/**
 * ラックの間口 (列) の区切りとピッキング面の向きを描く。
 *
 * 列数は数十になり得るため、区切り線ごとに Konva ノードを作らず
 * 1つの Shape にまとめて描画する。
 */
function RackDetail({
  object,
  scale,
}: {
  object: LayoutObject & { rack: { columns: number; face: string } };
  scale: number;
}): JSX.Element {
  const { columns, face } = object.rack;
  const bay = object.widthM / Math.max(1, columns);
  const hairline = 0.8 / scale;
  const faceY = face === 'back' ? object.depthM : 0;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        // 間口の区切り
        if (columns > 1) {
          ctx.beginPath();
          for (let i = 1; i < columns; i++) {
            ctx.moveTo(bay * i, 0);
            ctx.lineTo(bay * i, object.depthM);
          }
          ctx.setAttr('strokeStyle', '#7b8fab');
          ctx.setAttr('lineWidth', hairline);
          ctx.stroke();
        }

        // ピッキング面 (作業する側) を太線で示す
        if (face !== 'both') {
          ctx.beginPath();
          ctx.moveTo(0, faceY);
          ctx.lineTo(object.widthM, faceY);
          ctx.setAttr('strokeStyle', '#2f5d9e');
          ctx.setAttr('lineWidth', 3 / scale);
          ctx.stroke();
        }
      }}
    />
  );
}

/** フォークリフトの車体と向き (前方=ローカル +X)。 */
function ForkliftDetail({ object, scale }: { object: LayoutObject; scale: number }): JSX.Element {
  const w = object.widthM;
  const d = object.depthM;
  return (
    <Group listening={false}>
      {/* フォーク (前方) */}
      <Line points={[w, d * 0.25, w + 0.5, d * 0.25]} stroke="#4a3c00" strokeWidth={2.4 / scale} />
      <Line points={[w, d * 0.75, w + 0.5, d * 0.75]} stroke="#4a3c00" strokeWidth={2.4 / scale} />
      {/* 進行方向マーカー */}
      <Line
        points={[w * 0.55, d * 0.2, w * 0.85, d * 0.5, w * 0.55, d * 0.8]}
        stroke="#7a5c00"
        strokeWidth={1.6 / scale}
        closed={false}
      />
    </Group>
  );
}
