# Wiring an LLM into Agent Atlas (Requirements → Model)

**Status:** Guidance for adopters + design spec for DIAG-37 (2026-06-10). No feature is
shipped yet; this defines the contract so the implementation — and your own provider —
slot in cleanly.

Agent Atlas's "System Requirements" front door turns a requirements document into a
**first-cut model** you then refine in the studio. That generation needs an LLM. Agent
Atlas is **open source and provider-agnostic**: it does not ship or assume any specific
model, vendor, or key. Instead it defines a small **provider interface** and a stable
**request/response contract**, so you wire in whatever you run — a cloud API, a local
model, or your own service.

> The same philosophy as the rest of Atlas: couple to a stable interface, not a vendor.
> (Telemetry couples to OpenTelemetry; conformance rules implement a `ConformanceRule`
> interface; model generation implements a `ModelProvider`.)

---

## 1. The one rule: the call runs in YOUR backend, not the browser

**Do not put an API key in the web app.** Agent Atlas's web build is static client-side
JavaScript; any key embedded there is visible to anyone who opens the page. So the LLM
call must run **server-side, in a small backend/proxy you control**. Agent Atlas calls
*your* endpoint; *your* endpoint holds the key and calls the model.

```
Agent Atlas (browser or desktop)
        │  POST requirements text  → (your endpoint)
        ▼
YOUR backend / proxy   ← your API key lives HERE, never in the client
        │  calls your model (cloud API, local server, anything)
        ▼
        └─ returns model JSON  → Agent Atlas renders it as an editable draft
```

Exception: the **desktop (Tauri) build talking to a *local* model** (e.g. Ollama at
`http://localhost:11434`) can call directly — there's no exposed key and nothing leaves
the machine. For the web build, or any cloud key, always go through your backend.

## 2. The contract (provider interface)

A provider implements one operation:

```
generateModel(requirementsText, options?) -> AtlasModel
```

- **Input:** the requirements document as plain text (imported or typed in the studio),
  plus optional hints (e.g. target object-count, domain).
- **Output:** an **Atlas model** — the same JSON shape the studio already uses
  (`objects` keyed by id, `edges`, optionally `subjectAreas`), where each object is
  `{ id, kind, parent, data }` and `kind ∈ {orchestrator, task, agent, tool, job, router,
  system}`. See `src/atlas/seedModel.js` for a worked example of the exact shape.

In transport terms (HTTP), your backend exposes an endpoint Atlas can POST to:

```
POST /generate-model
Request:  { "requirements": "<text>", "options": { ... } }
Response: { "model": { "objects": {...}, "edges": [...], "subjectAreas": [...] },
            "notes": [ "low-confidence inferences, for the human to confirm" ] }
```

Atlas validates the returned model against the agent-atlas schemas before rendering it,
so a malformed or partial response degrades to "here's what we could parse, fix the rest"
rather than failing hard.

## 3. Reference adapters Atlas intends to ship (implement-your-own from these)

1. **OpenAI-compatible HTTP** — works against OpenAI, Azure OpenAI, and most local
   servers that expose the OpenAI API (Ollama, vLLM, LM Studio, llama.cpp servers,
   text-generation-inference). You configure a base URL, model name, and (server-side) key.
   This single adapter covers the large majority of adopters.
2. **Local Ollama (desktop)** — direct call to a local Ollama model for the desktop build,
   no key, fully offline.
3. **Bring-your-own endpoint** — point Atlas at any URL honoring the §2 contract; you
   implement the model call however you like (router, multi-model, in-house service).

Your own provider is just a fourth implementation of the same interface.

## 4. Choosing a model (guidance, not prescription)

Requirements → model is a **hard structured-reasoning task** (infer a typed object graph,
get parentage / tool allowlists / cardinality right, flag uncertainty). Two practical
notes:

- **Use a strong model for this** — it's a low-frequency, high-value call (you generate a
  model occasionally, not per request), so favor quality over cost. A frontier
  instruction/reasoning model produces a far better first cut than a small one.
- **Sensitivity decides cloud-vs-local first, size second.** If your requirements docs
  carry no sensitive data (most architecture/modernization specs don't), a cloud model is
  fine. If they contain regulated or proprietary data, run a local model in your backend
  and keep it on-prem. A **router** (one of Atlas's own object kinds) is the clean way to
  encode "heavy model for the architecture task, lighter/local for narrower or sensitive
  tasks" as policy rather than hardcoding.

(For local models, evaluate current open-weights reasoning models at the time you build —
the field moves monthly; don't pin to a name from a doc.)

## 5. The non-negotiable: the output is a DRAFT, not the truth

A requirements document does not fully contain intent — cardinality, parentage, tool
allowlists, and orchestration order are *decisions*, not facts recoverable from the text.
An LLM asked to produce a model **will** invent some of them (the same way a schema crawler
invents relationships that aren't in the data). So:

- The generated model is a **first cut to refine in the studio**, never a source of truth.
- The provider should **flag low-confidence inferences** (in `notes`) for the human to
  confirm.
- The model becomes correct only when a human **ratifies it in the tool**, where it passes
  the same live validation + id-uniqueness gates as a hand-built model.

The generator proposes; the tool and the human dispose. This is what makes the feature
safe — the output is an editable, validatable artifact, not a silent guess. See
`docs/agentic-ai-modeling-conformance-article.md` for the full "intent is not in the data"
argument this rests on.

## 6. Summary for an adopter

1. Stand up a small backend that holds your model key and exposes `POST /generate-model`
   per §2 (or use a shipped OpenAI-compatible adapter and just set base URL + model).
2. Point Agent Atlas at it. Keep keys server-side; only a local-model desktop call may go
   direct.
3. Pick a strong model for generation; keep sensitive docs on a local model.
4. Treat every generated model as a draft to ratify in the studio.
