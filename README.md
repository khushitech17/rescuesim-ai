# RescueSim AI – Building Emergency Evacuation Simulator
**Educational simulation only. It is NOT a certified or real-world emergency evacuation planning system.**
Classical AI search only: BFS, DFS, A* (Manhattan heuristic). No machine learning, no external APIs.

## Run on Windows (VS Code terminal, inside the project folder)
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000 in your browser.
(PowerShell may need once: `Set-ExecutionPolicy -Scope Process RemoteSigned` before `venv\Scripts\activate`.)

## What you see
The page opens straight on an architectural floor plan (no landing banner), in three panels:
- **Left – Building Editor:** Select, Add Occupant, Add Emergency Exit, Draw Wall, Add Door, Erase, with the selected tool and a one-line instruction. Below: layout selector, Reload This Layout, Random Building, Clear Building.
- **Centre – Floor plan (SVG):** rectangular rooms with names, thick walls, door openings with swing arcs, corridors, EXIT signs outside the outer wall, person icons, and the evacuation routes on top. Analytics and the legend sit directly under the plan.
- **Right – Simulation controls:** BFS / DFS / A*, Start Simulation, Pause, Resume, Reset, Preview Planned Routes, speed slider, current algorithm and status.

**Two predefined buildings** (selector at the left): *Academic Building – Ground Floor* (Classroom 101/102, Faculty Room, Computer Lab, Reception, Office, Conference Room, Washroom, Main Corridor; 40 x 24 grid) and *Corporate Office Tower – First Floor* (offices, meeting rooms, pantry, reception, open workspace, a central corridor; 36 x 28 grid). Each has its own grid, doors, exits and 12 occupants.

## The drawing IS the search grid
`layouts.py` describes a building as room rectangles, corridors, door cells and exit cells and compiles them into the same 0/1 grid the algorithms search (`0` free, `1` wall; cells are `(row, col)`). The browser draws the plan from that grid: every wall cell is a wall segment, a door is one free cell cut into a wall, an exit is a free cell in the outer wall. Nothing is decorative: routes can only pass through real openings, and every editing tool changes the real grid. Room names and floor tints come from the layout's room rectangles; a label disappears if its room is walled over.

## Evacuation analytics (all from real results)
Total Occupants, Evacuated, Remaining, Waiting, Trapped, Blocked, Evacuation Progress, Explored Nodes, Average Path Length, Execution Time (measured in Python), Simulation Steps. Counts come from one function, so evacuated + trapped + blocked + waiting + moving always equals the total. The occupant table lists status, start, exit, planned route length, steps taken and nodes explored per occupant (click a row to highlight its route).

## Algorithm comparison
One request (`algorithm: "all"`) runs BFS, DFS and A* on the building and occupant positions currently on the plan. The table, bars and explanation are built from the returned numbers.

## Building editor rules
Draw Wall, Erase, Add Door, Add Occupant, Add Emergency Exit, Select (inspect only). Refused with a message: walls on an occupant or an exit; occupants inside walls; exits anywhere except the outer wall (not in corners, with open floor directly inside); doors anywhere except a straight interior wall between two spaces. Two occupants never share a cell. The API rejects duplicate occupants, buildings above 60 x 60 and more than 200 occupants.

## How it works
1. Browser sends `{grid, occupants, exits, algorithm}` to `POST /api/evacuate` (unchanged). `GET /api/layouts` returns the predefined buildings.
2. For each occupant the real algorithm in `algorithms/` searches for the nearest reachable exit. Occupants with no reachable exit are **trapped**.
3. `static/js/simulation.js` moves everyone along their routes. **Two occupants never share a cell**; people wait if the next cell is taken, one person passes an exit per step.
4. If nobody can move (deadlock) the blocked occupants are re-planned by the backend, treating the others as walls. After 3 attempts a **movement conflict** is reported, never a collision.

## Tests
```
python test_rescuesim.py          # algorithms, API, validation, both layouts (+ JS engine and editor tests if Node.js is installed)
node tests/test_simulation.js     # collision handling, counts, trails, completion
node tests/test_editor.js         # editor rules incl. rectangular buildings and the Select tool
python tests/browser_test.py      # real Chromium test of the whole UI (pip install playwright, playwright install chromium); saves screenshots to tests/screenshots/
```

## Files
`app.py` · `layouts.py` · `algorithms/{bfs,dfs,astar,common}.py` · `templates/index.html` · `static/css/style.css` · `static/js/{simulation,editor,script}.js` · `tests/`

## Limits
No fire spread, speed differences or panic behaviour. DFS routes are long and winding (about 4-5x longer than BFS here), so with many occupants DFS can end in a reported movement conflict while BFS and A* finish; the default occupants of both buildings were chosen so all three algorithms complete.
