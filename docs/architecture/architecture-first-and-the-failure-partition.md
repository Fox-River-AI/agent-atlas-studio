# Architecture-First, and Why Observability Is Downstream of It

**Status:** Strategy / first-principles framing (2026-06-08).
**Purpose:** Articulate *why* Agent Atlas + Noesis sequence architecture before
observability, what the conformance/evidence layer is actually *for*, and the
honest limits of "a system that does not fail." This is the rationale behind the
build order (DIAG-15 generator first, conformance DIAG-29+ after) and the
telemetry-conformance design (`telemetry-conformance.md`).

Origin: a debate over whether the agent market's "build it, watch it fail, patch
it" default is the *correct* path or merely the *expedient* one.

---

## The question

The agent market largely went runtime-first: deploy agents, then use
discovery + continuous conformance to find where they fail. Should we follow
that — observability as the primary product — or build a system that *doesn't*
fail (or fails in limited, identifiable ways) first, and observe second?

The house analogy: runtime-first is like building a house with no architecture
and then selling tools that find the problems — from an upstairs toilet that
won't flush, to mis-distributed outlets, to catastrophic failure of a
load-bearing wall. For low stakes that loop is tolerable. For a load-bearing
wall it is malpractice.

## Descriptive ≠ normative

"The market bypassed design-time modeling" is a *description* of what's being
built, driven by the early, low-stakes use cases (marketing copilots, coding
assistants) where build-watch-patch is fine. It is **not** a verdict that
runtime-first is correct. Adoption is a traction signal, not an
engineering-correctness proof. Nobody authoritative says runtime-first is right;
the market's instinct was calibrated on toilet-flush problems.

Every safety-critical discipline does the opposite — architecture-first, with
design-time analysis and verification *before* deployment:
- **Aerospace:** DO-178C; model-based design (SCADE) that generates verified code.
- **Medical devices:** IEC 62304 design controls and V&V before release.

Clinical CDI sits at the load-bearing-wall end of the spectrum. There, the
precedent backs architecture-first. We are not building toilets.

## The legitimate steelman for runtime-first — and what it actually licenses

A load-bearing wall's failure modes are governed by physics you can fully
compute in advance. An LLM agent's are not. The generative components are
stochastic; part of their behavior space — emergent behavior, prompt injection,
distribution shift, goal drift — is genuinely **not enumerable at design time.**
You cannot formally verify "this model will never hallucinate a contraindication"
the way you verify a beam holds a load. That is the real reason observability is
not optional even with perfect architecture.

But notice what that argument licenses: **both, in sequence** — constrain by
design what you can, monitor the irreducible residual — *not* "skip the
architecture." Non-determinism doesn't excuse the absence of a design; it means
the design alone isn't sufficient.

So "build a system that does not fail" needs restating. For anything with a
generative component, "does not fail" has a hard ceiling — you can't get
deterministic non-failure from a probabilistic process. The achievable target is
**limited, identifiable failures.** And that is an *architectural* achievement,
not an observability one.

## The three-bin failure partition (the core model)

The architecture's job is not to eliminate failure — it's to **move failures
between bins**, shrinking the part that can fail in open-ended ways:

1. **Eliminable by construction — the load-bearing logic.**
   Deterministic, verifiable decision-making: DRG grouping, rule application,
   ontology grounding, the ASP/Z3 reasoning, provenance, rule versioning.
   Failures here are bugs, not stochastic risk. Architecture *prevents* these.
   By design, this is *most* of Noesis's actual decision-making.

