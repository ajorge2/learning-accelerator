import requests

BASE = "http://localhost:8000"

nodes = [
    ("Spaced Repetition", "Reviewing material at increasing intervals over time. The forgetting curve shows memory decays exponentially — spacing reviews just before you forget locks information into long-term memory far more efficiently than massed practice."),
    ("Active Recall", "Actively retrieving information from memory rather than passively re-reading. Testing yourself — flashcards, practice problems, blank-page dumps — is one of the highest-leverage study techniques."),
    ("The Feynman Technique", "Explain a concept in plain language as if teaching a child. Gaps in your explanation reveal gaps in your understanding. Go back to the source, fill the gap, then simplify again."),
    ("Deliberate Practice", "Focused, goal-directed practice that targets weaknesses just beyond your current ability. Requires immediate feedback and mental effort — mindless repetition doesn't count."),
    ("Deep Work", "Cognitively demanding tasks performed in a state of distraction-free concentration. Produces output that is hard to replicate and builds rare, valuable skills quickly."),
    ("Flow State", "A state of complete absorption in a challenging task where effort feels effortless. Triggered when skill level and task difficulty are closely matched."),
    ("Growth Mindset", "The belief that abilities are developed through effort and learning, not fixed by genetics. Leads to embracing challenges and persisting through failure rather than avoiding difficulty."),
    ("Metacognition", "Thinking about your own thinking. Involves monitoring comprehension, evaluating strategies, and adjusting approaches — the foundation of self-directed learning."),
    ("Interleaving", "Mixing different topics or problem types during a study session instead of blocking one subject at a time. Feels harder but produces better long-term retention and transfer."),
    ("Chunking", "Grouping individual pieces of information into meaningful units. Experts compress knowledge into chunks, freeing up working memory for higher-level reasoning."),
    ("Working Memory", "The mental workspace that holds and manipulates information in the short term. Limited to ~4 items. Overloading it causes cognitive load — good instruction minimises this."),
    ("Long-term Memory", "Virtually unlimited storage for knowledge and skills. Information moves from working memory to long-term memory through encoding — strengthened by emotion, repetition, and retrieval."),
    ("Sleep & Memory Consolidation", "During sleep, the hippocampus replays the day's learning and transfers it to the cortex for long-term storage. Skipping sleep after learning dramatically reduces retention."),
    ("Elaborative Interrogation", "Asking 'why' and 'how' questions while studying. Connecting new information to existing knowledge creates more retrieval pathways and deepens understanding."),
    ("Mind Mapping", "A visual diagram that branches concepts from a central idea. Mirrors the brain's associative structure and helps surface connections between ideas."),
    ("Pomodoro Technique", "Work in 25-minute focused blocks followed by 5-minute breaks. Reduces procrastination by making starting feel low-stakes and uses breaks to prevent mental fatigue."),
    ("Mental Models", "Frameworks for understanding how things work — first principles, inversion, second-order thinking. A rich library of models lets you reason across domains and avoid common cognitive biases."),
    ("Feedback Loops", "Timely, specific information about performance that guides improvement. Without feedback, practice can reinforce mistakes. Tight feedback loops accelerate skill acquisition."),
    ("Note-taking Systems", "Structured approaches to capturing and connecting ideas — Cornell notes, Zettelkasten, outlining. The goal is not transcription but sense-making and future retrieval."),
    ("Learning Goals", "Specific, measurable outcomes that direct attention and effort. Goals shift focus from passive coverage to active mastery and help calibrate when you actually know something."),
]

edges = [
    (0, 1,  False, "Spaced repetition schedules active recall sessions"),
    (1, 2,  False, "Feynman technique is a form of active recall"),
    (0, 12, False, "Sleep consolidates what spaced repetition encodes"),
    (3, 5,  False, "Deliberate practice can induce flow when calibrated correctly"),
    (3, 17, False, "Deliberate practice requires tight feedback loops"),
    (4, 5,  False, "Deep work creates the conditions for flow"),
    (6, 3,  False, "Growth mindset enables the discomfort of deliberate practice"),
    (7, 0,  False, "Metacognition helps optimise spacing intervals"),
    (8, 9,  False, "Interleaving prevents over-chunking a single topic"),
    (10, 9, False, "Chunking reduces working memory load"),
    (10, 11,False, "Working memory encodes into long-term memory"),
    (11, 0, False, "Long-term memory is strengthened by spaced retrieval"),
    (13, 1, False, "Elaborative interrogation deepens active recall"),
    (13, 16,False, "Mental models provide the 'why' behind elaborative interrogation"),
    (14, 18,False, "Mind maps are a visual note-taking system"),
    (15, 4, False, "Pomodoro structures time for deep work sessions"),
    (18, 1, False, "Good notes create retrieval practice opportunities"),
    (19, 3, False, "Clear goals define what to deliberately practice"),
    (7, 2,  False, "Metacognition is strengthened by the Feynman technique"),
    (6, 7,  True,  "Growth mindset and metacognition reinforce each other"),
]

created = []
for title, body in nodes:
    r = requests.post(f"{BASE}/nodes", json={"title": title, "body": body})
    created.append(r.json())
    print(f"  + {title}")

print(f"\nCreated {len(created)} nodes. Adding edges...")

for a, b, bidir, label in edges:
    na, nb = created[a], created[b]
    r = requests.post(f"{BASE}/edges", json={
        "body": label,
        "node_a_id": na["id"],
        "node_b_id": nb["id"],
        "bidirectional": bidir,
        "source_id": na["id"] if not bidir else None,
    })
    print(f"  → {na['title'][:30]} {'↔' if bidir else '→'} {nb['title'][:30]}")

print("\nDone!")
