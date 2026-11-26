/* RescueSim AI front end.
   The floor plan is an SVG drawn DIRECTLY from the editable search grid (grid[r][c]: 0 = free, 1 = wall):
   walls are wall cells, doors are single free cells cut into walls, exits are free cells in the outer wall.
   Room names/colours come from the layout's room rectangles. Nothing on the plan is decorative:
   what you see is exactly what BFS / DFS / A* search and what the occupants walk through. */
const NS = "http://www.w3.org/2000/svg";
const INFO = {
  bfs: "BFS uses a queue and explores level by level, so each occupant gets the nearest exit by number of steps.",
  dfs: "DFS uses a stack: it dives deep before backtracking. It finds an exit, but it does not guarantee the shortest route.",
  astar: "A* expands the cell with the lowest f(n) = g(n) + h(n); h is the Manhattan distance to the closest exit."
};
const NAMES = {bfs: "Breadth First Search", dfs: "Depth First Search", astar: "A* Search"};
const SHORT = {bfs: "BFS", dfs: "DFS", astar: "A*"};
const PALETTE = ["#0369a1", "#0f766e", "#be185d", "#4d7c0f", "#4338ca", "#0e7490", "#475569", "#1d4ed8"];   // one colour per occupant
const colorOf = i => PALETTE[i % PALETTE.length];
const FILL = {corridor: "#e2e6eb", classroom: "#e7eff9", faculty: "#efe8f6", lab: "#e4f1e8", reception: "#faf1d6", office: "#faeedd",
  conference: "#e5eff1", washroom: "#e2edf5", meeting: "#e8edf7", pantry: "#f4ece2", workspace: "#ebf1e5", room: "#eef0f2", exit: "#cdebd4"};
const $ = id => document.getElementById(id);
const key = (r, c) => r + "," + c, parse = k => k.split(",").map(Number);

let ROWS = 0, COLS = 0, grid = [], occ = new Set(), exits = new Set();
let kinds = [], rooms = [], corridors = [], meta = {name: "", building: "", floor: ""}, layouts = [];
let tool = "select", algo = "bfs", painting = false, selected = null;
let sim = null, timer = null, paused = false, running = false, busy = false, runId = 0, replans = 0;
const MAX_REPLANS = 3;
const say = t => $("msg").textContent = t || "";
const delay = () => 305 - $("speed").value * 3;

// ---------- layout loading ----------
function setKinds() {
  kinds = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  const paint = (it, k) => { for (let r = it.r; r < it.r + it.h; r++) for (let c = it.c; c < it.c + it.w; c++) kinds[r][c] = k; };
  rooms.forEach(it => paint(it, it.kind || "room")); corridors.forEach(it => paint(it, "corridor"));
}
function kindAt(r, c) {   // floor colour class; cells freed by editing take the colour of a neighbouring space
  if (kinds[r] && kinds[r][c]) return kinds[r][c];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const k = kinds[r + dr] && kinds[r + dr][c + dc]; if (k) return k; }
  return "room";
}
function applyBuilding(b) {   // b: {rows, cols, grid, rooms, corridors, exits, occupants, name, building, floor}
  resetSim(); clearStats(); say(""); $("editMsg").textContent = ""; $("selInfo").textContent = "";
  ROWS = b.rows; COLS = b.cols; grid = b.grid.map(r => r.slice());
  occ = new Set(b.occupants.map(p => key(p[0], p[1]))); exits = new Set(b.exits.map(p => key(p[0], p[1])));
  rooms = b.rooms; corridors = b.corridors; meta = {name: b.name, building: b.building, floor: b.floor};
  setKinds();
  $("planTitle").textContent = `${meta.building} – ${meta.floor}`;
  $("planMeta").textContent = `${meta.name} · ${COLS} × ${ROWS} grid cells · click or drag on the plan to edit`;
  const svg = $("plan"); svg.setAttribute("viewBox", `-1.9 -1.9 ${COLS + 3.8} ${ROWS + 5}`);
  const hit = $("hit"); hit.setAttribute("x", 0); hit.setAttribute("y", 0); hit.setAttribute("width", COLS); hit.setAttribute("height", ROWS);
  renderPlan(); draw();
}
function loadPreset(id) { const b = layouts.find(l => l.id === id); if (b) applyBuilding(b); }

