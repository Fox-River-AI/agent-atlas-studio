# Platform Modernization (Causeway) — Requirements

**Product:** Fox River AI — **Platform Modernization**, codename **Causeway**.
**Status:** DRAFT for co-authoring (2026-06-10).

This is the canonical spec for the reference platform modeled in Agent Atlas — a
generic, agentic **legacy-to-cloud data-modernization platform**. It replaces the
clinical (CDI) platform as the on-screen demo/seed, because large-scale modernization is
where agent duplication and fleet sprawl are *structural* rather than hypothetical — i.e.
the platform that most obviously needs Agent Atlas.

**This is Fox River AI's own product specification**, describing a generic,
industry-standard modernization architecture in our own words. It references no client,
prime, employer, or any third party's internal initiative, and reproduces no third party's
text. The decomposition here (discover → parse → map → generate → validate → review on a
stateful orchestrator, with an LLM router and metadata/lineage tracking) is the textbook
answer to legacy-to-cloud conversion and is not anyone's proprietary invention.

**Strategic scope:** Causeway is the *demo/reference model* — what we model in Atlas to
show the tool. It is **not** a shift in the business. The clinical platform remains the
conformance/moat/monetization reference (domain rule packs + ontology verifier). Causeway
showcases the mechanism on a universally-felt enterprise problem; it makes Fox River
credible to *every* modernization buyer (the be-found play), not one.

> ⚠️ Public repo. Platform/architecture requirements only. No client/employer/initiative
> names, no third-party text, no GTM or contact strategy.

---

## 1. Purpose

Causeway is an **agentic platform that automates converting legacy data systems and ETL
to modern cloud targets** at enterprise scale — discovering legacy objects, parsing them
to an intermediate representation, mapping constructs to the target, generating
target-native code, validating equivalence, and routing low-confidence results for human
review — built to be **extensible** so new source and target technologies are added
without rebuilding the platform.

Scale target: tens of thousands of legacy objects (50k–80k+) processed with parallel
execution, batching, **resumability, checkpointing, and audit logging** — so a run that
fails at object 40,000 resumes, not restarts.

