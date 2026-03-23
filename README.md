# Learning Accelerator

A tool for building a personal knowledge graph around a subject you're studying. You map what you know as a network of ideas and connections rather than a flat list of notes — the structure itself becomes part of how you understand the material.

---

## Why it's interesting

**Graph as the primary data model.** Most note-taking tools force a hierarchy (folders, pages, headings). This app treats knowledge as a graph from the start — nodes are ideas, edges are explicit relationships between them. The backend stores this in SQLite with a proper `nodes`/`edges` schema including directed vs. bidirectional edges and a `source_id` to track where a relationship originates. Everything the frontend displays is derived from this model.

**Single-subject invariant enforced at the service layer.** The app is designed around one active subject at a time. Rather than leaving that as a UI convention, it's enforced in `GraphService`: creating a second `Subject`-type node raises a `ValueError`, deleting the Subject node raises a `PermissionError`, and the API maps these to HTTP 400/403 respectively. The "clear graph" operation has two variants — one that preserves the Subject node (in-session clear) and one that wipes everything (new subject creation) — kept distinct so the invariant is never accidentally broken.

**LLM pipeline with structured output throughout.** `backend/llm.py` wraps all AI calls through OpenAI's structured output API (`responses.parse`), with every response typed via Pydantic models. This means the LLM can never return malformed graph data — if the response doesn't conform to the schema, the call fails loudly rather than silently corrupting graph state. Prompts are versioned and stored externally (OpenAI prompt IDs), keeping the codebase clean of long prompt strings while allowing prompt iteration without deploys.

**Graph delta pattern for LLM-driven updates.** Rather than having the LLM regenerate the full graph on every update, the `update_outline` call returns a `GraphDelta` — a diff of what to add, update, and delete. This keeps LLM responses small and predictable, and means partial updates can be applied without touching unrelated nodes. The same delta schema is reused for PDF ingestion, edit suggestions, and research-driven expansions.

**Reflection mode walks the graph via BFS.** The reflection feature traverses nodes in breadth-first order from the Subject outward, prompting the user to articulate each concept in their own words. The traversal order is computed in `reflection.js` rather than the backend, keeping the graph-walking logic co-located with the frontend graph state. Unreachable nodes are flagged before the session starts via a connectivity check.

**Research mode with AI-answered questions and citations.** The research screen generates questions tied to specific nodes or edges, explores them via web-grounded LLM answers (with citation objects including character offsets), and lets users take notes per question. Questions and their answers persist in the database; the frontend tracks per-item state (explored, noted, open) in the DOM rather than in a separate store. Answers are cached — `explore_question` returns the stored answer without re-calling the LLM unless `force=true` is passed.

**Reflection closes the feedback loop.** After a reflection session, the user's QA pairs (their own articulations of each concept) are fed directly into `update_outline` via `POST /reflection/finalize`. The LLM reads what the user actually said about each node and uses that as signal for what to add, correct, or expand in the graph — so the act of articulating your understanding directly shapes the knowledge structure.

**Expertise levels calibrate all LLM output.** During the questionnaire, a dedicated LLM call (`infer_expertise`) reads the user's stated goal, prior knowledge, and importance rating and infers `current_expertise` and `target_expertise` on a 1–5 scale. These two numbers are stored on the user record and passed as context to every subsequent LLM call — reflection questions, research answers, graph updates — so the language and depth of generated content adapts to where the user actually is, not where they say they are.

**PDF ingestion without client-side text extraction.** The questionnaire accepts a PDF upload. Rather than parsing the PDF in the browser or with a server-side library, the raw bytes are sent directly to the LLM (`extract_knowledge_from_pdf`), which returns a free-form knowledge summary. That summary then becomes the notes input for `gen_outline_from_notes`. This keeps the ingestion path identical to the manual notes path and avoids brittle PDF parsing logic.

