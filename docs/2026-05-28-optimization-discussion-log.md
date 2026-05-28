# 2026-05-28 Optimization Discussion Log

## Purpose

This document records agreed conclusions from each optimization discussion round.
It is discussion-only context for now, not an implementation spec and not a code task list.

## Working Principles

- We are in discussion mode first, not implementation mode.
- Changes should be based on the current codebase, with incremental optimization rather than large rewrites.
- The main system backbone stays the same:
  `capture -> parse -> internalize -> graph -> QA`
- For now:
  - `capture / parse / internalize / graph build` are treated as workflows.
  - `QA` is the primary area to evolve toward an agent-style module.

## Round 1: System Framing

### Agreed conclusions

- The whole system is being optimized together rather than treating inbox, internalization, graph, and QA as isolated features.
- The user wants discussion to proceed layer by layer.
- The near-term architecture direction is:
  - upstream knowledge production remains workflow-oriented
  - QA becomes the main agent-oriented capability

### Notes

- This means later design decisions should prioritize how upstream data structures support QA as an agent.

## Round 2: Discussion Order

### Agreed discussion order

1. Data definition layer
2. Capture and parsing layer
3. Internalization layer
4. Knowledge graph layer
5. QA retrieval layer
6. QA agent decision layer
7. Answer generation layer

### Notes

- The sequence follows the full knowledge lifecycle:
  raw material -> structured knowledge -> relations -> retrieval -> answer generation
- This order should be preserved unless we explicitly decide to branch.

## Round 3: Optimization Scope Constraints

### Agreed conclusions

- Optimization should be based on the current implementation, not a greenfield redesign.
- We should avoid major structural changes unless a later discussion proves they are necessary.
- We should preserve existing main objects and pipelines wherever possible, then enhance them incrementally.

### Practical interpretation

- Prefer adding missing fields, metadata, or intermediate assets over replacing existing core tables and routes.
- Prefer extending current API and workflow behavior over introducing an entirely separate architecture.

## Round 4: Capture Item Positioning

### Agreed conclusions

- `capture_items` should be treated as:
  - the main capture-layer object
  - a container for raw captured material
- `capture_items` should not be treated as the final knowledge object.
- `notes` remain the internalized knowledge object.

### Role definition

- `capture_items` is the raw knowledge snapshot.
- `notes` is the refined and internalized knowledge unit.

## Round 5: Raw Material Preservation Strategy

### Agreed conclusions

- `capture_items` should preserve as much raw captured material as possible.
- This is preferred because internalization can then reuse existing parsed material without re-reading external sources.

### Why this matters

- Faster internalization
- Better stability when links, external pages, or parsers change
- Better reuse for graph building and QA evidence later

### Raw material categories currently agreed

- User direct input text
- URL parsed body text
- Attachment extracted text
- OCR / image / video supplemental text
- User-provided understanding or commentary

## Round 6: Raw Material Storage Shape

### Agreed conclusions

- Raw captured material should be stored separated by source rather than flattened into one undifferentiated field.
- A fast aggregated readable text may still exist for convenience, but source boundaries should remain available.

### Why this matters

- Internalization can distinguish raw facts from user commentary.
- Graph and QA can trace evidence back to its origin.
- Later optimization remains flexible because source identity is preserved.

### Preferred structure direction

- Light structure first
- Keep small but important metadata

### Minimum source-aware metadata to retain

- content source type
- related URL or attachment identity
- whether the content is primary
- whether parsing succeeded

## Round 7: Capture-Layer Structure Level

### Agreed conclusions

- The capture layer should follow `1.5 = light structure + a small amount of key metadata`.
- The goal is not to make capture storage fully heavy or deeply normalized at this stage.
- The goal is to preserve source boundaries while keeping the current system easy to evolve incrementally.

### Practical interpretation

- Keep `capture_items` centered on text-like reusable assets.
- Preserve source-aware material boundaries.
- Attach only the minimum metadata needed to reuse these materials in internalization, graph building, and QA.

### Structural direction

- A top-level capture record should describe the capture event itself.
- Source-specific material details should not all be flattened into the top-level record.
- Source-aware content should remain conceptually separate, even if the implementation stays lightweight for now.

## Round 8: `raw_content` Role

### Agreed conclusions

- `raw_content` should be treated as the top-level aggregated primary view of capture content.
- `raw_content` should not be treated as the one and only canonical raw source.

### Practical interpretation

