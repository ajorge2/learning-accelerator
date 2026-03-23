import uuid
from enum import Enum
import database as db

MAX_NODES         = 500
MAX_EDGES         = 2000
MAX_TITLE_LEN     = 150
MAX_NODE_BODY_LEN = 50_000  # TODO(pre-release): revisit — node bodies sent to LLM could get expensive at this size
MAX_EDGE_BODY_LEN = 300
MAX_GOAL_LEN      = 2_000
MAX_KNOWLEDGE_LEN = 2_000
# TODO(pre-release): enforce MAX_USERS at the infra/billing layer


class LearningState(str, Enum):
    """
    Ordered states of the learning flow.
    The app advances through these as the user completes each phase:
      PreGraph → FirstOutline → FirstResearch → SecondOutline → SecondResearch
    Stored as a string on the user row so it survives server restarts.
    """
    PRE_GRAPH       = "PreGraph"
    FIRST_OUTLINE   = "FirstOutline"
    FIRST_RESEARCH  = "FirstResearch"
    SECOND_OUTLINE  = "SecondOutline"
    SECOND_RESEARCH = "SecondResearch"


class ExpertiseService:
    """
    Infers where the user currently is and where they want to get to,
    expressed as expertise levels on a 1–5 scale.

    Flow: questionnaire answers → LLM → clamped integers → saved to user row.
    Fired non-blocking after the questionnaire is submitted so it doesn't delay graph load.
    """

    def infer_and_save(
        self, user_id: str, subject: str, goal: str, knowledge: str, importance: int
    ) -> dict:
        """
        Run the inference pipeline and persist results to the user row.

        Steps:
        1. Pass raw questionnaire answers to the LLM (structured output)
        2. Clamp results to 1–5 and enforce current <= target
        3. Save subject, questionnaire answers, and expertise levels to the user row
        """
        if len(goal) > MAX_GOAL_LEN:
            raise ValueError(f"Goal must be {MAX_GOAL_LEN:,} characters or fewer.")
        if len(knowledge) > MAX_KNOWLEDGE_LEN:
            raise ValueError(f"Knowledge must be {MAX_KNOWLEDGE_LEN:,} characters or fewer.")

        import llm as llm_service  # local import to avoid circular deps at module level

        profile = llm_service.infer_expertise_levels(
            subject, goal, knowledge, importance,
        )

        # Enforce: current can never exceed target (clamp post-LLM)
        current = max(1, min(profile.current_expertise, 5))
        target  = max(1, min(profile.target_expertise,  5))
        if current > target:
            current = target

        db.update_user(user_id,
            subject=subject,
            user_goal=goal,
            user_knowledge=knowledge,
            user_importance=importance,
            current_expertise=current,
            target_expertise=target,
        )

        return {
            "current_expertise": current,
            "target_expertise":  target,
        }