The hard problems it embodies (why it's the ideal Atlas demo):
- Every source technology needs an **extractor**; every target needs an **emitter** —
  these proliferate, and parallel teams/agents rebuild the same one. A registry tames it.
- **Intent is not in the source.** Cardinality, business keys, FK direction, and the
  target schema are *decisions*, not facts recoverable from legacy values — so mapping is
  a human-ratified step with confidence scoring, not an automated guess. (The platform's
  own version of Agent Atlas's design philosophy.)
- The platform grows: a new legacy ETL tool or a new lakehouse target appears after
  launch, and the architecture absorbs it cleanly through the shared tool registry.

## 2. The conversion pipeline (→ the Orchestrator's TASKS)

A single **orchestrator** (stateful graph: conditional routing, agent handoff, retry/
fallback, interrupt/resume, checkpointing; owns the shared execution context) sequences
six stages, per object or per batch:

1. **Discover** — connect to a legacy source; inventory objects (jobs, schemas, tables,
   views, stored procedures, ETL graphs); capture dependencies. Output: object inventory.
2. **Parse** — parse each legacy object to a normalized **intermediate representation
   (IR/AST)** independent of source and target. Output: IR per object.
3. **Map** — map source constructs to target constructs; resolve the intent-not-in-source
   decisions (cardinality, keys, lineage) with **confidence scoring**, flagging
   low-confidence items for review. *(Uses the model router.)* Output: mapping spec.
4. **Generate** — emit target-native code from the IR + mapping (e.g. cloud-native
   PySpark, target-dialect SQL/DDL). Output: generated target code.
5. **Validate** — check semantic equivalence (logical-plan/row-count/sample-value/
   integrity checks) between source behavior and generated target. Refuse to pass on
   failed equivalence. *(Gate.)* Output: validation result + quality signals.
6. **Review** — route low-confidence or failed-validation objects to **human review**
   (HITL); accept, correct, or send back. Output: ratified conversion + review record.

## 3. Sources (→ System objects + extractor Tools)  ⟵ FINALIZE
Each source = a **System** + a read-effect **extractor Tool** (auth scope).
*Strawman — edit to the exact set:*
- **Legacy ETL / integration:** enterprise ETL tools (graph-based + SQL-based engines),
  legacy SOA/SOAP services, flat-file/EDI, mainframe extracts.
- **Relational legacy:** Oracle, MS SQL Server, MySQL, DB2.
- **Other:** document stores, message streams.
- *(Model a representative ~6–8 to hit the rich ~30–40 object target while staying legible.)*

## 4. Targets (→ System objects + emitter Tools)  ⟵ FINALIZE
Each target = a **System** + a write-effect **emitter Tool**. Families (your picks: AWS,
Azure/GCP, Lakehouse):
- **AWS:** S3 / data lake, Redshift, Aurora PostgreSQL
- **Azure / GCP:** Azure Synapse / SQL, BigQuery
- **Lakehouse:** Snowflake (SQL/DDL, Snowpark), Databricks (PySpark, Delta, Unity Catalog),
  Apache Iceberg / modern table formats
- *(Strawman models Databricks + Snowflake + BigQuery + Aurora to show multi-cloud +
  lakehouse without bloat.)*

## 5. Agents (→ Agent objects, single-responsibility)
Six core agents over the shared context, one per pipeline stage:
- `discovery-agent` — inventory legacy objects + dependencies
- `parsing-agent` — legacy object → IR/AST
- `mapping-agent` — source→target construct mapping + confidence scoring (uses the ROUTER)
- `codegen-agent` — IR + mapping → target-native code
- `validation-agent` — semantic-equivalence checking
- `review-router-agent` — route low-confidence/failed items to human review (HITL gate)

## 6. Router (→ Router object)
`conversion-model-router` — dynamic LLM selection for the reasoning-heavy agents
(mapping, codegen):
- **Simple / high-confidence constructs** → smaller, faster, cheaper model.
- **Ambiguous / complex / large constructs** → larger, stronger model.
- Policy: route on construct complexity, required output quality, latency, and cost.
  Candidates: a small fast model + a strong model + a pinned fallback. (This is also the
  pattern Fox River uses for the Requirements→Model generator itself — see §11.)

## 7. Jobs (→ Job objects, async/long-running)
- `conversion-batch-runner` — parallel, batched, **resumable, checkpointed** execution
  across the 50–80k objects (queue/timeout/retries). Orchestrator-dispatched → under a task.
- `extraction-run-tracker` — records each extraction run for traceability.
- `audit-logger` — append-only audit of model selection, hops, decisions, outcomes.

## 8. Shared systems (→ System objects)
- `metadata-catalog` — extraction runs, **dependency graphs, column-level lineage**,
  confidence/quality signals (the traceability backbone).
- `ir-store` — parsed intermediate representations.
- `state-store` — run state / checkpoints (resumability).
- `tool-registry` — the shared MCP tool registry (extractors/emitters/parsers) — the
  thing that prevents "the same extractor built twice."
- `audit-log` — retained audit trail.

## 9. Subject Areas (saved demo views)  ⟵ confirm
- **Discovery & Parsing** (Discover + Parse tasks, extractors, ir-store, metadata-catalog)
- **Mapping & Codegen** (Map + Generate, mapping/codegen agents, router, tool-registry)
- **Validation & Review** (Validate + Review, validation agent, review router, HITL, audit)

## 10. Open requirements decisions
- Exact source list (§3) and target list (§4).
- Object-count target: confirmed **rich (~30–40)**.
- An explicit extensibility object (e.g. a `connector-interface` pattern) to make
  "add a source/target without rebuilding" visible in the model?
- Optional "before" variant with deliberate duplicate extractors, for the
  Platform-A-vs-B contrast story, alongside the clean validated seed.

## 11. Note: this platform is also the test fixture for Requirements→Model (DIAG-37)
This requirements doc is the first fixture for the Atlas "System Requirements" front door
(DIAG-37): import/type a requirements doc → the backend proposes a first-cut model → human
refines it in the studio. The generator's own model selection is a Router decision
(dogfooding §6): a heavier model for the architecture-reasoning task, a lighter one for
narrower tasks — interchangeable via router policy. Because modernization docs carry no
sensitive data, the generator may use a frontier/cloud model; sensitive-domain conformance
stays on local inference. The generated model is a **draft to ratify in the tool**, never a
source of truth (intent isn't fully in the doc).

## 12. Mapping to Atlas object kinds (summary)
| Requirement | Atlas object |
|---|---|
| The modernization platform | **Orchestrator** (stateful graph / conditional routing) |
| Each pipeline stage (§2) | **Task** |
| Each worker (§5) | **Agent** |
| Extractors / emitters / parser / lineage / equivalence-checker | **MCP Tool** |
| Batch runner / run-tracker / audit-logger (§7) | **Job** |
| mapping/codegen model selection (§6) | **Router** |
| Sources, targets, catalog/IR/state/registry/audit (§3,4,8) | **System** |