- `raw_content` is the fastest reusable default text view for downstream workflows.
- `raw_content` is allowed to be convenient and aggregated.
- Fine-grained source identity should still remain available outside this single field.

### Why this matters

- It keeps the top-level capture record easy to use.
- It avoids forcing all downstream logic to reconstruct a default readable text every time.
- It preserves room for better evidence tracing later in graph and QA.

## Round 9: `raw_content` Composition Priority

### Agreed conclusions

- `raw_content` should not be a blind flattening of all content sources.
- `raw_content` should prioritize objective raw primary text.
- Supplementary parsed material may be included as secondary content.
- `my_understanding` should not be merged into the objective raw primary body.

### Priority order

- primary: objective raw source body
- secondary: supplementary extracted or parsed material
- separate: user understanding and user commentary

### Guiding rule

- `raw_content` is mainly for objective source text.
- user interpretation remains separately represented.

## Round 10: Internalization Input Layering

### Agreed conclusions

- Internalization should not rely on `raw_content` alone.
- Internalization should use layered inputs:
  - primary raw body text
  - supplementary source-aware content
  - user understanding as guidance

### Role definitions

- `raw_content`: default and fastest usable primary text
- source-aware content: enhancement layer when more detail or source separation matters
- `my_understanding`: guidance layer rather than fact evidence layer

### Guiding rule

- Internalization should be:
  - raw-text-centered
  - source-enhanced
  - user-guided

## Round 11: Video Parsing Scope

### Agreed conclusions

- Video parsing is not a prerequisite for the current optimization discussion.
- Video parsing can be deferred to a later optimization stage.
- When introduced later, it should be treated as one additional supplementary source type rather than a new architectural foundation.

## Round 12: Internalization Scope Expansion

### Agreed direction from discussion

- Internalization should not be treated as only "generate a note body".
- Internalization should be understood as a broader workflow that may include:
  - parse completion for deferred or oversized sources
  - structured note generation
  - regenerated summary and tags
  - downstream graph and QA asset preparation

### Key implications

- Model selection matters for internalization quality and may need to be discussed separately from capture-time parsing models.
- Prompt design and tuning is part of internalization design, not an afterthought.
- Capture-time summary and tags should not automatically remain authoritative after internalization.
- Large files that were only partially processed at capture time may need to be fully parsed during internalization.
- Graph and QA should consume both:
  - pre-internalization source assets
  - post-internalization refined knowledge assets

## Round 13: Internalization Model And Prompt Position

### Agreed conclusions

- Internalization requires its own model-selection discussion.
- Internalization should not automatically inherit the same model strategy used in capture-time parsing.
- Prompt design for internalization is a first-class design topic.
- Prompt tuning should be discussed as part of internalization quality optimization.

### Why this matters

- Capture-time parsing optimizes more for speed, stability, and intake success.
- Internalization optimizes more for understanding quality, structure quality, consistency, and downstream reuse.
- Therefore, internalization may justify a different model choice, different prompt structure, and different tuning criteria.

### Open questions for the internalization layer

- What internalization quality dimensions matter most:
  - structural clarity
  - factual fidelity to source text
  - concept extraction quality
  - graph usefulness
  - QA usefulness
- Should one model handle the whole internalization workflow, or should different subtasks use different models or prompts?

## Round 14: Internalization Model Priority

### Agreed conclusions

- The first-priority optimization target for internalization is:
  - fidelity to source text
  - insight and association beyond plain summarization

### Interpretation

- Internalization should not drift away from the source text.
- Internalization should also not stop at mechanical compression.
- The desired result is knowledge enhancement grounded in the source, not free-form rewriting.

### Prompt-design implication

- Internalization prompts should help the model distinguish:
  - what is explicitly supported by the source
  - what is a reasonable inference
  - what concepts, links, or extensions are worth surfacing

## Round 15: Internalization Output Structure

### Agreed conclusions

- Internalized note content should have a stable structured output.
- The most important design requirement is explicit separation between:
  - source-supported content
  - model-generated inference or extension

### Core content blocks

- core content
- key information / key concepts
- source-supported points
- inference and extension
- association directions / possible future links

### Priority judgment

- must-have:
  - core content
  - key information / key concepts
  - source-supported points
- strongly recommended:
  - inference and extension
  - association directions / future links

### Product-level meaning

- This separation is not only a prompt detail.
- It is part of product trust, readability, and evidence clarity.

