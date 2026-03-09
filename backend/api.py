from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database as db
from service import GraphService

app = FastAPI()
db.init_db()

graph = GraphService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# --- Node routes ---

@app.get("/nodes")
def get_nodes():
    return graph.get_all_nodes()

@app.post("/nodes", status_code=201)
def create_node(req: CreateNodeRequest):
    try:
        return graph.create_node(req.title, req.body, req.node_type)
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
        result = graph.update_node(node_id, **{k: getattr(req, k) for k in fields})
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
    return graph.get_all_edges()

@app.post("/edges", status_code=201)
def create_edge(req: CreateEdgeRequest):
    if not req.bidirectional and req.source_id is None:
        raise HTTPException(status_code=400, detail="source_id is required for directed edges")
    try:
        return graph.create_edge(
            req.body, req.node_a_id, req.node_b_id, req.bidirectional, req.source_id
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

@app.delete("/graph", status_code=204)
def clear_graph(full: bool = False):
    if full:
        db.reset_graph()
    else:
        graph.clear_graph()
