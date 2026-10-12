/**
 * Pure projection of a compiled education World onto abrash's FOUR-valued floor grid. Resolution is
 * measured through metrologic's finite sampling fibration; geometry is then carved deterministically.
 */
import { finitePredicatingFibration } from '@red-cup-engineering/metrologic/articulation/predicating/quantifying';

const keyOf = (x, z) => `${x},${z}`;
const byId = (a, b) => String(a).localeCompare(String(b));
const byPosition = (a, b) => a[1] - b[1] || a[0] - b[0] || byId(a[2] ?? '', b[2] ?? '');

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function resolutionStage(roomIds, positions, resolution) {
  const baseMap = {};
  const occupied = new Set();
  for (const roomId of roomIds) {
    const point = positions[roomId];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError(`voxelizeWorld: layout has no finite position for ${roomId}`);
    }
    const key = keyOf(Math.floor(point.x / resolution), Math.floor(point.y / resolution));
    baseMap[roomId] = key;
    occupied.add(key);
  }
  const occupiedKeys = [...occupied].sort(byId);
  const fibration = finitePredicatingFibration(roomIds, occupiedKeys, baseMap);
  // Box reconstruction is the pullback along base: it repeats a cell's value across its fiber, so it
  // gives back the room sampled exactly when the fiber holds one room; with two, room identity is
  // lost at this resolution. A FOUR valuation cannot carry room identity, so the count reads the
  // fibers directly; the ∃ adjoint enters when several sources' evidence about one cell is folded.
  let voxelizable = 0, alone = 0;
  for (const cell of occupiedKeys) {
    const fiberSize = (fibration.fibers[cell] ?? []).length;
    if (fiberSize === 1) {
      voxelizable++;
      alone += fiberSize;
    }
  }
  return { resolution, occupiedKeys, fibration, voxelizable, alone };
}

function *squareSpiral(cx, cz) {
  for (let ring = 1; ; ring++) {
    yield [cx + ring, cz];
    for (let z = 1; z <= ring; z++) yield [cx + ring, cz + z];
    for (let x = ring - 1; x >= -ring; x--) yield [cx + x, cz + ring];
    for (let z = ring - 1; z >= -ring; z--) yield [cx - ring, cz + z];
    for (let x = -ring + 1; x <= ring; x++) yield [cx + x, cz - ring];
  }
}

function indistinctPairs(world) {
  if (Array.isArray(world.indistinct)) {
    return world.indistinct.map((entry) => ({
      rooms: entry.rooms ?? [entry.idA, entry.idB], reason: entry.reason ?? 'indistinct',
    }));
  }
  const pattern = /^indistinct rooms: (.*?) ~ (.*?) \((.*)\)$/;
  return (world.warnings ?? []).flatMap((warning) => {
    const match = pattern.exec(warning);
    return match ? [{ rooms: [match[1], match[2]], reason: match[3] }] : [];
  });
}

function perimeter(chamber) {
  const out = [];
  const maxX = chamber.x + chamber.size - 1, maxZ = chamber.z + chamber.size - 1;
  for (let x = chamber.x; x <= maxX; x++) out.push([x, chamber.z]);
  for (let z = chamber.z + 1; z <= maxZ; z++) out.push([maxX, z]);
  for (let x = maxX - 1; x >= chamber.x; x--) out.push([x, maxZ]);
  for (let z = maxZ - 1; z > chamber.z; z--) out.push([chamber.x, z]);
  return out;
}

function corridor(from, to) {
  const points = [];
  let x = from.x, z = from.z;
  const sx = Math.sign(to.x - x), sz = Math.sign(to.z - z);
  while (x !== to.x) { x += sx; points.push([x, z]); }
  while (z !== to.z) { z += sz; points.push([x, z]); }
  return points;
}

function contains(chamber, x, z) {
  return x >= chamber.x && x < chamber.x + chamber.size && z >= chamber.z && z < chamber.z + chamber.size;
}

function chunkKey(x, z, size) { return `${Math.floor(x / size)},${Math.floor(z / size)}`; }