// ---------- floor plan drawing (static layer: floor, walls, doors, exits, labels) ----------
const free = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS && grid[r][c] === 0;
const perimeter = (r, c) => r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
function doorKind(r, c) {   // a free cell squeezed into a straight wall = door; 'h' = opening in a horizontal wall, 'v' = in a vertical wall
  if (!free(r, c) || perimeter(r, c)) return null;
  if (!free(r, c - 1) && !free(r, c + 1) && free(r - 1, c) && free(r + 1, c)) return "h";
  if (!free(r - 1, c) && !free(r + 1, c) && free(r, c - 1) && free(r, c + 1)) return "v";
  return null;
}
function roomNameAt(r, c) {
  const hit = it => r >= it.r && r < it.r + it.h && c >= it.c && c < it.c + it.w;
  const it = rooms.find(hit) || corridors.find(hit); return it ? it.name : null;
}
function doorMarkup(r, c, type) {
  const A = kindAt, isCorr = (rr, cc) => free(rr, cc) && A(rr, cc) === "corridor";
  let s = 1, x1, y1, tx, ty, bx, by, sweep;
  if (type === "h") {   // hinge on the left jamb, leaf swings up or down into a room (not into the corridor)
    if (isCorr(r + 1, c) && !isCorr(r - 1, c)) s = -1;
    x1 = c; y1 = r + .5; tx = c; ty = y1 + s; bx = c + 1; by = y1; sweep = s === 1 ? 0 : 1;
  } else {              // hinge on the top jamb, leaf swings left or right
    if (isCorr(r, c + 1) && !isCorr(r, c - 1)) s = -1;
    x1 = c + .5; y1 = r; tx = x1 + s; ty = r; bx = x1; by = r + 1; sweep = s === 1 ? 1 : 0;
  }
  return `<path class="swing" d="M${x1} ${y1}L${tx} ${ty}A1 1 0 0 ${sweep} ${bx} ${by}Z"/>` +
         `<line class="leaf" x1="${x1}" y1="${y1}" x2="${tx}" y2="${ty}"/>`;
}
function wrapLabel(text, w, fs) {   // one line if it fits the room width, otherwise two
  const fits = t => t.length * fs * .56 <= w - 1;
  if (fits(text) || !text.includes(" ")) return [text];
  const parts = text.split(" "); let best = null;
  for (let i = 1; i < parts.length; i++) { const a = parts.slice(0, i).join(" "), b = parts.slice(i).join(" ");
    const m = Math.max(a.length, b.length); if (!best || m < best.m) best = {m, l: [a, b]}; }
  return best.l;
}
function labelMarkup() {
  let out = "";
  const text = (x, y, fs, s, cls, rot) => `<text class="${cls}" x="${x}" y="${y}" font-size="${fs}" text-anchor="middle"${rot ? ` transform="rotate(-90 ${x} ${y})"` : ""}>${s}</text>`;
  const freeShare = it => { let n = 0; for (let r = it.r; r < it.r + it.h; r++) for (let c = it.c; c < it.c + it.w; c++) if (grid[r][c] === 0) n++; return n / (it.h * it.w); };
  rooms.forEach(it => {
    if (freeShare(it) < .5) return;      // the room was walled over: its label goes away too
    const fs = it.w < 8 ? .66 : .78, lines = wrapLabel(it.name, it.w, fs), cx = it.c + it.w / 2, cy = it.r + it.h / 2;
    lines.forEach((l, i) => out += text(cx, cy + (i - (lines.length - 1) / 2) * fs * 1.15 + fs * .33, fs, l, "room-label"));
  });
  corridors.forEach(it => {
    if (freeShare(it) < .5) return;
    const vertical = it.h > it.w * 2, cx = it.c + it.w / 2, cy = it.r + it.h / 2;
    out += text(cx, cy + .25, .66, it.name.toUpperCase(), "corr-label", vertical);
  });
  return out;
}
function exitMarkup(k, i) {
  const [r, c] = parse(k), L = String.fromCharCode(65 + i % 26);
  const side = r === 0 ? "top" : r === ROWS - 1 ? "bottom" : c === 0 ? "left" : "right";
  const rot = {top: 0, right: 90, bottom: 180, left: 270}[side];
  const pos = {top: [c + .5, -1.15, 0], bottom: [c + .5, ROWS + 1.15, 0], left: [-1.15, r + .5, -90], right: [COLS + 1.15, r + .5, 90]}[side];
  return `<path class="exit-arrow" transform="translate(${c + .5} ${r + .5}) rotate(${rot})" d="M-.3 .18L0 -.28L.3 .18Z"/>` +
    `<g class="exit-sign" transform="translate(${pos[0]} ${pos[1]}) rotate(${pos[2]})"><rect x="-1.7" y="-.48" width="3.4" height=".96" rx=".08"/>` +
    `<text x="0" y=".2" text-anchor="middle" font-size=".6">EXIT ${L}</text></g>`;
}
function renderPlan() {
  let floor = "", walls = "", doors = "", exitSvg = "";
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const wall = grid[r][c] === 1, col = wall ? "" : (exits.has(key(r, c)) ? FILL.exit : FILL[kindAt(r, c)] || FILL.room);
      let e = c + 1;
      while (e < COLS && (grid[r][e] === 1) === wall && (wall || (exits.has(key(r, e)) ? FILL.exit : FILL[kindAt(r, e)] || FILL.room) === col)) e++;
      if (wall) walls += `<rect x="${c}" y="${r}" width="${e - c}" height="1.02"/>`;
      else floor += `<rect x="${c}" y="${r}" width="${e - c}" height="1.02" fill="${col}"/>`;
      c = e;
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const t = doorKind(r, c); if (t) doors += doorMarkup(r, c, t); }
  [...exits].forEach((k, i) => exitSvg += exitMarkup(k, i));
  $("staticLayer").innerHTML =
    `<rect class="paper" x="-1.9" y="-1.9" width="${COLS + 3.8}" height="${ROWS + 5}"/>` +
    `<g shape-rendering="crispEdges">${floor}<g class="walls">${walls}</g></g>` + doors + exitSvg + labelMarkup() +
    `<text class="title-block" x="0" y="${ROWS + 2.8}" font-size=".95">${(meta.building + " – " + meta.floor).toUpperCase()}</text>` +
    `<text class="title-sub" x="${COLS}" y="${ROWS + 2.8}" font-size=".62" text-anchor="end">${meta.name} · ${COLS} × ${ROWS} grid</text>`;
}
function draw() {   // dynamic layers: routes, people, table, editor-view stats
  if (!sim) { $("sTotal").textContent = occ.size; $("sName").textContent = NAMES[algo]; }
  renderRoutes(); renderActors(); renderTable();
}

