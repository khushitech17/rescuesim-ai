import time
from flask import Flask, jsonify, render_template, request
from algorithms import ALGORITHMS
from layouts import all_layouts

app = Flask(__name__)
NAMES = {"bfs": "Breadth First Search", "dfs": "Depth First Search", "astar": "A* Search"}
MAX_SIZE, MAX_OCCUPANTS = 60, 200

def point(p, grid, label):
    if not (isinstance(p, list) and len(p) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in p)):
        raise ValueError(f"Invalid {label} position.")
    if not (0 <= p[0] < len(grid) and 0 <= p[1] < len(grid[0])):
        raise ValueError(f"A {label} is outside the building.")
    return tuple(p)

def parse(data):
    """Validate the request; returns (grid, occupants, exits) or raises ValueError."""
    grid = data.get("grid")
    if (not isinstance(grid, list) or not grid or not all(isinstance(r, list) and len(r) == len(grid[0]) for r in grid)
            or any(v not in (0, 1) for r in grid for v in r)):
        raise ValueError("Invalid building layout.")
    if len(grid) > MAX_SIZE or len(grid[0]) == 0 or len(grid[0]) > MAX_SIZE:
        raise ValueError(f"The building must be between 1 and {MAX_SIZE} cells wide and tall.")
    occ, exits = data.get("occupants"), data.get("exits")
    if not isinstance(occ, list) or not occ: raise ValueError("Place at least one occupant.")
    if not isinstance(exits, list) or not exits: raise ValueError("Place at least one emergency exit.")
    if len(occ) > MAX_OCCUPANTS: raise ValueError(f"At most {MAX_OCCUPANTS} occupants are supported.")
    occ = [point(p, grid, "occupant") for p in occ]
    if len(set(occ)) != len(occ): raise ValueError("Two occupants cannot stand in the same cell.")
    exits = {point(p, grid, "exit") for p in exits}
    if any(grid[r][c] == 1 for r, c in list(occ) + list(exits)):
        raise ValueError("An occupant or exit is placed on a wall.")
    return grid, occ, exits

def evacuate(key, grid, occupants, exits):
    """Run the chosen search for every occupant (each looks for its best reachable exit)."""
    t0, routes = time.perf_counter(), []
    for i, start in enumerate(occupants):
        r = ALGORITHMS[key](grid, start, exits)
        routes.append({"occupant": i, "start": list(start), "found": r["found"], "path": r["path"],
                       "path_length": r["path_length"], "explored_count": len(r["explored"]),
                       "exit": r["path"][-1] if r["found"] else None})
    ms = round((time.perf_counter() - t0) * 1000, 4)
    ok = [r for r in routes if r["found"]]
    return {"algorithm": key, "name": NAMES[key], "routes": routes, "total": len(routes),
            "reachable": len(ok), "trapped": len(routes) - len(ok),
            "avg_path_length": round(sum(r["path_length"] for r in ok) / len(ok), 2) if ok else 0,
            "max_path_length": max((r["path_length"] for r in ok), default=0),
            "total_path_length": sum(r["path_length"] for r in ok),
            "explored_total": sum(r["explored_count"] for r in routes), "time_ms": ms}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/layouts")
def api_layouts():
    """Predefined buildings: the real 0/1 grid plus the rooms, doors, exits and occupants it was compiled from."""
    return jsonify(layouts=all_layouts())

@app.route("/api/evacuate", methods=["POST"])
def api_evacuate():
    data = request.get_json(silent=True) or {}
    algo = data.get("algorithm")
    if algo not in list(ALGORITHMS) + ["all"]:
        return jsonify(error="Unknown algorithm."), 400
    try:
        grid, occ, exits = parse(data)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    keys = list(ALGORITHMS) if algo == "all" else [algo]
    return jsonify(results=[evacuate(k, grid, occ, exits) for k in keys])

if __name__ == "__main__":
    app.run(debug=True)