/** @returns {object} a JSON-safe `vaultmaze-voxels/v1` view */
export function voxelizeWorld(world, layout, options = {}) {
  const chamberSize = Math.max(1, options.chamber ?? 3) | 0;
  const gap = Math.max(0, options.gap ?? 2) | 0;
  const maxLevel = Math.min(16, Math.max(0, options.maxResolutionLevel ?? options.K ?? 16) | 0);
  const portalLimit = Math.max(0, options.portalsPerChamber ?? 4) | 0;
  const requestedRatio = options.voxelizableRatio ?? 0.9;
  const voxelizableRatio = Number.isFinite(requestedRatio)
    ? Math.min(1, Math.max(0, requestedRatio))
    : 0.9;
  const roomIds = world.rooms.map(({ id }) => id).sort(byId);
  const positions = layout.positions ?? {};
  const xs = roomIds.map((id) => positions[id]?.x).filter(Number.isFinite);
  const ys = roomIds.map((id) => positions[id]?.y).filter(Number.isFinite);
  const span = Math.max(1,
    xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    ys.length ? Math.max(...ys) - Math.min(...ys) : 0);

  const stages = [];
  let selected;
  for (let level = 0; level <= maxLevel; level++) {
    const stage = resolutionStage(roomIds, positions, span / (2 ** level));
    stages.push(stage);
    if (stage.alone >= voxelizableRatio * roomIds.length) { selected = stage; break; }
    selected = stage;
  }
  const tower = stages.map((stage) => ({
    r: stage.resolution, occupied: stage.occupiedKeys.length,
    voxelizable: stage.voxelizable, alone: stage.alone,
  }));

  const stride = chamberSize + gap;
  const sampledCells = new Set(selected.occupiedKeys);
  const placedCells = new Set();
  const placedCellByRoom = new Map();
  const displaced = [];
  for (const sampledCell of selected.occupiedKeys) {
    const [cx, cz] = sampledCell.split(',').map(Number);
    const fiber = [...(selected.fibration.fibers[sampledCell] ?? [])].sort(byId);
    for (const [index, roomId] of fiber.entries()) {
      let to = [cx, cz];
      if (index > 0) {
        for (const candidate of squareSpiral(cx, cz)) {
          const key = keyOf(candidate[0], candidate[1]);
          if (!sampledCells.has(key) && !placedCells.has(key)) { to = candidate; break; }
        }
        displaced.push({ roomId, from: [cx, cz], to });
      }
      placedCells.add(keyOf(to[0], to[1]));
      placedCellByRoom.set(roomId, to);
    }
  }
  // Displacement is ordinary deterministic label placement, not a sampling result; the view's
  // displaced list reports exactly how many rooms it moved.
  const chambers = roomIds.map((roomId) => {
    const [cx, cz] = placedCellByRoom.get(roomId);
    return { roomId, x: cx * stride, z: cz * stride, size: chamberSize };
  }).sort((a, b) => byId(a.roomId, b.roomId));
  const chamberOf = new Map(chambers.map((entry) => [entry.roomId, entry]));
  const cells = new Map();
  const carve = (x, z, reading = 'f') => cells.set(keyOf(x, z), [x, z, reading]);
  for (const chamber of chambers) {
    for (let z = chamber.z; z < chamber.z + chamber.size; z++) {
      for (let x = chamber.x; x < chamber.x + chamber.size; x++) carve(x, z);
    }
  }

  const hardDoors = world.doors.filter(({ weight }) => weight === 'hard')
    .sort((a, b) => byId(a.from, b.from) || byId(a.to, b.to));
  const gates = [];
  const outgoing = new Map(roomIds.map((id) => [id, 0]));
  for (const door of hardDoors) {
    const from = chamberOf.get(door.from), to = chamberOf.get(door.to);
    if (!from || !to) continue;
    outgoing.set(door.from, (outgoing.get(door.from) ?? 0) + 1);
    if (from.x === to.x && from.z === to.z) continue;
    const fromCenter = { x: from.x + Math.floor(from.size / 2), z: from.z + Math.floor(from.size / 2) };
    const toCenter = { x: to.x + Math.floor(to.size / 2), z: to.z + Math.floor(to.size / 2) };
    const path = corridor(fromCenter, toCenter);
    for (const [x, z] of path) carve(x, z);
    let gate;
    for (let index = path.length - 1; index >= 0; index--) {
      const [x, z] = path[index];
      if (!contains(to, x, z)) { gate = { x, z, roomId: door.to, prerequisiteRoomId: door.from }; break; }
    }
    if (gate) gates.push(gate);
  }

  const hallSizes = new Map();
  const hallsByRoom = new Map(roomIds.map((id) => [id, []]));
  for (const hall of world.halls ?? []) {
    hallSizes.set(hall.id, hall.rooms.length);
    for (const roomId of hall.rooms) if (hallsByRoom.has(roomId)) hallsByRoom.get(roomId).push(hall.id);
  }
  const proximity = (left, right) => {
    const rightHalls = new Set(hallsByRoom.get(right) ?? []);
    let score = 0;
    for (const hallId of hallsByRoom.get(left) ?? []) if (rightHalls.has(hallId)) score += 1 / hallSizes.get(hallId);
    return score;
  };
  const softByRoom = new Map();
  for (const door of world.doors) {
    if (door.weight !== 'soft' || !chamberOf.has(door.from) || !chamberOf.has(door.to)) continue;
    const targets = softByRoom.get(door.from) ?? new Set();
    targets.add(door.to); softByRoom.set(door.from, targets);
  }
  const portals = [];
  const portalUse = new Map();
  for (const roomId of roomIds) {
    const targets = [...(softByRoom.get(roomId) ?? [])].sort((a, b) =>
      proximity(roomId, b) - proximity(roomId, a) || fnv1a(`${roomId}\0${a}`) - fnv1a(`${roomId}\0${b}`) || byId(a, b));
    const edge = perimeter(chamberOf.get(roomId));
    const count = Math.min(portalLimit, targets.length, edge.length);
    for (let index = 0; index < count; index++) {
      const [x, z] = edge[index];
      const target = chamberOf.get(targets[index]);
      portals.push({
        x, z, roomId, to: targets[index], reading: 'f',
        target: { x: target.x + target.size / 2, z: target.z + target.size / 2 },
      });
    }
    portalUse.set(roomId, count);
  }

  const contested = [];
  for (const pair of indistinctPairs(world).sort((a, b) => byId(a.rooms[0], b.rooms[0]) || byId(a.rooms[1], b.rooms[1]))) {
    const [leftId, rightId] = pair.rooms;
    const chamber = chamberOf.get(leftId);
    if (!chamber || !chamberOf.has(rightId)) continue;
    const edge = perimeter(chamber);
    const index = (portalUse.get(leftId) ?? 0) % edge.length;
    const [x, z] = edge[index];
    const witnesses = [leftId, rightId].sort(byId);
    const target = chamberOf.get(rightId);
    portals.push({
      x, z, roomId: leftId, to: rightId, reading: 'top', witnesses, reason: pair.reason,
      target: { x: target.x + target.size / 2, z: target.z + target.size / 2 },
    });
    contested.push({ x, z, witnesses });
    carve(x, z, 'top');
    portalUse.set(leftId, index + 1);
  }

  const extent = chambers.length ? {
    minX: Math.min(...chambers.map(({ x }) => x)) - 1,
    minZ: Math.min(...chambers.map(({ z }) => z)) - 1,
    maxX: Math.max(...chambers.map(({ x, size }) => x + size - 1)) + 1,
    maxZ: Math.max(...chambers.map(({ z, size }) => z + size - 1)) + 1,
  } : { minX: -1, minZ: -1, maxX: 1, maxZ: 1 };
  const spawnRoom = roomIds.slice().sort((a, b) => (outgoing.get(b) ?? 0) - (outgoing.get(a) ?? 0) || byId(a, b))[0];
  const spawnChamber = chamberOf.get(spawnRoom);
  const spawn = spawnChamber
    ? { x: spawnChamber.x + chamberSize / 2, z: spawnChamber.z + chamberSize / 2, angle: 0 }
    : { x: 0.5, z: 0.5, angle: 0 };

  return {
    schemaVersion: 'vaultmaze-voxels/v1', wingId: world.wingId, resolution: selected.resolution,
    voxelizableRatio, tower, chamber: chamberSize, gap, bounds: extent, defaultReading: 't', chambers,
    displaced,
    cells: [...cells.values()].sort(byPosition),
    gates: gates.sort((a, b) => a.z - b.z || a.x - b.x || byId(a.roomId, b.roomId)),
    portals: portals.sort((a, b) => a.z - b.z || a.x - b.x || byId(a.roomId, b.roomId) || byId(a.to, b.to)),
    contested: contested.sort((a, b) => a.z - b.z || a.x - b.x || byId(a.witnesses.join('\0'), b.witnesses.join('\0'))),
    spawn,
  };
}

