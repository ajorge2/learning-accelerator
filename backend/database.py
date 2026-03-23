import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "graph.db"
DEFAULT_USER_ID = 'default'


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
            CREATE TABLE IF NOT EXISTS users (
                user_id           TEXT PRIMARY KEY,
                subject           TEXT,
                learning_state    TEXT,
                user_goal         TEXT,
                user_knowledge    TEXT,
                user_importance   INTEGER,
                current_expertise INTEGER,
                target_expertise  INTEGER
            );

            INSERT OR IGNORE INTO users (user_id) VALUES ('default');

            CREATE TABLE IF NOT EXISTS nodes (
                node_id   TEXT PRIMARY KEY,
                user_id   TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                title     TEXT NOT NULL CHECK(length(title) <= 150),
                body      TEXT CHECK(body IS NULL OR length(body) <= 50000),
                node_type TEXT NOT NULL DEFAULT 'Normal'
            );

            CREATE TABLE IF NOT EXISTS edges (
                edge_id       TEXT PRIMARY KEY,
                user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                body          TEXT CHECK(body IS NULL OR length(body) <= 300),
                node_a_id     TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
                node_b_id     TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
                bidirectional INTEGER NOT NULL DEFAULT 1,
                source_id     TEXT REFERENCES nodes(node_id) ON DELETE SET NULL,
                CHECK(node_a_id != node_b_id)
            );

            CREATE TABLE IF NOT EXISTS questions (
                question_id TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                text        TEXT NOT NULL,
                target_id   TEXT NOT NULL,
                target_type TEXT NOT NULL CHECK(target_type IN ('node', 'edge')),
                created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        """)
        # Migrate: add columns if they don't exist yet
        for col, typedef in [("answer", "TEXT"), ("citations", "TEXT"), ("note", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE questions ADD COLUMN {col} {typedef}")
            except sqlite3.OperationalError:
                pass  # column already exists


# ── serialisation ─────────────────────────────────────────────────────────────

def _node_dict(row: sqlite3.Row) -> dict:
    return {
        "id":        row["node_id"],
        "title":     row["title"],
        "body":      row["body"],
        "node_type": row["node_type"],
    }


def _edge_dict(row: sqlite3.Row) -> dict:
    return {
        "id":            row["edge_id"],
        "body":          row["body"],
        "node_a_id":     row["node_a_id"],
        "node_b_id":     row["node_b_id"],
        "bidirectional": bool(row["bidirectional"]),
        "source_id":     row["source_id"],
    }


# ── enrichment ────────────────────────────────────────────────────────────────

def _attach_connections(conn, node: dict) -> dict:
    nid = node["id"]
    edge_rows = conn.execute(
        "SELECT edge_id, node_a_id, node_b_id FROM edges WHERE node_a_id=? OR node_b_id=?",
        (nid, nid),
    ).fetchall()
    node["connected_node_ids"] = [
        r["node_b_id"] if r["node_a_id"] == nid else r["node_a_id"]
        for r in edge_rows
    ]
    node["connected_edge_ids"] = [r["edge_id"] for r in edge_rows]
    return node


# ── nodes ─────────────────────────────────────────────────────────────────────

def count_nodes(user_id: str) -> int:
    with _db() as conn:
        return conn.execute("SELECT COUNT(*) FROM nodes WHERE user_id=?", (user_id,)).fetchone()[0]


def get_all_nodes(user_id: str) -> list[dict]:
    with _db() as conn:
        rows = conn.execute("SELECT * FROM nodes WHERE user_id=?", (user_id,)).fetchall()
        return [_attach_connections(conn, _node_dict(r)) for r in rows]


def get_node(node_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id=?", (node_id,)).fetchone()
        return _attach_connections(conn, _node_dict(row)) if row else None


def create_node(user_id: str, node_id: str, title: str, body: str | None = None, node_type: str = "Normal") -> dict:
    with _db() as conn:
        conn.execute(
            "INSERT INTO nodes (node_id, user_id, title, body, node_type) VALUES (?,?,?,?,?)",
            (node_id, user_id, title, body, node_type),
        )
    return get_node(node_id)


def get_subject_node_id(user_id: str) -> str | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT node_id FROM nodes WHERE node_type='Subject' AND user_id=?", (user_id,)
        ).fetchone()
        return row["node_id"] if row else None


def update_node(node_id: str, **fields) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id=?", (node_id,)).fetchone()
        if row is None:
            return None
        new_title     = fields.get("title",     row["title"])
        new_body      = fields.get("body",      row["body"])
        new_node_type = fields.get("node_type", row["node_type"])
        conn.execute(
            "UPDATE nodes SET title=?, body=?, node_type=? WHERE node_id=?",
            (new_title, new_body, new_node_type, node_id),
        )
    return get_node(node_id)


def delete_node(node_id: str) -> bool:
    with _db() as conn:
        conn.execute("DELETE FROM questions WHERE target_id=?", (node_id,))
        return conn.execute("DELETE FROM nodes WHERE node_id=?", (node_id,)).rowcount > 0


# ── edges ─────────────────────────────────────────────────────────────────────

def count_edges(user_id: str) -> int:
    with _db() as conn:
        return conn.execute("SELECT COUNT(*) FROM edges WHERE user_id=?", (user_id,)).fetchone()[0]


def get_all_edges(user_id: str) -> list[dict]:
    with _db() as conn:
        return [_edge_dict(r) for r in conn.execute("SELECT * FROM edges WHERE user_id=?", (user_id,)).fetchall()]


def get_edge(edge_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE edge_id=?", (edge_id,)).fetchone()
        return _edge_dict(row) if row else None


def create_edge(
    user_id: str,
    edge_id: str,
    body: str | None,
    node_a_id: str,
    node_b_id: str,
    bidirectional: bool = True,
    source_id: str | None = None,
) -> dict:
    with _db() as conn:
        conn.execute(
            "INSERT INTO edges (edge_id,user_id,body,node_a_id,node_b_id,bidirectional,source_id) VALUES (?,?,?,?,?,?,?)",
            (edge_id, user_id, body, node_a_id, node_b_id, int(bidirectional), source_id),
        )
    return get_edge(edge_id)


def update_edge(edge_id: str, **fields) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE edge_id=?", (edge_id,)).fetchone()
        if row is None:
            return None
        new_body          = fields.get("body",          row["body"])
        new_node_a_id     = fields.get("node_a_id",     row["node_a_id"])
        new_node_b_id     = fields.get("node_b_id",     row["node_b_id"])
        new_source_id     = fields.get("source_id",     row["source_id"])
        bidirectional     = fields.get("bidirectional", None)
        new_bidirectional = int(row["bidirectional"]) if bidirectional is None else int(bidirectional)
        conn.execute(
            "UPDATE edges SET body=?,node_a_id=?,node_b_id=?,bidirectional=?,source_id=? WHERE edge_id=?",
            (new_body, new_node_a_id, new_node_b_id, new_bidirectional, new_source_id, edge_id),
        )
    return get_edge(edge_id)


def delete_edge(edge_id: str) -> bool:
    with _db() as conn:
        conn.execute("DELETE FROM questions WHERE target_id=?", (edge_id,))
        return conn.execute("DELETE FROM edges WHERE edge_id=?", (edge_id,)).rowcount > 0


def export_graph(user_id: str) -> dict:
    with _db() as conn:
        nodes = conn.execute(
            "SELECT node_id, title, body, node_type FROM nodes WHERE user_id=?", (user_id,)
        ).fetchall()
        edges = conn.execute(
            "SELECT edge_id, body, node_a_id, node_b_id, bidirectional FROM edges WHERE user_id=?", (user_id,)
        ).fetchall()

        titles = {r["node_id"]: r["title"] for r in nodes}
        subject = next((r for r in nodes if r["node_type"] == "Subject"), None)
        normal_nodes = [
            {"id": r["node_id"], "title": r["title"], **({"body": r["body"]} if r["body"] else {})}
            for r in nodes if r["node_type"] != "Subject"
        ]

        connections = []
        for e in edges:
            a, b = titles.get(e["node_a_id"], "?"), titles.get(e["node_b_id"], "?")
            link = f"{a} ↔ {b}" if e["bidirectional"] else f"{a} → {b}"
            entry = {"id": e["edge_id"], "link": link}
            if e["body"]:
                entry["label"] = e["body"]
            connections.append(entry)

        return {
            "subject": subject["title"] if subject else None,
            "nodes": normal_nodes,
            "connections": connections,
        }


def clear_graph(user_id: str):
    with _db() as conn:
        conn.execute("DELETE FROM questions WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM edges WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM nodes WHERE node_type != 'Subject' AND user_id=?", (user_id,))


def reset_graph(user_id: str):
    with _db() as conn:
        conn.execute("DELETE FROM questions WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM edges WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM nodes WHERE user_id=?", (user_id,))


# ── questions ──────────────────────────────────────────────────────────────────

def _question_dict(row: sqlite3.Row) -> dict:
    raw_citations = row["citations"] if "citations" in row.keys() else None
    return {
        "id":          row["question_id"],
        "text":        row["text"],
        "target_id":   row["target_id"],
        "target_type": row["target_type"],
        "created_at":  row["created_at"],
        "answer":      row["answer"] if "answer" in row.keys() else None,
        "citations":   json.loads(raw_citations) if raw_citations else [],
        "note":        row["note"] if "note" in row.keys() else None,
    }


def get_questions(target_id: str) -> list[dict]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM questions WHERE target_id=? ORDER BY created_at",
            (target_id,),
        ).fetchall()
        return [_question_dict(r) for r in rows]


def get_all_questions(user_id: str) -> list[dict]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM questions WHERE user_id=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [_question_dict(r) for r in rows]


def create_question(user_id: str, question_id: str, text: str, target_id: str, target_type: str) -> dict:
    with _db() as conn:
        conn.execute(
            "INSERT INTO questions (question_id, user_id, text, target_id, target_type) VALUES (?,?,?,?,?)",
            (question_id, user_id, text, target_id, target_type),
        )
    with _db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE question_id=?", (question_id,)).fetchone()
        return _question_dict(row)


def get_question(question_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM questions WHERE question_id=?", (question_id,)).fetchone()
        return _question_dict(row) if row else None


def update_question(question_id: str, text: str) -> dict | None:
    with _db() as conn:
        conn.execute("UPDATE questions SET text=? WHERE question_id=?", (text, question_id))
    return get_question(question_id)


def save_question_answer(question_id: str, answer: str, citations: list) -> dict | None:
    with _db() as conn:
        conn.execute(
            "UPDATE questions SET answer=?, citations=? WHERE question_id=?",
            (answer, json.dumps(citations), question_id),
        )
    return get_question(question_id)


def save_question_note(question_id: str, note: str) -> dict | None:
    with _db() as conn:
        conn.execute("UPDATE questions SET note=? WHERE question_id=?", (note, question_id))
    return get_question(question_id)


def delete_question(question_id: str) -> bool:
    with _db() as conn:
        return conn.execute("DELETE FROM questions WHERE question_id=?", (question_id,)).rowcount > 0


# ── users ─────────────────────────────────────────────────────────────────────

_USER_FIELDS = {
    "subject", "learning_state", "user_goal", "user_knowledge",
    "user_importance", "current_expertise", "target_expertise",
}


# TODO(pre-release): uncomment and wire up to auth system
# def create_user(user_id: str) -> dict:
#     with _db() as conn:
#         conn.execute("INSERT INTO users (user_id) VALUES (?)", (user_id,))
#     return get_user(user_id)


def get_user(user_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
        if not row:
            return None
        return {
            "user_id":            row["user_id"],
            "subject":            row["subject"],
            "learning_state":     row["learning_state"],
            "user_goal":          row["user_goal"],
            "user_knowledge":     row["user_knowledge"],
            "user_importance":    row["user_importance"],
            "current_expertise":  row["current_expertise"],
            "target_expertise":   row["target_expertise"],
        }


# TODO(pre-release): uncomment and wire up to auth system
# def delete_user(user_id: str) -> bool:
#     raise NotImplementedError


def update_user(user_id: str, **fields) -> None:
    invalid = set(fields) - _USER_FIELDS
    if invalid:
        raise ValueError(f"Unknown user fields: {invalid}")
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [user_id]
    with _db() as conn:
        conn.execute(f"UPDATE users SET {set_clause} WHERE user_id=?", values)


# ── admin (cross-user) ────────────────────────────────────────────────────────

# TODO(pre-release): uncomment and wire up to auth system
# def get_all_users() -> list[dict]:
#     raise NotImplementedError

# def get_all_nodes_admin() -> list[dict]:
#     raise NotImplementedError

# def get_all_edges_admin() -> list[dict]:
#     raise NotImplementedError

# def get_all_questions_admin() -> list[dict]:
#     raise NotImplementedError
