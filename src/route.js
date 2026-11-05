// Guide route to the objective: the hand-drawn roads (world.js ROADS) become a small graph, and the path
// follows them whenever that beats cutting across the valley (forests, hills and the river make the open
// ground slower: OFFROAD). The minimap and the valley map draw it as a dotted line.
import { ROADS } from './world.js';

const OFFROAD = 2; // a metre off the road "costs" this much road
const NEAR = 40; // closer than this, just head straight for it

const nodes = []; // { x, z, links: [{ to, d }] }
const segs = []; // { a, b, len }

function node(x, z) {
  let i = nodes.findIndex((n) => Math.hypot(n.x - x, n.z - z) < 0.5);
  if (i < 0) { i = nodes.length; nodes.push({ x, z, links: [] }); }
  return i;
}
function link(a, b) {
  if (a === b) return;
  const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
  nodes[a].links.push({ to: b, d });
  nodes[b].links.push({ to: a, d });
  segs.push({ a, b, len: d });
}
// a road that ends on the middle of another one (the cemetery and abbey forks) splits it there
const ends = ROADS.flatMap((r) => [r[0], r[r.length - 1]]);
for (const r of ROADS) {
  let prev = node(...r[0]);
  for (let i = 1; i < r.length; i++) {
    const [ax, az] = r[i - 1], [bx, bz] = r[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const mids = ends
      .map(([x, z]) => ({ x, z, t: ((x - ax) * dx + (z - az) * dz) / l2 }))
      .filter((p) => p.t > 0.001 && p.t < 0.999 && Math.hypot(ax + dx * p.t - p.x, az + dz * p.t - p.z) < 0.5)
      .sort((p, q) => p.t - q.t);
    for (const p of mids) { const n = node(p.x, p.z); link(prev, n); prev = n; }
    const n = node(bx, bz);
    link(prev, n);
    prev = n;
  }
}

// Shortest way from `from` to `to` ({x, z}); returns the corner points, both ends included.
export function route(from, to) {
  const direct = Math.hypot(to.x - from.x, to.z - from.z);
  if (direct < NEAR) return [from, to];
  // cost of finishing from every crossroad: walk the roads, step off where heading straight is cheaper
  const cost = nodes.map((n) => Math.hypot(n.x - to.x, n.z - to.z) * OFFROAD);
  const next = nodes.map(() => -1);
  const done = new Set();
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0) break;
    done.add(u);
    for (const { to: v, d } of nodes[u].links) if (cost[u] + d < cost[v]) { cost[v] = cost[u] + d; next[v] = u; }
  }
  // where to join the road: any point of any stretch, weighing the walk there against the road after it
  let best = direct * OFFROAD, entry = null, via = -1;
  for (const s of segs) {
    const A = nodes[s.a], B = nodes[s.b], dx = B.x - A.x, dz = B.z - A.z;
    const t = Math.max(0, Math.min(1, ((from.x - A.x) * dx + (from.z - A.z) * dz) / (s.len * s.len)));
    const qx = A.x + dx * t, qz = A.z + dz * t, walk = Math.hypot(qx - from.x, qz - from.z) * OFFROAD;
    const ca = walk + t * s.len + cost[s.a], cb = walk + (1 - t) * s.len + cost[s.b];
    if (Math.min(ca, cb) < best) { best = Math.min(ca, cb); entry = { x: qx, z: qz }; via = ca <= cb ? s.a : s.b; }
  }
  if (!entry) return [from, to];
  const path = [from];
  const add = (p) => { const l = path[path.length - 1]; if (Math.hypot(p.x - l.x, p.z - l.z) > 0.5) path.push(p); };
  add(entry);
  for (let i = via; i >= 0; i = next[i]) add(nodes[i]);
  add(to);
  return path;
}

export const routeLength = (path) => path.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0);
