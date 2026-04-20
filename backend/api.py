from dotenv import load_dotenv
load_dotenv(dotenv_path='../.env.local')

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database as db
from service import GraphService, UserState, LearningState, ExpertiseService
import llm as llm_service

app = FastAPI()
db.init_db()

graph = GraphService()
user_state = UserState()
expertise_service = ExpertiseService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# TODO(pre-release): make it so each detail panel has an option to view sources.

# --- Request models ---

class CreateNodeRequest(BaseModel):
    title: str
    body: str | None = None
    node_type: str = "Normal"

class UpdateNodeRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    node_type: str | None = None

class CreateEdgeRequest(BaseModel):
    body: str | None = None
    node_a_id: str
    node_b_id: str
    bidirectional: bool = True
    source_id: str | None = None

class UpdateEdgeRequest(BaseModel):
    body: str | None = None
    node_a_id: str | None = None
    node_b_id: str | None = None
    bidirectional: bool | None = None
    source_id: str | None = None

class GraphPatchRequest(BaseModel):
    add_nodes: list[dict] | None = None
    update_nodes: list[dict] | None = None
    delete_nodes: list[str] | None = None
    add_connections: list[dict] | None = None
    update_connections: list[dict] | None = None
    delete_connections: list[str] | None = None

class AIRequest(BaseModel):
    prompt: str
    context: dict | None = None

class QuestionRequest(BaseModel):
    target_id: str
    target_type: str
    text: str

class InitializeGraphRequest(BaseModel):
    subject: str
    notes: str = ""
    goal: str = ""
    importance: int = 5

class RegenerateGraphRequest(BaseModel):
    subject: str
    notes: str = ""
    goal: str = ""
    importance: int = 5

class RestoreVersionRequest(BaseModel):
    nodes: list[dict]
    edges: list[dict]

class InferExpertiseRequest(BaseModel):
    subject: str
    goal: str = ""
    knowledge: str = ""
    importance: int = 5

class ResearchNote(BaseModel):
    question: str
    note: str
    target_title: str

class UpdateOutlineRequest(BaseModel):
    research_notes: list[ResearchNote]

class ReflectionQuestionsRequest(BaseModel):
    node_id: str

class QAPair(BaseModel):
    question: str
    answer: str

class ReflectionSuggestionsRequest(BaseModel):
    node_id: str
    qa_pairs: list[QAPair]

class NodeQAPairs(BaseModel):
    node_id: str
    qa_pairs: list[QAPair]

class ReflectionFinalizeRequest(BaseModel):
    qa_by_node: list[NodeQAPairs]


# --- Node routes ---

@app.get("/nodes")
def get_nodes():
    return graph.get_all_nodes(db.DEFAULT_USER_ID)

