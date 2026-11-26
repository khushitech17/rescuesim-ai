"""Run: python test_rescuesim.py   (algorithms, multi-occupant API, errors, endpoints, collision tests via Node if installed)"""
import shutil, subprocess, sys
from collections import deque
from algorithms import ALGORITHMS
from app import app

def grid(rows): return [[1 if ch == "#" else 0 for ch in r] for r in rows]
empty = [[0] * 20 for _ in range(20)]
rooms = grid(["....#....", "....#....", ".........", "....#....", "....#...."])
sealed = grid([".....", ".###.", ".#.#.", ".###.", "....."])
maze = grid([".....", ".###.", ".#...", ".#.#.", "...#."])

def valid(g, p, s, exits):
    return (p[0] == list(s) and tuple(p[-1]) in exits and all(g[r][c] == 0 for r, c in p)
            and all(abs(p[i][0]-p[i+1][0]) + abs(p[i][1]-p[i+1][1]) == 1 for i in range(len(p)-1)))

def true_distance(g, s, e):                      # independent BFS used only to check the real algorithms
    q, seen = deque([(s, 0)]), {s}
    while q:
        (r, c), d = q.popleft()
        if (r, c) == e: return d
        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
            n = (r+dr, c+dc)
            if 0 <= n[0] < len(g) and 0 <= n[1] < len(g[0]) and g[n[0]][n[1]] == 0 and n not in seen:
                seen.add(n); q.append((n, d+1))
    return None

# ---- 1. BFS, DFS, A* ----
for name, f in ALGORITHMS.items():
    for gname, g, s, exits in [("empty", empty, (0, 0), {(19, 19)}), ("rooms", rooms, (0, 0), {(4, 8)}), ("maze", maze, (0, 0), {(4, 4)})]:
        r = f(g, s, exits)
        assert r["found"] and valid(g, r["path"], s, exits), (name, gname)
        assert set(["found", "explored", "path", "path_length"]) <= set(r)
        best = true_distance(g, s, next(iter(exits)))
        assert r["path_length"] >= best and (name == "dfs" or r["path_length"] == best), (name, gname)
    # ---- 2. multiple exits: nearest reachable exit is chosen (BFS, A*) ----
    exits = {(19, 19), (0, 3), (10, 0)}
    r = f(empty, (0, 0), exits); assert valid(empty, r["path"], (0, 0), exits), name
    if name != "dfs": assert r["path_length"] == 3, name
    # unreachable exit ignored when another is reachable
    two = grid([".....", ".###.", ".#.#.", ".###.", "....."]); two[4][0] = 0
    r = f(two, (0, 0), {(2, 2), (4, 4)}); assert r["found"] and tuple(r["path"][-1]) == (4, 4), name
    # ---- 3. unreachable ----
    r = f(sealed, (0, 0), {(2, 2)}); assert not r["found"] and r["path"] == [] and r["path_length"] == 0, name
    # ---- already at exit ----
    r = f(empty, (5, 5), {(5, 5)}); assert r["found"] and r["path"] == [[5, 5]] and r["path_length"] == 0, name
    print(name, "OK")
assert len(ALGORITHMS["astar"](empty, (0, 0), {(19, 19)})["explored"]) < len(ALGORITHMS["bfs"](empty, (0, 0), {(19, 19)})["explored"])

# ---- 4. API: multiple occupants, routes valid, trapped / at-exit reporting ----
c = app.test_client()
body = {"grid": rooms, "occupants": [[0, 0], [4, 0], [2, 8], [4, 8]], "exits": [[4, 8], [0, 8]], "algorithm": "all"}
res = c.post("/api/evacuate", json=body).get_json()["results"]
assert [r["algorithm"] for r in res] == ["bfs", "dfs", "astar"]
exitset = {(4, 8), (0, 8)}
for r in res:
    assert r["total"] == 4 and r["reachable"] == 4 and r["trapped"] == 0 and r["explored_total"] > 0 and "time_ms" in r
    for rt in r["routes"]:
        assert valid(rooms, rt["path"], rt["start"], exitset) and rt["path_length"] == len(rt["path"]) - 1
    assert r["routes"][3]["path_length"] == 0                    # occupant standing on an exit
mixed = {"grid": sealed, "occupants": [[0, 0], [2, 2]], "exits": [[2, 2], [4, 4]], "algorithm": "bfs"}
r = c.post("/api/evacuate", json=mixed).get_json()["results"][0]
assert r["reachable"] == 2                                       # (0,0) reaches (4,4); (2,2) stands on an exit
r = c.post("/api/evacuate", json={**mixed, "exits": [[2, 2]], "occupants": [[0, 0], [4, 4]]}).get_json()["results"][0]
assert r["trapped"] == 2 and all(not rt["found"] and rt["exit"] is None for rt in r["routes"])

