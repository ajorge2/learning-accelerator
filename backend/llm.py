from openai import OpenAI
from pydantic import BaseModel
from service import MAX_TITLE_LEN, MAX_NODE_BODY_LEN, MAX_EDGE_BODY_LEN

client = OpenAI()

OUTLINE_PROMPT_ID      = "pmpt_69af450f361c8190880fa9272ac5ccf600925a7d521ffdd8"
OUTLINE_PROMPT_VERSION = "8"

EXPERTISE_PROMPT_ID      = "pmpt_69b8a3c16f0481969f48ea668d6d03ea0abcd79917460735"
EXPERTISE_PROMPT_VERSION = "1"

EXPLORE_PROMPT_ID      = "pmpt_69b8bca846288193a3e7496879b6218a0ca81a68c8207bae"
EXPLORE_PROMPT_VERSION = "2"

REFLECTION_PROMPT_ID      = "pmpt_69b9ebd0b2d08196919a12b13b784cc1050c93b88ac6f547"
REFLECTION_PROMPT_VERSION = "3"

EDIT_SUGGESTIONS_PROMPT_ID      = "pmpt_69ba0ade238c8190a3398a48077178c60cc27e70b628a9f0"
EDIT_SUGGESTIONS_PROMPT_VERSION = "1"

PDF_KNOWLEDGE_PROMPT_ID      = "pmpt_69c0c9c084f08194b7f2567b58e7258d0ff6e4f6ec977c08"
PDF_KNOWLEDGE_PROMPT_VERSION = "1"

UPDATE_OUTLINE_PROMPT_ID      = "pmpt_69b8e5dc35e88194815c1db20d2042e208a784831b0ed01f"
UPDATE_OUTLINE_PROMPT_VERSION = "1"

FIRST_NODES_MIN = 1
FIRST_NODES_MAX = 15


# ── Pydantic models ────────────────────────────────────────────────────────────

## gen_outline_from_notes
class NewGraphNode(BaseModel):
    title: str
    body: str | None = None
    node_type: str = "Normal"

class NewGraphConnection(BaseModel):
    from_: str
    to: str
    label: str | None = None
    bidirectional: bool = True

class CreateNewGraph(BaseModel):
    nodes: list[NewGraphNode]
    connections: list[NewGraphConnection] | None = None

## infer_expertise_levels
class ExpertiseProfile(BaseModel):
    current_expertise: int  # 1–5
    target_expertise: int   # 1–5

## explore_question
class Citation(BaseModel):
    url: str
    title: str
    start_index: int = 0
    end_index: int = 0

class QuestionAnswer(BaseModel):
    answer: str
    citations: list[Citation]

## update_outline
class AddNode(BaseModel):
    title: str
    body: str | None = None

class UpdateNode(BaseModel):
    id: str
    title: str | None = None
    body: str | None = None

class AddConnection(BaseModel):
    from_: str
    to: str
    label: str | None = None
    bidirectional: bool = True

    class Config:
        populate_by_name = True

class UpdateConnection(BaseModel):
    id: str
    label: str | None = None

class GraphDelta(BaseModel):
    add_nodes: list[AddNode] | None = None
    update_nodes: list[UpdateNode] | None = None
    delete_nodes: list[str] | None = None
    add_connections: list[AddConnection] | None = None
    update_connections: list[UpdateConnection] | None = None
    delete_connections: list[str] | None = None

# ── LLM calls ─────────────────────────────────────────────────────────────────

def gen_outline_from_notes(subject: str, notes: str) -> CreateNewGraph:
    """
    Generate an initial graph outline from a subject title and the user's
    questionnaire notes. Returns a CreateNewGraph with nodes and connections.
    """
    response = client.responses.parse(
        prompt={
            "id": OUTLINE_PROMPT_ID,
            "version": OUTLINE_PROMPT_VERSION,
            "variables": {
                "max_title_len":     str(MAX_TITLE_LEN),
                "max_node_body_len": str(MAX_NODE_BODY_LEN),
                "max_edge_body_len": str(MAX_EDGE_BODY_LEN),
                "first_nodes_min":   str(FIRST_NODES_MIN),
                "first_nodes_max":   str(FIRST_NODES_MAX),
                "subject":           subject,
                "notes":             notes,
            },
        },
        text_format=CreateNewGraph,
    )

    return response.output_parsed

