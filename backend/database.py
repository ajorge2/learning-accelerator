import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "graph.db"


@contextmanager
def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS nodes (
                id    TEXT PRIMARY KEY,
                title TEXT NOT NULL CHECK(length(title) <= 150),
                body  TEXT CHECK(body IS NULL OR length(body) <= 50000)
            );

            CREATE TABLE IF NOT EXISTS edges (
                id            TEXT PRIMARY KEY,
                body          TEXT CHECK(body IS NULL OR length(body) <= 300),
                node_a_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                node_b_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                bidirectional INTEGER NOT NULL DEFAULT 1,
                source_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
                CHECK(node_a_id != node_b_id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS edges_pair
                ON edges(min(node_a_id, node_b_id), max(node_a_id, node_b_id));
        """)


# ── serialisation ─────────────────────────────────────────────────────────────

def _node_dict(conn, row: sqlite3.Row) -> dict:
    nid = row["id"]
    edge_rows = conn.execute(
        "SELECT id, node_a_id, node_b_id FROM edges WHERE node_a_id=? OR node_b_id=?",
        (nid, nid),
    ).fetchall()
    return {
        "id": nid,
        "title": row["title"],
        "body": row["body"],
        "connected_node_ids": [
            r["node_b_id"] if r["node_a_id"] == nid else r["node_a_id"]
            for r in edge_rows
        ],
        "connected_edge_ids": [r["id"] for r in edge_rows],
    }


def _edge_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "body": row["body"],
        "node_a_id": row["node_a_id"],
        "node_b_id": row["node_b_id"],
        "bidirectional": bool(row["bidirectional"]),
        "source_id": row["source_id"],
    }


# ── nodes ─────────────────────────────────────────────────────────────────────

def count_nodes() -> int:
    with _db() as conn:
        return conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]


def get_all_nodes() -> list[dict]:
    with _db() as conn:
        rows = conn.execute("SELECT * FROM nodes").fetchall()
        return [_node_dict(conn, r) for r in rows]


def get_node(node_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        return _node_dict(conn, row) if row else None


def create_node(node_id: str, title: str, body: str | None = None) -> dict:
    with _db() as conn:
        conn.execute(
            "INSERT INTO nodes (id, title, body) VALUES (?,?,?)",
            (node_id, title, body),
        )
    return get_node(node_id)


def update_node(node_id: str, **fields) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if row is None:
            return None
        new_title = fields.get("title", row["title"])
        new_body  = fields.get("body",  row["body"])
        conn.execute(
            "UPDATE nodes SET title=?, body=? WHERE id=?",
            (new_title, new_body, node_id),
        )
    return get_node(node_id)


def delete_node(node_id: str) -> bool:
    with _db() as conn:
        return conn.execute("DELETE FROM nodes WHERE id=?", (node_id,)).rowcount > 0


# ── edges ─────────────────────────────────────────────────────────────────────

def count_edges() -> int:
    with _db() as conn:
        return conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]


def get_all_edges() -> list[dict]:
    with _db() as conn:
        return [_edge_dict(r) for r in conn.execute("SELECT * FROM edges").fetchall()]


def get_edge(edge_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE id=?", (edge_id,)).fetchone()
        return _edge_dict(row) if row else None


def create_edge(
    edge_id: str,
    body: str | None,
    node_a_id: str,
    node_b_id: str,
    bidirectional: bool = True,
    source_id: str | None = None,
) -> dict:
    with _db() as conn:
        conn.execute(
            "INSERT INTO edges (id,body,node_a_id,node_b_id,bidirectional,source_id) VALUES (?,?,?,?,?,?)",
            (edge_id, body, node_a_id, node_b_id, int(bidirectional), source_id),
        )
    return get_edge(edge_id)


def update_edge(edge_id: str, **fields) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE id=?", (edge_id,)).fetchone()
        if row is None:
            return None
        new_body          = fields.get("body",          row["body"])
        new_node_a_id     = fields.get("node_a_id",     row["node_a_id"])
        new_node_b_id     = fields.get("node_b_id",     row["node_b_id"])
        new_source_id     = fields.get("source_id",     row["source_id"])
        bidirectional     = fields.get("bidirectional", None)
        new_bidirectional = int(row["bidirectional"]) if bidirectional is None else int(bidirectional)
        conn.execute(
            "UPDATE edges SET body=?,node_a_id=?,node_b_id=?,bidirectional=?,source_id=? WHERE id=?",
            (new_body, new_node_a_id, new_node_b_id, new_bidirectional, new_source_id, edge_id),
        )
    return get_edge(edge_id)


def delete_edge(edge_id: str) -> bool:
    with _db() as conn:
        return conn.execute("DELETE FROM edges WHERE id=?", (edge_id,)).rowcount > 0


def clear_graph():
    with _db() as conn:
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM nodes")
