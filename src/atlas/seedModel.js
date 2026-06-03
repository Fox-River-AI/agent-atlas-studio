// A rich, fully-valid demonstration model: an Intelligent Data Modernization
// workflow that migrates a legacy MS SQL Server database to Aurora PostgreSQL
// using a fleet of governed agents. Every object's required fields are filled so
// the model validates cleanly (no error flags) — for a presentable screenshot.
//
// Shape: { objects: {id: {id, kind, parent, position?, data}}, edges: [...],
//          expanded: {...}, subjectAreas: [...] }

const M = (provider, name, pinned) => ({ provider, name, pinned });
const HAIKU = M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001');
const OPUS = M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8');

// helpers to keep the seed terse
const agent = (id, parent, responsibility, model, tele) => ({
  id, kind: 'agent', parent,
  data: { id, owner: 'data-platform', version: '1.0.0', responsibility, model: { ...model }, refusalConditions: ['Required inputs are missing or unreadable.'], refusalEmits: 'refused', telemetry: [{ name: tele, attributes: ['status', 'duration_ms'] }] },
});
const tool = (id, parent, description, effect, scope) => ({
  id, kind: 'tool', parent, data: { id, owner: 'data-platform', version: '1.0.0', description, effect, authScope: scope },
});
const job = (id, parent, description, queue) => ({
  id, kind: 'job', parent, data: { id, owner: 'data-platform', version: '1.0.0', description, queue, trigger: '', timeoutSeconds: 3600, retries: 3 },
});
const system = (id, parent, description, systemKind, connection, scope) => ({
  id, kind: 'system', parent, data: { id, owner: 'data-platform', version: '1.0.0', description, systemKind, connection, authScope: scope },
});
const task = (id, label, description) => ({ id, kind: 'task', parent: null, data: { id, label, description } });

const objList = [
  // ── shared infrastructure (referenced across tasks) ──
  system('source-mssql', 'extract-agent', 'Legacy MS SQL Server holding the source schema and data.', 'relational-db', 'mssql://legacy-db:1433/sales', 'db:read'),
  system('target-aurora', 'load-agent', 'Target Aurora PostgreSQL cluster.', 'relational-db', 'postgres://aurora:5432/sales', 'db:write'),
  system('run-state', 'orchestrate-agent', 'Run/step state store for resumable migration runs.', 'state-store', 'postgres://aurora:5432/migration_state', 'state:rw'),

  // ── Task 1: Assess source ──
  task('assess-source', 'Assess Source Database', 'Inventory the legacy schema, sizing, and migration risks.'),
  agent('inventory-agent', 'assess-source', 'Inventory the source schema: tables, views, procs, dependencies.', HAIKU, 'agent.inventory.catalog'),
  tool('catalog-query', 'inventory-agent', 'Query the MS SQL system catalog for schema metadata.', 'read', 'db:read'),
  tool('dependency-map', 'inventory-agent', 'Resolve cross-object dependencies (FKs, views, procs).', 'read', 'db:read'),
  job('profile-data', 'inventory-agent', 'Profile row counts, null density, and value distributions.', 'profiling'),

  // ── Task 2: Extract & convert DDL ──
  task('convert-ddl', 'Convert Schema (DDL)', 'Extract MS SQL DDL and convert it to Aurora PostgreSQL DDL.'),
  agent('extract-agent', 'convert-ddl', 'Extract the full DDL from the source database.', HAIKU, 'agent.extract.ddl'),
  tool('ddl-reader', 'extract-agent', 'Read DDL for a given object from MS SQL.', 'read', 'db:read'),
  job('extract-ddl-job', 'extract-agent', 'Extract the complete DDL set (long-running).', 'migrations'),
  agent('convert-agent', 'convert-ddl', 'Convert MS SQL DDL into idiomatic Aurora PostgreSQL DDL.', OPUS, 'agent.convert.ddl'),
  tool('type-mapper', 'convert-agent', 'Map MS SQL types/constructs to PostgreSQL equivalents.', 'read', 'types:read'),
  tool('ddl-writer', 'convert-agent', 'Emit the converted PostgreSQL DDL artifact.', 'write', 'artifact:write'),

  // ── Task 3: Migrate data ──
  task('migrate-data', 'Migrate Data', 'Move and transform the data into the target with integrity checks.'),
  agent('load-agent', 'migrate-data', 'Stream-transform and load source rows into Aurora.', HAIKU, 'agent.load.rows'),
  tool('batch-reader', 'load-agent', 'Read source rows in batches.', 'read', 'db:read'),
  tool('upsert-writer', 'load-agent', 'Upsert transformed rows into Aurora.', 'write', 'db:write'),
  job('bulk-load', 'load-agent', 'Bulk-load large tables in parallel (long-running).', 'migrations'),

  // ── Task 4: Validate & cut over ──
  task('validate-cutover', 'Validate & Cut Over', 'Reconcile source vs. target and switch traffic.'),
  agent('reconcile-agent', 'validate-cutover', 'Reconcile row counts and checksums between source and target.', OPUS, 'agent.reconcile.report'),
  tool('checksum-compare', 'reconcile-agent', 'Compare per-table checksums across databases.', 'read', 'db:read'),
  agent('orchestrate-agent', 'validate-cutover', 'Coordinate the cutover and record run state.', HAIKU, 'agent.cutover.status'),
  tool('traffic-switch', 'orchestrate-agent', 'Flip application traffic to the target cluster.', 'external', 'infra:write'),

  // ── A Router: the convert-agent routes between models by complexity/cost ──
  {
    id: 'model-router', kind: 'router', parent: 'convert-agent',
    data: {
      id: 'model-router', owner: 'data-platform', version: '1.0.0',
      description: 'Route DDL conversion to a model by complexity, quality, and cost.',
      candidates: [M('anthropic', 'claude-opus-4-8', 'claude-opus-4-8'), M('anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001'), M('openai', 'gpt-5', '')],
      optimizeFor: ['quality', 'cost'],
      rules: [{ when: 'object_complexity == high', select: 'claude-opus-4-8' }, { when: 'cost_sensitive', select: 'claude-haiku-4-5' }],
      fallback: 'claude-opus-4-8',
    },
  },
];

