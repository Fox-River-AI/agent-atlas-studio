# R14 worked example — multiplier drift (a self-application instance)

**Filed against:** agentic-architecture rules v0.2, **R14 (governance-of-governance)** — the
rule that a governed system must itself be built under the governance it enforces: its own
construction, config, and constants are subject to the same runtime↔declaration binding it
demands of the systems it governs.

**Category (failure taxonomy):** Governance → Configuration / version drift ("Production
differs from what was validated" — the ✓ R14 row: *runtime↔declaration binding*).

**Why this entry matters:** it is a **self-application instance** — the framework catching a
governance failure in *its own construction*, not in a governed subject. Almanac (the first
build of the grounded-autonomy thesis, and a system that enforces solver-proved gates on
itself) was found to have an ungoverned constant drift inside its own scoring layer. R14 is
the rule that would have flagged it; the framework caught it the way R14 predicts such
failures are caught (provenance question + adversarial review), which is the strongest kind
of evidence a governance rule can have — it works on its author.

## The incident (Almanac, 2026-07-25; Almanac RMF M20/M21)

The payout score `CORR20·corr_mult + MMC20·mmc_mult` is computed from multipliers that
**Numerai owns and changes**. Almanac had hardcoded **three disagreeing copies** — 3.0/9.0
in two modules (one baked into stored, attested manifests), 0.5/3.0 in a third — while the
live authority had moved to **0.75/2.25**. No binding tied any copy to its source, so the
values drifted silently as Numerai changed them. A twin bug (M21) then compared two of the
scales in a single `max()`, reordering the tool's own build recommendations.

## The R14 mapping

| R14 expectation | What was violated | The fix that restores conformance |
|---|---|---|
| A governed value has a single declared source | 3 hardcoded copies, 0 sources | one live source (`core/multipliers.py`) fetching from the authority |
| Runtime binds to declaration, not a copy | copies drifted from Numerai unnoticed | live fetch + cache + loud frozen-fallback; provenance stamped on each new artifact |
| Attested artifacts are not silently rewritten when the declaration changes | (correctly preserved) | stored proxies keep build-time multipliers, LABELED at every cross-scale comparison |
| The governance applies to the governor's OWN construction | the scoring layer of a self-governing system was itself ungoverned | inventory of every remaining authority-owned constant filed as a hunt, not awaited |

## Detection provenance (the self-application evidence)

- **M20 was caught by a founder provenance question** ("do these multipliers change slot to
  slot?") — i.e. a human applying R14's own runtime↔declaration test by hand. That the
  question *is* R14 is the point: the rule names the check that found the failure.
- **M21 was caught by adversarial review**, a strictly different control than the founder
  question — establishing that governance-of-governance needs BOTH a provenance discipline
  (for wrong-value drift) and an adversarial pass (for cross-scale-comparison drift). One
  does not substitute for the other.

## Standing lesson for the rule pack

R14 should carry, as a checkable condition, an **authority-owned-constant inventory**: every
constant a governed system takes from an external authority (here Numerai: multipliers, tier
cutoffs, round windows, era/embargo methodology, payout factor) must be either live-sourced
or provenance-frozen-with-a-drift-check — never hardcoded-and-forgotten. Almanac's inventory
(its DECISIONS.md, 2026-07-25) is the reference instance of that condition being enumerated.
