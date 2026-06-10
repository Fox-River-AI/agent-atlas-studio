// A rich, fully-valid demonstration model: "Platform Modernization" (codename
// Causeway) — a generic, agentic legacy-to-cloud data-modernization platform,
// governed by a single Orchestrator. This is the on-screen DEMO/reference model
// for Agent Atlas (see docs/platform-modernization-requirements.md).
//
// Flow: Discover legacy objects → Parse to an intermediate representation →
// Map source→target constructs (with a model router) → Generate target-native
// code → Validate equivalence → route low-confidence results for human Review.
// A single Orchestrator owns the stateful control flow; Systems (legacy sources,
// cloud targets, metadata catalog, IR store, state store, shared tool registry,
// audit log) sit at task level, shared across agents. Jobs run the 50–80k-object
// batch conversion with checkpointing/resumability.
//
// Every required field is filled so the model validates clean (✓ registry valid)
// for a presentable screenshot. Generic by design — references no client,
// employer, or third-party initiative.

const M = (provider, name, pinned) => ({ provider, name, pinned });
const HAIKU = M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001');
const OPUS = M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8');

const OWNER = 'modernization-platform';
const orchestrator = (id, parent, description, controlFlow, stateStore) => ({
  id, kind: 'orchestrator', parent, data: { id, owner: OWNER, version: '1.0.0', description, controlFlow, stateStore },
});
const task = (id, parent, label, description) => ({ id, kind: 'task', parent, data: { id, label, description } });
const agent = (id, parent, responsibility, model, tele) => ({
  id, kind: 'agent', parent,
  data: { id, owner: OWNER, version: '1.0.0', responsibility, model: { ...model }, refusalConditions: ['Required source metadata is missing, or the conversion confidence is below threshold.'], refusalEmits: 'needs-review', telemetry: [{ name: tele, attributes: ['status', 'confidence', 'duration_ms'] }] },
});
const tool = (id, parent, description, effect, scope) => ({ id, kind: 'tool', parent, data: { id, owner: OWNER, version: '1.0.0', description, effect, authScope: scope } });
const job = (id, parent, description, queue) => ({ id, kind: 'job', parent, data: { id, owner: OWNER, version: '1.0.0', description, queue, trigger: '', timeoutSeconds: 3600, retries: 3 } });
const system = (id, parent, description, systemKind, connection, scope) => ({ id, kind: 'system', parent, data: { id, owner: OWNER, version: '1.0.0', description, systemKind, connection, authScope: scope } });

