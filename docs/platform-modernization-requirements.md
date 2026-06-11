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

## 8.5 Governance, privacy & compliance (→ governance declarations)

These are the governance facts the model must carry to be NIST-AI-RMF-legible
(Govern/Map) and conformance-checkable. Declared here so the generator can fill the
manifest governance fields rather than flag them as gaps.

### Compliance regimes (whole platform)
Causeway as a product must satisfy **SOC 2** and **GDPR**. **HIPAA** applies
conditionally when a customer ingests PHI-bearing legacy systems (BAA required).
**EU AI Act** high-risk provisions apply to the automated mapping and code-generation
decisions. **FedRAMP is out of scope** for the initial release.

### Data classification, residency & retention (systems §8)
- `ir-store` — **confidential**; may contain sampled source values (PII/PHI possible
  depending on customer source); **on-prem**; purged after a conversion run is ratified;
  sampled values **redacted/tokenized** before write.
- `metadata-catalog` — **confidential**; lineage + quality signals; **on-prem**; source
  values **redacted** before indexing; retained 1y.
- `state-store` — **internal**; run/checkpoint state only; **on-prem**.
- `tool-registry` — **internal**; **on-prem**.
- `audit-log` — **regulated**; append-only audit trail; **on-prem**; retained **7y**.
- Source/target systems carry the **customer's** classification; treat as
  **confidential** by default, **regulated** where the customer declares PHI/PII/PCI.

### Per-agent governance (§5)
- Every reasoning agent declares a **grounding/confidence threshold** below which it
  **refuses and escalates** to the `review-router-agent` (HITL). The `validation-agent`
  refuses on failed equivalence (row-count delta beyond tolerance, sample-value mismatch,
  integrity-check failure).
- **Prohibited actions:** no agent may perform write/mutate operations on **source**
  systems (extractors are read-only); no agent may directly deploy/execute generated code
  in a target (codegen only **stages**); no agent may bypass the HITL gate.
- Agents emit telemetry: agent-id, object-id, stage, model-selected, confidence-score,
  duration, refusal-flag, escalation-flag — with source-data values **redacted** before
  indexing.

### Ownership
Each component declares an accountable **role** (not individual): the platform team owns
the orchestrator and shared systems; the data-engineering team owns the agents and jobs.
The `audit-log` is reviewed quarterly by the compliance role.

### Router governance (§6)
Every routing event records the specific model id + version to the `audit-log`. When
processing **confidential or regulated** source artifacts, the router must select a
**locally-hosted** model (no frontier/cloud routing).

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

## Governance — to declare (resolved)

_These were recommended by the governance review and have been filled with concrete
values. They extend §8.5 with the per-agent / quantified detail a conformance check needs._

### Refusal / grounding thresholds _(high)_
Per-agent thresholds: `mapping-agent` refuses and escalates when confidence_score < 0.80;
`codegen-agent` refuses when confidence_score < 0.75; `validation-agent` refuses when
row-count delta > 0.1% OR sample-value mismatch rate > 1% OR any integrity-check failure.
Threshold type: fixed constants for v1. All refusals route to `review-router-agent`
synchronously (immediate).

### Human oversight (HITL SLA & authority) _(high)_
The `review-router-agent` holds a queued object for up to 4 business hours before
re-escalating to the platform-team-lead. Authorized reviewers are the data-engineering
team role. A human reviewer MAY override a `validation-agent` refusal only when the
reviewer attaches a written rationale logged to `audit-log`; overrides are appended to the
`audit-log` as a distinct event type.

### Observability / telemetry schema _(high)_
All agent telemetry is emitted at 100% (no sampling) to the `metadata-catalog` telemetry
partition. Fields containing source-data values (e.g. sample_value, error_message,
construct_text) MUST be SHA-256 hashed before indexing. Telemetry is retained for 90 days
and is subject to the same on-prem residency requirement as `metadata-catalog`. The
canonical redaction-trigger field list is: sample_value, construct_text, error_detail,
source_schema_name.

### Compliance regimes — quantified obligations _(high)_
SOC 2 target is Type II; audit period annual. GDPR data-subject-request (DSR) response
SLA: 30 calendar days. HIPAA BAA is required before any customer run where source systems
are declared PHI-bearing; breach notification window: 60 calendar days (per HITECH).
EU AI Act risk tier for automated mapping and codegen decisions: high-risk (Annex III
candidate); conformity assessment: internal review + technical documentation per Art. 11.

### Security posture _(high)_
All data at rest in `ir-store`, `metadata-catalog`, `state-store`, and `audit-log` is
encrypted with AES-256 using customer-managed keys via KMS. All agent-to-system and
agent-to-agent communication uses TLS 1.3 minimum. Extractor credentials are stored in a
secrets manager (HashiCorp Vault) and rotated every 90 days. Agent workloads run in a
dedicated VPC/VLAN with no egress to public internet except router-policy-approved model
endpoints. Vulnerability scans run weekly; penetration tests annually.

### Explainability / transparency _(medium)_
The `mapping-agent` MUST attach a human-readable rationale string to every mapping
decision stored in `metadata-catalog`, structured as: construct_id, source_construct,
target_construct, confidence_score, rationale_text (max 500 characters), and model_id. The
`review-router-agent` MUST surface this rationale in the HITL review UI. A per-run
explainability summary (aggregate confidence distribution, count of HITL escalations,
model routing breakdown) is exported to `metadata-catalog` and retained for 3 years.

### Accountability / component ownership granularity _(medium)_
Per-component accountable roles: orchestrator → platform-team; discovery-agent,
parsing-agent, mapping-agent, codegen-agent, validation-agent → data-engineering-team;
review-router-agent → data-engineering-team; conversion-model-router → platform-team;
audit-log → compliance-team; metadata-catalog, ir-store, state-store, tool-registry →
platform-team; conversion-batch-runner, extraction-run-tracker, audit-logger jobs →
data-engineering-team. Each owner role reviews component-level telemetry monthly and
attests in the `audit-log` annually.

### Router governance — confidential/regulated routing enforcement _(medium)_
The router determines artifact sensitivity from a `metadata-catalog` classification tag
set by the `discovery-agent`. When the tag is confidential or regulated, the router MUST
select from the approved local model list. If no approved local model is available, the
router hard-stops the task and raises a HITL escalation rather than falling back to a
cloud/frontier model. Every routing decision (model-id, version, sensitivity-tag,
rationale) is appended to `audit-log` within 5 seconds of the routing event.

### ir-store retention precision _(low)_
`ir-store` content for a given run is purged within 24 hours of the run reaching the
ratified state (the `review-router-agent` emits a ratification event to `audit-log`). On
run failure or timeout without ratification, content is purged after 7 days. The purge is
executed by the `audit-logger` job and recorded as a purge-event in `audit-log`.
