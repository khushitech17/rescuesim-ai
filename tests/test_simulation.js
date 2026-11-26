// Run: node tests/test_simulation.js   (tests collision handling and simulation completion)
const assert = require("assert");
const E = require("../static/js/simulation.js");
const route = (path, found = true) => ({ found, path, start: path[0] || [0, 0] });
const run = (routes, maxTicks = 500) => {
  const sim = E.createSim(routes); let last;
  for (let t = 0; t < maxTicks && !E.isComplete(sim); t++) {
    last = E.step(sim);
    assert(E.positionsAreUnique(sim), "two occupants share a cell at tick " + sim.ticks);
    const k = E.counts(sim);
    assert.strictEqual(k.evacuated + k.trapped + k.blocked + k.waiting + k.moving, k.total, "counts do not add up at tick " + sim.ticks);
    assert.strictEqual(k.evacuated, sim.evac, "evacuated count differs from engine counter");
    if (last.deadlock) return { sim, deadlock: true };
  }
  return { sim, deadlock: false };
};
let n = 0; const ok = name => console.log("ok -", name, ++n);

// 1. Head-on in a corridor: swapping or sharing is forbidden -> deadlock is reported, nobody collides
let r = run([route([[0, 0], [0, 1], [0, 2], [0, 3]]), route([[0, 3], [0, 2], [0, 1], [0, 0]])]);
assert(r.deadlock && r.sim.evac === 0); ok("head-on corridor deadlock reported, no collision");

// 2. Followers in a queue move without collision and all finish
r = run([route([[0, 0], [0, 1], [0, 2], [0, 3]]), route([[0, 1], [0, 2], [0, 3]]), route([[0, 2], [0, 3]])]);
assert(!r.deadlock && r.sim.evac === 3); ok("queue evacuates completely");

// 3. Two occupants reaching the same exit the same step: one per step
let sim = E.createSim([route([[0, 0], [0, 1]]), route([[1, 1], [0, 1]])]);
E.step(sim); assert(sim.evac === 1 && sim.waiting.length === 1); E.step(sim); assert(sim.evac === 2);
ok("one occupant per exit per step");

// 4. Trapped occupant blocks its cell: the other waits, deadlock reported, never walks through
r = run([route([[0, 0], [0, 1], [0, 2]]), route([], false)].map((x, i) => i ? { found: false, path: [], start: [0, 1] } : x));
assert(r.deadlock && r.sim.evac === 0 && E.position(r.sim, 0)[1] === 0); ok("trapped occupant blocks cell");

// 5. Occupant already at an exit evacuates in step 1
sim = E.createSim([route([[3, 3]])]); E.step(sim); assert(sim.evac === 1 && E.isComplete(sim)); ok("occupant at exit");

// 6. Nobody to move: complete immediately; all-trapped scenario terminates
assert(E.isComplete(E.createSim([]))); assert(E.isComplete(E.createSim([{ found: false, path: [], start: [1, 1] }]))); ok("empty / all trapped completes");

// 7. markConflict flags remaining occupants
sim = E.createSim([route([[0, 0], [0, 1]]), { found: false, path: [], start: [0, 1] }]);
E.markConflict(sim); assert(sim.conflict && sim.blocked.has(0)); ok("markConflict");

// 8. Stress test: random buildings, BFS routes, never a collision, always terminates
function bfs(grid, s, exits) {
  const q = [s], par = new Map([[s.join(), null]]);
  while (q.length) { const c = q.shift(); if (exits.has(c.join())) { const p = []; for (let k = c.join(); k; k = par.get(k)) p.unshift(k.split(",").map(Number)); return p; }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const n = [c[0] + dr, c[1] + dc], k = n.join();
      if (grid[n[0]]?.[n[1]] === 0 && !par.has(k)) { par.set(k, c.join()); q.push(n); } } }
  return null;
}
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let finished = 0, deadlocks = 0;
for (let t = 0; t < 300; t++) {
  const S = 12, grid = Array.from({ length: S }, () => Array.from({ length: S }, () => (rnd() < 0.2 ? 1 : 0)));
  const free = []; for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) if (!grid[a][b]) free.push([a, b]);
  if (free.length < 8) continue;
  free.sort(() => rnd() - 0.5);
  const exits = new Set(free.slice(0, 2).map(p => p.join())), occ = free.slice(2, 8);
  const routes = occ.map(o => { const p = bfs(grid, o, exits); return p ? { found: true, path: p, start: o } : { found: false, path: [], start: o }; });
  const { sim, deadlock } = run(routes, 400);
  deadlock ? deadlocks++ : (assert(E.isComplete(sim)), finished++);
}
assert(finished > 0); ok(`stress: 300 random buildings, no collision ever (${finished} completed, ${deadlocks} deadlocks reported)`);
// 9. Status and counts for each situation
sim = E.createSim([route([[0, 0], [0, 1], [0, 2]]), route([[5, 5]]), { found: false, path: [], start: [9, 9] }]);
assert.deepStrictEqual([0, 1, 2].map(i => E.status(sim, i)), ["planned", "at exit", "trapped"]);
assert.deepStrictEqual(E.counts(sim), { total: 3, evacuated: 0, trapped: 1, blocked: 0, waiting: 0, moving: 2 });
E.step(sim);
assert.deepStrictEqual([0, 1, 2].map(i => E.status(sim, i)), ["moving", "evacuated", "trapped"]);
assert.deepStrictEqual(E.counts(sim), { total: 3, evacuated: 1, trapped: 1, blocked: 0, waiting: 0, moving: 1 }); ok("status and counts (planned, at exit, moving, evacuated, trapped)");
r = run([route([[0, 0], [0, 1], [0, 2], [0, 3]]), route([[0, 3], [0, 2], [0, 1], [0, 0]])]);
assert(r.deadlock); let kk = E.counts(r.sim); assert.strictEqual(kk.waiting, 2); E.markConflict(r.sim); kk = E.counts(r.sim);
assert.deepStrictEqual([kk.blocked, kk.waiting, kk.moving, kk.evacuated], [2, 0, 0, 0]); ok("deadlock: waiting occupants become blocked after a reported conflict, counts still add up");

// 10. Trail = the cells an occupant really stood on: starts at the start cell, steps are adjacent, ends at the exit when evacuated
sim = E.createSim([route([[0, 0], [0, 1], [0, 2], [0, 3]]), route([[1, 1], [1, 2], [1, 3], [0, 3]]), { found: false, path: [], start: [9, 9] }]);
assert.deepStrictEqual(sim.trail.map(x => x.length), [1, 1, 1]);
while (!E.isComplete(sim)) E.step(sim);
const adj = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
sim.trail.slice(0, 2).forEach((tr, i) => { assert.deepStrictEqual(tr[0], sim.routes[i].path[0]); assert.deepStrictEqual(tr[tr.length - 1], [0, 3]);
  for (let j = 1; j < tr.length; j++) assert(adj(tr[j - 1], tr[j])); assert.strictEqual(tr.length - 1, sim.routes[i].path.length - 1); });
assert.deepStrictEqual(sim.trail[2], [[9, 9]]); ok("trail matches the cells actually visited");
console.log("ALL SIMULATION TESTS PASSED");