# ---- 5. invalid positions / input ----
good = {"grid": rooms, "occupants": [[0, 0]], "exits": [[4, 8]], "algorithm": "bfs"}
bad = [{**good, "occupants": []}, {**good, "exits": []}, {**good, "exits": [[99, 99]]}, {**good, "occupants": [[-1, 0]]},
       {**good, "occupants": [[0.5, 1]]}, {**good, "occupants": [["a", "b"]]}, {**good, "occupants": [[0, 4]]},
       {**good, "exits": [[0, 4]]}, {**good, "algorithm": "x"}, {**good, "grid": "bad"}, {**good, "grid": [[0, 2]]},
       {**good, "grid": [[0, 0], [0]]}, {**good, "occupants": "none"}]
for b in bad:
    resp = c.post("/api/evacuate", json=b); assert resp.status_code == 400 and "error" in resp.get_json(), b
assert c.post("/api/evacuate", data="not json").status_code == 400

# ---- 5b. stricter validation: duplicates, limits, booleans ----
dup = c.post("/api/evacuate", json={**good, "occupants": [[0, 0], [0, 0]]})
assert dup.status_code == 400 and "same cell" in dup.get_json()["error"]
big = [[0] * 61 for _ in range(61)]
assert c.post("/api/evacuate", json={"grid": big, "occupants": [[0, 0]], "exits": [[60, 60]], "algorithm": "bfs"}).status_code == 400
wide = [[0] * 60 for _ in range(60)]
many = [[r, k] for r in range(4) for k in range(60)][:201]
assert c.post("/api/evacuate", json={"grid": wide, "occupants": many, "exits": [[59, 59]], "algorithm": "bfs"}).status_code == 400
assert c.post("/api/evacuate", json={"grid": wide, "occupants": many[:200], "exits": [[59, 59]], "algorithm": "bfs"}).status_code == 200
assert c.post("/api/evacuate", json={**good, "occupants": [[True, 0]]}).status_code == 400
assert c.post("/api/evacuate", json={**good, "grid": [[]]}).status_code == 400
print("validation OK")

# ---- 5c. metrics + comparison on the same layout and occupants ----
cmp_body = {"grid": rooms, "occupants": [[0, 0], [4, 0], [2, 8], [3, 6], [0, 6]], "exits": [[4, 8], [0, 8]], "algorithm": "all"}
res = c.post("/api/evacuate", json=cmp_body).get_json()["results"]
by = {r["algorithm"]: r for r in res}
for r in res:
    lens = [rt["path_length"] for rt in r["routes"] if rt["found"]]
    assert r["total_path_length"] == sum(lens) and r["max_path_length"] == max(lens)
    assert r["avg_path_length"] == round(sum(lens) / len(lens), 2)
    assert r["explored_total"] == sum(rt["explored_count"] for rt in r["routes"]) and r["time_ms"] >= 0
    assert [rt["start"] for rt in r["routes"]] == [list(p) for p in cmp_body["occupants"]]   # same occupant positions for every algorithm
    assert r["reachable"] == by["bfs"]["reachable"] and r["trapped"] == by["bfs"]["trapped"]
assert by["bfs"]["total_path_length"] == by["astar"]["total_path_length"] <= by["dfs"]["total_path_length"]
assert by["astar"]["explored_total"] <= by["bfs"]["explored_total"]
# nothing reachable: metrics are zero, not invented
none = c.post("/api/evacuate", json={"grid": sealed, "occupants": [[0, 0]], "exits": [[2, 2]], "algorithm": "all"}).get_json()["results"]
assert all(r["reachable"] == 0 and r["total_path_length"] == 0 and r["max_path_length"] == 0 and r["avg_path_length"] == 0 for r in none)
print("metrics + comparison OK")