## Round 16: Internalization Formal Assets

### Agreed conclusions

- Internalization should produce a set of formal assets, not only a readable note body.

### Must-have formal assets

- finalized note body
- finalized summary
- finalized tags / concepts
- fact-layer fragments that are clearly supported by source material

### Nice-to-have, phaseable later

- inference-layer fragments as separately structured assets

### Practical interpretation

- inference and extension should at minimum remain explicitly separated inside the internalized note body
- a dedicated structured inference asset can be postponed if needed during the current optimization phase

## Round 17: Graph Node And Evidence Basis

### Agreed conclusions

- Graph primary nodes should be based on internalized notes.
- Relationship discovery should mainly use internalized knowledge assets.
- Relationship evidence should be able to trace back to source material whenever possible.

### Practical interpretation

- node body = note-level knowledge unit
- edge discovery = primarily from internalized note understanding
- edge evidence = preferably grounded in source assets

## Round 18: Minimal Relation Types

### Agreed conclusions

- The current optimization phase should keep a small, stable relation set.
- `contradicts` should not be included for now.

### Current preferred relation types

- `related`
- `supports`
- `example_of`

### Why `contradicts` is excluded for now

- higher judgment difficulty
- higher QA complexity
- higher risk of polluting graph trust

## Round 19: Relation Generation Strategy

### Agreed conclusions

- Relation generation should be multi-signal rather than single-signal.
- It should follow a three-stage pattern:
  - coarse candidate recall
  - model-based relation typing
  - evidence retention

### Preferred coarse signals

- embedding similarity
- concept / tag overlap
- title / summary / keyword overlap

### Preferred typing stage

- The model should judge relation type among the candidate pairs.
- The model should not be responsible for full-library search.

### Evidence expectation

- Relations should retain evidence inputs such as:
  - matched concepts
  - similar fragments
  - supporting source fragments
  - short relation rationale

## Round 20: Relation-Typing Inputs

### Agreed conclusions

- Relation typing should use layered inputs rather than blindly feeding every available field.

### Primary inputs

- finalized summary
- concepts / tags
- fact-layer fragments

### Secondary inputs

- core section of the finalized note body
- source fragments when clarification or validation is needed

### Inputs not preferred as primary evidence

- user understanding
- inference / extension content

## Round 21: Relation Confidence And Evidence Summary

### Agreed conclusions

- Every graph relation should carry at least:
  - relation type
  - confidence
  - evidence summary

### Why this is required

- Graph trust depends on distinguishing stronger and weaker relations.
- QA needs relation confidence to decide whether and how far to expand retrieval.
- Evidence summary is required for explainability in both graph browsing and QA use.

### Confidence interpretation

- Confidence does not need to begin as a highly precise score.
- A usable layered confidence model is sufficient in the current optimization phase.

### Evidence-summary role

- Evidence summary should briefly explain why a relation exists.
- It may be based on:
  - shared concepts
  - fact-layer fragments
  - supporting source fragments
  - short model rationale

## Round 22: QA Retrieval Entry Order

### Agreed conclusions

- QA retrieval should not begin with fully parallel use of internalized assets and raw source assets.
- The preferred order is:
  - first use internalized assets to identify the most relevant knowledge units
  - then use source assets for evidence support and validation
  - then expand through the graph only when needed

### Guiding rule

- internalized assets = understanding and routing entry
- source assets = evidence and factual grounding layer

## Round 23: When Graph Should Enter QA Retrieval

### Agreed conclusions

- The graph should not be the default first-stage retrieval entry.
- The graph should mainly act as a second-stage retrieval expansion mechanism.

### Preferred sequence

- direct retrieval from internalized assets
- source-evidence supplementation
- graph-based expansion when needed
- final answer organization

### Role definition

- graph = retrieval-range expander, not default first-hop retriever

## Round 24: Follow-Up Questions And Graph Use

### Agreed conclusions

- In multi-turn QA, graph use may need to happen earlier when the user is clearly asking a follow-up that depends on prior context.
- However, not every follow-up-shaped question is truly context-dependent.

### Key distinction

- conversational follow-up
- semantic follow-up

### Rule

- The agent should not equate "next message in the conversation" with "context-dependent question".
- Whether graph relations are reused should depend on semantic continuity, not message position alone.

## Round 25: Semantic Continuity Signals

### Agreed conclusions

- Semantic continuity should be judged from meaning, not merely conversational order.

### Preferred signals