2. **Boundable but not eliminable — the fenced generative edges.**
   The LLM extracting concepts from an unstructured note, drafting query
   language. You can't prove it never mis-extracts — but the architecture
   *fences* it: generation feeds the deterministic verifier (a hallucinated
   concept that isn't SNOMED-grounded is caught), and nothing the LLM emits has
   effect without a validation gate and a human-initiated query. A stochastic
   failure becomes a **contained, observable** failure — caught, not propagated.
   This is "limited, identifiable failures" in practice.

3. **Irreducible — the genuinely emergent.**
   Prompt injection, distribution shift, novel inputs. Not enumerable at design
   time. You don't *prevent* these; you **detect, contain, and attest** them.
   This is exactly what observability + conformance is for.

**The hinge result:** clinical CDI *can* be architected into bounded failure for
bins 1 and 2. Bin 3 is the irreducible residual you monitor and attest. And the
existence of bin 3 is not a hole in the business — **it is the source of the
evidence product's value.** If everything were boundable by construction you'd
need only a test suite, not ongoing attestation. The residual is what makes
"prove it stayed in bounds" a continuous, payable, regulator-mandated activity.

## Observability quality is downstream of architectural partitioning

This is the principle the whole sequencing argument turns on:

> **The architecture determines how small and how legible bin 3 is. Observability
> can only ever watch the residual the architecture left behind.**

- A badly-architected system has a huge, illegible bin 3 — *everything* can fail
  in unbounded ways — so its observability is mostly noise. (This is the
  home-inspector-for-a-badly-built-house model the horizontal failure-spotters
  sell: no bin-1/bin-2 architecture, so their bin 3 is the whole system.)
- A well-architected system shrinks bin 3 to a fenced, *named* set of generative
  touchpoints — so its conformance evidence is **meaningful**, because it's
  watching a small, well-defined residual against a real declaration.

You cannot meaningfully observe a residual you did not first define. So
architecture-first isn't a phase that precedes observability — it's the thing
that makes observability *worth anything.*

## Conformance presupposes a declaration

You cannot have "declared-vs-running" without the *declared* — and a real
declaration **is** design-time architecture. So architecture-first isn't a frame
the conformance work bypasses; it's the anchor the conformance work hangs from.

The horizontal players mostly **fake the declaration** — they auto-discover
whatever configuration happens to exist and diff it against generic policy. That
is checking a badly-built house against a generic code. Our move is the inverse
and coherent end-to-end:

1. Author a real, clinical-domain architectural declaration (how the system
   *should* be built).
2. Build Noesis to conform to it **by construction** (bins 1 and 2).
3. Have Atlas produce the evidence that the well-built system behaves as designed
   (watching bin 3).

The evidence is meaningful *because* there's a sound architecture behind it — not
in spite of the absence of one. Even the regulation assumes this sequencing: the
EU AI Act measures drift against the **initial conformity assessment**, which only
exists if the design-time architectural work was done first.

## What this means for the build order

- **DIAG-15 (CLAUDE.md + hooks generator) is the bin-1/bin-2 machine.**
  Generating the platform *from* the declaration, with hooks enforcing the tool
  allowlist / refusal / pinned model, is "conform by construction" — keeping
  failures out of bins 1 and 2 at build time. This is why it is correctly the
  *first* real build: it is architecture-first made operational.
- **Conformance (DIAG-29+) is the bin-3 instrument.** It watches the residual the
  generator couldn't eliminate.
- **The rule-pack seam** is what makes the bin-3 evidence *clinical* (meaningful)
  rather than generic (noise) — see `telemetry-conformance.md` §4C′.

## Product packaging: vertical, not horizontal

Architecture-first as a *philosophy* is correct (granted above). Architecture-
first as a *horizontal, standalone design-time modeler other teams adopt* is a
historically brutal sell — Erwin is niche; SCADE/Simulink are low-volume,
high-touch into aerospace/auto; all require customers to change how they build.

But the unified product here is **not** the horizontal modeler. It is the
modeler **plus a domain rule pack** — a *vertical*, opinionated,
batteries-included artifact: the CDI architecture already modeled, the clinical
conformance pack built in. That dodges the GTM problem that killed the horizontal
tools ("change how you build") and replaces it with "here is how a compliant
clinical agent system is already shaped; conform to it." Architecture-first wins
as **Noesis's engineering spine + Atlas's anchor + a vertically-packaged
artifact** — never as a horizontal modeling product you must convince the world
to adopt. (See the monetization posture in `telemetry-conformance.md` §5.)

## The honest claim (and the one to never make)

The dangerous failure mode for a clinical-AI vendor is over-claiming determinism
— "our architecture guarantees correctness." That is both false (bin 3 exists)
and a weaker sell to a risk-averse buyer who won't believe it.

The defensible claim is the true one:

> **We eliminate failure where it's eliminable (bin 1), contain it where it's not
> (bin 2), and produce evidence for the irreducible residual (bin 3).**

That is architecture-first and the conformance wedge, unified — and a genuinely
different product than what the failure-spotters sell.
