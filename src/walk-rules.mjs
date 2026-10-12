import { gameRules } from '@red-cup-engineering/gaming/running/rules';

const DIRECTIONS = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const keyOf = (x, z) => `${Math.floor(x)},${Math.floor(z)}`;

function chamberAt(view, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  return (view.chambers ?? []).find((chamber) => ix >= chamber.x && ix < chamber.x + chamber.size
    && iz >= chamber.z && iz < chamber.z + chamber.size) ?? null;
}

function cellAt(view, x, z) {
  const key = keyOf(x, z);
  const cell = (view.cells ?? []).find(([cx, cz]) => `${cx},${cz}` === key);
  return cell?.[2] ?? view.defaultReading ?? 't';
}

function adjacent(position) {
  const [dx, dz] = DIRECTIONS[position.facing];
  return { x: position.x + dx, z: position.z + dz };
}

function portalAt(view, position) {
  const ahead = adjacent(position);
  const hereKey = keyOf(position.x, position.z), aheadKey = keyOf(ahead.x, ahead.z);
  return (view.portals ?? []).find((portal) => {
    const key = keyOf(portal.x, portal.z);
    return key === hereKey || key === aheadKey;
  }) ?? null;
}

function normalizedFacing(angle) {
  const quarterTurns = Math.round((Number(angle) || 0) / (Math.PI / 2));
  return ((quarterTurns % 4) + 4) % 4;
}

function serialize(position) {
  return { ...position, carved: [...position.carved].sort() };
}

/** Rule-presented blockstep over one assembled voxel view. Fog is deliberately absent: it is an
 * observation of this shared position, never replay state. */
export function vaultMazeWalkRules(view) {
  if (!view || typeof view !== 'object') throw new TypeError('vaultMazeWalkRules: view must be an object');
  const gateByKey = new Map((view.gates ?? []).map((gate) => [keyOf(gate.x, gate.z), gate]));

  function initialPosition(_seed, _configId) {
    const spawn = view.spawn ?? { x: 0.5, z: 0.5, angle: 0 };
    return serialize({
      x: spawn.x,
      z: spawn.z,
      facing: normalizedFacing(spawn.angle),
      room: chamberAt(view, spawn.x, spawn.z)?.roomId ?? null,
      carved: [],
    });
  }

  function extend(position, move) {
    if (!move || typeof move !== 'object') throw new TypeError('illegal VaultMaze move');
    if (move.type === 'turn') {
      if (move.dir !== 'left' && move.dir !== 'right') throw new TypeError('illegal turn');
      const delta = move.dir === 'right' ? 1 : -1;
      return { state: serialize({ ...position, facing: (position.facing + delta + 4) % 4 }), events: [] };
    }
    if (move.type === 'step') {
      if (move.dir !== 'forward' && move.dir !== 'back') throw new TypeError('illegal step');
      const sign = move.dir === 'forward' ? 1 : -1;
      const [dx, dz] = DIRECTIONS[position.facing];
      const x = position.x + dx * sign, z = position.z + dz * sign;
      const reading = cellAt(view, x, z);
      if (reading === 't' || reading === 'top' || reading === '⊤' || reading === '⊥') throw new Error('step is blocked');
      const gate = gateByKey.get(keyOf(x, z));
      if (gate && !position.carved.includes(keyOf(gate.x, gate.z))) throw new Error('gate is not carved');
      const room = chamberAt(view, x, z)?.roomId ?? null;
      const events = room !== position.room && room !== null ? [{ type: 'entered-room', roomId: room }] : [];
      return { state: serialize({ ...position, x, z, room }), events };
    }
    if (move.type === 'answer') {
      if (typeof move.gate !== 'string' || typeof move.correct !== 'boolean') throw new TypeError('illegal gate answer');
      const ahead = adjacent(position), gate = gateByKey.get(keyOf(ahead.x, ahead.z));
      if (!gate || move.gate !== keyOf(gate.x, gate.z)) throw new Error('gate is not faced');
      if (!move.correct || position.carved.includes(move.gate)) return { state: serialize(position), events: [] };
      const carved = [...position.carved, move.gate].sort();
      return { state: serialize({ ...position, carved }), events: [{ type: 'gate-carved', gate: move.gate }] };
    }
    if (move.type === 'portal') {
      const portal = portalAt(view, position);
      if (!portal || portal.reading !== 'f') throw new Error('portal is unavailable');
      const target = portal.target ?? (() => {
        const chamber = (view.chambers ?? []).find(({ roomId }) => roomId === portal.to);
        return chamber ? { x: chamber.x + chamber.size / 2, z: chamber.z + chamber.size / 2 } : null;
      })();
      if (!target) throw new Error('portal destination is not loaded');
      return {
        state: serialize({ ...position, x: target.x, z: target.z, facing: 0, room: portal.to }),
        events: position.room === portal.to ? [] : [{ type: 'entered-room', roomId: portal.to }],
      };
    }
    throw new TypeError(`illegal VaultMaze move: ${String(move.type)}`);
  }

  return gameRules(initialPosition, extend, { serialize });
}
