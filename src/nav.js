// Ground navigation for the walking creatures. A 1 m grid around the hunter is rasterized from the world's
// obstacle circles (houses, walls, fences, rocks, the closed castle gate...) as the hunter moves. A creature
// that can see the hunter across it walks straight at them; one that can't follows a flow field (walking
// distance to the hunter, Dijkstra over 8 neighbours, solved only when needed) around whatever is in the way.
// Flyers skip all this.
import { mapE } from './world.js';

const HALF = 56; // window half-size (m) around the hunter; creatures further out just walk straight in
const N = HALF * 2; // cells per side (1 m cells)
const INFLATE = 0.45; // creature body added to every obstacle, so paths keep clear of walls
const REBUILD = 0.35; // seconds between rebuilds at most...
const MOVE = 2; // ...and only once the hunter moved this far (m); creatures that can see the hunter don't need it
const FORCE = 1; // rebuild at least this often: gates open, coffins break, guards move the hunter
const AHEAD = 3; // cells walked down the field to pick the next waypoint (smoother than the next cell)
const INF = 0xffff;
// neighbour offsets with costs 2 (straight) and 3 (diagonal), close to 1 : 1.41
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [2, 2, 2, 2, 3, 3, 3, 3];

export class NavGrid {
  constructor(world) {
    this.world = world;
    this.blocked = new Uint8Array(N * N);
    this.dist = new Uint16Array(N * N).fill(INF);
    this.x0 = this.z0 = 0; // world position of the window's corner cell
    this.ready = false;
    this.since = Infinity;
    this.px = this.pz = Infinity; // where the hunter stood at the last rebuild
    this.buckets = [[], [], [], []];
    this.solved = false;
    this.ms = this.msSolve = 0; // cost of the last obstacle raster / path solve, for the dev console
  }

  // index of the cell under (x, z), or -1 outside the window
  cell(x, z) {
    const i = Math.floor(x - this.x0), j = Math.floor(z - this.z0);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  }

  blockedAt(x, z) {
    const c = this.cell(x, z);
    return c >= 0 && this.blocked[c] === 1;
  }

  update(dt, px, pz) {
    this.since += dt;
    if (this.since < REBUILD) return;
    if (this.ready && Math.hypot(px - this.px, pz - this.pz) < MOVE && this.since < FORCE) return;
    this.since = 0;
    this.build(px, pz);
  }

  build(px, pz) {
    const t0 = performance.now();
    this.px = px;
    this.pz = pz;
    const x0 = (this.x0 = Math.floor(px) - HALF), z0 = (this.z0 = Math.floor(pz) - HALF);
    const B = this.blocked;
    B.fill(0);
    // the valley's edge (the ellipse is convex: if every corner is inside, the whole window is)
    const out = (x, z) => mapE(x, z) > 0.9;
    if (out(x0, z0) || out(x0 + N, z0) || out(x0, z0 + N) || out(x0 + N, z0 + N))
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (out(x0 + i + 0.5, z0 + j + 0.5)) B[j * N + i] = 1;
    // obstacle circles from the world's 16 m buckets that touch the window
    const grid = this.world.grid;
    for (let bz = Math.floor((z0 - 8) / 16); bz <= Math.floor((z0 + N + 8) / 16); bz++)
      for (let bx = Math.floor((x0 - 8) / 16); bx <= Math.floor((x0 + N + 8) / 16); bx++) {
        const list = grid.get(bx + ',' + bz);
        if (!list) continue;
        for (const o of list) {
          if (!o.r) continue; // opened gate, broken coffin
          const R = o.r + INFLATE, R2 = R * R;
          const i0 = Math.max(0, Math.floor(o.x - R - x0)), i1 = Math.min(N - 1, Math.floor(o.x + R - x0));
          const j0 = Math.max(0, Math.floor(o.z - R - z0)), j1 = Math.min(N - 1, Math.floor(o.z + R - z0));
          for (let j = j0; j <= j1; j++) {
            const dz = z0 + j + 0.5 - o.z;
            for (let i = i0; i <= i1; i++) {
              const dx = x0 + i + 0.5 - o.x;
              if (dx * dx + dz * dz < R2) B[j * N + i] = 1;
            }
          }
        }
      }
    this.ready = true;
    this.solved = false; // the walking distances are worked out on demand (see flow)
    this.ms = performance.now() - t0;
  }

  // Dijkstra from the hunter's cell with a ring of 4 buckets (edge costs are 2 or 3). Only runs when some
  // creature has lost sight of the hunter, so open fields never pay for it.
  solve() {
    const t0 = performance.now();
    const B = this.blocked, D = this.dist;
    D.fill(INF);
    const s = this.cell(this.px, this.pz);
    const Q = this.buckets;
    for (const q of Q) q.length = 0;
    D[s] = 0;
    Q[0].push(s);
    let count = 1;
    for (let cur = 0; count > 0; cur++) {
      const q = Q[cur & 3];
      while (q.length) {
        const c = q.pop();
        count--;
        if (D[c] !== cur) continue; // superseded by a shorter path
        const ci = c % N, cj = (c - ci) / N;
        for (let k = 0; k < 8; k++) {
          const di = DI[k], dj = DJ[k], ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (B[n]) continue;
          if (k > 3 && (B[cj * N + ni] || B[nj * N + ci])) continue; // no squeezing between diagonal blocks
          const nd = cur + DC[k];
          if (nd < D[n]) {
            D[n] = nd;
            Q[nd & 3].push(n);
            count++;
          }
        }
      }
    }
    this.solved = true;
    this.msSolve = performance.now() - t0;
  }

  // The straight line from a to b crosses no blocked cell (ends excluded: the bodies stand next to walls).
  // Outside the window everything counts as open.
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    for (let t = 0.8; t < len - 1; t += 0.5) {
      const c = this.cell(ax + (dx * t) / len, az + (dz * t) / len);
      if (c >= 0 && this.blocked[c]) return false;
    }
    return true;
  }

  // Unit direction to walk from (x, z) along the field, written to `out`; null when there is no path
  // (outside the window, or a pocket the hunter can't be reached from).
  flow(x, z, out) {
    let c = this.cell(x, z);
    if (!this.ready || c < 0) return null;
    if (!this.solved) this.solve();
    const B = this.blocked, D = this.dist;
    let moved = 0;
    for (let step = 0; step < AHEAD; step++) {
      const ci = c % N, cj = (c - ci) / N;
      let best = B[c] ? INF : D[c], bn = -1;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        if (B[n] || (k > 3 && (B[cj * N + ni] || B[nj * N + ci]))) continue; // same no-corner rule as build()
        if (D[n] < best) { best = D[n]; bn = n; }
      }
      if (bn < 0) break;
      c = bn;
      moved++;
      if (D[c] === 0) break;
    }
    if (!moved) return null;
    const ci = c % N, cj = (c - ci) / N;
    const ox = this.x0 + ci + 0.5 - x, oz = this.z0 + cj + 0.5 - z, l = Math.hypot(ox, oz) || 1;
    out.x = ox / l;
    out.z = oz / l;
    return out;
  }
}