/** Split a view into spatial documents without changing its canonical header. */
export function chunkVoxelView(view, size = 64) {
  const chunkSize = Math.max(1, size | 0);
  const chunks = {};
  const ensure = (key) => chunks[key] ??= { cells: [], gates: [], portals: [], contested: [], chambers: [] };
  for (const cell of view.cells) ensure(chunkKey(cell[0], cell[1], chunkSize)).cells.push(cell);
  for (const field of ['gates', 'portals', 'contested']) {
    for (const entry of view[field]) ensure(chunkKey(entry.x, entry.z, chunkSize))[field].push(entry);
  }
  for (const chamber of view.chambers) {
    const minCX = Math.floor(chamber.x / chunkSize), maxCX = Math.floor((chamber.x + chamber.size - 1) / chunkSize);
    const minCZ = Math.floor(chamber.z / chunkSize), maxCZ = Math.floor((chamber.z + chamber.size - 1) / chunkSize);
    for (let cz = minCZ; cz <= maxCZ; cz++) for (let cx = minCX; cx <= maxCX; cx++) ensure(`${cx},${cz}`).chambers.push(chamber);
  }
  const keys = Object.keys(chunks).sort((a, b) => {
    const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
    return az - bz || ax - bx;
  });
  const ordered = Object.fromEntries(keys.map((key) => [key, chunks[key]]));
  const index = {
    schemaVersion: view.schemaVersion, wingId: view.wingId, resolution: view.resolution,
    voxelizableRatio: view.voxelizableRatio, tower: view.tower,
    chamber: view.chamber, gap: view.gap, bounds: view.bounds, displaced: view.displaced,
    defaultReading: view.defaultReading, spawn: view.spawn, chunkSize, chunks: keys,
  };
  return { index, chunks: ordered };
}
