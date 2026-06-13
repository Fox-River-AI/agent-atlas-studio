// Framework recognizers for the TS/React UI scanner (DIAG-51).
//
// THE PARSER (typescript compiler API) is framework-agnostic — it parses any TS/JS/
// JSX. What's framework-SPECIFIC is recognizing which AST nodes are "an API call",
// "a route", "client storage", "an approval control". That lives HERE, as a list of
// recognizers, so adding support for another front-end stack (Amplify, Next.js,
// Express SSR, Angular…) is adding a recognizer — NOT a new parser or a new plugin.
//
// This mirrors how DIAG-57 makes the *sensitivity* lexicon a swappable pack: same
// idea on the *framework* axis. Domain-agnostic by construction (see
// project_agent_atlas_domain_agnostic): nothing here is healthcare-specific.
//
// A recognizer is pure over the TS namespace + a CallExpression-ish node; it returns
// a finding or null. The scanner walks the AST once and offers each call/node to the
// recognizers. Unrecognized fetch-like calls are COUNTED and surfaced as a note, so
// the scan never silently under-reports (no false "fully covered").

// ── API-client recognizers ───────────────────────────────────────────────────
// Each maps a call expression → { target, method, path } or null. `target` is a
// logical backend name (the edge endpoint); the scanner resolves it to a System.

// Noesis pattern: `core.get("/x")` / `gateway.post("/x", body)` — a client object
// with verb methods. Generalizes to any `<clientName>.<verb>(...)` where clientName
// is a known API client and verb ∈ http verbs.
const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head']);
function clientVerbRecognizer(ts, call, knownClients) {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  const verb = expr.name.getText();
  if (!HTTP_VERBS.has(verb.toLowerCase())) return null;
  const obj = expr.expression;
  if (!ts.isIdentifier(obj)) return null;
  const client = obj.getText();
  if (knownClients && knownClients.size && !knownClients.has(client)) return null;
  return { target: client, method: verb.toUpperCase(), path: firstStringArg(ts, call), kind: 'client' };
}

// Raw fetch: `fetch("/x", {method})`. target is unknown until we resolve the URL
// prefix; the scanner maps it to a backend if the path matches a known API base.
function fetchRecognizer(ts, call) {
  const expr = call.expression;
  if (!(ts.isIdentifier(expr) && expr.getText() === 'fetch')) return null;
  return { target: null, method: methodFromOptions(ts, call) || 'GET', path: firstStringArg(ts, call), kind: 'fetch' };
}

// axios: `axios.get("/x")` / `axios("/x")` — common outside this app; ships so an
// axios-based UI (very common in enterprise React) is covered too.
function axiosRecognizer(ts, call) {
  const expr = call.expression;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.getText() === 'axios') {
    const verb = expr.name.getText();
    if (HTTP_VERBS.has(verb.toLowerCase())) return { target: 'axios', method: verb.toUpperCase(), path: firstStringArg(ts, call), kind: 'axios' };
  }
  if (ts.isIdentifier(expr) && expr.getText() === 'axios') {
    return { target: 'axios', method: methodFromOptions(ts, call) || 'GET', path: firstStringArg(ts, call), kind: 'axios' };
  }
  return null;
}

// AWS Amplify pattern (stub, proves extensibility): `client.graphql(...)`,
// `API.get(name, path)`, `generateClient()`. Recognized as a call to a managed AWS
// data plane — the path/route differs from REST, so we tag target 'amplify-data'.
// This is intentionally minimal: it demonstrates that another front-end framework is
// ONE recognizer entry, not a re-architecture. Flesh out when an Amplify estate is in
// scope (it currently recognizes the call shape and records it as an unresolved edge).
function amplifyRecognizer(ts, call) {
  const expr = call.expression;
  if (ts.isPropertyAccessExpression(expr)) {
    const m = expr.name.getText();
    const objTxt = ts.isIdentifier(expr.expression) ? expr.expression.getText() : '';
    if (m === 'graphql') return { target: 'amplify-data', method: 'GRAPHQL', path: null, kind: 'amplify' };
    if (objTxt === 'API' && HTTP_VERBS.has(m.toLowerCase())) return { target: 'amplify-data', method: m.toUpperCase(), path: firstStringArg(ts, call), kind: 'amplify' };
  }
  return null;
}

export const API_RECOGNIZERS = [clientVerbRecognizer, fetchRecognizer, axiosRecognizer, amplifyRecognizer];

// ── Client-storage recognizers ────────────────────────────────────────────────
// Web-standard, so framework-independent: localStorage/sessionStorage/IndexedDB.
const STORAGE_OBJECTS = { localStorage: 'localStorage', sessionStorage: 'sessionStorage', indexedDB: 'IndexedDB' };
const STORAGE_WRITE = new Set(['setItem', 'put', 'add']);
export function storageRecognizer(ts, call) {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  // chase the leftmost identifier (handles window.localStorage.setItem too)
  let root = expr.expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  const rootName = ts.isIdentifier(root) ? root.getText() : '';
  const store = STORAGE_OBJECTS[rootName];
  if (!store) return null;
  const op = expr.name.getText();
  return { store, op, isWrite: STORAGE_WRITE.has(op) };
}

// ── Approval / human-in-the-loop control recognizers ──────────────────────────
// Domain-agnostic: an approval/sign-off/disposition control is a governed object
// (4-eyes, maker-checker). Matched on identifier/string signals, then confirmed by
// the scanner as a control with no declared audit trail = a finding. Keyword set is
// generic governance vocabulary, NOT domain terms.
const APPROVAL_SIGNALS = ['approve', 'approval', 'reject', 'signoff', 'sign-off', 'disposition', 'attest', 'foureyes', '4-eyes', 'maker', 'checker', 'review_status', 'reviewstatus'];
export function approvalSignal(text) {
  if (!text) return false;
  const t = text.toLowerCase().replace(/[_-]/g, '');
  return APPROVAL_SIGNALS.some((s) => t.includes(s.replace(/[_-]/g, '')));
}

// ── helpers ───────────────────────────────────────────────────────────────────
function firstStringArg(ts, call) {
  const a = call.arguments && call.arguments[0];
  if (!a) return null;
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  // template like `${base}/x` — recover the literal tail so we still see the route
  if (ts.isTemplateExpression(a)) {
    const tail = a.templateSpans.map((s) => s.literal.text).join('');
    const head = a.head.text;
    return (head + tail) || null;
  }
  return null;
}
function methodFromOptions(ts, call) {
  const opt = call.arguments && call.arguments[1];
  if (!opt || !ts.isObjectLiteralExpression(opt)) return null;
  for (const p of opt.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'method') {
      const init = p.initializer;
      if (ts.isStringLiteral(init)) return init.text.toUpperCase();
    }
  }
  return null;
}
