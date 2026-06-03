// A rich, fully-valid demonstration model: the Noesis Health clinical
// documentation-integrity (CDI) pipeline. It consumes FHIR, grounds clinical
// concepts in SNOMED/ICD, runs CDI rules, computes DRG/HAC financial impact,
// drafts a compliant query, and gates on human review — a real, governed agent
// fleet sharing on-prem infrastructure (Neo4j ontology, pgvector RAG, Postgres,
// the FHIR endpoint). Every required field is filled so the model validates
// cleanly (✓ registry valid) for a presentable screenshot.
//
// Systems sit at TASK level (shared infrastructure) and agents connect to them
// via edges, so "what touches Neo4j?" is answerable at a glance.

const M = (provider, name, pinned) => ({ provider, name, pinned });
const HAIKU = M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001');
const OPUS = M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8');

const task = (id, label, description) => ({ id, kind: 'task', parent: null, data: { id, label, description } });
const agent = (id, parent, responsibility, model, tele) => ({
  id, kind: 'agent', parent,
  data: { id, owner: 'cdi-platform', version: '1.0.0', responsibility, model: { ...model }, refusalConditions: ['Required clinical inputs are missing or ungrounded.'], refusalEmits: 'refused', telemetry: [{ name: tele, attributes: ['status', 'confidence', 'duration_ms'] }] },
});
const tool = (id, parent, description, effect, scope) => ({ id, kind: 'tool', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, effect, authScope: scope } });
const job = (id, parent, description, queue) => ({ id, kind: 'job', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, queue, trigger: '', timeoutSeconds: 1800, retries: 2 } });
const system = (id, parent, description, systemKind, connection, scope) => ({ id, kind: 'system', parent, data: { id, owner: 'cdi-platform', version: '1.0.0', description, systemKind, connection, authScope: scope } });

