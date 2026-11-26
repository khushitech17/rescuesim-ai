"""Predefined building layouts for RescueSim AI.

Every layout is described the way an architect would: room rectangles, corridors, door openings and
emergency exits. build_layout() COMPILES that description into the same 0/1 grid the BFS / DFS / A*
algorithms search (0 = free floor, 1 = wall), so the drawn floor plan and the search grid can never
disagree: a room is a block of free cells, a wall is a block of wall cells, a door is a single free
cell cut into a wall, an exit is a free cell in the outer wall.

Coordinates are (row, col). Room rectangles give the INTERIOR (free) cells: r, c = top-left cell,
h, w = height and width in cells. Rooms are separated by one-cell walls.
"""

# ---------------------------------------------------------------- Academic building (horizontal corridor)
ACADEMIC = {
    "id": "academic", "name": "Academic Building", "building": "Academic Block", "floor": "Ground Floor",
    "rows": 24, "cols": 40,
    "rooms": [
        {"name": "Classroom 101", "kind": "classroom", "r": 1, "c": 1, "h": 8, "w": 9},
        {"name": "Classroom 102", "kind": "classroom", "r": 1, "c": 11, "h": 8, "w": 9},
        {"name": "Faculty Room", "kind": "faculty", "r": 1, "c": 21, "h": 8, "w": 8},
        {"name": "Computer Lab", "kind": "lab", "r": 1, "c": 30, "h": 8, "w": 9},
        {"name": "Reception", "kind": "reception", "r": 14, "c": 1, "h": 9, "w": 11},
        {"name": "Office", "kind": "office", "r": 14, "c": 13, "h": 9, "w": 9},
        {"name": "Conference Room", "kind": "conference", "r": 14, "c": 23, "h": 9, "w": 8},
        {"name": "Washroom", "kind": "washroom", "r": 14, "c": 32, "h": 9, "w": 7},
    ],
    "corridors": [{"name": "Main Corridor", "r": 10, "c": 1, "h": 3, "w": 38}],
    "doors": [(9, 5), (9, 15), (9, 24), (9, 34), (13, 6), (13, 17), (13, 26), (13, 35), (4, 29)],
    "exits": [(11, 0), (11, 39), (18, 0), (23, 17), (0, 34)],
    "occupants": [(2, 26), (3, 11), (6, 1), (7, 31), (7, 32), (15, 28), (16, 8), (16, 19),
                  (16, 35), (19, 11), (20, 17), (21, 36)],
}

# ---------------------------------------------------------------- Office building (vertical spine + lobby)
OFFICE = {
    "id": "office", "name": "Office Building", "building": "Corporate Office Tower", "floor": "First Floor",
    "rows": 28, "cols": 36,
    "rooms": [
        {"name": "Office 201", "kind": "office", "r": 1, "c": 1, "h": 6, "w": 14},
        {"name": "Office 202", "kind": "office", "r": 8, "c": 1, "h": 6, "w": 14},
        {"name": "Meeting Room A", "kind": "meeting", "r": 15, "c": 1, "h": 5, "w": 14},
        {"name": "Office 203", "kind": "office", "r": 1, "c": 20, "h": 6, "w": 15},
        {"name": "Office 204", "kind": "office", "r": 8, "c": 20, "h": 6, "w": 15},
        {"name": "Meeting Room B", "kind": "meeting", "r": 15, "c": 20, "h": 5, "w": 15},
        {"name": "Pantry", "kind": "pantry", "r": 21, "c": 1, "h": 6, "w": 9},
        {"name": "Reception", "kind": "reception", "r": 21, "c": 11, "h": 6, "w": 13},
        {"name": "Open Workspace", "kind": "workspace", "r": 21, "c": 25, "h": 6, "w": 10},
    ],
    # the corridor runs one row into the lobby row band (row 20), so it opens straight into Reception
    "corridors": [{"name": "Central Corridor", "r": 1, "c": 16, "h": 20, "w": 3}],
    "doors": [(3, 15), (10, 15), (17, 15), (3, 19), (10, 19), (17, 19), (24, 10), (24, 24)],
    "exits": [(0, 17), (27, 17), (23, 0), (23, 35)],
    "occupants": [(2, 12), (3, 1), (3, 33), (10, 14), (10, 33), (11, 33), (17, 3), (17, 23),
                  (22, 9), (24, 21), (25, 23), (25, 34)],
}

LAYOUTS = {"academic": ACADEMIC, "office": OFFICE}


def _rect(spec_item):
    return [(r, c) for r in range(spec_item["r"], spec_item["r"] + spec_item["h"])
            for c in range(spec_item["c"], spec_item["c"] + spec_item["w"])]


def build_layout(key):
    """Compile a layout description into the real simulation grid and return everything the UI needs."""
    spec = LAYOUTS[key]
    rows, cols = spec["rows"], spec["cols"]
    grid = [[1] * cols for _ in range(rows)]                 # start fully walled, then carve space out
    for item in spec["rooms"] + spec["corridors"]:
        for r, c in _rect(item):
            grid[r][c] = 0
    for r, c in spec["doors"]:                                # a door is one free cell cut into a wall
        assert grid[r][c] == 1, f"{key}: door {(r, c)} is not on a wall"
        grid[r][c] = 0
    for r, c in spec["exits"]:                                # an exit is a free cell in the outer wall
        assert r in (0, rows - 1) or c in (0, cols - 1), f"{key}: exit {(r, c)} is not on the outer wall"
        grid[r][c] = 0
    occ = [list(p) for p in spec["occupants"]]
    assert all(grid[r][c] == 0 for r, c in occ), f"{key}: an occupant stands on a wall"
    assert len({tuple(p) for p in occ}) == len(occ), f"{key}: two occupants share a cell"
    return {
        "id": spec["id"], "name": spec["name"], "building": spec["building"], "floor": spec["floor"],
        "rows": rows, "cols": cols, "grid": grid,
        "rooms": [dict(x) for x in spec["rooms"]], "corridors": [dict(x) for x in spec["corridors"]],
        "doors": [list(p) for p in spec["doors"]], "exits": [list(p) for p in spec["exits"]], "occupants": occ,
    }


def all_layouts():
    return [build_layout(k) for k in LAYOUTS]