- referential expressions
- topic continuation
- follow-up question type
- compatibility with the main assets retrieved in the previous turn

### Guiding rule

- semantic continuity should be inferred from:
  - referential signals
  - topic continuity
  - question type
  - previous-hit asset fit

## Round 26: Relation Preference In Follow-Up QA

### Agreed conclusions

- When a question is semantically continuous, graph relations should be chosen according to the follow-up intent.

### Preferred mapping

- evidence or support seeking -> `supports`
- example or case seeking -> `example_of`
- related-topic expansion -> `related`

### Fallback behavior

- If intent is unclear, retrieval should remain conservative rather than aggressively expanding through all relation types.

## Round 27: Follow-Up Intent Routing

### Agreed conclusions

- Follow-up relation routing should be driven by lightweight intent recognition.

### Current intent groups

- evidence strengthening
- example expansion
- related-topic expansion

### Safety rule

- If the relation-intent signal is weak, prefer limited or conservative expansion.

## Round 28: QA Agent Stopping Rule

### Agreed conclusions

- The QA agent should stop when evidence is sufficient rather than maximizing search breadth.
- The QA agent should be "enough and stop", not "search as long as possible".

### Preferred stopping situations

- evidence is sufficient for the current question
- expansion benefit has clearly declined
- evidence is still insufficient and continued expansion is unlikely to solve the gap

### Answering policy

- can answer -> answer directly
- can partially answer -> answer with uncertainty
- cannot answer reliably -> explicitly state insufficient evidence

## Round 29: QA System Positioning

### Agreed conclusions

- QA should be built as RAG, but not as a basic single-pass RAG pipeline.
- The preferred direction is an agent-guided RAG system.

### Positioning statement

- QA = a source-grounded, graph-enhanced RAG system
- source assets provide the factual evidence base
- internalized assets provide the main retrieval entry
- graph relations provide expansion capability
- the agent is responsible for retrieval and answer-planning decisions

### Architectural interpretation

- RAG is the backbone
- agent behavior sits on top of RAG as the decision layer
- QA should not be treated as a free-form agent without retrieval structure

## Round 30: Chunking Position In The System

### Agreed conclusions

- Chunking remains necessary.
- Chunking should be treated as a foundational retrieval structure rather than a user-facing product concept.
- The system should support both:
  - internalized-asset chunks
  - source-asset chunks

### Different purposes

- internalized chunks = knowledge-location units
- source chunks = evidence-support units

### Design-level rules

- internalized chunks should be more structure-aware and knowledge-unit-oriented
- source chunks should preserve more original context continuity
- chunking should retain source mapping, especially for source assets

## Round 31: Answer Evidence Presentation

### Agreed conclusions

- Answer evidence should be shown in a lightweight way.
- The answer should let the user know what it is based on without overwhelming them with raw retrieval fragments.

### Evidence-display expectations

- indicate where the basis comes from
- briefly explain why the basis is relevant
- reflect evidence strength rather than pretending all support is equally strong

### Product rule

- The answer should be understandable and grounded, not a dump of stitched evidence.

## Round 32: Answer Voice And Readability

### Agreed conclusions

- Answers should sound like natural human explanation rather than stitched retrieval output.
- Retrieval is the support layer, not the surface voice.

### Practical meaning

- The answer should reorganize retrieved material into coherent explanation.
- It should not read like pasted fragments from notes or source chunks.
- Natural explanation quality is part of the product requirement, not a cosmetic preference.

## Round 33: Uncertainty Expression

### Agreed conclusions

- Uncertainty should be expressed honestly, but it should not dominate the answer tone.
- The preferred pattern is:
  - first give the strongest current judgment
  - then state the boundary conditions or evidence limits

### Confidence bands

- high certainty:
  - answer directly, with light grounding
- medium certainty:
  - answer, then clarify the evidence boundary
- low certainty:
  - allow partial answer, but explicitly state what is unsupported

### Product rule

- uncertainty should appear as boundary clarification, not as a front-loaded weakening of the whole response

## Round 34: Asset Persistence Layers

### Agreed conclusions

- System assets should be viewed in three persistence layers:
  - long-term assets
  - intermediate assets
  - runtime assets

### Long-term assets

- source assets
- finalized internalization assets
- graph formal assets
- key QA outcome assets

### Intermediate assets

- chunks
- embeddings
- parse-completion results
- fact-layer fragments
- potentially other reusable evidence-oriented derived assets

