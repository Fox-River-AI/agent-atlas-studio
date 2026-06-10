# We Spent Twenty Years Unlearning How to Model. Agentic AI Won't Let Us.

*Architecture rigor should scale with the cost of failure. We forgot that — and autonomous agents are where the bill comes due.*

---

Early in my career I built mission-critical systems for the Department of Defense — software whose job was to depict battlefield conditions accurately enough that soldiers made decisions on it. The goal was 100% accuracy. We never quite reached it, and testing always ran long, because no one is capable of architecting for every contingency. But the *standard* was never in question. You designed first. You modeled first. The cost of being wrong was a life, and that cost disciplined everything upstream of the code.

Then I moved into the commercial world, starting in financial services, and I met a phrase that has bothered me ever since: **directionally correct.**

My question then is the one I'd still ask now: *if you haven't identified the point of failure, how do you know it's directionally accurate?* "Directional" is a claim about error, and you cannot make a claim about error you have not characterized. Yet "directionally correct" was rarely a disciplined judgment about materiality. It was usually a way to wave off the fact that no one had bounded the error at all. If a report produced a chart the stakeholders felt was approximately right, that was the gold standard.

Here I want to be careful, because it's the difference between an argument and a grievance. I am *not* saying every system should be built like a battlefield system. The DoD standard was right *because* the cost of being wrong was a life. A marketing website is not a missile system, and treating it like one would be its own kind of malpractice. The principle underneath all of this — the one I didn't have a name for until recently — is simpler and much harder to argue with:

**Architecture rigor should scale with the cost of failure.**

That is the whole argument. Everything that follows is a description of how, over twenty years, that proportionality quietly collapsed — until rigor stopped tracking stakes at all, "fast" became the default for everything, and the systems where being wrong is most expensive ended up with the least design of all.

## The slow unbundling of design

The collapse came one reasonable-sounding step at a time.

Transactional databases got defined by application developers and denormalized — partly for performance, but more often because it let them avoid trapping the hard cases: duplicate values, orphaned records, the integrity work that makes a model honest. Then came data warehousing and big data, and modeling slipped further down the priority list.

I want to be fair to the names that get blamed, because the blame is misplaced. Ralph Kimball and Bill Inmon are routinely cited as license to stop modeling, and that's a misreading of both. Inmon is the *normalization-first* figure — a centralized, third-normal-form enterprise warehouse as the single source of truth. Kimball's dimensional modeling is denormalized, yes, but it is ferociously disciplined: declared grain, conformed dimensions, explicit handling of slowly changing dimensions, with integrity enforced upstream in the pipeline rather than abandoned. The Kimball-versus-Inmon debate was a fight *between two rigorous modeling schools.* What degraded the field wasn't their ideas. It was practitioners invoking their authority as cover while doing neither discipline.

The justification was always the same: time to market. The trade was real — delivery got faster. But quality degraded in lockstep with the architecture being skipped, and the degradation stayed invisible until it wasn't. Outside the DoD, I have rarely seen a software *program* design — no class diagram, no durable structural artifact of any kind. Data models persisted longer than anything else, and that persistence is the most important clue in this entire story.

Data models survived because **data outlives code.** A bad schema is brutally expensive to migrate and lives for decades; bad code gets refactored next sprint. Modeling endures exactly where the artifact is durable and costly to change, and withers where it's cheap and disposable. That's why data modeling outlasted UML and class diagrams in commercial practice — and it's the principle that tells you, in advance, where modeling is about to become necessary again.

## The circularity nobody wanted to admit

Cloud computing arrived with a tempting promise: schema-on-read, schema-on-write — as long as you had the metadata, you could define your architecture on the fly. The obstacle showed up almost immediately. You can't define a schema without metadata, and you can't produce meaningful metadata until you've defined a model. It's circular. But modeling had become such a heavy lift that the industry worked very hard to pretend the circle wasn't there, in order to do away with modeling altogether.

The tooling followed. AWS Glue and its peers promised to auto-generate data models. I've reviewed many of those models, and with the exception of trivially small ones, they are always wrong — many-to-many relationships invented, attributes misaligned, foreign keys pointing backward or simply absent.

