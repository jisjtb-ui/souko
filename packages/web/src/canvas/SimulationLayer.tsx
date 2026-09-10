import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { RACK_STATUS_LABEL } from '@ws/shared';
import type { RackUnit, SimulationSnapshot, Vehicle } from '@ws/shared';
import type { Location } from '@ws/shared';

interface Props {
  snapshot: SimulationSnapshot;
  locations: Location[];
  scale: number;
}

/** 状態ごとの色分け（要件12・23）。 */
const RACK_COLOR: Record<RackUnit['status'], string> = {
  empty: '#c9ced4',
  loading: '#ffd980',
  stored: '#7fb2e5',
  full: '#2f6fb5',
  unloading: '#f0a58c',
  carrying: '#ffb020',
  waiting: '#d8b26a',
  stacked: '#98a2ad',
};

const VEHICLE_COLOR: Record<Vehicle['state'], string> = {
  idle: '#b9c0c8',
  moving: '#ffcf3f',
  handling: '#59b36b',
  carrying: '#ff8b2c',
  charging: '#8f7fd8',
  blocked: '#e05c4a',
  done: '#b9c0c8',
};

/**
 * シミュレーション中の動的要素を描画する。
 *
 * - ロケーションに格納された可搬ラック（積載率で色分け）
 * - 空ラック置き場のスタック（現在段数 / 上限）
 * - フォークリフト（向き・積荷の有無・状態色）
 * - ゲートの状態と滞留数
 */
export function SimulationLayer({ snapshot, locations, scale }: Props): JSX.Element {
  const fontSize = 10 / scale;
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const carried = new Set(
    snapshot.vehicles.map((v) => v.carryingRackId).filter((id): id is string => Boolean(id)),
  );

  return (
    <Group listening={false}>
      {/* 保管中のラック */}
      {[...snapshot.occupancy.entries()].map(([locationId, rackId]) => {
        const location = locationById.get(locationId);
        const rack = snapshot.rackUnits.find((r) => r.id === rackId);
        if (!location || !rack) return null;
        const ratio = rack.capacityUnits === 0 ? 0 : rack.currentUnits / rack.capacityUnits;
        const w = Math.max(0.6, location.widthM * 0.8);
        const d = Math.max(0.5, location.depthM * 0.8);
        return (
          <Group key={locationId} x={location.x} y={location.y}>
            <Rect
              x={-w / 2}
              y={-d / 2}
              width={w}
              height={d}
              fill={RACK_COLOR[rack.status]}
              opacity={0.55 + ratio * 0.45}
              stroke="#33465e"
              strokeWidth={0.4 / scale}
              cornerRadius={0.08}
            />
          </Group>
        );
      })}

      {/* 空ラックのスタック: 段数を積み上げたバーで表す */}
      {snapshot.stacks.map((stack) => {
        const count = stack.rackUnitIds.length;
        if (count === 0) return null;
        const max = Math.max(1, stack.maxLevels);
        const barH = Math.min(0.22, 1.3 / max);
        return (
          <Group key={stack.id} x={stack.x} y={stack.y}>
            {Array.from({ length: count }, (_, i) => (
              <Rect
                key={i}
                x={-0.7}
                y={0.6 - (i + 1) * (barH + 0.04)}
                width={1.4}
                height={barH}
                fill={i === count - 1 ? '#8d97a2' : '#b6bec7'}
                stroke="#5b646d"
                strokeWidth={0.35 / scale}
                cornerRadius={0.04}
              />
            ))}
            {scale > 13 && (
              <Text
                x={-0.7}
                y={0.66}
                width={1.4}
                align="center"
                text={`${count}/${max}`}
                fontSize={fontSize * 0.9}
                fill={count >= max ? '#c0392b' : '#4c5866'}
              />
            )}
          </Group>
        );
      })}

      {/* ゲートの状態 */}
      {snapshot.gates.map((gate) => {
        const load = gate.pendingRacks.length + gate.queue.length;
        const color =
          gate.status === 'congested'
            ? '#c0392b'
            : gate.status === 'queued'
              ? '#c8892b'
              : gate.status === 'idle'
                ? '#7c8794'
                : '#2f9e5f';
        return (
          <Group key={gate.objectId} x={gate.point.x} y={gate.point.y}>
            <Circle radius={0.9} fill={color} opacity={0.85} />
            <Text
              x={-2}
              y={-fontSize * 2}
              width={4}
              align="center"
              text={load > 0 ? `滞留 ${load}` : GATE_STATUS_LABEL[gate.status]}
              fontSize={fontSize}
              fill={color}
            />
          </Group>
        );
      })}

      {/* フォークリフト */}
      {snapshot.vehicles.map((vehicle) => (
        <ForkliftMarker key={vehicle.id} vehicle={vehicle} scale={scale} loaded={Boolean(vehicle.carryingRackId)} />
      ))}

      {/* 運搬中のラック（車両に重ねる） */}
      {snapshot.rackUnits
        .filter((r) => carried.has(r.id))
        .map((rack) => (
          <Rect
            key={rack.id}
            x={rack.x - 0.5}
            y={rack.y - 0.4}
            width={1}
            height={0.8}
            fill={RACK_COLOR[rack.status]}
            stroke="#22303d"
            strokeWidth={0.4 / scale}
            cornerRadius={0.08}
            opacity={0.9}
          />
        ))}
    </Group>
  );
}

const GATE_STATUS_LABEL: Record<string, string> = {
  idle: '待機',
  receiving: '入庫受付中',
  shipping: '出荷中',
  queued: '処理待ち',
  congested: '混雑',
};

function ForkliftMarker({
  vehicle,
  scale,
  loaded,
}: {
  vehicle: Vehicle;
  scale: number;
  loaded: boolean;
}): JSX.Element {
  const w = vehicle.widthM;
  const d = vehicle.depthM;
  const fontSize = 9 / scale;
  return (
    <Group x={vehicle.x} y={vehicle.y} rotation={vehicle.headingDeg}>
      <Rect
        x={-w / 2}
        y={-d / 2}
        width={w}
        height={d}
        fill={VEHICLE_COLOR[vehicle.state]}
        stroke="#4a3c00"
        strokeWidth={0.6 / scale}
        cornerRadius={0.15}
      />
      {/* フォーク（前方） */}
      <Line points={[w / 2, -d * 0.25, w / 2 + 0.6, -d * 0.25]} stroke="#4a3c00" strokeWidth={2 / scale} />
      <Line points={[w / 2, d * 0.25, w / 2 + 0.6, d * 0.25]} stroke="#4a3c00" strokeWidth={2 / scale} />
      {/* 積荷の有無 */}
      {loaded && (
        <Rect x={w / 2 + 0.1} y={-d * 0.35} width={0.7} height={d * 0.7} fill="#ff8b2c" opacity={0.9} />
      )}
      <Text
        x={-2}
        y={-d / 2 - fontSize * 1.4}
        width={4}
        align="center"
        text={vehicle.code}
        fontSize={fontSize}
        fill="#3a4652"
        rotation={-vehicle.headingDeg}
      />
    </Group>
  );
}

export { RACK_STATUS_LABEL };