class GraphService:
    """
    Business logic layer for graph operations.
    Sits between the API and the database — validates inputs and enforces rules
    before anything is written to the DB.
    """

    # -- Nodes -----------------------------------------------------------------

    def get_all_nodes(self, user_id: str) -> list[dict]:
        return db.get_all_nodes(user_id)

    def get_node(self, node_id: str) -> dict | None:
        return db.get_node(node_id)

    def create_node(self, user_id: str, title: str, body: str | None = None, node_type: str = "Normal") -> dict:
        """
        Validates length limits, node count cap, and Subject uniqueness
        before writing to the DB.
        """
        if len(title) > MAX_TITLE_LEN:
            raise ValueError(f"Title must be {MAX_TITLE_LEN} characters or fewer.")
        if body and len(body) > MAX_NODE_BODY_LEN:
            raise ValueError(f"Description must be {MAX_NODE_BODY_LEN:,} characters or fewer.")
        if db.count_nodes(user_id) >= MAX_NODES:
            raise ValueError(f"Node limit reached ({MAX_NODES} max).")
        if node_type not in ("Subject", "Normal"):
            raise ValueError("node_type must be 'Subject' or 'Normal'.")
        if node_type == "Subject" and db.get_subject_node_id(user_id) is not None:
            raise ValueError("A Subject node already exists.")
        return db.create_node(user_id, str(uuid.uuid4()), title, body, node_type)

    def update_node(self, user_id: str, node_id: str, **fields) -> dict | None:
        """
        Validates length limits and Subject uniqueness before updating.
        """
        if "title" in fields and fields["title"] and len(fields["title"]) > MAX_TITLE_LEN:
            raise ValueError(f"Title must be {MAX_TITLE_LEN} characters or fewer.")
        if "body" in fields and fields["body"] and len(fields["body"]) > MAX_NODE_BODY_LEN:
            raise ValueError(f"Description must be {MAX_NODE_BODY_LEN:,} characters or fewer.")
        if "node_type" in fields:
            if fields["node_type"] not in ("Subject", "Normal"):
                raise ValueError("node_type must be 'Subject' or 'Normal'.")
            if fields["node_type"] == "Subject":
                existing = db.get_subject_node_id(user_id)
                if existing and existing != node_id:
                    raise ValueError("A Subject node already exists.")
        return db.update_node(node_id, **fields)

    def delete_node(self, node_id: str) -> bool:
        """Prevents deletion of the Subject node."""
        node = db.get_node(node_id)
        if node and node["node_type"] == "Subject":
            raise PermissionError("The Subject node cannot be deleted.")
        return db.delete_node(node_id)

    # -- Edges -----------------------------------------------------------------

    def get_all_edges(self, user_id: str) -> list[dict]:
        return db.get_all_edges(user_id)

    def get_edge(self, edge_id: str) -> dict | None:
        return db.get_edge(edge_id)

    def create_edge(
        self,
        user_id: str,
        body: str | None,
        node_a_id: str,
        node_b_id: str,
        bidirectional: bool = True,
        source_id: str | None = None,
    ) -> dict:
        """
        Validates body length, edge count cap, and that both endpoint nodes exist
        before writing to the DB.
        """
        if body and len(body) > MAX_EDGE_BODY_LEN:
            raise ValueError(f"Edge description must be {MAX_EDGE_BODY_LEN} characters or fewer.")
        if db.count_edges(user_id) >= MAX_EDGES:
            raise ValueError(f"Edge limit reached ({MAX_EDGES} max).")
        if not db.get_node(node_a_id):
            raise LookupError("node_a not found")
        if not db.get_node(node_b_id):
            raise LookupError("node_b not found")
        if source_id and not db.get_node(source_id):
            raise LookupError("source node not found")
        return db.create_edge(user_id, str(uuid.uuid4()), body, node_a_id, node_b_id, bidirectional, source_id)

    def update_edge(self, edge_id: str, **fields) -> dict | None:
        if "body" in fields and fields["body"] and len(fields["body"]) > MAX_EDGE_BODY_LEN:
            raise ValueError(f"Edge description must be {MAX_EDGE_BODY_LEN} characters or fewer.")
        return db.update_edge(edge_id, **fields)

    def delete_edge(self, edge_id: str) -> bool:
        return db.delete_edge(edge_id)

    # -- Questions -------------------------------------------------------------

    def get_questions(self, target_id: str) -> list[dict]:
        return db.get_questions(target_id)

    def get_all_questions(self, user_id: str) -> list[dict]:
        return db.get_all_questions(user_id)

    def create_question(self, user_id: str, target_id: str, target_type: str, text: str) -> dict:
        """Validates text is non-empty and the target node/edge actually exists."""
        if not text.strip():
            raise ValueError("Question text cannot be empty.")
        if target_type == "node" and not db.get_node(target_id):
            raise LookupError("Target not found.")
        if target_type == "edge" and not db.get_edge(target_id):
            raise LookupError("Target not found.")
        return db.create_question(user_id, str(uuid.uuid4()), text.strip(), target_id, target_type)

    def get_question(self, question_id: str) -> dict | None:
        return db.get_question(question_id)

    def update_question(self, question_id: str, text: str) -> dict | None:
        if not text.strip():
            raise ValueError("Question text cannot be empty.")
        return db.update_question(question_id, text.strip())

    def save_question_note(self, question_id: str, note: str) -> dict | None:
        return db.save_question_note(question_id, note)

    def delete_question(self, question_id: str) -> bool:
        return db.delete_question(question_id)

    # -- Graph -----------------------------------------------------------------

    def initialize_graph(self, user_id: str, data: dict) -> dict:
        """
        Populates a fresh graph from the LLM's outline output.
        data = {"subject": str, "nodes": [...], "connections": [...]}

        Nodes are created first, then connections are wired up by title name
        (since the LLM references nodes by title, not ID).
        Also saves the subject to the user row.
        Returns a results dict with created items and any errors.
        """
        results = {"created_nodes": [], "created_connections": [], "errors": []}
        title_to_id = {}

        if data.get("subject"):
            db.update_user(user_id, subject=data["subject"])

        for n in data.get("nodes") or []:
            try:
                node = self.create_node(user_id, n["title"], n.get("body"), n.get("node_type", "Normal"))
                title_to_id[node["title"]] = node["id"]
                results["created_nodes"].append(node)
            except (ValueError, Exception) as e:
                results["errors"].append(f"create_node '{n.get('title')}': {e}")

        for c in data.get("connections") or []:
            from_title = c.get("from") or c.get("from_", "")
            to_title   = c.get("to", "")
            from_id    = title_to_id.get(from_title)
            to_id      = title_to_id.get(to_title)
            if not from_id or not to_id:
                results["errors"].append(f"create_connection: node not found for '{from_title}' or '{to_title}'")
                continue
            bidir = c.get("bidirectional", True)
            try:
                conn = self.create_edge(user_id, c.get("label"), from_id, to_id, bidir, from_id if not bidir else None)
                results["created_connections"].append(conn)
            except (ValueError, LookupError) as e:
                results["errors"].append(f"create_connection: {e}")

        return results

    def clear_graph(self, user_id: str):
        db.clear_graph(user_id)

    def apply_patch(self, user_id: str, patch: dict) -> dict:
        """
        Applies a batch of graph changes in one shot.
        Used by both the manual AI endpoint and direct graph edits.

        Processes in order: add nodes → update nodes → delete nodes →
        add connections → update connections → delete connections.
        Errors on individual items are collected and returned without stopping
        the rest of the patch from applying.
        """
        results = {
            "added_nodes": [], "updated_nodes": [], "deleted_nodes": [],
            "added_connections": [], "updated_connections": [], "deleted_connections": [],
            "errors": [],
        }

        # Build title→id map for existing nodes so connections can reference by title
        title_to_id = {n["title"]: n["id"] for n in db.get_all_nodes(user_id)}

        for n in patch.get("add_nodes") or []:
            try:
                node = self.create_node(user_id, n["title"], n.get("body"))
                title_to_id[node["title"]] = node["id"]
                results["added_nodes"].append(node)
            except (ValueError, Exception) as e:
                results["errors"].append(f"add_node '{n.get('title')}': {e}")

        for n in patch.get("update_nodes") or []:
            try:
                fields = {k: v for k, v in n.items() if k != "id"}
                node = self.update_node(user_id, n["id"], **fields)
                if node:
                    results["updated_nodes"].append(node)
            except ValueError as e:
                results["errors"].append(f"update_node '{n.get('id')}': {e}")

        for node_id in patch.get("delete_nodes") or []:
            try:
                if self.delete_node(node_id):
                    results["deleted_nodes"].append(node_id)
            except PermissionError as e:
                results["errors"].append(f"delete_node '{node_id}': {e}")

        # Build id→id set for direct-ID fallback
        valid_ids = {n["id"] for n in db.get_all_nodes(user_id)}

        for c in patch.get("add_connections") or []:
            from_val = c.get("from", "")
            to_val   = c.get("to", "")
            # Resolve by title first, then fall back to treating the value as a raw ID
            from_id  = title_to_id.get(from_val) or (from_val if from_val in valid_ids else None)
            to_id    = title_to_id.get(to_val)   or (to_val   if to_val   in valid_ids else None)
            if not from_id or not to_id:
                results["errors"].append(f"add_connection: node not found for '{from_val}' or '{to_val}'")
                continue
            bidir = c.get("bidirectional", True)
            try:
                conn = self.create_edge(user_id, c.get("label"), from_id, to_id, bidir, from_id if not bidir else None)
                results["added_connections"].append(conn)
            except (ValueError, LookupError) as e:
                results["errors"].append(f"add_connection: {e}")

        for c in patch.get("update_connections") or []:
            fields = {k: v for k, v in c.items() if k != "id"}
            if "label" in fields:
                fields["body"] = fields.pop("label")
            try:
                conn = self.update_edge(c["id"], **fields)
                if conn:
                    results["updated_connections"].append(conn)
            except ValueError as e:
                results["errors"].append(f"update_connection '{c.get('id')}': {e}")

        for conn_id in patch.get("delete_connections") or []:
            if self.delete_edge(conn_id):
                results["deleted_connections"].append(conn_id)

        return results


class UserState:
    """
    Reads and writes the user's current position in the learning flow.
    Wraps the raw string stored on the user row into a typed LearningState enum.
    """

    def get(self, user_id: str) -> LearningState:
        """Returns the current state, defaulting to PreGraph if nothing is saved yet."""
        user = db.get_user(user_id)
        raw = user.get("learning_state") if user else None
        if raw is None:
            return LearningState.PRE_GRAPH
        return LearningState(raw)

    def set(self, user_id: str, state: LearningState) -> LearningState:
        db.update_user(user_id, learning_state=state.value)
        return state
