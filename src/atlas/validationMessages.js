// Translate raw Ajv errors into named, plain-language messages so a user sees
// "Tool 'db-connect': owner is required" instead of "/owner must NOT have fewer
// than 1 characters". Keyed by object so the UI can name the offender + jump to it.

const KIND_NOUN = { task: 'Task', agent: 'Agent', tool: 'Tool', job: 'Job', system: 'System', router: 'Router' };

// Friendly phrase for a single Ajv error on a manifest.
function phrase(err) {
  const path = err.instancePath || '';
  const field = path.replace(/^\//, '').split('/')[0] || '';
  // reused_by/tools entries come from connections to un-named objects.
  if (path.startsWith('/reused_by')) return 'a connected agent has no id yet';
  if (path.startsWith('/tools')) return 'a connected tool has no id yet';
  if (err.keyword === 'pattern' && field === 'id') return 'id is required (lowercase, hyphens)';
  if (err.keyword === 'minLength' || err.keyword === 'minItems') return `${field || 'a required field'} is required`;
  if (err.keyword === 'required') return `${err.params?.missingProperty || 'a field'} is required`;
  if (err.keyword === 'enum') return `${field} has an invalid value`;
  if (err.keyword === 'oneOf') return 'model must be either a pinned model OR a router (not both)';
  return `${field || 'a field'}: ${err.message}`;
}

// Given { objId: rawAjvErrors[] } and the objects map, produce named summaries:
// [{ objId, label, kind, reasons: [string] }]
export function namedIssues(problemsByObj, objects) {
  const out = [];
  for (const [objId, errs] of Object.entries(problemsByObj)) {
    if (!errs || !errs.length) continue;
    const o = objects[objId];
    if (!o) continue;
    const label = o.data?.id || o.data?.label || objId;
    const reasons = [...new Set(errs.map(phrase))];
    out.push({ objId, kind: o.kind, label, noun: KIND_NOUN[o.kind] || o.kind, reasons });
  }
  return out;
}
