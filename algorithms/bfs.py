from collections import deque
from .common import neighbors, build_path, result

def bfs(grid, start, exits):
    """BFS from one occupant to the NEAREST of several exits. FIFO queue -> fewest steps."""
    queue, parent, explored = deque([start]), {start: None}, []
    while queue:
        cell = queue.popleft()
        explored.append(cell)
        if cell in exits:
            return result(True, explored, build_path(parent, cell))
        for nxt in neighbors(grid, cell):
            if nxt not in parent:
                parent[nxt] = cell
                queue.append(nxt)
    return result(False, explored, [])
