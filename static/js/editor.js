/* Building-editor rules for RescueSim AI (no DOM code, so it can be unit-tested with Node).
   state = { grid, occ: Set("r,c"), exits: Set("r,c"), size }   grid[r][c]: 0 = free floor, 1 = wall.
   apply() either changes the state and returns {ok:true, changed:true}, or leaves it untouched and
   returns {ok:false, message} explaining why the placement is invalid. */
(function (root) {
  const key = (r, c) => r + "," + c;
  // buildings may be rectangular: state has rows/cols (st.size is still accepted for square grids)
  const R = st => (st.rows !== undefined ? st.rows : st.size), C = st => (st.cols !== undefined ? st.cols : st.size);
  const inside = (st, r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < R(st) && c < C(st);
  const isPerimeter = (st, r, c) => r === 0 || c === 0 || r === R(st) - 1 || c === C(st) - 1;
  const isCorner = (st, r, c) => (r === 0 || r === R(st) - 1) && (c === 0 || c === C(st) - 1);
  const free = (st, r, c) => inside(st, r, c) && st.grid[r][c] === 0;
  const wallAt = (st, r, c) => inside(st, r, c) && st.grid[r][c] === 1;

  /* A door is a gap in a straight interior wall: wall on both sides along the wall, open space on both sides across it. */
  function isDoorSpot(st, r, c) {
    if (!wallAt(st, r, c) || isPerimeter(st, r, c)) return false;
    return (wallAt(st, r, c - 1) && wallAt(st, r, c + 1) && free(st, r - 1, c) && free(st, r + 1, c)) ||
           (wallAt(st, r - 1, c) && wallAt(st, r + 1, c) && free(st, r, c - 1) && free(st, r, c + 1));
  }
  const inwardCell = (st, r, c) => r === 0 ? [1, c] : r === R(st) - 1 ? [r - 1, c] : c === 0 ? [r, 1] : [r, c - 1];
  const fail = message => ({ ok: false, changed: false, message });
  const done = changed => ({ ok: true, changed, message: "" });

  function apply(st, tool, r, c, opts = {}) {
    if (!inside(st, r, c)) return fail("That position is outside the building.");
    const k = key(r, c), isWall = st.grid[r][c] === 1, hasOcc = st.occ.has(k), hasExit = st.exits.has(k);
    switch (tool) {
      case "select": return done(false);                     // inspection only, never edits the layout
      case "wall":
        if (hasOcc) return fail("An occupant is standing here. Erase the occupant before building a wall.");
        if (hasExit) return fail("This is an emergency exit. Erase the exit before building a wall.");
        if (isWall) return done(false);
        st.grid[r][c] = 1; return done(true);
      case "erase":
        if (hasOcc) { st.occ.delete(k); return done(true); }
        if (hasExit) { st.exits.delete(k); return done(true); }
        if (isWall) { st.grid[r][c] = 0; return done(true); }
        return done(false);
      case "door":
        if (!isWall) return fail("A door replaces a wall segment. Click a wall cell.");
        if (isPerimeter(st, r, c)) return fail("Doors go inside the building. Use Add Exit on the outer wall.");
        if (!isDoorSpot(st, r, c)) return fail("A door needs a straight wall with open space on both sides.");
        st.grid[r][c] = 0; return done(true);
      case "occupant":
        if (isWall) return fail("Occupants cannot stand inside a wall.");
        if (hasOcc) { if (opts.drag) return done(false); st.occ.delete(k); return done(true); }   // click again to remove
        st.occ.add(k); return done(true);                                                           // standing on an exit is allowed
      case "exit":
        if (!isPerimeter(st, r, c)) return fail("Emergency exits must be on the outer wall of the building.");
        if (isCorner(st, r, c)) return fail("Exits cannot be placed in a corner.");
        if (hasExit) { if (opts.drag) return done(false); st.exits.delete(k); return done(true); }
        { const [ir, ic] = inwardCell(st, r, c); if (!free(st, ir, ic)) return fail("An exit needs open floor directly inside it."); }
        st.grid[r][c] = 0; st.exits.add(k); return done(true);                                      // opens the outer wall
      default: return fail("Unknown tool.");
    }
  }
  const HINTS = {
    select: "Select: click a room, wall, door, exit or occupant to inspect it. Nothing is changed.",
    wall: "Draw Wall: click or drag to build walls on free cells.",
    erase: "Erase: removes a wall, or the occupant / exit standing on the cell.",
    door: "Add Door: click an interior wall between two spaces to open a doorway. Draw Wall closes it again.",
    occupant: "Add Occupant: click a free floor cell. Click an occupant again to remove it.",
    exit: "Add Exit: click a non-corner cell of the outer wall that has open floor directly inside."
  };
  const api = { apply, isDoorSpot, isPerimeter, HINTS };
  if (typeof module !== "undefined") module.exports = api; else root.Editor = api;
})(this);