def infer_expertise_levels(
    subject: str,
    goal: str,
    knowledge: str,
    importance: int,
) -> ExpertiseProfile:
    """
    Infer current and target expertise levels (1–5) from questionnaire answers.
    Uses structured output for reliability.
    """
    response = client.responses.parse(
        prompt={
            "id": EXPERTISE_PROMPT_ID,
            "version": EXPERTISE_PROMPT_VERSION,
            "variables": {
                "subject":    subject,
                "goal":       goal or "(not provided)",
                "knowledge":  knowledge or "(not provided)",
                "importance": str(importance),
            },
        },
        text_format=ExpertiseProfile,
    )

    return response.output_parsed


def update_outline(
    subject: str,
    current_expertise: int,
    target_expertise: int,
    graph_export: dict,
    research_notes: list[dict],  # [{ question, note, target_title }, ...]
) -> dict:
    """
    Given the current graph and the user's research notes, ask the LLM to
    suggest additions/updates as a GraphDelta. Returns a patch-compatible dict.
    """
    nodes = graph_export.get("nodes", [])
    edges = graph_export.get("edges", [])
    node_map = {n["id"]: n["title"] for n in nodes}

    nodes_str = "\n".join(
        f"- [{n['id']}] {n['title']}: {n['body']}" if n.get("body") else f"- [{n['id']}] {n['title']}"
        for n in nodes
    ) or "(none)"

    edges_str = "\n".join(
        f"- [{e['id']}] {node_map.get(e['node_a_id'], '?')} {'↔' if e.get('bidirectional') else '→'} {node_map.get(e['node_b_id'], '?')}{': ' + e['body'] if e.get('body') else ''}"
        for e in edges
    ) or "(none)"

    notes_str = "\n\n".join(
        f"Question: {r['question']}\nOn: {r['target_title']}\nNotes: {r['note']}"
        for r in research_notes
        if r.get("note", "").strip()
    ) or "(no notes)"

    response = client.responses.parse(
        prompt={
            "id": UPDATE_OUTLINE_PROMPT_ID,
            "version": UPDATE_OUTLINE_PROMPT_VERSION,
            "variables": {
                "subject":            subject,
                "current_expertise":  str(current_expertise),
                "target_expertise":   str(target_expertise),
                "nodes":              nodes_str,
                "edges":              edges_str,
                "notes":              notes_str,
                "max_title_len":      str(MAX_TITLE_LEN),
                "max_node_body_len":  str(MAX_NODE_BODY_LEN),
                "max_edge_body_len":  str(MAX_EDGE_BODY_LEN),
            },
        },
        text_format=GraphDelta,
    )

    delta: GraphDelta = response.output_parsed
    raw = delta.model_dump(exclude_none=True)
    if "add_connections" in raw:
        for c in raw["add_connections"]:
            if "from_" in c:
                c["from"] = c.pop("from_")
    return raw
 
def explore_question(
    subject: str,
    current_expertise: int,
    target_expertise: int,
    target_title: str,
    context_nodes: list[dict],   # for node Q: target + neighbors; for edge Q: the two endpoints
    context_edges: list[dict],   # for node Q: incident edges;     for edge Q: the edge itself
    question_text: str,
) -> QuestionAnswer:
    node_map = {n["id"]: n["title"] for n in context_nodes}

    nodes_str = "\n".join(
        f"- {n['title']}: {n['body']}" if n.get("body") else f"- {n['title']}"
        for n in context_nodes
    ) or "(none)"

    edges_lines = []
    for e in context_edges:
        a = node_map.get(e["node_a_id"], "?")
        b = node_map.get(e["node_b_id"], "?")
        arrow = "↔" if e.get("bidirectional") else "→"
        label = f": {e['body']}" if e.get("body") else ""
        edges_lines.append(f"- {a} {arrow} {b}{label}")
    edges_str = "\n".join(edges_lines) or "(none)"

    response = client.responses.create(
        prompt={
            "id": EXPLORE_PROMPT_ID,
            "version": EXPLORE_PROMPT_VERSION,
            "variables": {
                "subject":            subject,
                "current_expertise":  str(current_expertise),
                "target_expertise":   str(target_expertise),
                "nodes":              nodes_str,
                "edges":              edges_str,
                "target_title":       target_title,
                "question":           question_text,
            },
        },
    )

    answer = ""
    citations = []
    for item in response.output:
        if item.type == "message":
            for content in item.content:
                if content.type == "output_text":
                    answer = content.text
                    for ann in getattr(content, "annotations", []):
                        if ann.type == "url_citation":
                            citations.append(Citation(
                                url=ann.url,
                                title=getattr(ann, "title", ""),
                                start_index=getattr(ann, "start_index", 0),
                                end_index=getattr(ann, "end_index", 0),
                            ))

    return QuestionAnswer(answer=answer, citations=citations)