@app.post("/nodes", status_code=201)
def create_node(req: CreateNodeRequest):
    try:
        return graph.create_node(db.DEFAULT_USER_ID, req.title, req.body, req.node_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/nodes/{node_id}")
def get_node(node_id: str):
    node = graph.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node

@app.patch("/nodes/{node_id}")
def update_node(node_id: str, req: UpdateNodeRequest):
    fields = req.__fields_set__
    try:
        result = graph.update_node(db.DEFAULT_USER_ID, node_id, **{k: getattr(req, k) for k in fields})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result

@app.delete("/nodes/{node_id}", status_code=204)
def delete_node(node_id: str):
    try:
        if not graph.delete_node(node_id):
            raise HTTPException(status_code=404, detail="Node not found")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


# --- Edge routes ---

@app.get("/edges")
def get_edges():
    return graph.get_all_edges(db.DEFAULT_USER_ID)

@app.post("/edges", status_code=201)
def create_edge(req: CreateEdgeRequest):
    if not req.bidirectional and req.source_id is None:
        raise HTTPException(status_code=400, detail="source_id is required for directed edges")
    try:
        return graph.create_edge(
            db.DEFAULT_USER_ID, req.body, req.node_a_id, req.node_b_id, req.bidirectional, req.source_id
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/edges/{edge_id}")
def get_edge(edge_id: str):
    edge = graph.get_edge(edge_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="Edge not found")
    return edge

@app.patch("/edges/{edge_id}")
def update_edge(edge_id: str, req: UpdateEdgeRequest):
    fields = req.__fields_set__
    try:
        result = graph.update_edge(edge_id, **{k: getattr(req, k) for k in fields})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Edge not found")
    return result

@app.delete("/edges/{edge_id}", status_code=204)
def delete_edge(edge_id: str):
    if not graph.delete_edge(edge_id):
        raise HTTPException(status_code=404, detail="Edge not found")


# --- Graph ---

@app.get("/graph/export")
def export_graph():
    return db.export_graph(db.DEFAULT_USER_ID)

@app.post("/graph/initialize", status_code=201)
def initialize_graph(req: InitializeGraphRequest):
    try:
        outline = llm_service.gen_outline_from_notes(req.subject, req.notes, req.goal, req.importance)
        return graph.initialize_graph(db.DEFAULT_USER_ID, outline.model_dump(exclude_none=True))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graph/regenerate", status_code=201)
def regenerate_graph(req: RegenerateGraphRequest):
    try:
        graph.clear_graph(db.DEFAULT_USER_ID)
        outline = llm_service.gen_outline_from_notes(req.subject, req.notes, req.goal, req.importance)
        return graph.initialize_graph(db.DEFAULT_USER_ID, outline.model_dump(exclude_none=True))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graph/restore-version", status_code=200)
def restore_version(req: RestoreVersionRequest):
    try:
        db.restore_graph_version(db.DEFAULT_USER_ID, req.nodes, req.edges)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graph/apply")
def apply_patch(req: GraphPatchRequest):
    return graph.apply_patch(db.DEFAULT_USER_ID, req.model_dump(exclude_none=True))

@app.post("/graph/ai")
def ai_update(req: AIRequest):
    try:
        graph_export = db.export_graph(db.DEFAULT_USER_ID)
        patch = llm_service.call_llm(req.prompt, graph_export, req.context)
        results = graph.apply_patch(db.DEFAULT_USER_ID, patch)
        results["patch"] = patch
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graph/update-from-research")
def update_from_research(req: UpdateOutlineRequest):
    try:
        user = db.get_user(db.DEFAULT_USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        graph_export = db.export_graph(db.DEFAULT_USER_ID)
        patch = llm_service.update_outline(
            subject=user.get("subject") or "",
            current_expertise=user.get("current_expertise") or 1,
            target_expertise=user.get("target_expertise") or 3,
            graph_export=graph_export,
            research_notes=[r.model_dump() for r in req.research_notes],
        )
        results = graph.apply_patch(db.DEFAULT_USER_ID, patch)
        results["patch"] = patch
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Reflection ---

@app.post("/reflection/questions")
def get_reflection_questions(req: ReflectionQuestionsRequest):
    try:
        user = db.get_user(db.DEFAULT_USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        node = db.get_node(req.node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        all_edges = db.get_all_edges(db.DEFAULT_USER_ID)
        all_nodes = db.get_all_nodes(db.DEFAULT_USER_ID)
        node_map  = {n["id"]: n for n in all_nodes}

        neighbors = []
        for e in all_edges:
            if e["node_a_id"] == req.node_id:
                other_id = e["node_b_id"]
                direction = "↔" if e["bidirectional"] else "→"
            elif e["node_b_id"] == req.node_id:
                other_id = e["node_a_id"]
                direction = "↔" if e["bidirectional"] else ("←" if e.get("source_id") == e["node_b_id"] else "→")
            else:
                continue
            other = node_map.get(other_id)
            if other:
                neighbors.append({"title": other["title"], "direction": direction, "label": e.get("body")})

        graph_context = [{"title": n["title"], "body": n.get("body")} for n in all_nodes]

        result = llm_service.gen_reflection_questions(
            subject           = user.get("subject") or "",
            current_expertise = user.get("current_expertise") or 1,
            target_expertise  = user.get("target_expertise") or 3,
            node              = {"title": node["title"], "body": node.get("body")},
            neighbors         = neighbors,
            graph_context     = graph_context,
        )
        return {"questions": result.questions}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reflection/suggestions")
def get_reflection_suggestions(req: ReflectionSuggestionsRequest):
    try:
        user = db.get_user(db.DEFAULT_USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        node = db.get_node(req.node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        all_edges = db.get_all_edges(db.DEFAULT_USER_ID)
        all_nodes = db.get_all_nodes(db.DEFAULT_USER_ID)
        node_map  = {n["id"]: n for n in all_nodes}

        neighbors = []
        for e in all_edges:
            if e["node_a_id"] == req.node_id:
                other_id  = e["node_b_id"]
                direction = "↔" if e["bidirectional"] else "→"
            elif e["node_b_id"] == req.node_id:
                other_id  = e["node_a_id"]
                direction = "↔" if e["bidirectional"] else ("←" if e.get("source_id") == e["node_b_id"] else "→")
            else:
                continue
            other = node_map.get(other_id)
            if other:
                neighbors.append({"title": other["title"], "direction": direction, "label": e.get("body")})

        result = llm_service.gen_edit_suggestions(
            subject           = user.get("subject") or "",
            current_expertise = user.get("current_expertise") or 1,
            target_expertise  = user.get("target_expertise") or 3,
            node              = {"title": node["title"], "body": node.get("body")},
            neighbors         = neighbors,
            qa_pairs          = [p.model_dump() for p in req.qa_pairs],
        )
        return {"suggestions": [s.model_dump() for s in result.suggestions]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reflection/finalize")
def finalize_reflection(req: ReflectionFinalizeRequest):
    try:
        user = db.get_user(db.DEFAULT_USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        all_nodes = db.get_all_nodes(db.DEFAULT_USER_ID)
        node_map  = {n["id"]: n for n in all_nodes}

        research_notes = []
        for entry in req.qa_by_node:
            node = node_map.get(entry.node_id)
            if not node:
                continue
            for qa in entry.qa_pairs:
                if qa.answer.strip():
                    research_notes.append({
                        "question":     qa.question,
                        "note":         qa.answer,
                        "target_title": node["title"],
                    })

        graph_export = db.export_graph(db.DEFAULT_USER_ID)
        patch = llm_service.update_outline(
            subject           = user.get("subject") or "",
            current_expertise = user.get("current_expertise") or 1,
            target_expertise  = user.get("target_expertise") or 3,
            graph_export      = graph_export,
            research_notes    = research_notes,
        )
        return {"patch": patch}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Questions ---

@app.get("/questions")
def get_questions(target_id: str | None = None):
    if target_id is None:
        return graph.get_all_questions(db.DEFAULT_USER_ID)
    return graph.get_questions(target_id)

@app.post("/questions", status_code=201)
def create_question(req: QuestionRequest):
    try:
        return graph.create_question(db.DEFAULT_USER_ID, req.target_id, req.target_type, req.text)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class UpdateQuestionRequest(BaseModel):
    text: str

@app.patch("/questions/{question_id}")
def update_question(question_id: str, req: UpdateQuestionRequest):
    try:
        result = graph.update_question(question_id, req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return result

class SaveNoteRequest(BaseModel):
    note: str

class SaveAnswerRequest(BaseModel):
    answer: str
    citations: list = []

@app.patch("/questions/{question_id}/answer")
def save_answer_direct(question_id: str, req: SaveAnswerRequest):
    """Dev endpoint: directly set a stored answer without calling the LLM."""
    result = db.save_question_answer(question_id, req.answer, req.citations)
    if result is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return result

@app.patch("/questions/{question_id}/note")
def save_note(question_id: str, req: SaveNoteRequest):
    result = graph.save_question_note(question_id, req.note)
    if result is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return result

@app.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: str):
    if not graph.delete_question(question_id):
        raise HTTPException(status_code=404, detail="Question not found")

@app.post("/questions/{question_id}/explore")
def explore_question_endpoint(question_id: str, force: bool = False):
    question = graph.get_question(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    if not force and question.get("answer"):
        return {"answer": question["answer"], "citations": question["citations"]}

    user = db.get_user(db.DEFAULT_USER_ID)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    subject          = user.get("subject") or ""
    current_expertise = user.get("current_expertise") or 1
    target_expertise  = user.get("target_expertise") or 3

    all_nodes = graph.get_all_nodes(db.DEFAULT_USER_ID)
    all_edges = graph.get_all_edges(db.DEFAULT_USER_ID)
    node_map  = {n["id"]: n for n in all_nodes}
    edge_map  = {e["id"]: e for e in all_edges}

    target_id   = question["target_id"]
    target_type = question["target_type"]

    if target_type == "node":
        target_node  = node_map.get(target_id)
        target_title = target_node["title"] if target_node else target_id
        # incident edges and the neighbor nodes on the other end
        incident = [e for e in all_edges if e["node_a_id"] == target_id or e["node_b_id"] == target_id]
        neighbor_ids = {
            (e["node_b_id"] if e["node_a_id"] == target_id else e["node_a_id"])
            for e in incident
        }
        context_nodes = [n for n in all_nodes if n["id"] == target_id or n["id"] in neighbor_ids]
        context_edges = incident
    else:
        target_edge = edge_map.get(target_id)
        if target_edge:
            a = node_map.get(target_edge["node_a_id"])
            b = node_map.get(target_edge["node_b_id"])
            a_title = a["title"] if a else "?"
            b_title = b["title"] if b else "?"
            target_title = f"{a_title} ↔ {b_title}" if target_edge.get("bidirectional") else f"{a_title} → {b_title}"
            context_nodes = [n for n in [a, b] if n]
        else:
            target_title  = target_id
            context_nodes = []
        context_edges = [target_edge] if target_edge else []

    try:
        result = llm_service.explore_question(
            subject=subject,
            current_expertise=current_expertise,
            target_expertise=target_expertise,
            target_title=target_title,
            context_nodes=context_nodes,
            context_edges=context_edges,
            question_text=question["text"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    citations = [c.model_dump() for c in result.citations]
    db.save_question_answer(question_id, result.answer, citations)
    return {"answer": result.answer, "citations": citations}


@app.delete("/graph", status_code=204)
def clear_graph(full: bool = False):
    if full:
        db.reset_graph(db.DEFAULT_USER_ID)
    else:
        graph.clear_graph(db.DEFAULT_USER_ID)


# --- User state ---

class SetStateRequest(BaseModel):
    state: LearningState

@app.get("/state")
def get_state():
    return {"state": user_state.get(db.DEFAULT_USER_ID)}

@app.post("/state")
def set_state(req: SetStateRequest):
    return {"state": user_state.set(db.DEFAULT_USER_ID, req.state)}


@app.get("/settings")
def get_settings():
    return db.get_user(db.DEFAULT_USER_ID)


@app.post("/questionnaire/extract-pdf")
async def extract_pdf(file: UploadFile = File(...), subject: str = Form("")):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="PDF must be under 20 MB.")
    knowledge = llm_service.extract_knowledge_from_pdf(pdf_bytes, subject or "the subject")
    return {"knowledge": knowledge}


@app.post("/expertise/infer")
def infer_expertise(req: InferExpertiseRequest):
    result = expertise_service.infer_and_save(
        db.DEFAULT_USER_ID, req.subject, req.goal, req.knowledge, req.importance
    )
    return result
