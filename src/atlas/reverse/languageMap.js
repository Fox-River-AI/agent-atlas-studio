// Canonical file-extension → language map (DIAG-59).
//
// DATA, not logic — domain- and framework-agnostic, deliberately BROAD so the census
// names languages we have NO scanner for (Go/Rust/Java/Terraform/COBOL…). That's the
// whole point: a language we can't yet scan must be NAMED and reported as UNSCANNED,
// never silently skipped. Extending = add a row here.
//
// Litmus (per project_agent_atlas_domain_agnostic): this must serve a PCI payment
// estate (Java/Go/Terraform) or a SOX manufacturer (C#/SQL/PowerShell), not just the
// Noesis Python+TS stack. So the map is intentionally wider than what we can scan.

// extension (lowercase, no dot) → canonical language id.
export const EXT_LANGUAGE = {
  // --- have scanners today ---
  py: 'python', pyi: 'python', pyw: 'python',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  sql: 'sql', ddl: 'sql', dml: 'sql',

  // --- detected but NO scanner yet (the loud-gap set) ---
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  go: 'go',
  rs: 'rust',
  cs: 'csharp', vb: 'vbnet', fs: 'fsharp',
  rb: 'ruby', erb: 'ruby',
  php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  swift: 'swift', m: 'objc', mm: 'objc',
  r: 'r', jl: 'julia',
  cbl: 'cobol', cob: 'cobol', cpy: 'cobol',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  tf: 'terraform', tfvars: 'terraform', hcl: 'hcl',
  yaml: 'yaml-config', yml: 'yaml-config',
  dockerfile: 'docker',
  proto: 'protobuf', graphql: 'graphql', gql: 'graphql',
  ipynb: 'notebook',
  pl: 'perl', pm: 'perl', lua: 'lua', dart: 'dart', ex: 'elixir', exs: 'elixir',
  clj: 'clojure', cljs: 'clojure', hs: 'haskell', erl: 'erlang',
};

// Some files are matched by NAME, not extension (the leading dir/file).
export const NAME_LANGUAGE = {
  dockerfile: 'docker',
  makefile: 'make',
  rakefile: 'ruby',
  'cmakelists.txt': 'cmake',
};

// A few extensions are config/markup, not "source we'd assess for logic." We still
// count them but tag them as non-code so the coverage % is computed against real code
// and config noise doesn't dilute the "what wasn't scanned" signal.
export const NON_CODE_LANGS = new Set(['yaml-config', 'docker', 'make', 'cmake', 'protobuf', 'graphql', 'notebook']);

/** language id for a filename, or null if unknown/uninteresting. */
export function languageForFile(name) {
  const lower = name.toLowerCase();
  if (NAME_LANGUAGE[lower]) return NAME_LANGUAGE[lower];
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  return EXT_LANGUAGE[ext] || null;
}

/** Human label for a language id (fallback: the id itself). */
const LABELS = {
  python: 'Python', typescript: 'TypeScript', javascript: 'JavaScript', sql: 'SQL',
  java: 'Java', kotlin: 'Kotlin', scala: 'Scala', go: 'Go', rust: 'Rust',
  csharp: 'C#', ruby: 'Ruby', php: 'PHP', c: 'C', cpp: 'C++', swift: 'Swift',
  r: 'R', cobol: 'COBOL', shell: 'Shell', powershell: 'PowerShell',
  terraform: 'Terraform', hcl: 'HCL', notebook: 'Jupyter notebook',
};
export function languageLabel(id) { return LABELS[id] || id; }