### Runtime assets

- per-turn retrieval candidate sets
- expansion paths
- temporary agent judgments
- temporary answer-context assemblies
- other per-task transient working sets

### Framing statement

- long-term assets = knowledge body
- intermediate assets = knowledge infrastructure
- runtime assets = task-time working memory

## Round 35: Current Object Role Clarity

### Agreed conclusions

- Some current objects already have relatively clear roles:
  - `notes`
  - `note_relations`
  - `note_chunks`
- `capture_items` is currently the most mixed-responsibility object and is the best candidate for further boundary clarification.
- QA-related tables are long-term interaction assets, but their boundaries do not need to be the first structural priority right now.

### Practical interpretation

- `notes` can continue to be strengthened without rethinking their core identity.
- `note_relations` can continue to evolve as graph assets.
- `note_chunks` can continue to serve as intermediate retrieval infrastructure.
- `capture_items` deserves the next round of careful design clarification.

## Round 36: Implementation Anti-Chaos Principles

### Agreed conclusions

- Future implementation should be staged and complexity-controlled.

### Anti-chaos rules

- change one primary layer goal at a time
- stabilize data boundaries before adding more intelligence
- prefer extending existing objects over introducing parallel systems
- separate formal assets from runtime decision logic
- make each implementation stage independently verifiable

### Framing statement

- first clarify boundaries
- then strengthen capabilities
- advance one core complexity at a time

## Round 37: `capture_items` Responsibility Boundary

### Agreed conclusions

- `capture_items` should continue to retain its upstream role.
- It should remain the main object for:
  - capture identity
  - raw-material snapshot entry
  - lifecycle state
  - lightweight parse/process status

### Responsibilities that should stay

- capture record identity
- raw snapshot entry role
- lifecycle / flow status
- lightweight parse status and retry-state information

### Responsibilities that should gradually move away

- finalized knowledge results
- source-level detailed material structures
- graph-specific assets
- QA-specific retrieval or reasoning assets

### Direction statement

- `capture_items` should be an upstream intake-and-state object, not a long-term all-purpose container for downstream knowledge products

## Round 38: Data-Layer Closure

### Agreed conclusions

- The data layer can be understood through four asset classes:
  - source assets
  - internalization assets
  - graph assets
  - QA assets

### Persistence-layer framing

- long-term assets:
  - source assets
  - finalized internalization assets
  - formal graph assets
  - key QA outcome assets
- intermediate assets:
  - chunks
  - embeddings
  - parse-completion outputs
  - fact-layer fragments
- runtime assets:
  - temporary retrieval candidates
  - expansion paths
  - temporary agent judgments
  - temporary answer-context assemblies

### `capture_items` top-level role

- `capture_items` keeps:
  - capture identity
  - raw snapshot entry
  - lifecycle state
  - lightweight parse/process state
- `capture_items` should not remain the main container for:
  - finalized knowledge products
  - graph-specific products
  - QA-specific products

### Field-role clarifications

- top-level identity fields remain appropriate on `capture_items`
- `raw_content` remains, but as aggregated primary raw view rather than the sole canonical source
- `summary` and `tags` on `capture_items` are capture-stage transitional assets
- `summary`, `tags`, and `concepts` on `notes` are formal internalization-stage assets

### Content-layer distinction

- `raw_content` = material layer
- `note.content` = understanding layer

### Relationship between capture and note

- current default mental model:
  - one capture item -> one primary note
- design stance:
  - do not permanently hard-code this as an immutable one-to-one future

### Chunking conclusion

- both internalized chunks and source chunks are required
- internalized chunks serve knowledge location
- source chunks serve evidence support

## Round 39: Internalization-Layer Closure

### Agreed conclusions

- Internalization is the knowledge-upgrade hub.
- It is responsible for:
  - parse completion for deferred or oversized material
  - structured note generation
  - regenerated formal summary / tags / concepts
  - downstream asset preparation for graph and QA

### Input layering

- primary input:
  - raw source body
- auxiliary input:
  - source-aware supplementary content
- guidance input:
  - user understanding

### Model and prompt direction

- priority:
  - fidelity to source text
  - insight and association
- prompts must distinguish:
  - source-supported content
  - inference / extension

### Formal outputs

- finalized note body
- finalized summary
- finalized tags / concepts
- fact-layer fragments
- inference-layer content stays at least visibly separated, even if not yet fully assetized

