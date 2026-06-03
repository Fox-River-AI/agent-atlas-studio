// A rich, fully-valid demonstration model: the Noesis Health clinical
// documentation-integrity (CDI) platform, governed by a single Orchestrator.
//
// Flow: Gateway ingests from multiple sources (an interface engine like
// Mirth/Rhapsody for HL7v2 + FHIR + flat files) → extract clinical concepts →
// ground in SNOMED/ICD → apply CDI rules → score DRG/HAC impact → draft a
// compliant query → human review. A single Orchestrator owns the control flow;
// Systems (interface engine, EHR FHIR, Neo4j ontology, pgvector RAG, Postgres,
// rules/DRG stores, run-state) sit at task level, shared across agents.
//
// Every required field is filled so the model validates clean (✓ registry
// valid) for a presentable screenshot.

const M = (provider, name, pinned) => ({ provider, name, pinned });
const HAIKU = M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001');
const OPUS = M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8');

const orchestrator = (id, parent, description, controlFlow, stateStore) => ({
  id, kind: 'orchestrator', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, controlFlow, stateStore },
});
const task = (id, parent, label, description) => ({ id, kind: 'task', parent, data: { id, label, description } });
const agent = (id, parent, responsibility, model, tele) => ({
  id, kind: 'agent', parent,
  data: { id, owner: 'cdi-platform', version: '1.0.0', responsibility, model: { ...model }, refusalConditions: ['Required clinical inputs are missing or ungrounded.'], refusalEmits: 'refused', telemetry: [{ name: tele, attributes: ['status', 'confidence', 'duration_ms'] }] },
});
const tool = (id, parent, description, effect, scope) => ({ id, kind: 'tool', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, effect, authScope: scope } });
const job = (id, parent, description, queue) => ({ id, kind: 'job', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, queue, trigger: '', timeoutSeconds: 1800, retries: 2 } });
const system = (id, parent, description, systemKind, connection, scope) => ({ id, kind: 'system', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, systemKind, connection, authScope: scope } });

