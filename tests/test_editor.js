// Run: node tests/test_editor.js   (building-editor validation rules)
const assert = require("assert");
const E = require("../static/js/editor.js");
const S = 10;
const state = rows => ({ size: S, occ: new Set(), exits: new Set(), grid: rows.map(r => [...r].map(ch => (ch === "#" ? 1 : 0))) });
const open = () => state(Array(S).fill(".".repeat(S)));
const room = () => { const g = open().grid; for (let i = 0; i < S; i++) { g[0][i] = g[S - 1][i] = g[i][0] = g[i][S - 1] = 1; } for (let r = 1; r < S - 1; r++) g[r][5] = 1; return { size: S, occ: new Set(), exits: new Set(), grid: g }; };
let n = 0; const ok = m => console.log("ok -", m, ++n);
const rejected = (st, tool, r, c, text) => { const before = JSON.stringify([st.grid, [...st.occ], [...st.exits]]);
  const res = E.apply(st, tool, r, c); assert(!res.ok && !res.changed && res.message.toLowerCase().includes(text.toLowerCase()), `${tool}(${r},${c}) -> ${JSON.stringify(res)}`);
  assert.strictEqual(JSON.stringify([st.grid, [...st.occ], [...st.exits]]), before, "a rejected edit must not change anything"); };

// walls
let st = open(); assert(E.apply(st, "wall", 2, 2).changed && st.grid[2][2] === 1); assert(!E.apply(st, "wall", 2, 2).changed); ok("wall: builds, repeating is a no-op");
st = open(); E.apply(st, "occupant", 3, 3); rejected(st, "wall", 3, 3, "occupant"); ok("wall: refused on an occupant (no silent deletion)");
st = room(); E.apply(st, "exit", 5, 0); rejected(st, "wall", 5, 0, "exit"); ok("wall: refused on an exit");
rejected(open(), "wall", 99, 0, "outside"); rejected(open(), "wall", -1, 3, "outside"); rejected(open(), "wall", 1.5, 3, "outside"); ok("out-of-range or non-integer positions are refused");

// erase
st = open(); E.apply(st, "wall", 4, 4); assert(E.apply(st, "erase", 4, 4).changed && st.grid[4][4] === 0); ok("erase removes a wall");
st = open(); E.apply(st, "occupant", 4, 4); E.apply(st, "erase", 4, 4); assert(!st.occ.has("4,4")); ok("erase removes an occupant");
st = room(); E.apply(st, "exit", 5, 0); E.apply(st, "erase", 5, 0); assert(!st.exits.has("5,0")); ok("erase removes an exit");

// occupants
st = room(); rejected(st, "occupant", 5, 5, "wall"); rejected(st, "occupant", 0, 0, "wall"); ok("occupant: refused inside a wall");
st = open(); assert(E.apply(st, "occupant", 2, 2).changed && st.occ.has("2,2")); E.apply(st, "occupant", 2, 2); assert(!st.occ.has("2,2")); ok("occupant: click adds, click again removes");
st = open(); E.apply(st, "occupant", 2, 2); assert(!E.apply(st, "occupant", 2, 2, { drag: true }).changed && st.occ.has("2,2")); ok("occupant: dragging never toggles an occupant off");
st = open(); E.apply(st, "occupant", 2, 2); E.apply(st, "occupant", 2, 2); E.apply(st, "occupant", 2, 2); assert.strictEqual(st.occ.size, 1); ok("occupant: two occupants can never share a cell (set semantics)");
st = room(); E.apply(st, "exit", 5, 0); assert(E.apply(st, "occupant", 5, 0).ok && st.occ.has("5,0") && st.exits.has("5,0")); ok("occupant: may stand on an exit (handled as 'already at exit')");

// exits
st = room(); assert(E.apply(st, "exit", 5, 0).changed && st.exits.has("5,0") && st.grid[5][0] === 0); ok("exit: opens a gap in the outer wall");
rejected(room(), "exit", 3, 3, "outer wall"); ok("exit: refused in the interior");
rejected(room(), "exit", 0, 0, "corner"); rejected(room(), "exit", S - 1, S - 1, "corner"); ok("exit: refused in a corner");
st = room(); st.grid[5][1] = 1; rejected(st, "exit", 5, 0, "open floor"); ok("exit: refused when a wall blocks the inside");
st = room(); E.apply(st, "exit", 0, 3); E.apply(st, "exit", S - 1, 3); E.apply(st, "exit", 4, S - 1); assert.strictEqual(st.exits.size, 3); ok("exit: multiple exits on different sides");
st = room(); E.apply(st, "exit", 5, 0); E.apply(st, "exit", 5, 0); assert(!st.exits.has("5,0")); ok("exit: click again removes it");

// doors
st = room(); assert(E.apply(st, "door", 4, 5).changed && st.grid[4][5] === 0 && E.isDoorSpot(st, 3, 5) === false); ok("door: opens a straight interior wall between two spaces");
rejected(room(), "door", 3, 3, "wall"); ok("door: refused on floor");
rejected(room(), "door", 0, 4, "inside the building"); ok("door: refused on the outer wall (use an exit)");
st = state(["..........", "..........", "..........", "..........", "....##....", "....##....", "..........", "..........", "..........", ".........."]); rejected(st, "door", 4, 4, "straight wall"); ok("door: refused in a thick wall block");
st = room(); E.apply(st, "door", 4, 5); E.apply(st, "wall", 4, 5); assert.strictEqual(st.grid[4][5], 1); ok("door can be closed again with Draw Wall");
rejected(open(), "bogus", 1, 1, "unknown tool"); ok("unknown tool is refused");
["wall", "erase", "door", "occupant", "exit"].forEach(t => assert(E.HINTS[t] && E.HINTS[t].length > 10)); ok("every tool has a hint");

// rectangular buildings (rows != cols) and the Select tool
const rect = (rows, cols) => { const g = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? 1 : 0))); return { rows, cols, occ: new Set(), exits: new Set(), grid: g }; };
st = rect(6, 14); assert(E.apply(st, "exit", 3, 13).changed && st.exits.has("3,13") && st.grid[3][13] === 0); ok("rectangular: exit on the far (right) wall of a 6 x 14 building");
assert(E.apply(st, "exit", 5, 7).changed && st.exits.has("5,7")); ok("rectangular: exit on the bottom wall uses rows-1, not cols-1");
rejected(rect(6, 14), "exit", 5, 13, "corner"); rejected(rect(6, 14), "exit", 0, 0, "corner"); ok("rectangular: all four corners refused");
rejected(rect(6, 14), "occupant", 5, 5, "wall"); rejected(rect(6, 14), "wall", 6, 3, "outside"); rejected(rect(6, 14), "wall", 3, 14, "outside"); ok("rectangular: bounds use rows and cols separately");
st = rect(6, 14); for (let r = 1; r < 5; r++) st.grid[r][7] = 1; assert(E.apply(st, "door", 3, 7).changed && st.grid[3][7] === 0); ok("rectangular: door in an interior wall");
st = rect(6, 14); const snap = JSON.stringify([st.grid, [...st.occ], [...st.exits]]); assert(E.apply(st, "select", 2, 2).ok && !E.apply(st, "select", 2, 2).changed && JSON.stringify([st.grid, [...st.occ], [...st.exits]]) === snap); ok("select tool never changes the building");
assert(E.HINTS.select.length > 10); ok("select tool has a hint");
console.log("ALL EDITOR TESTS PASSED");
