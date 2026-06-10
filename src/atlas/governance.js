// Governance assets for the build-handoff bundle (DIAG-15), imported as raw text
// from the agent-atlas engine submodule via Vite's ?raw loader. This keeps a
// SINGLE SOURCE OF TRUTH (the submodule) — the bytes are bundled at build time,
// so this works in both the web build and the Tauri desktop app with no runtime
// filesystem read of the submodule. (Same mechanism schema.js uses for the JSON
// schemas.) To update governance, update the submodule.
//
// These are copied VERBATIM into a generated bundle:
//   CLAUDE.md                              -> bundle root (the contract Claude Code loads)
//   .claude/settings.json                  <- from settings.example.json (wires the hook)
//   governance/hooks/validate_against_registry.py   (the PreToolUse enforcement hook)
//   governance/ci/validate_registry.py              (the CI/pre-push validator)
//   governance/README.md                            (the "why two layers" explainer)

import claudeMd from '../../vendor/agent-atlas/governance/CLAUDE.md?raw';
import settingsExample from '../../vendor/agent-atlas/governance/settings.example.json?raw';
import validateHook from '../../vendor/agent-atlas/governance/hooks/validate_against_registry.py?raw';
import validateCi from '../../vendor/agent-atlas/governance/ci/validate_registry.py?raw';
import governanceReadme from '../../vendor/agent-atlas/governance/README.md?raw';

export const GOVERNANCE_FILES = {
  'CLAUDE.md': claudeMd,
  '.claude/settings.json': settingsExample,
  'governance/hooks/validate_against_registry.py': validateHook,
  'governance/ci/validate_registry.py': validateCi,
  'governance/README.md': governanceReadme,
};
