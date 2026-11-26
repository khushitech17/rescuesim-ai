import heapq
from .common import neighbors, build_path, result

def heuristic(cell, exits):
    """h(n) = Manhattan distance to the CLOSEST exit (never overestimates -> stays optimal)."""
    return min(abs(cell[0] - e[0]) + abs(cell[1] - e[1]) for e in exits)

def astar(grid, start, exits):
    """A*: expand lowest f(n) = g(n) + h(n). Ties prefer larger g (closer to goal)."""
    tie = 0
    heap = [(heuristic(start, exits), 0, tie, start)]        # (f, -g, tie, cell)
    g, parent, closed, explored = {start: 0}, {start: None}, set(), []
    while heap:
        _, neg_g, _, cell = heapq.heappop(heap)
        if cell in closed:
            continue
        closed.add(cell)
        explored.append(cell)
        if cell in exits:
            return result(True, explored, build_path(parent, cell))
        for nxt in neighbors(grid, cell):
            new_g = -neg_g + 1
            if new_g < g.get(nxt, float("inf")):
                g[nxt], parent[nxt] = new_g, cell
                tie += 1
                heapq.heappush(heap, (new_g + heuristic(nxt, exits), -new_g, tie, nxt))
    return result(False, explored, [])