/* Routes. Every line is drawn from real simulation state (the planned path and the cells actually visited):
     planned   = faint dotted line, the calculated route before anyone has moved
     active    = bright animated dashes, the part of the route still ahead of a moving occupant
     travelled = thin solid line, the cells an occupant has really walked on
     completed = bold solid line, the full walked route of an occupant who has reached an exit */
function renderRoutes() {
  if (!sim) { $("routeLayer").innerHTML = ""; return; }
  const phase = Date.now() % 1200;
  const line = (cells, cls, i) => `<polyline class="route-line ${cls}${selected === null ? "" : selected === i ? " sel" : " dim"}" ` +
    `style="stroke:${colorOf(i)};animation-delay:-${phase}ms" points="${cells.map(([r, c]) => `${c + 0.5},${r + 0.5}`).join(" ")}"/>`;
  let svg = "";
  sim.routes.forEach((rt, i) => {
    if (!rt.found) return;
    const finished = sim.done[i];
    if (sim.trail[i].length > 1) svg += line(sim.trail[i], finished ? "completed" : "travelled", i);
    if (!finished) { const ahead = rt.path.slice(sim.idx[i]); if (ahead.length > 1) svg += line(ahead, sim.ticks === 0 ? "planned" : "active", i); }
  });
  $("routeLayer").innerHTML = svg;
}