The reason they're wrong is not a bug anyone can fix. **Cardinality, foreign-key direction, and business keys are statements of intent, and intent is not present in the data.** You can observe a one-to-one relationship in a sample that is truly one-to-many. No crawler can recover a fact that was never in the values it crawled.

Generative AI now produces data models the same way, with the same defect — and worse, without even an Entity Relationship Diagram for a human to look at and catch the obvious errors. So developers guess at the relationships and write queries against their own assumptions. They model on the fly, privately, inconsistently. Two engineers will make two different assumptions about the same data. One may be right and one wrong; both may be wrong; both may be right for incompatible reasons. There is no shared, canonical artifact to make the disagreement visible, let alone resolvable.

Visual modeling of data is still a necessity. The Erwin approach — and a small handful of tools like Embarcadero's — remains the most engineered process we have for it. Hold that thought.

## Agentic AI: the same disease, one layer up

Now we arrive at autonomous agents, and I see the identical pattern. We are designing multi-agent systems with little or no modeling and almost no architecture. Where design happens at all, it's a few whiteboard sessions that leave behind no durable artifact for engineers to build against.

The symptoms are exactly what the absence of a model always produces. Two agents or MCP servers with identical purposes, implemented differently, because no one could see that the first one already existed. No single canonical location for a capability, so the same logic gets reimplemented in three places — and when it needs a patch, no one can say how many places must be corrected. No shared diagram to scan for the obvious structural errors. This is the data-modeling collapse returning as agent sprawl.

An agent registry is, in effect, the missing Entity Relationship Diagram for the agent estate — the canonical artifact that lets you dedupe, enforce a single source of truth, and *see* the structure before it rots. And by the logic of "data outlives code," this was predictable: agent estates are becoming durable, expensive-to-change infrastructure, and durable infrastructure always drags modeling back into the room.

But here the analogy breaks, and the break is the most important part.

**A database can, in principle, be modeled to correctness.** A normalized schema has a correct form given the domain's functional dependencies. The relationships are determinable. The errors are objective and visible on a diagram. You can architect your way to a right answer.

An agent system cannot — not entirely. Part of its behavior is irreducibly emergent. A schema has no stochastic residual; a table does not improvise. So the answer for agents is not "model harder." It's *both layers at once*: design-time structural modeling for everything that has a right answer, and something the data world never needed for everything that doesn't.

## Three pillars: eliminate, contain, attest

Once you accept that an agent system contains an irreducible stochastic component, design alone stops being sufficient. The question is no longer only *how to build the system correctly* — it's *how to keep proving that the parts you cannot fully predict are staying inside their bounds.* Answering that requires separating failures by what you can actually do about each one. Three categories, and they are not equal.

**Pillar 1 — Eliminable by construction.** This is the load-bearing logic. In a clinical system: DRG (diagnosis-related group) assignment, rule application, ontology grounding, the deterministic reasoning layer (Answer Set Programming, satisfiability solvers). These are deterministic and verifiable. Failures here are *bugs*, not stochastic risk — and architecture prevents them. Done right, this is most of the system's actual decision-making, by design. It is the pillar the industry stopped building even though it has a right answer, and the one Erwin-grade modeling applies to directly.

**Pillar 2 — Boundable but not eliminable.** This is the generative residual at the edges — the language model extracting a concept from an unstructured clinical note, or drafting query language. You cannot prove it never mis-extracts. But you can fence it. The extraction feeds the deterministic verifier, so a hallucinated concept that isn't grounded in the ontology gets caught. Nothing the model emits has effect without passing a validation gate and a human-initiated review. A stochastic failure becomes a *contained, observable* failure — caught, not propagated. These are the limited, identifiable failures a well-architected system is allowed to have.

**Pillar 3 — Irreducible.** Prompt injection, distribution shift, novel inputs, the genuinely emergent. You cannot enumerate these at design time. The honest answer is that you do not prevent them. You detect them, contain them, and attest to them. This is precisely — and only — what observability and conformance are for.

