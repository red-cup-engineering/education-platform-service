/**
 * `build-layout` — the web-face build step every consumer needs alongside a compiled `World`:
 * a deterministic (fixed seed, fixed iteration count, no wall-clock) Fruchterman–Reingold
 * force-directed room layout, plus one auto-hall Kata per multi-room Hall. Vendored verbatim
 * (logic unchanged, ported .mts -> .mjs, generalized to take a `World` value directly rather
 * than only reading one from a fixed file path) from lantern-service's
 * `web/build/build-layout.mts`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeAutoKata } from './kata.mjs';

// --- deterministic PRNG (mulberry32) — fixed seed, never Math.random() -------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LAYOUT_SEED = 0x9e3779b9; // fixed, arbitrary, never derived from clock/env
const WIDTH = 1000;
const HEIGHT = 720;
const PADDING = 48;
const ITERATIONS = 500;

/**
 * Fruchterman–Reingold spring-embedder, deterministic variant: fixed seed for the initial
 * placement, fixed iteration count and cooling schedule rather than a wall-clock or
 * convergence-threshold stop condition, so the same input graph always produces the same output
 * coordinates bit-for-bit.
 * @param {readonly string[]} nodeIds
 * @param {ReadonlyArray<readonly [number, number]>} edges
 */
export function forceDirectedLayout(nodeIds, edges) {
  const n = nodeIds.length;
  const area = WIDTH * HEIGHT;
  const k = Math.sqrt(area / Math.max(1, n));

  const rng = mulberry32(LAYOUT_SEED);
  const pos = nodeIds.map((_, i) => {
    const angle = (2 * Math.PI * i) / n;
    const radius = Math.min(WIDTH, HEIGHT) * 0.32;
    const jitterX = (rng() - 0.5) * k * 0.6;
    const jitterY = (rng() - 0.5) * k * 0.6;
    return {
      x: WIDTH / 2 + radius * Math.cos(angle) + jitterX,
      y: HEIGHT / 2 + radius * Math.sin(angle) + jitterY,
    };
  });

  const disp = nodeIds.map(() => ({ x: 0, y: 0 }));
  const t0 = WIDTH / 10;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < n; i++) disp[i] = { x: 0, y: 0 };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = pos[i];
        const pj = pos[j];
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dist = 0.01;
          dx = 0.01;
          dy = 0;
        }
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[i].x += fx;
        disp[i].y += fy;
        disp[j].x -= fx;
        disp[j].y -= fy;
      }
    }

    for (const [a, b] of edges) {
      const pa = pos[a];
      const pb = pos[b];
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) dist = 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[a].x -= fx;
      disp[a].y -= fy;
      disp[b].x += fx;
      disp[b].y += fy;
    }

    const temperature = t0 * (1 - iter / ITERATIONS);
    for (let i = 0; i < n; i++) {
      const d = disp[i];
      const dlen = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const capped = Math.min(dlen, temperature);
      const p = pos[i];
      p.x += (d.x / dlen) * capped;
      p.y += (d.y / dlen) * capped;
      p.x = Math.min(WIDTH - PADDING, Math.max(PADDING, p.x));
      p.y = Math.min(HEIGHT - PADDING, Math.max(PADDING, p.y));
    }
  }

  const out = new Map();
  nodeIds.forEach((id, i) => {
    const p = pos[i];
    out.set(id, { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
  });
  return out;
}

export function buildEdges(nodeIds, doors) {
  const index = new Map();
  nodeIds.forEach((id, i) => index.set(id, i));
  const seen = new Set();
  const edges = [];
  for (const d of doors) {
    const a = index.get(d.from);
    const b = index.get(d.to);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([lo, hi]);
  }
  return edges;
}

/**
 * Compute the layout artifact for a compiled `World` in memory — no file I/O. This is what
 * both the CLI below and any programmatic caller (e.g. lantern-service's `vaultmaze` bin)
 * should call; the CLI is a thin wrapper that additionally reads/writes JSON files.
 * @param {World} world
 */
export function buildLayout(world) {
  const nodeIds = world.rooms.map((r) => r.id).sort();
  const edges = buildEdges(nodeIds, world.doors);
  const positions = forceDirectedLayout(nodeIds, edges);

  const katas = world.halls.filter((h) => h.rooms.length >= 2).map((h) => makeAutoKata(h, world.doors, world.rooms));

  const positionsOut = {};
  for (const [id, p] of positions) positionsOut[id] = p;

  return {
    wingId: world.wingId,
    width: WIDTH,
    height: HEIGHT,
    seed: LAYOUT_SEED,
    iterations: ITERATIONS,
    positions: positionsOut,
    katas: katas.map((k) => ({ id: k.id, hallId: k.id.replace(/^kata:/, ''), path: k.path, origin: k.origin })),
  };
}

// ---------------------------------------------------------------------------------------
// CLI entry point: node src/build-layout.mjs <wing> <srcWorldPath> <outDir>
// ---------------------------------------------------------------------------------------

async function main() {
  const wing = process.argv[2];
  const srcPath = process.argv[3];
  const outDir = process.argv[4];
  if (!wing || !srcPath || !outDir) {
    console.error('usage: node src/build-layout.mjs <wing> <srcWorldPath> <outDir>');
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(srcPath, 'utf8');
  const world = JSON.parse(raw);
  const layout = buildLayout(world);

  await writeFile(join(outDir, `${wing}.json`), JSON.stringify(world, null, 1), 'utf8');
  await writeFile(join(outDir, `${wing}-layout.json`), JSON.stringify(layout, null, 1), 'utf8');

  process.stdout.write(
    `build-layout: wrote ${world.rooms.length} room positions, ${layout.katas.length} auto-hall katas, ` +
      `${outDir}/${wing}.json + ${outDir}/${wing}-layout.json\n`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
