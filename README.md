# Learning Accelerator

A tool for building a personal knowledge graph around a subject you're studying. You map what you know as a network of ideas and connections rather than a flat list of notes — the structure itself becomes part of how you understand the material.

---

## Why it's interesting

**Graph as the primary data model.** Most note-taking tools force a hierarchy (folders, pages, headings). This app treats knowledge as a graph from the start — nodes are ideas, edges are explicit relationships between them. The backend stores this in SQLite with a proper `nodes`/`edges` schema including directed vs. bidirectional edges and a `source_id` to track where a relationship originates. Everything the frontend displays is derived from this model.

**Single-subject invariant enforced at the service layer.** The app is designed around one active subject at a time. Rather than leaving that as a UI convention, it's enforced in `GraphService`: creating a second `Subject`-type node raises a `ValueError`, deleting the Subject node raises a `PermissionError`, and the API maps these to HTTP 400/403 respectively. The "clear graph" operation has two variants — one that preserves the Subject node (in-session clear) and one that wipes everything (new subject creation) — kept distinct so the invariant is never accidentally broken.

**Search is decoupled from the backend.** Rather than adding full-text search to SQLite, the app syncs the in-memory graph state to Algolia after every `loadData()` call via `replaceAllObjects`. This keeps the backend a simple REST API over SQLite and lets search scale and be configured independently. If Algolia credentials aren't present the app degrades silently — search just doesn't show up.

**Vite with a non-root `frontend/` directory.** The project root holds both the backend and frontend. Setting `root: 'frontend'` in Vite means `envDir` defaults to `frontend/` rather than the project root — a subtle gotcha that required an explicit `envDir: '..'` override so `.env.local` at the repo root is actually loaded. The Algolia ESM browser build also required a resolve alias since Vite can't bundle Algolia's Node CJS build for the browser.

**Session management without a login system.** The landing/questionnaire flow uses `sessionStorage` to distinguish a first visit (show onboarding) from a page refresh (show the graph immediately with a brief splash). This gives a polished first-run experience without any auth infrastructure.

---

## Architecture

```
learning-accelerator/
├── backend/
│   ├── api.py          # FastAPI routes (REST: /nodes, /edges, /graph)
│   ├── service.py      # Business logic & invariant enforcement
│   ├── database.py     # SQLite via contextlib; raw SQL, no ORM
│   └── graph.db        # SQLite database (gitignored)
│
├── frontend/
│   ├── index.html
│   ├── scripts/
│   │   ├── main.js         # Entry point
│   │   ├── api.js          # Fetch helpers, Algolia sync, shared state (nodes/edges dicts)
│   │   ├── graph.js        # D3.js force-directed graph, all interaction logic
│   │   ├── ui.js           # Table view, modals, view switching
│   │   ├── landing.js      # Landing screen (new subject / continue)
│   │   ├── questionnaire.js# Onboarding questionnaire (pre-graph creation)
│   │   ├── search.js       # Algolia-powered search UI
│   │   └── history.js      # localStorage edit history
│   └── styles/
│       ├── base.css        # Layout, landing, table, modals
│       └── graph.css       # SVG graph styles, detail panel
│
└── vite.config.js
```

The frontend holds the entire graph in memory as two flat dictionaries (`nodes`, `edges`) keyed by ID, loaded fresh on every `loadData()` call. D3 reads directly from these. The backend is stateless beyond the SQLite file.

```
Browser  ──fetch──▶  FastAPI (port 8000)  ──SQL──▶  SQLite
                            │
Browser  ──fetch──▶  Algolia (search only, optional)
```

---

## Running locally

**Backend**

```bash
cd backend
pip install fastapi uvicorn
uvicorn api:app --reload
# API available at http://localhost:8000
```

**Frontend**

```bash
npm install
npm run dev
# App available at http://localhost:3000
```

**Environment variables** (optional — only needed for search)

Create `.env.local` in the project root:

```
VITE_ALGOLIA_APP_ID=your_app_id
VITE_ALGOLIA_WRITE_KEY=your_write_api_key
VITE_ALGOLIA_SEARCH_KEY=your_search_only_key
```

**Seed data** (optional)

```bash
cd backend
python seed.py   # requires backend to be running; populates a sample learning-science graph
```