Now notice what the third pillar quietly depends on, because it is the answer to the sharpest objection anyone can raise against everything I've said. The objection goes: *if the dangerous part is exactly the part you can't model, doesn't that prove the modeling is the low-value half — that the runtime-first crowd, watching live behavior, is doing the real work?*

It proves the opposite. You can only measure conformance *against a declaration.* There is nothing to attest to unless someone first declared what the system was supposed to do — and a real declaration is design-time architecture. The irreducible residual doesn't diminish modeling; it is *parasitic* on it. Pillar 3 has no meaning without Pillar 1. Which means the runtime-first tools — discovering agents and watching their behavior with no declared model to compare against — are not doing the more important half of the job. They are doing half of it. They can tell you what an agent did. They cannot tell you whether it was supposed to.

And that is the bridge to the part that matters commercially.

## Why conformance is a product, not a feature

Pillars 1 and 2 are architecture. They are how you build the system that does not fail — or fails only in bounded, identifiable ways. Pillar 3 is the part with no precedent in the data world. And that is exactly why it is a product, not a feature.

Consider what Erwin actually does that's most valuable. It isn't the diagram. It's Complete Compare: forward-engineer the model into a database, reverse-engineer the database back into a model, and *diff the two* to detect drift. That is declared-versus-running conformance — and it has shipped, for databases, for three decades. So the pattern is not new. The question is why it has always been a *feature* of a modeling tool for data, and why it cannot be for agents.

The answer is in four parts.

**It is continuous, not episodic.** A database drifts only when a human alters it — a column added, a constraint dropped. The running state is stable between those events, so a periodic diff suffices, and a diff you run on a schedule is a button in a tool. An agent drifts *every inference.* There is no stable running state to compare against on a schedule; conformance has to be an always-on process watching a system that is never quiet. An always-on process is not a button. It is an operating discipline.

**It serves a different buyer.** A schema diff is for the engineer who owns the schema. A conformance attestation is for someone who does not write code at all — a compliance officer, a risk committee, an auditor, ultimately a regulator. The moment the output is *for* someone outside engineering, you are no longer building a developer convenience. You are building a product, because a product is defined by serving a buyer the developer is not.

**It produces an artifact that leaves the building.** A diff stays inside the dev loop. A conformance record is *evidence* — signed, retained, and meant to travel: into an audit, a procurement review, a regulatory file, potentially a courtroom. Under the EU AI Act, runtime behavior is measured against the system's initial conformity assessment, which means the artifact carries legal weight the instant it's created. Producing an evidentiary artifact with external value is product work. Producing a debugging aid is feature work.

**And it never closes.** A database can, in principle, be modeled to correctness, and the diff goes quiet. Pillar 3 never goes quiet. There is always an irreducible residual to detect, contain, and attest — for the life of the system. A problem that resolves once is served by a feature. A problem that recurs continuously and produces ongoing external value is, by definition, a product.

This is the inversion worth sitting with. The irreducible residual is not a hole in the architecture or an embarrassment to be hidden behind a determinism guarantee — and in a regulated domain, claiming such a guarantee is the most dangerous thing a vendor can do, because "we guarantee correctness" is a representation you have to defend the first time the system is wrong. The residual is the *reason the conformance layer exists at all.* If failure were fully eliminable by architecture, you'd need the verified system and nothing more. The existence of Pillar 3 is what turns governance from hygiene into a standing product — with a buyer, an artifact, and a need that never ends.

## The narrow claim

So this returns where it started, now with the agents in view. I am not arguing that the industry should repent and model everything, or that every system needs the standard we held in the DoD. The claim is narrower and, I think, harder to dispute: architecture rigor should scale with the cost of failure; that proportionality has collapsed; and the systems where it matters most — durable, high-stakes, regulated — are being built with the least of it.

Agentic AI doesn't need everyone to start drawing diagrams again. It needs the high-stakes systems to be architected for what's eliminable and contained — Pillars 1 and 2 — and it needs a way to prove, continuously and to people outside engineering, that what's left over is being watched and accounted for. That proof is Pillar 3. It is not a feature you bolt onto a builder's tool. It is the product that thirty years of unlearning has finally made unavoidable.