# ---- 6. endpoints ----
assert c.get("/").status_code == 200
for path in ("/static/css/style.css", "/static/js/script.js", "/static/js/simulation.js"): assert c.get(path).status_code == 200, path
assert c.get("/api/evacuate").status_code == 405 and c.get("/nope").status_code == 404
import re
html, js = c.get("/").get_data(as_text=True), open("static/js/script.js", encoding="utf-8").read()
ids = set(re.findall(r'\$\("([A-Za-z]+)"\)', js))
assert ids and all(f'id="{i}"' in html for i in ids), [i for i in ids if f'id="{i}"' not in html]
for needed in ("sTotal", "sEvac", "sRemain", "sWait", "sTrap", "sBlock", "sName", "sExp", "sAvg", "sTime", "sTick", "sStatus", "progressBar", "actorLayer", "routeLayer", "staticLayer",
               "plan", "layoutSelect", "runBtn", "pauseBtn", "resumeBtn", "resetBtn", "speed", "occBody", "previewBtn", "editMsg", "toolHint", "cmpNote", "cmpMsg"): assert f'id="{needed}"' in html
for tool in ("select", "wall", "erase", "door", "occupant", "exit"): assert f'data-tool="{tool}"' in html
for a in ("bfs", "dfs", "astar"): assert f'data-algo="{a}"' in html
for path in ("/static/js/editor.js",): assert c.get(path).status_code == 200, path
assert "not a certified" in html.lower() or "not certified" in html.lower()
print("API TESTS PASSED")

# ---- 6b. predefined buildings: real grids, valid doors/exits, reachable by BFS, DFS and A* ----
from layouts import build_layout, LAYOUTS
lj = c.get("/api/layouts").get_json()["layouts"]
assert [l["id"] for l in lj] == ["academic", "office"]
assert lj[0]["grid"] != lj[1]["grid"] and (lj[0]["rows"], lj[0]["cols"]) != (lj[1]["rows"], lj[1]["cols"])
for l in lj:
    g, ex, oc = l["grid"], {tuple(e) for e in l["exits"]}, [tuple(o) for o in l["occupants"]]
    rows, cols = l["rows"], l["cols"]
    assert len(g) == rows and all(len(r) == cols for r in g)
    assert all(g[r][k] == 1 for r in (0, rows - 1) for k in range(cols) if (r, k) not in ex)          # closed outer wall except exits
    assert all(g[r][k] == 1 for k in (0, cols - 1) for r in range(rows) if (r, k) not in ex)
    for room in l["rooms"] + l["corridors"]:                                                           # rooms are solid rectangles of free cells
        assert all(g[r][k] == 0 for r in range(room["r"], room["r"] + room["h"]) for k in range(room["c"], room["c"] + room["w"])), room["name"]
        assert room["r"] >= 1 and room["c"] >= 1 and room["r"] + room["h"] <= rows - 1 and room["c"] + room["w"] <= cols - 1, room["name"]
    for r, k in l["doors"]:                                                                            # a door is one free cell between two walls
        horiz = g[r][k - 1] == 1 and g[r][k + 1] == 1 and g[r - 1][k] == 0 and g[r + 1][k] == 0
        vert = g[r - 1][k] == 1 and g[r + 1][k] == 1 and g[r][k - 1] == 0 and g[r][k + 1] == 0
        assert g[r][k] == 0 and (horiz or vert), (l["id"], r, k)
    assert len(oc) >= 10 and len(set(oc)) == len(oc) and all(g[r][k] == 0 for r, k in oc) and len(ex) >= 4
    body = {"grid": g, "occupants": l["occupants"], "exits": l["exits"], "algorithm": "all"}
    res = c.post("/api/evacuate", json=body).get_json()["results"]
    by = {r["algorithm"]: r for r in res}
    for r in res:
        assert r["reachable"] == len(oc) and r["trapped"] == 0, (l["id"], r["algorithm"])
        for rt in r["routes"]: assert valid(g, rt["path"], rt["start"], ex), (l["id"], r["algorithm"])
    assert by["bfs"]["total_path_length"] == by["astar"]["total_path_length"] <= by["dfs"]["total_path_length"]
    assert by["astar"]["explored_total"] < by["bfs"]["explored_total"]
    print(l["id"], "layout OK:", f"{rows}x{cols}", len(l["rooms"]), "rooms,", len(l["doors"]), "doors,", len(ex), "exits,", len(oc), "occupants")
print("LAYOUT TESTS PASSED")

# ---- 7. collision handling + simulation completion (JavaScript engine, needs Node.js) ----
if shutil.which("node"):
    for script in ("tests/test_simulation.js", "tests/test_editor.js"):
        out = subprocess.run(["node", script], capture_output=True, text=True)
        print(out.stdout.strip().splitlines()[-1]); assert out.returncode == 0, out.stderr
else:
    print("NOTE: Node.js not found, skipped the JavaScript tests (install Node.js to run the collision and editor tests)")
print("ALL TESTS PASSED")
