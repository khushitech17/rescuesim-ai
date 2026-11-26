"""Shared helpers. Grid: list of rows, 0 = free, 1 = wall. Cells are (row, col) tuples."""
MOVES = [(-1, 0), (1, 0), (0, -1), (0, 1)]  # up, down, left, right

def neighbors(grid, cell):
    """Free in-bounds 4-directional neighbours of a cell."""
    r, c = cell
    for dr, dc in MOVES:
        nr, nc = r + dr, c + dc
        if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]) and grid[nr][nc] == 0:
            yield (nr, nc)

def build_path(parent, end):
    """Walk parent links back from end to start."""
    path = [end]
    while parent[path[-1]] is not None:
        path.append(parent[path[-1]])
    return path[::-1]

def result(found, explored, path):
    return {"found": found, "explored": [list(c) for c in explored],
            "path": [list(c) for c in path], "path_length": max(len(path) - 1, 0) if found else 0}