const objList = [
  // ════ THE ORCHESTRATOR — the control plane (root of the model) ════
  orchestrator('cdi-orchestrator', null, 'Owns the CDI control flow: decides which task/agent runs, in what order, on what condition, and externalizes run state.', 'state-machine', 'run-state'),

  // ── Task 0: Gateway / Ingestion ──
  task('gateway-ingest', 'cdi-orchestrator', 'Gateway: Ingest & Normalize', 'Pull data from EHRs and source systems via the interface engine; normalize HL7v2/FHIR/flat-file to FHIR R4.'),
  system('interface-engine', 'gateway-ingest', 'Interface engine (Mirth/Rhapsody): routes & transforms inbound messages.', 'external-api', 'mllp://mirth:6661', 'iface:rw'),
  system('ehr-fhir', 'gateway-ingest', 'Downstream EHR FHIR R4 API (21st Century Cures).', 'fhir', 'https://ehr/fhir/r4', 'fhir:read'),
  system('hl7-feed', 'gateway-ingest', 'HL7 v2 ADT/ORU feed from ancillary systems.', 'external-api', 'mllp://hl7-src:2575', 'hl7:read'),
  system('flatfile-drop', 'gateway-ingest', 'SFTP drop for batch flat-file extracts.', 'document-store', 'sftp://drop/inbound', 'file:read'),
  system('patient-store', 'gateway-ingest', 'Patient master + FHIR resources (PostgreSQL).', 'relational-db', 'postgres://axiom:5433/noesis', 'db:rw'),
  agent('ingest-router-agent', 'gateway-ingest', 'Receive inbound messages from the interface engine and route by message type.', HAIKU, 'agent.gateway.route'),
  tool('mllp-listen', 'ingest-router-agent', 'Listen for MLLP messages from the interface engine.', 'external', 'iface:read'),
  tool('source-classify', 'ingest-router-agent', 'Classify inbound payload (HL7v2 / FHIR / flat file).', 'read', 'iface:read'),
  agent('normalize-agent', 'gateway-ingest', 'Normalize HL7v2 and flat-file payloads into FHIR R4 resources.', OPUS, 'agent.gateway.normalize'),
  tool('hl7-to-fhir', 'normalize-agent', 'Map HL7 v2 segments to FHIR R4 resources.', 'write', 'fhir:write'),
  tool('flatfile-parse', 'normalize-agent', 'Parse and map flat-file extracts to FHIR.', 'write', 'fhir:write'),
  tool('identity-resolve', 'normalize-agent', 'Match incoming resources to the patient master.', 'write', 'db:write'),
  job('bulk-ingest', 'gateway-ingest', 'Bulk-load a historical batch through the pipeline (long-running).', 'ingestion'),

  // ── Task 1: Extract clinical concepts ──
  task('extract-concepts', 'cdi-orchestrator', 'Extract Clinical Concepts', 'Extract candidate diagnoses/conditions from clinical notes.'),
  agent('concept-extractor', 'extract-concepts', 'Extract clinical concepts from notes, honoring negation and history.', OPUS, 'agent.concept.extract'),
  tool('note-reader', 'concept-extractor', 'Read DocumentReference note text for an encounter.', 'read', 'db:read'),
  tool('negation-scan', 'concept-extractor', 'Flag negated / historical mentions (NegEx-style).', 'read', 'nlp:read'),
  tool('section-split', 'concept-extractor', 'Split notes into clinical sections (HPI, A&P, etc.).', 'read', 'nlp:read'),
  job('reanalyze-corpus', 'extract-concepts', 'Re-analyze the note corpus when the extractor changes.', 'reanalysis'),

  // ── Task 2: Ground in ontology (SNOMED / ICD) ──
  task('ground-ontology', 'cdi-orchestrator', 'Ground in Ontology', 'Map extracted concepts to SNOMED CT and ICD-10 with evidence.'),
  system('snomed-graph', 'ground-ontology', 'Neo4j ontology store: SNOMED concepts, relationships, ICD-10 maps.', 'graph-db', 'bolt://axiom:7687', 'graph:read'),
  system('rag-store', 'ground-ontology', 'pgvector embeddings for clinical-guideline retrieval.', 'vector-store', 'postgres://axiom:5433/noesis', 'rag:read'),
  agent('ontology-mapper', 'ground-ontology', 'Map each concept to a SNOMED code and its ICD-10 equivalent, with an evidence chain.', OPUS, 'agent.ontology.map'),
  tool('snomed-search', 'ontology-mapper', 'Search SNOMED concepts (MCP: search/detail/descendants/ancestors).', 'read', 'graph:read'),
  tool('icd-map', 'ontology-mapper', 'Resolve the SNOMED → ICD-10 mapping.', 'read', 'graph:read'),
  tool('guideline-retrieve', 'ontology-mapper', 'Retrieve grounding guidelines from the RAG store.', 'read', 'rag:read'),
  {
    id: 'grounding-router', kind: 'router', parent: 'ontology-mapper',
    data: {
      id: 'grounding-router', owner: 'cdi-platform', version: '1.0.0',
      description: 'Route ontology grounding to a model by case complexity, quality, and cost.',
      candidates: [M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8'), M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001')],
      optimizeFor: ['quality', 'cost'],
      rules: [{ when: 'concept_ambiguity == high', select: 'claude-opus-4-8' }, { when: 'routine_mapping', select: 'claude-haiku-4-5' }],
      fallback: 'claude-opus-4-8',
    },
  },

  // ── Task 3: Apply CDI rules ──
  task('apply-rules', 'cdi-orchestrator', 'Apply CDI Rules', 'Run the specificity/coverage rules to find documentation gaps.'),
  system('rules-store', 'apply-rules', 'CDI rules (Layer 1 base + Layer 3 hospital overrides) in PostgreSQL.', 'relational-db', 'postgres://axiom:5433/noesis', 'db:read'),
  agent('rules-engine', 'apply-rules', 'Evaluate CDI specificity rules against the grounded concepts.', HAIKU, 'agent.rules.evaluate'),
  tool('rules-lookup', 'rules-engine', 'Find CDI rules by condition / SNOMED code (MCP rules tools).', 'read', 'db:read'),
  tool('gap-detect', 'rules-engine', 'Detect specificity/coverage gaps and missing attributes.', 'read', 'db:read'),
  tool('coverage-score', 'rules-engine', 'Score documentation coverage per condition.', 'read', 'db:read'),

  // ── Task 4: Score financial & safety impact ──
  task('score-impact', 'cdi-orchestrator', 'Score DRG / HAC Impact', 'Compute the DRG/CMI and HAC/POA implications of each gap.'),
  system('drg-data', 'score-impact', 'CMS DRG grouper data + CC/MCC tables (PostgreSQL).', 'relational-db', 'postgres://axiom:5433/noesis', 'db:read'),
  agent('impact-scorer', 'score-impact', 'Compute DRG/CMI shift and HAC/POA risk for each documentation gap.', OPUS, 'agent.impact.score'),
  tool('drg-group', 'impact-scorer', 'Group to a DRG and compute CC/MCC severity impact.', 'read', 'db:read'),
  tool('hac-check', 'impact-scorer', 'Check HAC list + POA implications.', 'read', 'db:read'),
  tool('cmi-calc', 'impact-scorer', 'Compute the case-mix-index delta.', 'read', 'db:read'),

  // ── Task 5: Draft compliant query & human review ──
  task('query-review', 'cdi-orchestrator', 'Draft Query & Human Review', 'Draft a compliant CDI query and gate on human approval.'),
  system('run-state', 'review-gate', 'Run/step state store for resumable, auditable CDI runs.', 'state-store', 'postgres://axiom:5433/migration_state', 'state:rw'),
  agent('query-drafter', 'query-review', 'Draft an ACDIS-compliant, non-leading CDI query with the evidence chain.', OPUS, 'agent.query.draft'),
  tool('template-fill', 'query-drafter', 'Fill the compliant query template (non-leading, multiple-choice).', 'read', 'tmpl:read'),
  tool('compliance-check', 'query-drafter', 'Verify the draft against ACDIS query-compliance rules.', 'read', 'rules:read'),
  agent('review-gate', 'query-review', 'Present the query + evidence to a CDI specialist and record the disposition.', HAIKU, 'agent.review.disposition'),
  tool('hitl-present', 'review-gate', 'Present the suggestion for human approval (HITL gate).', 'external', 'ui:write'),
  tool('feedback-record', 'review-gate', 'Record the reviewer decision + reason code (the learning loop).', 'write', 'db:write'),
];