// Person icons. One element per occupant is kept, so the CSS transition animates the walk between cells.
const STATE_CLASS = {evacuated: "gone", trapped: "trapped", blocked: "blocked", waiting: "waiting", moving: "moving", planned: "idle", "at exit": "idle"};
let actorEls = [];
function makeActor() {
  const g = document.createElementNS(NS, "g"); g.setAttribute("class", "actor");
  g.innerHTML = `<title></title><g class="ai"><circle class="bg" r=".47"/><circle class="head" cy="-.2" r=".13"/>` +
    `<path class="body" d="M-.21 .3C-.21 -.02 -.11 -.06 0 -.06S.21 -.02 .21 .3Z"/></g>`;
  return g;
}
function renderActors() {
  const layer = $("actorLayer");
  const list = sim ? sim.routes.map((rt, i) => ({pos: SimEngine.position(sim, i), status: SimEngine.status(sim, i)}))
    : [...occ].map(k => ({pos: parse(k), status: "planned"}));
  if (actorEls.length !== list.length) { layer.innerHTML = ""; actorEls = list.map(() => { const a = makeActor(); layer.appendChild(a); return a; }); }
  const ms = sim ? Math.round(delay() * 0.9) : 0;     // no sliding when only editing or after Reset
  list.forEach((o, i) => {
    const a = actorEls[i];
    a.setAttribute("class", "actor " + STATE_CLASS[o.status] + (selected === i ? " sel" : ""));
    a.firstChild.textContent = `Occupant ${i + 1}: ${o.status}`;
    a.style.color = colorOf(i);
    a.style.transition = `transform ${ms}ms linear`;
    a.style.transform = `translate(${o.pos[1] + 0.5}px, ${o.pos[0] + 0.5}px)`;
  });
}

// Per-occupant table (same data as the icons and routes). Click a row to highlight that occupant.
const exitLetter = cell => { const i = [...exits].indexOf(key(cell[0], cell[1])); return i < 0 ? "?" : String.fromCharCode(65 + i % 26); };
const STATUS_LABEL = {evacuated: "Evacuated", trapped: "Trapped", blocked: "Blocked", waiting: "Waiting", moving: "Moving", planned: "Planned", "at exit": "At exit"};
let tableSig = "";
function renderTable() {
  let html;
  if (!sim) html = `<tr><td colspan="7" class="empty">Start or preview an evacuation to see each occupant's route.</td></tr>`;
  else html = sim.routes.map((rt, i) => {
    const s = SimEngine.status(sim, i), last = rt.found ? rt.path[rt.path.length - 1] : null;
    return `<tr data-i="${i}" class="${selected === i ? "sel" : ""}"><td><i class="dot" style="background:${colorOf(i)}"></i>${i + 1}</td>` +
      `<td><span class="st st-${s.replace(" ", "-")}">${STATUS_LABEL[s]}</span></td><td>${rt.start[0]}, ${rt.start[1]}</td>` +
      `<td>${last ? "EXIT " + exitLetter(last) : "none"}${rt.replanned ? " (re-planned)" : ""}</td><td>${rt.found ? (rt.path_length ?? rt.path.length - 1) : "–"}</td>` +
      `<td>${sim.trail[i].length - 1}</td><td>${rt.explored_count ?? "–"}</td></tr>`;
  }).join("");
  if (html === tableSig) return;
  tableSig = html; $("occBody").innerHTML = html;
}
$("occBody").onclick = e => {
  const tr = e.target && e.target.closest ? e.target.closest("tr[data-i]") : null;
  if (!tr) return;
  const i = +tr.dataset.i; selected = selected === i ? null : i; draw();
};