const objList = [
  // ── Task 1: Ingest FHIR ──
  task('ingest-fhir', 'Ingest FHIR', 'Consume FHIR R4 from the EHR and resolve patient identity.'),
  system('ehr-fhir', 'ingest-fhir', 'Downstream EHR FHIR R4 API (21st Century Cures).', 'fhir', 'https://ehr/fhir/r4', 'fhir:read'),
  system('patient-store', 'ingest-fhir', 'Patient master + resources (PostgreSQL).', 'relational-db', 'postgres://axiom:5433/noesis', 'db:rw'),
  agent('fhir-consumer', 'ingest-fhir', 'Pull FHIR resources for an encounter and resolve patient identity.', HAIKU, 'agent.fhir.ingest'),
  tool('fhir-fetch', 'fhir-consumer', 'Fetch FHIR resources (Patient, Encounter, Condition, DocumentReference).', 'external', 'fhir:read'),
  tool('identity-resolve', 'fhir-consumer', 'Match incoming resources to the patient master.', 'write', 'db:write'),

  // ── Task 2: Extract clinical concepts ──
  task('extract-concepts', 'Extract Clinical Concepts', 'Extract candidate diagnoses/conditions from clinical notes.'),
  agent('concept-extractor', 'extract-concepts', 'Extract clinical concepts from notes, honoring negation and history.', OPUS, 'agent.concept.extract'),
  tool('note-reader', 'concept-extractor', 'Read DocumentReference note text for an encounter.', 'read', 'db:read'),
  tool('negation-scan', 'concept-extractor', 'Flag negated / historical mentions (NegEx-style).', 'read', 'nlp:read'),
  job('reanalyze-corpus', 'extract-concepts', 'Re-analyze the note corpus when the extractor changes.', 'reanalysis'),

  // ── Task 3: Ground in ontology (SNOMED / ICD) ──
  task('ground-ontology', 'Ground in Ontology', 'Map extracted concepts to SNOMED CT and ICD-10 with evidence.'),
  system('snomed-graph', 'ground-ontology', 'Neo4j ontology store: SNOMED concepts, relationships, ICD-10 maps.', 'graph-db', 'bolt://axiom:7687', 'graph:read'),
  system('rag-store', 'ground-ontology', 'pgvector embeddings for clinical-guideline retrieval.', 'vector-store', 'postgres://axiom:5433/noesis', 'rag:read'),
  agent('ontology-mapper', 'ground-ontology', 'Map each concept to a SNOMED code and its ICD-10 equivalent, with an evidence chain.', OPUS, 'agent.ontology.map'),
  tool('snomed-search', 'ontology-mapper', 'Search SNOMED concepts (MCP: search/detail/descendants/ancestors).', 'read', 'graph:read'),
  tool('icd-map', 'ontology-mapper', 'Resolve the SNOMED → ICD-10 mapping.', 'read', 'graph:read'),
  tool('guideline-retrieve', 'ontology-mapper', 'Retrieve grounding guidelines from the RAG store.', 'read', 'rag:read'),
  // ontology-mapper dynamically routes its model by case complexity
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

  // ── Task 4: Apply CDI rules ──
  task('apply-rules', 'Apply CDI Rules', 'Run the specificity/coverage rules to find documentation gaps.'),
  system('rules-store', 'apply-rules', 'CDI rules (Layer 1 base + Layer 3 hospital overrides) in PostgreSQL.', 'relational-db', 'postgres://axiom:5433/noesis', 'db:read'),
  agent('rules-engine', 'apply-rules', 'Evaluate CDI specificity rules against the grounded concepts.', HAIKU, 'agent.rules.evaluate'),
  tool('rules-lookup', 'rules-engine', 'Find CDI rules by condition / SNOMED code (MCP rules tools).', 'read', 'db:read'),
  tool('gap-detect', 'rules-engine', 'Detect specificity/coverage gaps and missing attributes.', 'read', 'db:read'),

  // ── Task 5: Score financial & safety impact ──
  task('score-impact', 'Score DRG / HAC Impact', 'Compute the DRG/CMI and HAC/POA implications of each gap.'),
  system('drg-data', 'score-impact', 'CMS DRG grouper data + CC/MCC tables (PostgreSQL).', 'relational-db', 'postgres://axiom:5433/noesis', 'db:read'),
  agent('impact-scorer', 'score-impact', 'Compute DRG/CMI shift and HAC/POA risk for each documentation gap.', OPUS, 'agent.impact.score'),
  tool('drg-group', 'impact-scorer', 'Group to a DRG and compute CC/MCC severity impact.', 'read', 'db:read'),
  tool('hac-check', 'impact-scorer', 'Check HAC list + POA implications.', 'read', 'db:read'),

  // ── Task 6: Draft compliant query & review ──
  task('query-review', 'Draft Query & Human Review', 'Draft a compliant CDI query and gate on human approval.'),
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
  // ingest
  E('fhir-consumer', 'fhir-fetch'), E('fhir-consumer', 'identity-resolve'),
  E('fhir-consumer', 'ehr-fhir'), E('fhir-consumer', 'patient-store'),
  // extract
  E('concept-extractor', 'note-reader'), E('concept-extractor', 'negation-scan'),
  E('concept-extractor', 'patient-store'), E('concept-extractor', 'reanalyze-corpus'),
  // ground
  E('ontology-mapper', 'snomed-search'), E('ontology-mapper', 'icd-map'), E('ontology-mapper', 'guideline-retrieve'),
  E('ontology-mapper', 'snomed-graph'), E('ontology-mapper', 'rag-store'), E('ontology-mapper', 'grounding-router'),
  // rules
  E('rules-engine', 'rules-lookup'), E('rules-engine', 'gap-detect'), E('rules-engine', 'rules-store'),
  // impact
  E('impact-scorer', 'drg-group'), E('impact-scorer', 'hac-check'), E('impact-scorer', 'drg-data'),
  // query + review
  E('query-drafter', 'template-fill'), E('query-drafter', 'compliance-check'), E('query-drafter', 'rag-store'),
  E('review-gate', 'hitl-present'), E('review-gate', 'feedback-record'), E('review-gate', 'patient-store'),
];

// Tasks + Systems visible; expand a couple of agents so the depth shows and the
// tree scrolls — the presentable "whole platform" view.
export const SEED_EXPANDED = {
  'ingest-fhir': true, 'extract-concepts': true, 'ground-ontology': true,
  'apply-rules': true, 'score-impact': true, 'query-review': true,
  'fhir-consumer': true, 'ontology-mapper': true, 'review-gate': true,
};

// Subject Area that TAMES the complexity: focus only the ontology-grounding
// slice — the moat. Shows how you zoom from the whole platform to one concern.
export const SEED_SUBJECT_AREAS = [
  { id: 'sa-grounding', name: 'Ontology Grounding (SNOMED/ICD)', taskIds: ['extract-concepts', 'ground-ontology'] },
  { id: 'sa-financial', name: 'Financial & Safety Impact', taskIds: ['apply-rules', 'score-impact'] },
];
