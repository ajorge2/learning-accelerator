import uuid
import database as db

MAX_NODES         = 500
MAX_EDGES         = 2000
MAX_TITLE_LEN     = 150
MAX_NODE_BODY_LEN = 50_000
MAX_EDGE_BODY_LEN = 300


class GraphService:

    # -- Nodes -----------------------------------------------------------------

    def get_all_nodes(self) -> list[dict]:
        return db.get_all_nodes()

    def get_node(self, node_id: str) -> dict | None:
        return db.get_node(node_id)

    def create_node(self, title: str, body: str | None = None, node_type: str = "Normal") -> dict:
        if len(title) > MAX_TITLE_LEN:
            raise ValueError(f"Title must be {MAX_TITLE_LEN} characters or fewer.")
        if body and len(body) > MAX_NODE_BODY_LEN:
            raise ValueError(f"Description must be {MAX_NODE_BODY_LEN:,} characters or fewer.")
        if db.count_nodes() >= MAX_NODES:
            raise ValueError(f"Node limit reached ({MAX_NODES} max).")
        if node_type not in ("Subject", "Normal"):
            raise ValueError("node_type must be 'Subject' or 'Normal'.")
        if node_type == "Subject" and db.get_subject_node_id() is not None:
            raise ValueError("A Subject node already exists.")
        return db.create_node(str(uuid.uuid4()), title, body, node_type)

    def update_node(self, node_id: str, **fields) -> dict | None:
        if "title" in fields and fields["title"] and len(fields["title"]) > MAX_TITLE_LEN:
            raise ValueError(f"Title must be {MAX_TITLE_LEN} characters or fewer.")
        if "body" in fields and fields["body"] and len(fields["body"]) > MAX_NODE_BODY_LEN:
            raise ValueError(f"Description must be {MAX_NODE_BODY_LEN:,} characters or fewer.")
        if "node_type" in fields:
            if fields["node_type"] not in ("Subject", "Normal"):
                raise ValueError("node_type must be 'Subject' or 'Normal'.")
            if fields["node_type"] == "Subject":
                existing = db.get_subject_node_id()
                if existing and existing != node_id:
                    raise ValueError("A Subject node already exists.")
        return db.update_node(node_id, **fields)

    def delete_node(self, node_id: str) -> bool:
        node = db.get_node(node_id)
        if node and node["node_type"] == "Subject":
            raise PermissionError("The Subject node cannot be deleted.")
        return db.delete_node(node_id)

    # -- Edges -----------------------------------------------------------------

    def get_all_edges(self) -> list[dict]:
        return db.get_all_edges()

    def get_edge(self, edge_id: str) -> dict | None:
        return db.get_edge(edge_id)

    def create_edge(
        self,
        body: str | None,
        node_a_id: str,
        node_b_id: str,
        bidirectional: bool = True,
        source_id: str | None = None,
    ) -> dict:
        if body and len(body) > MAX_EDGE_BODY_LEN:
            raise ValueError(f"Edge description must be {MAX_EDGE_BODY_LEN} characters or fewer.")
        if db.count_edges() >= MAX_EDGES:
            raise ValueError(f"Edge limit reached ({MAX_EDGES} max).")
        if not db.get_node(node_a_id):
            raise LookupError("node_a not found")
        if not db.get_node(node_b_id):
            raise LookupError("node_b not found")
        if source_id and not db.get_node(source_id):
            raise LookupError("source node not found")
        return db.create_edge(str(uuid.uuid4()), body, node_a_id, node_b_id, bidirectional, source_id)

    def update_edge(self, edge_id: str, **fields) -> dict | None:
        if "body" in fields and fields["body"] and len(fields["body"]) > MAX_EDGE_BODY_LEN:
            raise ValueError(f"Edge description must be {MAX_EDGE_BODY_LEN} characters or fewer.")
        return db.update_edge(edge_id, **fields)

    def delete_edge(self, edge_id: str) -> bool:
        return db.delete_edge(edge_id)

    # -- Graph -----------------------------------------------------------------

    def clear_graph(self):
        db.clear_graph()