// ---------- editing on the plan ----------
function cellFromEvent(e) {
  const svg = $("plan"), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [Math.floor(p.y), Math.floor(p.x)];
}
function describeCell(r, c) {
  const k = key(r, c), who = sim ? sim.routes.findIndex((rt, i) => !sim.done[i] && SimEngine.position(sim, i).join() === k) : -1;
  let what;
  if (grid[r][c] === 1) what = perimeter(r, c) ? "Outer wall" : "Wall";
  else if (exits.has(k)) what = "Emergency exit EXIT " + exitLetter([r, c]);
  else if (doorKind(r, c)) { const h = doorKind(r, c) === "h", a = roomNameAt(h ? r - 1 : r, h ? c : c - 1), b = roomNameAt(h ? r + 1 : r, h ? c : c + 1); what = `Door between ${a || "open space"} and ${b || "open space"}`; }
  else what = roomNameAt(r, c) || "Open floor";
  const person = who >= 0 ? ` · Occupant ${who + 1} (${SimEngine.status(sim, who)})` : (!sim && occ.has(k) ? " · Occupant here" : "");
  return {text: `Cell (row ${r}, col ${c}): ${what}${person}`, who};
}
function applyTool(r, c, isDrag) {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return;
  if (tool === "select") {
    const d = describeCell(r, c); $("selInfo").textContent = d.text; $("editMsg").textContent = "";
    if (sim && d.who >= 0) { selected = selected === d.who ? null : d.who; draw(); }
    return;
  }
  if (running) { $("editMsg").textContent = "Reset the simulation before editing the building."; return; }
  const res = Editor.apply({grid, occ, exits, rows: ROWS, cols: COLS}, tool, r, c, {drag: isDrag});
  $("editMsg").textContent = res.ok ? "" : res.message;      // invalid placements are refused and explained
  if (!res.changed) return;
  if (sim) { sim = null; selected = null; clearStats(); }    // editing discards the old simulation / preview
  renderPlan(); draw();
}
function moveHover(e) {
  const [r, c] = cellFromEvent(e), h = $("hover");
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) { h.setAttribute("visibility", "hidden"); return [r, c]; }
  h.setAttribute("x", c); h.setAttribute("y", r); h.setAttribute("visibility", "visible"); return [r, c];
}
$("hit").addEventListener("pointerdown", e => { const [r, c] = moveHover(e); applyTool(r, c, false); painting = tool === "wall" || tool === "erase"; });
$("hit").addEventListener("pointermove", e => { const [r, c] = moveHover(e); if (painting) applyTool(r, c, true); });
$("hit").addEventListener("pointerleave", () => $("hover").setAttribute("visibility", "hidden"));
window.addEventListener("pointerup", () => painting = false);

const TOOL_NAMES = {select: "Select", occupant: "Add Occupant", exit: "Add Emergency Exit", wall: "Draw Wall", door: "Add Door", erase: "Erase"};
function setTool(t) {
  tool = t; document.querySelectorAll(".tool").forEach(x => x.classList.toggle("active", x.dataset.tool === t));
  $("toolName").textContent = TOOL_NAMES[t]; $("toolHint").textContent = Editor.HINTS[t]; $("editMsg").textContent = "";
  $("plan").dataset.tool = t;
}
document.querySelectorAll(".tool").forEach(b => b.onclick = () => setTool(b.dataset.tool));
setTool("select");
document.querySelectorAll("button.algo").forEach(b => b.onclick = () => {
  algo = b.dataset.algo; document.querySelectorAll("button.algo").forEach(x => x.classList.toggle("active", x === b));
  $("algoInfo").textContent = INFO[algo]; if (!sim) draw(); });
$("algoInfo").textContent = INFO.bfs;