const objList = [
  // ════ THE ORCHESTRATOR — the control plane (root of the model) ════
  orchestrator('modernization-orchestrator', null, 'Owns the conversion control flow: stateful graph that sequences discover→parse→map→generate→validate→review per object/batch, with conditional routing, handoff, retry/fallback, and interrupt/resume over a shared execution context.', 'state-machine', 'state-store'),

  // ── Task 1: Discover ──
  task('discover', 'modernization-orchestrator', 'Discover', 'Connect to legacy sources; inventory objects (ETL jobs, schemas, tables, views, procedures) and capture dependencies.'),
  system('src-oracle', 'discover', 'Legacy Oracle database (schemas, tables, PL/SQL procedures).', 'relational-db', 'jdbc:oracle:thin:@legacy-ora:1521/PROD', 'src:read'),
  system('src-mssql', 'discover', 'Legacy Microsoft SQL Server (databases, stored procedures, views).', 'relational-db', 'jdbc:sqlserver://legacy-mssql:1433', 'src:read'),
  system('src-db2', 'discover', 'Legacy IBM DB2 instance (on IBM server).', 'relational-db', 'jdbc:db2://legacy-db2:50000/PROD', 'src:read'),
  system('src-etl-graph', 'discover', 'Graph-based legacy ETL engine (job/stage/link metadata export).', 'external-api', 'https://legacy-etl/api', 'src:read'),
  system('src-etl-sql', 'discover', 'SQL-engine legacy ETL / data-virtualization layer (view & query definitions).', 'external-api', 'https://legacy-dv/api', 'src:read'),
  system('src-soa', 'discover', 'Legacy SOAP/SOA services exposing data operations.', 'external-api', 'https://legacy-soa/services?wsdl', 'src:read'),
  system('src-flatfile', 'discover', 'Flat-file / EDI extract drop (SFTP).', 'document-store', 'sftp://legacy-drop/inbound', 'file:read'),
  agent('discovery-agent', 'discover', 'Inventory legacy objects across sources and capture their dependency graph.', HAIKU, 'agent.discover.inventory'),
  tool('source-connect', 'discovery-agent', 'Connect to a legacy source and enumerate its objects.', 'read', 'src:read'),
  tool('dependency-map', 'discovery-agent', 'Build the cross-object dependency graph.', 'read', 'meta:write'),
  tool('object-catalog-write', 'discovery-agent', 'Write the discovered object inventory to the metadata catalog.', 'write', 'meta:write'),
  job('extraction-run-tracker', 'discover', 'Track each extraction run for traceability across 50–80k+ objects.', 'discovery'),

  // ── Task 2: Parse ──
  task('parse', 'modernization-orchestrator', 'Parse', 'Parse each legacy object into a normalized intermediate representation (IR/AST), independent of source and target.'),
  system('ir-store', 'parse', 'Intermediate-representation store for parsed legacy objects.', 'document-store', 's3://modernization/ir', 'ir:rw'),
  agent('parsing-agent', 'parse', 'Parse a legacy object (SQL, ETL graph, or service definition) into the canonical IR/AST.', OPUS, 'agent.parse.toIR'),
  tool('sql-parser', 'parsing-agent', 'Parse legacy SQL / PL-SQL / T-SQL into the IR.', 'read', 'ir:write'),
  tool('etl-parser', 'parsing-agent', 'Parse legacy ETL job/stage definitions into the IR.', 'read', 'ir:write'),
  tool('ir-write', 'parsing-agent', 'Persist the parsed IR for an object.', 'write', 'ir:write'),

  // ── Task 3: Map ──
  task('map', 'modernization-orchestrator', 'Map', 'Map source constructs to target constructs; resolve intent decisions (cardinality, keys, lineage) with confidence scoring; flag low-confidence for review.'),
  system('metadata-catalog', 'map', 'Metadata catalog: extraction runs, dependency graphs, column-level lineage, confidence/quality signals.', 'relational-db', 'postgres://modernization:5432/catalog', 'meta:rw'),
  system('tool-registry', 'map', 'Shared MCP tool registry — extractors/emitters/parsers reused across the fleet (prevents the same connector being built twice).', 'external-api', 'https://modernization/tool-registry', 'registry:read'),
  agent('mapping-agent', 'map', 'Map each source construct to its target construct and score the mapping confidence.', OPUS, 'agent.map.constructs'),
  tool('construct-map', 'mapping-agent', 'Propose source→target construct mappings from the IR.', 'read', 'meta:read'),
  tool('lineage-trace', 'mapping-agent', 'Trace column-level lineage and record it to the catalog.', 'write', 'meta:write'),
  tool('confidence-score', 'mapping-agent', 'Score mapping confidence; flag low-confidence items for review.', 'read', 'meta:read'),
  {
    id: 'conversion-model-router', kind: 'router', parent: 'mapping-agent',
    data: {
      id: 'conversion-model-router', owner: OWNER, version: '1.0.0',
      description: 'Select the LLM for mapping/codegen by construct complexity, required quality, latency, and cost.',
      candidates: [M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8'), M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001')],
      optimizeFor: ['quality', 'cost'],
      rules: [{ when: 'construct_complexity == high', select: 'claude-opus-4-8' }, { when: 'simple_1to1_mapping', select: 'claude-haiku-4-5' }],
      fallback: 'claude-opus-4-8',
    },
  },

  // ── Task 4: Generate ──
  task('generate', 'modernization-orchestrator', 'Generate', 'Emit target-native code (PySpark, target-dialect SQL/DDL) from the IR + mapping, for the selected cloud targets.'),
  system('tgt-databricks', 'generate', 'Target: Databricks (PySpark, Delta Lake, Unity Catalog).', 'external-api', 'https://target-databricks/api/2.0', 'tgt:write'),
  system('tgt-snowflake', 'generate', 'Target: Snowflake (SQL/DDL, Snowpark).', 'relational-db', 'snowflake://target-sf/account', 'tgt:write'),
  system('tgt-bigquery', 'generate', 'Target: Google BigQuery.', 'relational-db', 'bigquery://target-gcp/dataset', 'tgt:write'),
  system('tgt-aurora', 'generate', 'Target: AWS Aurora PostgreSQL.', 'relational-db', 'postgres://target-aurora:5432/app', 'tgt:write'),
  system('tgt-s3-lake', 'generate', 'Target: AWS S3 data lake (Iceberg/Parquet).', 'document-store', 's3://target-lake', 'tgt:write'),
  agent('codegen-agent', 'generate', 'Generate target-native code from the IR and the ratified mapping for the selected target.', OPUS, 'agent.generate.code'),
  tool('emit-pyspark', 'codegen-agent', 'Emit PySpark/Delta code for the Databricks/lakehouse target.', 'write', 'tgt:write'),
  tool('emit-sql', 'codegen-agent', 'Emit target-dialect SQL/DDL (Snowflake, BigQuery, Aurora).', 'write', 'tgt:write'),
  tool('emit-ddl', 'codegen-agent', 'Generate target schema DDL from the mapping.', 'write', 'tgt:write'),
  job('conversion-batch-runner', 'generate', 'Parallel, batched, resumable, checkpointed conversion across 50–80k+ objects.', 'conversion'),

  // ── Task 5: Validate ──
  task('validate', 'modernization-orchestrator', 'Validate', 'Check semantic equivalence between source behavior and generated target (logical-plan / row-count / sample-value / integrity); refuse to pass on failure.'),
  agent('validation-agent', 'validate', 'Verify semantic equivalence of generated target code against the source, and emit quality signals.', OPUS, 'agent.validate.equivalence'),
  tool('equivalence-check', 'validation-agent', 'Compare source vs generated-target logical behavior.', 'read', 'tgt:read'),
  tool('rowcount-reconcile', 'validation-agent', 'Reconcile row counts and sampled values source↔target.', 'read', 'tgt:read'),
  tool('integrity-check', 'validation-agent', 'Verify constraints / referential integrity on the target.', 'read', 'tgt:read'),
  tool('quality-signal-write', 'validation-agent', 'Record validation quality signals to the catalog.', 'write', 'meta:write'),

  // ── Task 6: Review (HITL) ──
  task('review', 'modernization-orchestrator', 'Review', 'Route low-confidence or failed-validation objects to a human; accept, correct, or send back. Externalize state for resumability + audit.'),
  system('state-store', 'review', 'Run/step state + checkpoints for resumable, auditable conversion runs.', 'state-store', 'redis://modernization-state:6379', 'state:rw'),
  system('audit-log', 'review', 'Append-only audit trail: model selection, hops, decisions, outcomes.', 'document-store', 's3://modernization/audit', 'audit:write'),
  agent('review-router-agent', 'review', 'Route low-confidence/failed conversions to a human reviewer and record the disposition.', HAIKU, 'agent.review.route'),
  tool('hitl-present', 'review-router-agent', 'Present a conversion + evidence for human approval (HITL gate).', 'external', 'ui:write'),
  tool('disposition-record', 'review-router-agent', 'Record the reviewer decision + reason (the learning loop).', 'write', 'meta:write'),
  job('audit-logger', 'review', 'Append run events to the audit log across the lifecycle.', 'audit'),
];

