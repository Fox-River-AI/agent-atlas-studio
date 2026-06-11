// Loads the agent-atlas JSON schemas (the single source of truth, pinned via the
// vendor/agent-atlas submodule) and builds Ajv validators for live, in-browser
// validation. Importing from the submodule means the UI can never drift from the
// open-source spec — there is exactly one copy of the schema.
// The schemas declare draft 2020-12; Ajv's default export only knows draft-07,
// so import the 2020 build explicitly or compile() throws "no schema with key
// or ref .../2020-12/schema" at runtime.
import Ajv from 'ajv/dist/2020';

// Vite allows imports outside src/, so we point straight at the submodule —
// one copy of the schema, no drift, no symlink hack (unlike CRA).
// Agent schema is prototyped in-studio (model = pinned OR router ref) ahead of
// upstreaming to agent-atlas; tool stays the canonical submodule copy.
import agentSchema from './schemas/agent.schema.json';
// Tool is now studio-prototyped too (carries the governance block, like agent/
// job/system) ahead of upstreaming the governance extensions to the submodule.
import toolSchema from './schemas/tool.schema.json';
// Job + System are prototyped in the studio for fast iteration; once proven
// in the UI they get upstreamed to agent-atlas as canonical schemas.
import jobSchema from './schemas/job.schema.json';
import systemSchema from './schemas/system.schema.json';
import routerSchema from './schemas/router.schema.json';
import orchestratorSchema from './schemas/orchestrator.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });

export const validateAgent = ajv.compile(agentSchema);
export const validateTool = ajv.compile(toolSchema);
export const validateJob = ajv.compile(jobSchema);
export const validateSystem = ajv.compile(systemSchema);
export const validateRouter = ajv.compile(routerSchema);
export const validateOrchestrator = ajv.compile(orchestratorSchema);

// Per-node-type validator lookup, so the model layer stays generic.
export const VALIDATORS = {
  orchestrator: validateOrchestrator,
  agent: validateAgent,
  tool: validateTool,
  job: validateJob,
  system: validateSystem,
  router: validateRouter,
};

export { agentSchema, toolSchema, jobSchema, systemSchema, routerSchema, orchestratorSchema };

// The model+pinned version a freshly-dropped agent starts with. Mirrors the
// example manifest in the submodule so a new model validates as soon as the
// required fields are filled.
export const DEFAULT_MODEL = {
  provider: 'anthropic',
  name: 'claude-haiku-4-5',
  pinned: 'claude-haiku-4-5-20251001',
  parameters: { temperature: 0, max_tokens: 512 },
};

// Turn Ajv errors into short, human-readable strings keyed to a node's fields.
export function formatErrors(errors) {
  if (!errors) return [];
  return errors.map((e) => {
    const where = e.instancePath || '(root)';
    return `${where} ${e.message}`;
  });
}