// ---------- simulation state ----------
function setControls() {
  $("runBtn").disabled = running; $("previewBtn").disabled = running;
  $("pauseBtn").disabled = !(running && !paused); $("resumeBtn").disabled = !(running && paused);
}
function resetSim() { clearTimeout(timer); runId++; sim = null; selected = null; running = paused = busy = false; replans = 0; setControls(); }
function clearStats() { ["sName", "sTotal", "sEvac", "sRemain", "sTrap", "sAvg", "sExp", "sTime", "sTick", "sWait", "sBlock", "sStatus"].forEach(i => $(i).textContent = "–");
  $("progressBar").style.width = "0%"; $("progressPct").textContent = "0%"; }
$("resetBtn").onclick = () => { resetSim(); clearStats(); say(""); draw(); };
$("reloadBtn").onclick = () => loadPreset($("layoutSelect").value);
$("layoutSelect").onchange = () => loadPreset($("layoutSelect").value);

$("clearBtn").onclick = () => {     // blank building with an outer wall only: draw your own rooms
  const g = Array.from({length: ROWS}, (_, r) => Array.from({length: COLS}, (_, c) => (perimeter(r, c) ? 1 : 0)));
  applyBuilding({rows: ROWS, cols: COLS, grid: g, rooms: [], corridors: [], exits: [], occupants: [], name: "Custom Building", building: "Custom Building", floor: "Blank Floor"});
};
$("randomBtn").onclick = () => {     // random floor plan: rooms above and below a 3-wide corridor, one door per room, 3 exits
  const rows = 22, cols = 36, rnd = n => Math.floor(Math.random() * n);
  const g = Array.from({length: rows}, () => Array(cols).fill(1)), rs = [], pool = ["classroom", "office", "lab", "meeting", "pantry", "workspace"];
  const cr = 7 + rnd(5), carve = (r0, r1, c0, c1) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = 0; };
  carve(cr, cr + 2, 1, cols - 2);
  const split = (r0, r1, wallRow) => {
    let c = 1;
    for (;;) {
      const w = 6 + rnd(4), last = c + w + 1 + 6 > cols - 1, c1 = last ? cols - 2 : c + w - 1;
      carve(r0, r1, c, c1); g[wallRow][c + 1 + rnd(c1 - c - 1)] = 0;                      // room + its door
      rs.push({name: "Room " + (rs.length + 1), kind: pool[rnd(pool.length)], r: r0, c, h: r1 - r0 + 1, w: c1 - c + 1});
      if (last) break; c = c1 + 2;
    }
  };
  split(1, cr - 2, cr - 1); split(cr + 4, rows - 2, cr + 3);
  const ex = [[cr + 1, 0], [cr + 1, cols - 1]], bottom = rs.filter(x => x.r > cr), b = bottom[rnd(bottom.length)];
  ex.push([rows - 1, b.c + 1 + rnd(b.w - 2)]); ex.forEach(([r, c]) => { g[r][c] = 0; });
  const spots = []; for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) if (g[r][c] === 0 && !(g[r - 1][c] && g[r + 1][c])) spots.push([r, c]);
  const oc = []; while (oc.length < 8) oc.push(spots.splice(rnd(spots.length), 1)[0]);
  applyBuilding({rows, cols, grid: g, rooms: rs, corridors: [{name: "Corridor", r: cr, c: 1, h: 3, w: cols - 2}], exits: ex, occupants: oc,
    name: "Random Building", building: "Random Building", floor: "Generated Floor"});
};

// ---------- backend calls ----------
async function callApi(algorithm) {
  const res = await fetch("/api/evacuate", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({grid, occupants: [...occ].map(parse), exits: [...exits].map(parse), algorithm})});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data.results;
}
const netErr = e => e instanceof TypeError ? "Cannot reach the server. Is Flask running?" : e.message;