export const SEED_OBJECTS = Object.fromEntries(objList.map((o) => [o.id, o]));

// Edges: agent → tool/job/system/router (containment is implicit via parent;
// these explicit edges express the relationships the registry reads).
const E = (source, target) => ({ id: `e-${source}-${target}`, source, target });
export const SEED_EDGES = [
  E('inventory-agent', 'catalog-query'), E('inventory-agent', 'dependency-map'), E('inventory-agent', 'profile-data'),
  E('extract-agent', 'ddl-reader'), E('extract-agent', 'extract-ddl-job'), E('extract-agent', 'source-mssql'),
  E('convert-agent', 'type-mapper'), E('convert-agent', 'ddl-writer'), E('convert-agent', 'model-router'),
  E('load-agent', 'batch-reader'), E('load-agent', 'upsert-writer'), E('load-agent', 'bulk-load'), E('load-agent', 'target-aurora'),
  E('reconcile-agent', 'checksum-compare'),
  E('orchestrate-agent', 'traffic-switch'), E('orchestrate-agent', 'run-state'),
];

// Tasks + most agents expanded so the tree shows the full workflow depth
// (tasks → agents → tools/jobs/systems/router) and needs scrolling — the
// presentable "this is the whole platform model" view.
export const SEED_EXPANDED = {
  'assess-source': true, 'convert-ddl': true, 'migrate-data': true, 'validate-cutover': true,
  'inventory-agent': true, 'extract-agent': true, 'convert-agent': true,
  'load-agent': true, 'reconcile-agent': true, 'orchestrate-agent': true,
};

// A demonstrable Subject Area: just the schema-conversion slice.
export const SEED_SUBJECT_AREAS = [
  { id: 'sa-schema', name: 'Schema Conversion', taskIds: ['assess-source', 'convert-ddl'] },
];
