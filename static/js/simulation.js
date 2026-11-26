/* Movement engine for RescueSim AI (no DOM code, so it can be unit-tested with Node).
   Routes come from the Python search algorithms. This file only decides who may move each step.
   SAFETY RULE: an occupant moves only into a cell that no other occupant currently stands on.
   There is no "move anyway" fallback. If nobody can move, a deadlock is reported instead. */
(function (root) {
  const key = p => p[0] + "," + p[1];

  function createSim(routes) {
    const rs = routes.map(r => ({ ...r }));
    return { routes: rs, idx: rs.map(() => 0), done: rs.map(() => false), evac: 0, ticks: 0, waiting: [],
             blocked: new Set(), conflict: false,
             trail: rs.map(r => [r.found ? r.path[0] : r.start]) };     // every cell an occupant has really stood on
  }
  // Trapped occupants (no route) stay on their start cell, so they still block that cell.
  function position(sim, i) { const r = sim.routes[i]; return r.found ? r.path[sim.idx[i]] : r.start; }
  const movers = sim => sim.routes.map((r, i) => i).filter(i => sim.routes[i].found && !sim.done[i]);
  const isComplete = sim => movers(sim).length === 0;

  /* One simulation step. Occupants closest to their exit go first, so queues move like a train.
     `occupied` always holds the true set of occupied cells, so two people can never share a cell,
     and two people can never swap places (each would find the other's cell occupied). */
  function step(sim) {
    sim.ticks++;
    const occupied = new Set();
    sim.routes.forEach((r, i) => { if (!sim.done[i]) occupied.add(key(position(sim, i))); });
    const order = movers(sim).sort((a, b) => (sim.routes[a].path.length - 1 - sim.idx[a]) - (sim.routes[b].path.length - 1 - sim.idx[b]) || a - b);
    const exitUsed = new Set();      // only one person can pass through an exit door per step
    let moved = 0; sim.waiting = [];
    for (const i of order) {
      const rt = sim.routes[i], cur = key(position(sim, i));
      if (rt.path.length === 1) { sim.done[i] = true; sim.evac++; occupied.delete(cur); moved++; continue; }   // already at an exit
      const next = rt.path[sim.idx[i] + 1], k = key(next), atExit = sim.idx[i] + 1 === rt.path.length - 1;
      if (occupied.has(k) || (atExit && exitUsed.has(k))) { sim.waiting.push(i); continue; }                   // wait, never collide
      occupied.delete(cur); sim.idx[i]++; moved++; sim.trail[i].push(rt.path[sim.idx[i]]);
      if (atExit) { exitUsed.add(k); sim.done[i] = true; sim.evac++; } else occupied.add(k);
    }
    return { moved, deadlock: moved === 0 && movers(sim).length > 0 };   // nobody could move and people remain
  }

  function markConflict(sim) { sim.conflict = true; movers(sim).forEach(i => sim.blocked.add(i)); }
  function positionsAreUnique(sim) {
    const seen = new Set();
    for (let i = 0; i < sim.routes.length; i++) { if (sim.done[i]) continue; const k = key(position(sim, i)); if (seen.has(k)) return false; seen.add(k); }
    return true;
  }

  /* Single source of truth for what every occupant is doing; the dashboard, table and icons all use it. */
  function status(sim, i) {
    const rt = sim.routes[i];
    if (sim.done[i]) return "evacuated";
    if (!rt.found) return "trapped";                       // no route to any exit
    if (sim.blocked.has(i)) return "blocked";              // movement conflict that could not be resolved
    if (sim.waiting.includes(i)) return "waiting";         // next cell is occupied right now
    if (sim.ticks === 0) return rt.path.length === 1 ? "at exit" : "planned";
    return "moving";
  }
  /* Every occupant is in exactly one group, so evacuated + trapped + blocked + waiting + moving === total. */
  function counts(sim) {
    const c = { total: sim.routes.length, evacuated: 0, trapped: 0, blocked: 0, waiting: 0, moving: 0 };
    for (let i = 0; i < c.total; i++) {
      const s = status(sim, i);
      if (s === "evacuated") c.evacuated++; else if (s === "trapped") c.trapped++; else if (s === "blocked") c.blocked++;
      else if (s === "waiting") c.waiting++; else c.moving++;
    }
    return c;
  }
  const api = { createSim, step, position, movers, isComplete, markConflict, positionsAreUnique, status, counts };
  if (typeof module !== "undefined") module.exports = api; else root.SimEngine = api;
})(this);