export const SEED_OBJECTS = Object.fromEntries(objList.map((o) => [o.id, o]));

const E = (source, target) => ({ id: `e-${source}-${target}`, source, target });
export const SEED_EDGES = [
  // gateway
  E('ingest-router-agent', 'mllp-listen'), E('ingest-router-agent', 'source-classify'),
  E('ingest-router-agent', 'interface-engine'), E('ingest-router-agent', 'hl7-feed'),
  E('normalize-agent', 'hl7-to-fhir'), E('normalize-agent', 'flatfile-parse'), E('normalize-agent', 'identity-resolve'),
  E('normalize-agent', 'ehr-fhir'), E('normalize-agent', 'flatfile-drop'), E('normalize-agent', 'patient-store'),
  // extract
  E('concept-extractor', 'note-reader'), E('concept-extractor', 'negation-scan'), E('concept-extractor', 'section-split'),
  E('concept-extractor', 'patient-store'),
  // ground
  E('ontology-mapper', 'snomed-search'), E('ontology-mapper', 'icd-map'), E('ontology-mapper', 'guideline-retrieve'),
  E('ontology-mapper', 'snomed-graph'), E('ontology-mapper', 'rag-store'), E('ontology-mapper', 'grounding-router'),
  // rules
  E('rules-engine', 'rules-lookup'), E('rules-engine', 'gap-detect'), E('rules-engine', 'coverage-score'), E('rules-engine', 'rules-store'),
  // impact
  E('impact-scorer', 'drg-group'), E('impact-scorer', 'hac-check'), E('impact-scorer', 'cmi-calc'), E('impact-scorer', 'drg-data'),
  // query + review
  E('query-drafter', 'template-fill'), E('query-drafter', 'compliance-check'), E('query-drafter', 'rag-store'),
  E('review-gate', 'hitl-present'), E('review-gate', 'feedback-record'), E('review-gate', 'run-state'),
];

// Orchestrator + all tasks expanded; a few agents expanded so depth shows and
// the tree scrolls — the presentable "whole platform" view.
export const SEED_EXPANDED = {
  'cdi-orchestrator': true,
  'gateway-ingest': true, 'extract-concepts': true, 'ground-ontology': true,
  'apply-rules': true, 'score-impact': true, 'query-review': true,
  'ingest-router-agent': true, 'normalize-agent': true, 'ontology-mapper': true, 'review-gate': true,
};

// Subject Areas that TAME the complexity — focus the whole platform to one slice.
export const SEED_SUBJECT_AREAS = [
  { id: 'sa-gateway', name: 'Gateway & Ingestion', taskIds: ['gateway-ingest'] },
  { id: 'sa-grounding', name: 'Ontology Grounding (SNOMED/ICD)', taskIds: ['extract-concepts', 'ground-ontology'] },
  { id: 'sa-financial', name: 'Financial & Safety Impact', taskIds: ['apply-rules', 'score-impact'] },
];