export const SEED_OBJECTS = Object.fromEntries(objList.map((o) => [o.id, o]));

const E = (source, target) => ({ id: `e-${source}-${target}`, source, target });
export const SEED_EDGES = [
  // discover
  E('discovery-agent', 'source-connect'), E('discovery-agent', 'dependency-map'), E('discovery-agent', 'object-catalog-write'),
  E('discovery-agent', 'src-oracle'), E('discovery-agent', 'src-mssql'), E('discovery-agent', 'src-db2'),
  E('discovery-agent', 'src-etl-graph'), E('discovery-agent', 'src-etl-sql'), E('discovery-agent', 'src-soa'), E('discovery-agent', 'src-flatfile'),
  // parse
  E('parsing-agent', 'sql-parser'), E('parsing-agent', 'etl-parser'), E('parsing-agent', 'ir-write'), E('parsing-agent', 'ir-store'),
  // map
  E('mapping-agent', 'construct-map'), E('mapping-agent', 'lineage-trace'), E('mapping-agent', 'confidence-score'),
  E('mapping-agent', 'metadata-catalog'), E('mapping-agent', 'tool-registry'), E('mapping-agent', 'conversion-model-router'),
  // generate
  E('codegen-agent', 'emit-pyspark'), E('codegen-agent', 'emit-sql'), E('codegen-agent', 'emit-ddl'),
  E('codegen-agent', 'tgt-databricks'), E('codegen-agent', 'tgt-snowflake'), E('codegen-agent', 'tgt-bigquery'),
  E('codegen-agent', 'tgt-aurora'), E('codegen-agent', 'tgt-s3-lake'),
  // validate
  E('validation-agent', 'equivalence-check'), E('validation-agent', 'rowcount-reconcile'),
  E('validation-agent', 'integrity-check'), E('validation-agent', 'quality-signal-write'),
  // review
  E('review-router-agent', 'hitl-present'), E('review-router-agent', 'disposition-record'),
  E('review-router-agent', 'state-store'), E('review-router-agent', 'audit-log'),
];

// Orchestrator + all tasks expanded; the reasoning-heavy agents expanded so depth
// shows and the tree scrolls — the presentable "whole platform" view.
export const SEED_EXPANDED = {
  'modernization-orchestrator': true,
  'discover': true, 'parse': true, 'map': true, 'generate': true, 'validate': true, 'review': true,
  'discovery-agent': true, 'parsing-agent': true, 'mapping-agent': true, 'codegen-agent': true, 'review-router-agent': true,
};

// Subject Areas that TAME the complexity — focus the whole platform to one slice.
export const SEED_SUBJECT_AREAS = [
  { id: 'sa-discovery', name: 'Discovery & Parsing', memberIds: ['discover', 'parse'], hiddenIds: [] },
  { id: 'sa-mapping', name: 'Mapping & Codegen', memberIds: ['map', 'generate'], hiddenIds: [] },
  { id: 'sa-validation', name: 'Validation & Review', memberIds: ['validate', 'review'], hiddenIds: [] },
];
