# INBOUND REQUIREMENT (from the Almanac project): model-family scope (2026-06-25)

> **For the Atlas session.** This requirement originated while building Almanac; the source copy is in
> the Almanac repo at `docs/conformance-exhibit/2026-06-25-model-family-scope-for-atlas.md`. It is
> filed HERE because the work is an Atlas registry/contract change — Atlas declares the capability,
> then Claude Code builds Almanac to it.

Randy reasoned this out and it's correct. Recording as an ATLAS hand-off — do NOT design it in the
Almanac repo (that would invert the contract: code defining its own requirements).

## The architecture (Randy's framing, verbatim sense)
- **Atlas** designs the registry + the CLAUDE.md contract.
- **Claude Code** builds **Almanac** (an MLOps management system) TO that registry/contract.
- Therefore **the scope of ML model families Almanac supports is a REQUIREMENT** that belongs in
  Atlas's registry/contract — e.g. a declared capability: time-series, gradient-boosting, DLNN, …
- **Adding a new model family** (e.g. LSTM for Noesis) is therefore an **Atlas session** action first
  (declare the capability + its manifest), THEN a Claude Code session implements Almanac to match.
  It is NOT an ad-hoc code hack — it's a governed, declared extension.
- The meta-loop Randy named: **Atlas evolved from "design/monitor/report on agentic AI systems" into
  ALSO producing the registry + Claude contract that BUILDS the system it will then monitor.** Atlas
  is both the designer and the conformance monitor of what gets built. Model-family scope is one
  requirement flowing through that loop.

## What a model-family / model-type declaration should carry (for the Atlas session to design)
A registry manifest per supported model family (or a `supported_model_families` requirement on the
Almanac system manifest). Each model TYPE within a family declares:
- **param schema** — the tunable params AND their HPO ranges {default, min, max, scale} (so the UI
  shows value + searchable range; see the Almanac-side UX work below).
- **training contract** — does it fit the tabular `(X,y)->.fit()/.predict()` mold (sklearn-style:
  lightgbm/xgboost/randomforest/catboost — trivial) OR does it need a different pipeline (sequence
  windowing, epoch/batch loop, GPU, different serialization — LSTM/transformers — real engineering)?
- **gate** — what proves a model of this family is promotable (the metric may differ by family).
- **serialization / predict path** — sklearn pickle vs torch state_dict vs Numerai cloudpickle predict().
- **telemetry** — what the runtime must emit.

## The sklearn-tabular vs neural-net split (the engineering boundary, for scoping cost)
- **Trivial (config-level, ~3 lines in train.py maker + UI chip):** RandomForest, ExtraTrees, CatBoost
  — same `(X,y)->.fit()` pattern as lightgbm/xgboost. The build maker already does `{**defaults,
  **params}` so it passes ANY param through.
- **Real engineering (new pipeline):** LSTM / transformers / any sequence or neural model — breaks the
  tabular assumption (windowing, epochs/batches/optimizer/early-stop, GPU, torch serialization, a
  different HPO param set). This is where Claude Code genuinely writes new code — TO the Atlas
  declaration.

## Almanac-side work that is NOT Atlas's job (stays here, already decided 2026-06-25)
These are Almanac UI/engine improvements, independent of the family-scope requirement:
- Full XGBoost param set in the UI (engine already accepts any param; UI exposes only 4 today).
- **Show/edit each param's HPO range inline** (min/max/scale), reading/writing hpo_search_space — so
  when you Tune, you SEE and CONTROL what each param searches (Randy's UX concern; applies to all
  models/params). NOTE: the param SCHEMA (incl ranges) ultimately should come from the model-type
  manifest Atlas declares — so this UI work and the Atlas declaration meet in the middle: Almanac
  renders ranges from the manifest; Atlas owns the manifest.

## Action
- ATLAS SESSION: design the model-family/type declaration in the registry (the bullets above). Decide
  whether it's a `supported_model_families` requirement on the system manifest or per-type manifests.
- ALMANAC SESSION (this repo): build the XGB params + inline HPO-range UX (Randy chose the full fix).
  Render param schema/ranges from config now; from the Atlas manifest once it exists.
