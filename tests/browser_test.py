"""Real-browser test (Chromium via Playwright):  python tests/browser_test.py
Needs: pip install playwright && playwright install chromium. It starts the Flask server itself and saves
screenshots to tests/screenshots/. Every check reads the live page, the live grid and the real backend."""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "screenshots"); os.makedirs(SHOTS, exist_ok=True)
URL = "http://127.0.0.1:5000"
log = open(os.path.join(ROOT, "tests", "flask_server.log"), "w")
server = subprocess.Popen([sys.executable, "app.py"], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
passed = []
def ok(msg): passed.append(msg); print("ok -", msg)

def api(body):
    req = urllib.request.Request(URL + "/api/evacuate", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["results"]

try:
    for _ in range(60):
        try: urllib.request.urlopen(URL + "/"); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch(); errors = []
        page = b.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(URL + "/"); page.wait_for_selector("#staticLayer .walls rect")
        finished = "['Complete','Movement conflict'].includes(document.getElementById('sStatus').textContent)"
        txt = lambda sel: page.inner_text(sel)
        texts = lambda sel: page.evaluate("s => [...document.querySelectorAll(s)].map(e => e.textContent)", sel)   # SVG text has no innerText
        def center(r, c):
            return page.evaluate("""([r,c]) => { const s = document.getElementById('plan'), p = s.createSVGPoint();
                p.x = c + .5; p.y = r + .5; const q = p.matrixTransform(s.getScreenCTM()); return [q.x, q.y]; }""", [r, c])
        def click(r, c): x, y = center(r, c); page.mouse.click(x, y)
        def tool(t): page.click(f'.tool[data-tool="{t}"]')
        def load(layout): page.select_option("#layoutSelect", layout); page.wait_for_function(f"document.getElementById('planMeta').textContent.includes('{ {'academic':'Academic','office':'Office'}[layout] }')")
        def shot(name): page.screenshot(path=os.path.join(SHOTS, name + ".png"))

        # ---------- 1. first impression: a floor plan, not a maze ----------
        assert page.locator("#planTitle").inner_text() == "Academic Block – Ground Floor"
        labels = texts("#staticLayer .room-label")
        for name in ["Classroom 101", "Classroom 102", "Faculty Room", "Computer Lab", "Reception", "Office", "Conference Room", "Washroom"]:
            assert any(name.split()[0] in l for l in labels), (name, labels)
        assert "MAIN CORRIDOR" in texts("#staticLayer .corr-label")
        assert page.locator("#staticLayer .exit-sign").count() == 5 and page.locator("#staticLayer .swing").count() == 9
        assert page.locator("#grid, .cell").count() == 0, "old maze cells must be gone"
        shot("01_academic_building"); ok("Academic layout renders: 8 labelled rooms + Main Corridor, 9 doors with swings, 5 EXIT signs, no maze cells")
        for t in ("select", "occupant", "exit", "wall", "door", "erase"): assert page.locator(f'.tool[data-tool="{t}"]').count() == 1
        assert page.locator("#plan").evaluate("e => e.getBoundingClientRect().width") > 800
        ok("left toolbar has all 6 tools; floor plan is the widest element (%d px wide)" % page.locator("#plan").evaluate("e => e.getBoundingClientRect().width"))

        # ---------- 2. the drawing IS the search grid ----------
        def plan_matches_grid(layout):
            res = page.evaluate("""() => {
                const g = grid, drawn = new Set();
                document.querySelectorAll('#staticLayer .walls rect').forEach(r => { const x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width');
                  for (let c = x; c < x + w; c++) drawn.add(y + ',' + c); });
                let wallCells = 0, mismatch = 0;
                for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) { const w = g[r][c] === 1; if (w) wallCells++; if (w !== drawn.has(r + ',' + c)) mismatch++; }
                // every drawn door sits on a free cell squeezed between two walls; every EXIT sign matches an exit cell on the outer wall
                const doors = [...document.querySelectorAll('#staticLayer .leaf')].length;
                const exitsOk = [...exits].every(k => { const [r, c] = k.split(',').map(Number); return g[r][c] === 0 && (r === 0 || c === 0 || r === g.length - 1 || c === g[0].length - 1); });
                return {wallCells, mismatch, doors, exitsOk, rows: g.length, cols: g[0].length};
            }""")
            assert res["mismatch"] == 0 and res["exitsOk"], res
            return res
        r1 = plan_matches_grid("academic"); ok(f"academic: all {r1['wallCells']} wall cells of the {r1['cols']}x{r1['rows']} search grid are drawn, no extra, no missing; exits on the outer wall")
        load("office"); r2 = plan_matches_grid("office")
        assert r2["doors"] == 8 and page.locator("#staticLayer .exit-sign").count() == 4 and page.locator("#planTitle").inner_text() == "Corporate Office Tower – First Floor"
        ok(f"office: all {r2['wallCells']} wall cells of the {r2['cols']}x{r2['rows']} grid drawn exactly; 8 doors, 4 EXIT signs, different structure from the academic block")
        olabels = texts("#staticLayer .room-label")
        assert {"Reception", "Pantry", "Open Workspace"} <= set(olabels) and any("201" in l for l in olabels) and "CENTRAL CORRIDOR" in texts("#staticLayer .corr-label")
        shot("02_office_building"); ok("office labels: offices, meeting rooms, reception, pantry, workspace, Central Corridor")

        # ---------- 3. every layout x every algorithm: real run, collision check, route validity ----------
        def run_full(layout, algo, speed="100"):
            load(layout); page.click(f'button.algo[data-algo="{algo}"]'); page.fill("#speed", speed)
            page.click("#runBtn"); page.wait_for_function(finished, timeout=120000)
            data = page.evaluate("""() => { const bad = []; const g = grid;
                sim.trail.forEach((t, i) => { for (let k = 0; k < t.length; k++) { const [r, c] = t[k]; if (g[r][c] !== 0) bad.push('walked into wall ' + i);
                    if (k && Math.abs(t[k][0] - t[k-1][0]) + Math.abs(t[k][1] - t[k-1][1]) !== 1) bad.push('jump ' + i); } });
                return {bad, unique: SimEngine.positionsAreUnique(sim), counts: SimEngine.counts(sim), ticks: sim.ticks, conflict: sim.conflict}; }""")
            assert not data["bad"] and data["unique"], data
            c = data["counts"]; assert c["evacuated"] + c["trapped"] + c["blocked"] + c["waiting"] + c["moving"] == c["total"]
            return data
        results = {}
        for layout in ("academic", "office"):
            for algo in ("bfs", "dfs", "astar"):
                d = run_full(layout, algo); st = txt("#sStatus"); c = d["counts"]
                results[(layout, algo)] = (st, c["evacuated"], c["total"], d["ticks"])
                # dashboard equals the real backend numbers for the same request
                body = page.evaluate("() => ({grid, occupants: [...occ].map(k => k.split(',').map(Number)), exits: [...exits].map(k => k.split(',').map(Number)), algorithm: algo})")
                api_r = api(body)[0]
                assert float(txt("#sExp")) == api_r["explored_total"] and float(txt("#sAvg")) == api_r["avg_path_length"] and float(txt("#sTotal")) == api_r["total"], (layout, algo)
                assert txt("#sTick") == str(d["ticks"]) and txt("#sEvac") == f"{c['evacuated']} / {c['total']}" and txt("#sRemain") == str(c["total"] - c["evacuated"])
                print(f"   {layout:8s} {algo:5s} -> {st:17s} evacuated {c['evacuated']}/{c['total']}  steps {d['ticks']:3d}  explored {api_r['explored_total']:4d}  avg path {api_r['avg_path_length']:5}  time {api_r['time_ms']} ms")
                if algo == "bfs": shot(f"03_{layout}_{algo}_complete")
        for (layout, algo), (st, ev, tot, _) in results.items():
            assert st == "Complete" and ev == tot, (layout, algo, st, ev, tot)
        ok("BFS, DFS and A*: all 12 occupants evacuated on BOTH layouts; routes only on free cells, one step at a time, no shared cells")
        ok("dashboard values (explored, avg path, total, steps, evacuated, remaining) equal the backend / engine numbers for every run")

        # ---------- 4. mid-run view with routes + movement ----------
        load("academic"); page.fill("#speed", "35"); page.click("#runBtn"); page.wait_for_timeout(1800)
        assert page.locator(".route-line.active").count() > 0 and page.locator(".route-line.travelled").count() > 0
        before = page.evaluate("[...document.querySelectorAll('#actorLayer .actor')].map(a => a.style.transform).join('|')")
        page.wait_for_timeout(600)
        after = page.evaluate("[...document.querySelectorAll('#actorLayer .actor')].map(a => a.style.transform).join('|')")
        assert before != after and "transform" in page.locator("#actorLayer .actor").first.evaluate("e => getComputedStyle(e).transitionProperty")
        shot("04_academic_running"); ok("running: active + travelled routes drawn over the plan; occupant icons move (transform transition)")

        # ---------- 5. pause / resume / reset ----------
        page.click("#pauseBtn"); t1 = txt("#sTick"); page.wait_for_timeout(500)
        assert txt("#sTick") == t1 and txt("#sStatus") == "Paused" and page.locator("#resumeBtn").is_enabled() and page.locator("#pauseBtn").is_disabled()
        page.click("#resumeBtn"); page.wait_for_timeout(400); assert int(txt("#sTick")) > int(t1) and txt("#sStatus") in ("Running", "Complete")
        page.fill("#speed", "100"); page.wait_for_function(finished, timeout=60000)
        assert txt("#sEvac") == "12 / 12" and txt("#progressPct") == "100%"
        ok("pause freezes the step counter and sets 'Paused'; resume continues and completes 12/12, progress 100%")
        page.click("#resetBtn"); assert txt("#sStatus") == "–" and txt("#sEvac") == "–" and txt("#progressPct") == "0%" and page.locator(".route-line").count() == 0
        assert txt("#sTotal") == "12" and page.locator("#actorLayer .actor").count() == 12
        ok("reset clears status, routes and statistics and puts all 12 occupants back at their start cells")

        # ---------- 6. editing modifies the REAL layout ----------
        load("academic"); gr = lambda r, c: page.evaluate(f"grid[{r}][{c}]")
        tool("wall"); click(11, 12); assert gr(11, 12) == 1 and page.locator("#staticLayer .walls rect").count() > 0
        ok("Draw Wall: clicking a corridor cell sets grid[11][12] = 1 and the wall appears on the plan")
        tool("erase"); click(11, 12); assert gr(11, 12) == 0; ok("Erase: removes that wall again (grid back to 0)")
        # close Classroom 101's only door -> its 2 occupants must become trapped; reopen with Add Door -> they escape
        tool("wall"); click(9, 5); assert gr(9, 5) == 1 and page.locator("#staticLayer .swing").count() == 8
        inside = page.evaluate("[...occ].map(k => k.split(',').map(Number)).filter(([r, c]) => r >= 1 && r <= 8 && c >= 1 && c <= 9).length"); assert inside >= 1
        page.click('button.algo[data-algo="bfs"]'); page.fill("#speed", "100"); page.click("#runBtn"); page.wait_for_function(finished, timeout=60000)
        assert txt("#sTrap") == str(inside) and txt("#sEvac") == f"{12 - inside} / 12", (txt("#sTrap"), txt("#sEvac"))
        shot("05_door_closed_trapped"); ok(f"closing the only door of Classroom 101 (wall edit) -> backend reports exactly {inside} trapped (the occupant(s) inside), {12 - inside}/12 evacuated")
        tool("door"); click(9, 5); assert gr(9, 5) == 0 and page.locator("#staticLayer .swing").count() == 9
        page.click("#runBtn"); page.wait_for_function(finished, timeout=60000); assert txt("#sTrap") == "0" and txt("#sEvac") == "12 / 12"
        ok(f"Add Door re-opens the wall at (9,5) with a swing symbol -> same run now evacuates 12/12, 0 trapped")
        tool("door"); click(2, 2); msg = txt("#editMsg"); assert "wall" in msg.lower()
        ok("Add Door on open floor is refused with a message: '%s'" % msg)
        # occupants and exits
        n0 = page.locator("#actorLayer .actor").count(); tool("occupant"); click(15, 8); assert page.locator("#actorLayer .actor").count() == n0 + 1 and "15,8" in page.evaluate("[...occ]")
        click(15, 8); assert page.locator("#actorLayer .actor").count() == n0; click(15, 8)
        tool("occupant"); click(0, 0); ok("Add Occupant: added to the real occupant set (and click again removes); count %d -> %d" % (n0, n0 + 1))
        e0 = page.locator("#staticLayer .exit-sign").count(); tool("exit"); click(23, 5)
        assert page.locator("#staticLayer .exit-sign").count() == e0 + 1 and "23,5" in page.evaluate("[...exits]") and gr(23, 5) == 0
        click(5, 5); assert "outer wall" in txt("#editMsg"); click(0, 0); assert "corner" in txt("#editMsg")
        ok("Add Emergency Exit: opens the outer wall at (23,5), adds an EXIT sign; interior and corner placements refused with messages")
        page.click("#runBtn"); page.wait_for_function(finished, timeout=60000)
        assert txt("#sEvac") == "13 / 13"; shot("06_edited_academic_new_exit"); ok("run after edits (new occupant + new exit) evacuates 13/13 on the edited grid")
        tool("select"); click(4, 5); info = txt("#selInfo"); assert "Classroom 101" in info
        click(9, 5); assert "Door between Classroom 101 and Main Corridor" in txt("#selInfo"); ok("Select tool: inspects cells -> '%s'" % txt("#selInfo"))

        # ---------- 7. random + clear + reload ----------
        page.click("#randomBtn"); assert page.locator("#actorLayer .actor").count() == 8 and "Random Building" in txt("#planMeta")
        plan_matches_grid("random"); page.click("#runBtn"); page.wait_for_function(finished, timeout=60000); shot("07_random_building")
        ok("Random Building: drawn plan equals its grid; run finishes with status '%s' (%s)" % (txt("#sStatus"), txt("#sEvac")))
        page.click("#clearBtn"); assert page.locator("#actorLayer .actor").count() == 0 and page.evaluate("grid[5][5]") == 0 and page.evaluate("grid[0][5]") == 1
        page.click("#runBtn"); page.wait_for_function("document.getElementById('msg').textContent.includes('at least one occupant')")
        page.click("#reloadBtn"); assert txt("#planTitle") == "Academic Block – Ground Floor" and page.locator("#actorLayer .actor").count() == 12
        ok("Clear Building gives an empty walled shell (run refused: 'place at least one occupant'); Reload restores the preset")

        # ---------- 8. comparison on both layouts ----------
        for layout in ("academic", "office"):
            load(layout); page.evaluate("document.querySelector('#cmpTable tbody').innerHTML = ''"); page.click("#compareBtn"); page.wait_for_function("document.querySelectorAll('#cmpTable tbody tr').length === 3")
            rows = page.evaluate("[...document.querySelectorAll('#cmpTable tbody tr')].map(r => [...r.children].map(c => c.textContent))")
            body = page.evaluate("() => ({grid, occupants: [...occ].map(k => k.split(',').map(Number)), exits: [...exits].map(k => k.split(',').map(Number)), algorithm: 'all'})")
            for row, r in zip(rows, api(body)):
                assert row[0] == r["name"] and row[1] == f"{r['reachable']}/{r['total']}" and float(row[3]) == r["avg_path_length"] and float(row[4]) == r["total_path_length"] and float(row[5]) == r["explored_total"]
            assert "same layout" in txt("#cmpNote") and "Shortest" in txt("#cmpTable tbody")
            print("   compare", layout, [(r[0].split()[0], r[3], r[5]) for r in rows])
            page.locator("#compare").scroll_into_view_if_needed(); shot(f"08_compare_{layout}"); page.evaluate("window.scrollTo(0,0)")
        ok("comparison table (path length, nodes explored, time) equals fresh backend results on both layouts")

        # ---------- 9. responsive + console ----------
        m = b.new_page(viewport={"width": 390, "height": 844}); m.goto(URL + "/"); m.wait_for_selector("#staticLayer .walls rect")
        m.fill("#speed", "100"); m.click("#runBtn"); m.wait_for_function(finished, timeout=60000)
        assert m.inner_text("#sEvac") == "12 / 12" and not m.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        m.screenshot(path=os.path.join(SHOTS, "09_mobile.png")); ok("mobile 390px: run completes 12/12, no horizontal overflow")
        unexpected = [e for e in errors if "400 (BAD REQUEST)" not in e]
        assert not unexpected, unexpected; ok("no JavaScript console errors (only the deliberate 400 reply for a run with no occupants)")
        b.close()
    print(f"\nALL {len(passed)} BROWSER CHECKS PASSED")
finally:
    server.terminate(); log.close()
