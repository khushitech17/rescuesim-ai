from .common import neighbors, build_path, result

def dfs(grid, start, exits):
    """DFS: LIFO stack, dives deep, backtracks. Reaches AN exit, route may be much longer."""
    stack, parent, visited, explored = [(start, None)], {}, set(), []
    while stack:
        cell, came_from = stack.pop()
        if cell in visited:
            continue
        visited.add(cell)
        parent[cell] = came_from
        explored.append(cell)
        if cell in exits:
            return result(True, explored, build_path(parent, cell))
        for nxt in neighbors(grid, cell):
            if nxt not in visited:
                stack.append((nxt, cell))
    return result(False, explored, [])