## Round 40: Graph-Layer Closure

### Agreed conclusions

- graph primary nodes should currently be based on `notes`
- graph relation set should remain minimal and stable in the current phase

### Preferred relation types

- `related`
- `supports`
- `example_of`

### Relation-generation strategy

- coarse recall:
  - embedding similarity
  - concept/tag overlap
  - keyword/title/summary overlap
- relation typing:
  - model-based judgment
- persistence:
  - retain evidence

### Relation-basis rule

- relation discovery mainly uses internalized assets
- relation evidence should trace back to source assets when possible

### Required relation metadata

- relation type
- confidence
- evidence summary

## Round 41: QA Retrieval-Layer Closure

### Agreed conclusions

- QA should be treated as agent-guided RAG.
- Retrieval order should be:
  - first internalized assets
  - then source assets
  - graph expansion only when needed

### Chunking conclusion

- internalized chunks:
  - knowledge-location role
- source chunks:
  - evidence-support role

### Graph role in QA

- graph is mainly a retrieval expander
- graph is not the default first-hop retriever

## Round 42: QA Agent-Decision Closure

### Agreed conclusions

- the QA agent decides:
  - whether the question is new or context-dependent
  - whether a follow-up is semantically continuous
  - whether the user is asking for support, example, or related expansion
  - whether evidence is sufficient
  - whether to continue retrieval or stop

### Semantic continuity rule

- semantic continuity is judged by:
  - referential expressions
  - topic continuation
  - follow-up type
  - compatibility with previous-hit assets

### Follow-up relation routing

- support-seeking -> `supports`
- example-seeking -> `example_of`
- related expansion -> `related`

### Stopping rule

- answer when evidence is enough
- answer partially with boundary statements when evidence is partial
- explicitly state insufficient evidence when reliable support is missing

## Round 43: QA Intent Taxonomy

### Agreed direction

- QA intent recognition should not only cover follow-up relation routing.
- It should also classify the user's question at the whole-QA level.

### Proposed primary QA intents

- fact query
- concept explanation
- summary / synthesis
- comparison / distinction
- action advice
- evidence strengthening
- example / case request
- related-topic expansion

### Notes

- follow-up relation routing remains a sub-layer inside QA intent handling
- `supports / example_of / related` are not the whole intent taxonomy
- they are graph-expansion preferences used after higher-level intent recognition

## Round 44: QA Role Split

### Agreed conclusions

- QA should be designed with two roles in mind:
  - decision role
  - answer role
- In the current optimization phase, these two roles may still be implemented by the same model if needed.

### Decision role

- intent recognition
- follow-up recognition
- semantic continuity judgment
- graph-expansion decision
- stopping decision

### Answer role

- answer organization
- natural explanation
- evidence-grounded response
- uncertainty / boundary expression

## Round 45: QA Answer-Model Priorities

### Agreed conclusions

- QA answer-model priorities should be:
  - fidelity to evidence
  - multi-source context integration
  - natural explanation quality
  - proper uncertainty and boundary expression

### Framing statement

- the answer model should prioritize evidence-faithful synthesis and natural explanation over merely sounding smart

## Round 46: QA Role Ability Priorities

### Agreed conclusions

- the decision role and answer role should optimize for different strengths

### Decision-role priorities

- stability
- conservative judgment
- non-aggressive expansion

### Answer-role priorities

- multi-source integration
- natural human-readable explanation
- trust-preserving boundary expression

## Round 47: QA Decision-Prompt Design

### Agreed conclusions

- Decision prompting should be treated as a structured routing task rather than a free-form reasoning or answer-writing task.

### Decision-prompt responsibilities

- classify primary QA intent
- judge whether the current turn is a semantic follow-up
- decide whether graph expansion is needed
- choose preferred relation direction when graph expansion is needed
- decide whether the system should behave conservatively

### Prompt-design principles

- short
- strict
- structured
- non-chatty

### Behavioral rule

- the decision prompt should favor stable executable routing decisions over elaborate explanation

## Open Questions For Next Discussion

- At the data-definition layer, what exact fields should remain in `capture_items` versus move into adjacent source-aware structures?
- What is the minimum field set needed so that internalization, graph, and QA can all reuse capture-layer assets without repeated parsing?

## Update Rule

- After each discussion round, append:
  - the topic
  - agreed conclusions
  - unresolved questions
- Do not convert this file into an implementation spec until the discussion phase is explicitly closed.