**Learning state machine persists in the backend.** A `LearningState` enum (`questionnaire → graph → reflect → research`) is stored per user and exposed via `GET/POST /state`. The frontend reads this on load to determine which screen to show, so returning to the app always drops you back in the right mode rather than re-running onboarding.

**Search is decoupled from the backend.** Rather than adding full-text search to SQLite, the app syncs the in-memory graph state to Algolia after every `loadData()` call via `replaceAllObjects`. This keeps the backend a simple REST API over SQLite and lets search scale and be configured independently. If Algolia credentials aren't present the app degrades silently — search just doesn't show up.

**Vite with a non-root `frontend/` directory.** The project root holds both the backend and frontend. Setting `root: 'frontend'` in Vite means `envDir` defaults to `frontend/` rather than the project root — a subtle gotcha that required an explicit `envDir: '..'` override so `.env.local` at the repo root is actually loaded. The Algolia ESM browser build also required a resolve alias since Vite can't bundle Algolia's Node CJS build for the browser.

**Session management without a login system.** The landing/questionnaire flow uses `sessionStorage` to distinguish a first visit (show onboarding) from a page refresh (show the graph immediately with a brief splash). This gives a polished first-run experience without any auth infrastructure.

---

## Architecture

```
learning-accelerator/
├── backend/
│   ├── api.py          # FastAPI routes (REST: /nodes, /edges, /graph, /reflection, /questions)
│   ├── service.py      # Business logic & invariant enforcement
│   ├── database.py     # SQLite via contextlib; raw SQL, no ORM
│   ├── llm.py          # All LLM calls — structured output via OpenAI responses.parse
│   └── graph.db        # SQLite database (gitignored)
│
├── frontend/
│   ├── index.html
│   ├── scripts/
│   │   ├── main.js             # Entry point
│   │   ├── api.js              # Fetch helpers, Algolia sync, shared state (nodes/edges dicts)
│   │   ├── graph.js            # D3.js force-directed graph, all interaction logic
│   │   ├── ui.js               # Modals, view switching
│   │   ├── landing.js          # Landing screen (new subject / continue)
│   │   ├── questionnaire.js    # Onboarding questionnaire (pre-graph creation), PDF upload
│   │   ├── reflection.js       # BFS reflection mode, per-node Q&A, finalize → graph update
│   │   ├── research.js         # Research screen, question exploration, notes panel
│   │   ├── questions.js        # Question list, routing to research explorer
│   │   ├── ideaTable.js        # Idea table drawer (tabular view of nodes)
│   │   ├── search.js           # Algolia-powered search UI
│   │   └── history.js          # localStorage edit history
│   └── styles/
│       ├── base.css            # Layout, landing, table, modals
│       └── graph.css           # SVG graph styles, detail panel
│
└── vite.config.js
```

The frontend holds the entire graph in memory as two flat dictionaries (`nodes`, `edges`) keyed by ID, loaded fresh on every `loadData()` call. D3 reads directly from these. The backend is stateless beyond the SQLite file.

```
Browser  ──fetch──▶  FastAPI (port 8000)  ──SQL──▶  SQLite
                            │
                     OpenAI Responses API  (structured output, versioned prompts)
                            │
Browser  ──fetch──▶  Algolia (search only, optional)
```

---

## Running locally

**Backend**

```bash
cd backend
pip install fastapi uvicorn openai pydantic python-dotenv python-multipart
uvicorn api:app --reload
# API available at http://localhost:8000
```

**Frontend**

```bash
npm install
npm run dev
# App available at http://localhost:3000
```

**Environment variables**

Create `.env.local` in the project root:

```
OPENAI_API_KEY=your_openai_key          # required — used by the backend for all LLM calls

VITE_ALGOLIA_APP_ID=your_app_id         # optional — search degrades silently if absent
VITE_ALGOLIA_WRITE_KEY=your_write_api_key
VITE_ALGOLIA_SEARCH_KEY=your_search_only_key
```

**Seed data** (optional)

```bash
cd backend
python seed.py   # requires backend to be running; populates a sample learning-science graph
```
