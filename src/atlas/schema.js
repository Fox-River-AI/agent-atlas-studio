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
import agentSchema from '../../vendor/agent-atlas/registry/schema/agent.schema.json';
import toolSchema from '../../vendor/agent-atlas/registry/schema/tool.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });

export const validateAgent = ajv.compile(agentSchema);
export const validateTool = ajv.compile(toolSchema);

export { agentSchema, toolSchema };

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