// ---------- analytics ----------
function showMetrics(r) {   // numbers measured by the Python backend for this run
  $("sName").textContent = r.name; $("sTotal").textContent = r.total; $("sExp").textContent = r.explored_total; $("sTime").textContent = Number(r.time_ms).toFixed(3);
  $("sAvg").textContent = r.reachable ? r.avg_path_length : "–"; $("sAvg").title = r.reachable ? `longest route: ${r.max_path_length} steps` : "";
}
function updateLive() {   // live counts, all from SimEngine.counts so they always add up to the total
  const k = SimEngine.counts(sim);
  $("sEvac").textContent = `${k.evacuated} / ${k.total}`; $("sRemain").textContent = k.total - k.evacuated; $("sWait").textContent = k.waiting;
  $("sTrap").textContent = k.trapped; $("sBlock").textContent = k.blocked; $("sTick").textContent = sim.ticks;
  const pct = k.total ? k.evacuated / k.total * 100 : 0;
  $("progressBar").style.width = pct + "%"; $("progressPct").textContent = Math.round(pct) + "%";
}

// ---------- simulation (movement rules live in simulation.js) ----------
$("previewBtn").onclick = async () => {   // calculate and show the planned routes without moving anyone
  resetSim(); clearStats(); say("");
  const my = runId;
  try {
    const [r] = await callApi(algo);
    if (my !== runId) return;
    sim = SimEngine.createSim(r.routes); showMetrics(r); $("sStatus").textContent = "Planned"; updateLive(); draw();
    say(`Routes planned with ${r.name}. Press Start Simulation to begin moving.`);
  } catch (e) { say(netErr(e)); }
};
$("runBtn").onclick = async () => {
  resetSim(); clearStats(); say("");   // clear the previous run's status so it cannot be mistaken for the new one
  const my = runId;
  try {
    const [r] = await callApi(algo);
    if (my !== runId) return;                         // Reset or a new run happened while waiting for the server
    sim = SimEngine.createSim(r.routes); showMetrics(r);
    $("sStatus").textContent = "Running"; running = true; setControls();
    updateLive(); draw(); tick();
  } catch (e) { say(netErr(e)); }
};
async function tick() {
  if (paused || busy || !sim) return;
  const my = runId, res = SimEngine.step(sim);
  updateLive(); draw();
  if (SimEngine.isComplete(sim)) { finish(); return; }
  if (res.deadlock) {                                 // nobody can move: re-plan around other occupants, never collide
    if (replans >= MAX_REPLANS) { SimEngine.markConflict(sim); finish(); return; }
    replans++; busy = true; $("sStatus").textContent = "Re-planning"; say("Movement conflict: re-planning blocked occupants…");
    try { await replan(); }
    catch (e) { if (my !== runId) return; busy = false; SimEngine.markConflict(sim); finish(); say(netErr(e)); return; }
    if (my !== runId) return;
    busy = false; say(""); if (paused) return;        // if paused meanwhile, Resume continues
  }
  $("sStatus").textContent = "Running";
  timer = setTimeout(tick, delay());
}
async function replan() {
  /* Ask the backend (same real algorithm) for a new route that treats every other occupant as a wall. */
  for (const i of SimEngine.movers(sim)) {
    const g2 = grid.map(row => row.slice()), me = SimEngine.position(sim, i);
    sim.routes.forEach((rt, j) => { if (j !== i && !sim.done[j]) { const [r, c] = SimEngine.position(sim, j); g2[r][c] = 1; } });
    const res = await fetch("/api/evacuate", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({grid: g2, occupants: [me], exits: [...exits].map(parse), algorithm: algo})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Server error");
    const route = data.results[0].routes[0];
    if (route.found) { sim.routes[i].path = route.path; sim.routes[i].replanned = true; sim.idx[i] = 0; }   // otherwise keep waiting on the old route
  }
}
function finish() {
  running = false; setControls();
  updateLive(); draw();
  const k = SimEngine.counts(sim);
  if (sim.conflict) {
    $("sStatus").textContent = "Movement conflict";
    say(`Movement conflict: ${k.blocked} occupant(s) could not move without colliding. ${k.evacuated} evacuated, ${k.trapped} trapped.`);
  } else {
    $("sStatus").textContent = "Complete";
    say(k.trapped ? `${k.evacuated} evacuated. ${k.trapped} occupant(s) trapped: no route to any exit.` : "All occupants evacuated.");
  }
}
$("pauseBtn").onclick = () => {
  if (!running || paused) return;
  paused = true; clearTimeout(timer); $("sStatus").textContent = "Paused"; setControls();
};
$("resumeBtn").onclick = () => {
  if (!running || !paused) return;
  paused = false; $("sStatus").textContent = busy ? "Re-planning" : "Running"; setControls();
  if (!busy) tick();
};

// ---------- comparison (one backend call: same layout, same occupants, same exits for all three algorithms) ----------
$("compareBtn").onclick = async () => {
  $("cmpMsg").textContent = "";
  try {
    const rs = await callApi("all"), by = Object.fromEntries(rs.map(r => [r.algorithm, r]));
    const min = f => Math.min(...rs.map(f)), any = rs[0].reachable > 0;
    const bestTotal = min(r => r.total_path_length), bestAvg = min(r => r.avg_path_length), bestExp = min(r => r.explored_total), bestTime = min(r => r.time_ms);
    const best = (v, b) => v === b ? ' class="best"' : "";
    document.querySelector("#cmpTable tbody").innerHTML = rs.map(r =>
      `<tr><td>${r.name}</td><td>${r.reachable}/${r.total}</td><td>${r.trapped}</td><td${any ? best(r.avg_path_length, bestAvg) : ""}>${any ? r.avg_path_length : "–"}</td>` +
      `<td>${any ? r.total_path_length : "–"}</td><td${best(r.explored_total, bestExp)}>${r.explored_total}</td><td${best(r.time_ms, bestTime)}>${r.time_ms}</td>` +
      `<td>${!any ? "–" : r.total_path_length === bestTotal ? "Shortest" : "+" + (r.total_path_length - bestTotal) + " steps"}</td></tr>`).join("");
    const bars = (title, f, max) => `<h3>${title}</h3>` + rs.map(r =>
      `<div class="bar-row"><span>${SHORT[r.algorithm]}</span><div><div class="bar" style="width:${max ? f(r) / max * 100 : 0}%"></div></div><span>${f(r)}</span></div>`).join("");
    $("bars").innerHTML = bars("Nodes explored", r => r.explored_total, Math.max(...rs.map(r => r.explored_total))) +
      (any ? bars("Average path length (steps)", r => r.avg_path_length, Math.max(...rs.map(r => r.avg_path_length))) : "");
    // explanation built from the numbers above, not from fixed text
    const notes = [`All three algorithms ran on the same layout (${meta.name}): ${rs[0].total} occupant(s) at the same positions and ${exits.size} exit(s).`];
    if (!any) notes.push("No occupant can reach an exit, so there are no routes to compare.");
    else {
      const d = by.dfs.total_path_length;
      notes.push(d > bestTotal ? `DFS routes were longer: ${d} steps in total versus ${bestTotal} for the shortest (+${Math.round((d - bestTotal) / bestTotal * 100)}%).`
                               : "On this layout DFS happened to match the shortest total route length.");
      const a = by.astar.explored_total, b = by.bfs.explored_total;
      notes.push(a < b ? `A* explored ${a} nodes versus ${b} for BFS (${Math.round((b - a) / b * 100)}% fewer).`
                       : a === b ? `A* and BFS explored the same number of nodes (${a}).` : `A* explored ${a} nodes versus ${b} for BFS on this layout.`);
    }
    notes.push("DFS does not guarantee the shortest path; BFS guarantees the fewest steps in an unweighted grid, and A* with the Manhattan heuristic is also optimal here. Times are measured in Python for the whole building and vary by machine.");
    $("cmpNote").textContent = notes.join(" ");
  } catch (e) { $("cmpMsg").textContent = netErr(e); say(netErr(e)); }
};

// ---------- start-up: load the predefined buildings from the backend ----------
(async function init() {
  try {
    const res = await fetch("/api/layouts"); layouts = (await res.json()).layouts;
    $("layoutSelect").innerHTML = layouts.map(l => `<option value="${l.id}">${l.name}</option>`).join("");
    loadPreset(layouts[0].id);
  } catch (e) { $("planTitle").textContent = "Could not load the building layouts"; say(netErr(e)); }
})();