class ReflectionQuestions(BaseModel):
    questions: list[str]


def gen_reflection_questions(
    subject: str,
    current_expertise: int,
    target_expertise: int,
    node: dict,           # {title, body}
    neighbors: list[dict],  # [{title, direction, label}]
    graph_context: list[dict],  # [{title, body}]
) -> ReflectionQuestions:
    node_body = f"Description: {node['body']}" if node.get("body") else ""

    neighbors_str = "\n".join(
        f"- {n['direction']} {n['title']}{': ' + n['label'] if n.get('label') else ''}"
        for n in neighbors
    ) or "(no connections)"

    graph_context_str = "\n".join(
        f"- {n['title']}: {n['body']}" if n.get("body") else f"- {n['title']}"
        for n in graph_context
    ) or "(empty)"

    response = client.responses.parse(
        prompt={
            "id": REFLECTION_PROMPT_ID,
            "version": REFLECTION_PROMPT_VERSION,
            "variables": {
                "subject":            subject,
                "current_expertise":  str(current_expertise),
                "target_expertise":   str(target_expertise),
                "node_title":         node["title"],
                "node_body":          node_body,
                "neighbors":          neighbors_str,
                "graph_context":      graph_context_str,
            },
        },
        text_format=ReflectionQuestions,
    )
    return response.output_parsed


class EditSuggestion(BaseModel):
    type: str        # "update_node" | "add_node" | "update_edge" | "add_edge"
    description: str

class EditSuggestions(BaseModel):
    suggestions: list[EditSuggestion]


def gen_edit_suggestions(
    subject: str,
    current_expertise: int,
    target_expertise: int,
    node: dict,           # {title, body}
    neighbors: list[dict],  # [{title, direction, label}]
    qa_pairs: list[dict],   # [{question, answer}]
) -> EditSuggestions:
    node_body = f"Description: {node['body']}" if node.get("body") else "(no description)"

    neighbors_str = "\n".join(
        f"- {n['direction']} {n['title']}{': ' + n['label'] if n.get('label') else ''}"
        for n in neighbors
    ) or "(no connections)"

    qa_str = "\n\n".join(
        f"Q: {p['question']}\nA: {p['answer']}"
        for p in qa_pairs
        if p.get("answer", "").strip()
    ) or "(no answers provided)"

    response = client.responses.parse(
        prompt={
            "id": EDIT_SUGGESTIONS_PROMPT_ID,
            "version": EDIT_SUGGESTIONS_PROMPT_VERSION,
            "variables": {
                "subject":           subject,
                "current_expertise": str(current_expertise),
                "target_expertise":  str(target_expertise),
                "node_title":        node["title"],
                "node_body":         node_body,
                "neighbors":         neighbors_str,
                "qa_pairs":          qa_str,
            },
        },
        text_format=EditSuggestions,
    )
    return response.output_parsed


def extract_knowledge_from_pdf(pdf_bytes: bytes, subject: str) -> str:
    """
    Given a raw PDF (as bytes) and a subject title, returns a plain-text summary
    of what knowledge the document demonstrates about that subject.
    Uses the OpenAI Responses API with native PDF input (no text extraction step).
    """
    import base64
    b64 = base64.b64encode(pdf_bytes).decode()

    response = client.responses.create(
        prompt={
            "id": PDF_KNOWLEDGE_PROMPT_ID,
            "version": PDF_KNOWLEDGE_PROMPT_VERSION,
            "variables": {
                "subject": subject,
            },
        },
        input=[{
            "role": "user",
            "content": [{
                "type": "input_file",
                "filename": "upload.pdf",
                "file_data": f"data:application/pdf;base64,{b64}",
            }],
        }],
    )

    for item in response.output:
        if item.type == "message":
            for content in item.content:
                if content.type == "output_text":
                    return content.text
    return ""


def research_subject():
    raise NotImplementedError

def verify_with_sources():
    raise NotImplementedError