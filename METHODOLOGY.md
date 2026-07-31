# Loglisted Screenplay Scoring Methodology

**Methodology Version:** 0.1.0  
**Status:** Draft for Public Comment  
**Last Updated:** July 2026

## Purpose

This document defines the public scoring methodology used by Loglisted to evaluate feature screenplays and television pilots.

The purpose of the methodology is to make screenplay evaluation more structured, consistent, explainable, and open to improvement.

It is not intended to make artistic taste objective or to declare that a numerical score is the final judgment of a screenplay or writer.

The methodology is designed to:

- provide emerging writers with clear and actionable feedback
- connect scores to evidence from the screenplay
- make scoring categories, weights, and calculations transparent
- allow contributors to challenge and improve scoring rules
- support consistent comparison across scripts
- identify promising work within high submission volumes
- create a framework that can be tested against human judgment and industry outcomes

The methodology should evolve through public proposals, documented evidence, evaluation, and versioned releases.

## Authority of This Document

This file is the current public specification for:

- scoring categories
- scoring criteria
- score anchors
- category and overall-score calculations
- evidence requirements
- confidence and uncertainty rules
- benchmark interpretation
- methodology limitations

The broader product thesis, research plan, and long-term vision are described in [`WHITEPAPER.md`](./WHITEPAPER.md).

The prompts used to apply this methodology are published separately in [`PROMPTS.md`](./PROMPTS.md).

Merging a methodology change into this repository does not automatically change the production application. Approved methodology releases are implemented in the application through a separate review, testing, and deployment process.

The production application should identify the methodology version used to generate each result.

---

# 1. Core Principles

## 1.1 Explainability

Scores should be supported by specific evidence from the screenplay.

A score without an explanation is incomplete.

Where practical, findings should identify the relevant:

- page
- scene
- sequence
- character
- line of dialogue
- structural event
- recurring pattern

## 1.2 Separation of Observation and Judgment

The system should distinguish among:

1. **Objective or directly observable information**  
   Examples include page count, scene count, location, character appearances, and dialogue volume.

2. **Model inference**  
   Examples include likely genre, tone, intended audience, thematic focus, and story engine.

3. **Evaluative judgment**  
   Examples include whether dialogue is effective, whether pacing is strong, or whether a premise is commercially distinctive.

These forms of information should not be presented as interchangeable.

## 1.3 Blind Evaluation

The scoring process should exclude information that is not necessary to evaluate the screenplay itself.

The evaluator should not receive:

- writer identity
- demographic information
- account information
- profile information
- prior submission history
- previous scores
- payment status
- platform engagement history
- industry relationships
- personal risk or abuse classifications

The screenplay should be evaluated on the submitted work and the evidence available within it.

## 1.4 Deterministic Calculation

The language model may assign subcategory scores and provide evidence.

Deterministic code should:

- validate score ranges
- validate required fields
- validate weight totals
- calculate weighted category scores
- calculate the overall score
- apply rounding rules
- store methodology and prompt versions

The model should not be responsible for performing final weighting arithmetic when deterministic code can perform it consistently.

## 1.5 Sparse Top Scores

The top of the scoring scale should remain intentionally rare.

A compelling premise, one excellent character, or one standout sequence is not enough to justify an elite overall score.

Scores above 9.5 should require sustained excellence across nearly every relevant scoring category.

## 1.6 Scores Are Diagnostic

Scores are intended to help identify strengths, weaknesses, revision priorities, and potentially promising work.

They should not be treated as:

- objective measurements of artistic worth
- guarantees of commercial success
- guarantees of representation or production
- rankings of writers as people
- substitutes for human taste
- permanent judgments

---

# 2. Scoring Architecture

The methodology contains ten top-level categories:

1. Premise
2. Story
3. Structure
4. Characters
5. Dialogue
6. Pacing
7. Theme
8. Tone
9. Marketability
10. Craft

Each category contains five subcategories.

Each subcategory receives a score from 1.0 to 10.0.

The five subcategory weights within a category must total 100%.

## 2.1 Category Score

A category score is calculated as the weighted sum of its five subcategory scores:

```text
Category Score =
(Subcategory 1 Score × Subcategory 1 Weight)
+ (Subcategory 2 Score × Subcategory 2 Weight)
+ (Subcategory 3 Score × Subcategory 3 Weight)
+ (Subcategory 4 Score × Subcategory 4 Weight)
+ (Subcategory 5 Score × Subcategory 5 Weight)
```

Weights are expressed as decimals during calculation.

For example, a weight of 20% is calculated as `0.20`.

## 2.2 Overall Score

The overall score is the arithmetic mean of all ten category scores:

```text
Overall Score =
Sum of All Ten Category Scores ÷ 10
```

Each top-level category therefore contributes equally to the overall score in methodology version 0.1.0.

Changing the relative weight of a top-level category requires a public methodology proposal and a new methodology release.

## 2.3 Internal Precision and Public Rounding

Calculations should preserve their available internal precision.

Public category and overall scores should be rounded to one decimal place.

For example:

```text
Internal score: 7.846
Public score: 7.8
```

Rounding should occur only after the underlying category or overall calculation is complete.

Intermediate values should not be repeatedly rounded in a way that changes the final result.

---

# 3. Score Scale

All subcategories, categories, and overall results use a scale from 1.0 to 10.0.

## 3.1 General Score Anchors

### 10.0 — Extraordinary Benchmark

One of the finest examples of screenplay execution in its genre or format.

A score of 10.0 should be exceptionally rare and supported by sustained evidence.

### 9.5–9.9 — Elite Professional

Elite professional work that can credibly be discussed alongside the strongest modern screenplays.

The work demonstrates sustained excellence with very few meaningful weaknesses.

### 9.0–9.4 — Outstanding Professional

Outstanding professional-level work comparable to top-tier produced screenplays.

Weaknesses may exist, but they do not materially undermine the execution.

### 8.0–8.9 — Strong Professional

Strong professional work with realistic commercial or artistic viability.

The screenplay demonstrates clear command of craft, although meaningful improvements may remain.

### 7.0–7.9 — Good

Good work with clear strengths and material weaknesses.

A score in this range should not be described as poor or failing.

A 7 represents successful execution with identifiable room for improvement.

### 6.0–6.9 — Competent and Promising

Competent work that demonstrates promise but is not yet consistently industry-ready.

The screenplay may contain strong elements but lacks consistency, depth, clarity, or execution in important areas.

### Below 6.0 — Developing

Developing work that requires substantial revision.

The screenplay may contain promising ideas or isolated strengths, but important craft problems interfere with its effectiveness.

## 3.2 Interpretation of Key Scores

The scoring prompt should reinforce the following:

- **7 is good**
- **8 is professional**
- **9 is exceptional**
- **Scores above 9.5 are extraordinarily rare**

Evaluators should not inflate scores merely because a script is competent, enjoyable, polished, or promising.

Evaluators should also not treat a score below 8 as a dismissal of the writer or screenplay.

---

# 4. Scoring Categories

## 4.1 Premise

Premise evaluates the strength, clarity, distinctiveness, and dramatic potential of the screenplay’s central concept.

It considers whether the underlying idea creates a meaningful foundation for the story.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Originality` | `25%` |
| `Clarity` | `12.5%` |
| `Hook` | `25%` |
| `Stakes` | `12.5%` |
| `Commercial Appeal` | `25%` |
| **Total** | **100%** |


## 4.2 Story

Story evaluates the development, coherence, escalation, and dramatic effectiveness of the narrative.

It considers whether events build meaningfully and whether the central dramatic movement remains engaging and understandable.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Conflict` | `25%` |
| `Escalation` | `25%` |
| `Causality` | `15%` |
| `Emotional Impact` | `15%` |
| `Resolution` | `20%` |
| **Total** | **100%** |

## 4.3 Structure

Structure evaluates how effectively the screenplay organizes dramatic events, sequences, turning points, and progression.

It considers whether the form supports the intended experience rather than requiring every script to follow one universal formula.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Opening` | `25%` |
| `Plot Progression` | `25%` |
| `Turning Points` | `15%` |
| `Climax` | `25%` |
| `Scene Flow` | `10%` |
| **Total** | **100%** |

## 4.4 Characters

Characters evaluates characterization, motivation, agency, development, relationships, and dramatic function.

It considers whether characters feel sufficiently distinct, purposeful, and compelling within the intended style and genre.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Protagonist` | `25%` |
| `Supporting Characters` | `25%` |
| `Character Arcs` | `25%` |
| `Motivation` | `12.5%` |
| `Relationships` | `12.5%` |
| **Total** | **100%** |

## 4.5 Dialogue

Dialogue evaluates the effectiveness of spoken language within the screenplay’s intended genre, tone, period, and style.

It may consider voice, subtext, naturalness, memorability, dramatic purpose, and efficiency.

Dialogue should not be judged only by whether it resembles everyday speech. Stylized, heightened, sparse, period-specific, or genre-specific dialogue may be effective on its own terms.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Naturalness` | `15%` |
| `Subtext` | `10%` |
| `Voice` | `40%` |
| `Memorability` | `25%` |
| `Efficiency` | `10%` |
| **Total** | **100%** |

## 4.6 Pacing

Pacing evaluates the screenplay’s control of momentum, duration, escalation, variation, and narrative movement.

It considers whether the pace supports the intended dramatic experience.

Fast pacing is not automatically better than slow pacing. Deliberate stillness, tension, repetition, or gradual development may be appropriate when effectively executed.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Momentum` | `25%` |
| `Scene Rhythm` | `15%` |
| `Narrative Balance` | `20%` |
| `Tension Management` | `20%` |
| `Engagement` | `20%` |
| **Total** | **100%** |
   
## 4.7 Theme

Theme evaluates the screenplay’s development of ideas, meaning, moral or emotional questions, and thematic coherence.

A screenplay does not need to state its themes explicitly.

Theme should be evaluated through the relationship among events, characters, choices, imagery, conflict, and consequences.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Novelty` | `25%` |
| `Clarity` | `25%` |
| `Integration` | `20%` |
| `Depth` | `15%` |
| `Consistency` | `15%` |
| **Total** | **100%** |

## 4.8 Tone

Tone evaluates the screenplay’s control of mood, style, emotional register, genre expectations, and tonal consistency.

Tonal shifts are not automatically weaknesses.

A shift should be evaluated according to whether it appears intentional, understandable, and effective.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Consistency` | `25%` |
| `Genre Alignment` | `10%` |
| `Emotional Authenticity` | `20%` |
| `Atmosphere` | `35%` |
| `Relatability` | `10%` |
| **Total** | **100%** |

## 4.9 Marketability

Marketability evaluates the screenplay’s practical positioning, audience clarity, production considerations, genre accessibility, and potential industry interest.

Marketability is not the same as artistic quality.

A highly marketable screenplay may contain craft weaknesses. A less conventionally marketable screenplay may demonstrate exceptional artistic achievement.

Marketability should not dominate unrelated craft categories.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Audience Appeal` | `50%` |
| `General Positioning` | `20%` |
| `Production Feasibility` | `10%` |
| `Distinctiveness` | `10%` |
| `Franchise Potential` | `10%` |
| **Total** | **100%** |

## 4.10 Craft

Craft evaluates the technical execution, clarity, readability, formatting, visual communication, and control demonstrated on the page.

Craft should distinguish between minor formatting imperfections and problems that materially interfere with comprehension or dramatic impact.

### Current Subcategories and Weights

| Subcategory | Weight |
|---|---:|
| `Formatting` | `25%` |
| `Grammar` | `25%` |
| `Visual Storytelling` | `20%` |
| `Clarity of Writing` | `20%` |
| `Economy` | `10%` |
| **Total** | **100%** |
   
---

# 5. Evidence Requirements

Each scored subcategory should be supported by evidence.

Evidence may include:

- a specific page or scene
- a line or exchange of dialogue
- a recurring narrative pattern
- a structural event
- a character decision
- a setup and payoff
- an example of escalation
- an example of tonal control or inconsistency
- an example of visual storytelling
- an example of unclear or ineffective execution

Evidence should explain why it supports the score.

A citation without interpretation is incomplete.

An interpretation without identifiable evidence should be treated with lower confidence.

## 5.1 Representative Evidence

The evaluator should select evidence that represents meaningful patterns rather than relying only on isolated moments.

A single weak line should not determine the entire dialogue score.

A single strong scene should not justify an elite character or structure score if the rest of the screenplay does not sustain that quality.

## 5.2 Positive and Negative Evidence

Where practical, analysis should identify both:

- evidence supporting the screenplay’s strengths
- evidence supporting identified weaknesses or revision priorities

## 5.3 Evidence Availability

When the screenplay does not provide enough evidence to judge a criterion reliably, the evaluator should report insufficient evidence or reduced confidence rather than inventing certainty.

---

# 6. Screenplay Processing

Long screenplays may be processed in sections before final scoring.

## 6.1 Chunk Summaries

When a screenplay cannot be evaluated in a single context, sections may be summarized.

Chunk summaries should preserve information relevant to later scoring, including:

- important events
- character actions and decisions
- conflict
- relationships
- setups and payoffs
- changes in goals
- tonal developments
- thematic developments
- pacing changes
- notable dialogue patterns
- page- or scene-level evidence

Chunk summaries should avoid replacing evidence with unsupported conclusions.

## 6.2 Final Scoring Context

The final evaluator may receive:

- screenplay text or selected portions
- chunk summaries
- representative excerpts
- deterministic metadata
- relevant page or scene references
- the current rubric
- scoring anchors
- output requirements
- methodology and prompt versions

The evaluator should not receive writer identity, account history, previous scores, or unrelated platform data.

## 6.3 Representative Excerpts

Representative excerpts should be selected to preserve evidence relevant to scoring.

Selection should not intentionally favor only the strongest or weakest portions.

The process should seek coverage across:

- the beginning
- the middle
- the ending
- major turning points
- important character interactions
- significant tonal or pacing changes
- scenes relevant to disputed or uncertain dimensions

---

# 7. Confidence and Uncertainty

A score should not imply more certainty than the available evidence supports.

Confidence may be reduced when:

- the available text is incomplete
- parsing is unreliable
- scenes are missing
- formatting is ambiguous
- the screenplay uses an unusual or experimental form
- a criterion has limited supporting evidence
- different portions of the screenplay strongly conflict
- repeated evaluations vary substantially
- genre or format classification is uncertain

Confidence should be reported separately from quality.

A high score with low confidence is not equivalent to a high score with strong evidence and stable evaluation.

A low-confidence result should not be presented as definitive.

---

# 8. Benchmarking and Percentiles

Raw scores and percentile rankings are different measures.

A raw score reflects evaluation under the published rubric.

A percentile reflects the script’s position within a defined comparison cohort.

Percentiles should identify the relevant cohort, including factors such as:

- methodology version
- screenplay format
- genre, when applicable
- evaluation period
- sample size
- inclusion criteria

## 8.1 Illustrative Launch Assumptions

The initial white paper proposed an illustrative emerging-writer distribution with:

- mean overall score near 6.3
- median overall score near 6.2
- standard deviation near 1.0
- approximately 10% of submissions at 7.6 or higher
- approximately 4% of submissions at 8.0 or higher
- approximately 1% of submissions at 8.7 or higher

These values are modeling assumptions for planning.

They are not observed industry statistics and should not be presented as empirical facts.

They should be replaced or revised when sufficient platform data and independent validation become available.

## 8.2 Modeled Versus Observed Benchmarks

Every published benchmark should be labeled as one of the following:

- **Modeled assumption**
- **Observed platform distribution**
- **Curated evaluation benchmark**
- **External comparison dataset**

Observed benchmark claims should include:

- cohort definition
- sample size
- methodology version
- collection period
- known exclusions
- relevant uncertainty
- whether the scripts were independently selected

## 8.3 Genre Benchmarking

Genre may affect the interpretation of pacing, dialogue, tone, structure, exposition, audience expectations, and production considerations.

Genre benchmarking should not automatically redefine artistic quality.

The methodology should distinguish among:

1. criteria intended to apply broadly
2. criteria whose interpretation may depend on genre or format
3. descriptive genre conventions that should not automatically affect quality scores

Hybrid, experimental, and cross-genre work should not be forced into a single comparison group when that would distort the evaluation.

---

# 9. Discovery and Ranking

The overall score should not be the sole basis for discovery or industry recommendation.

Discovery may also consider:

- standout category scores
- genre
- format
- intended audience
- production scale
- tone
- story engine
- creative fit
- specific industry search criteria
- human review
- confidence in the analysis

Similarity should not be presented as quality.

A script that resembles another work in genre, tone, character configuration, or pacing is not necessarily equally strong.

Any similarity or creative-neighbor result should explain which dimensions contributed to the match.

---

# 10. Validation

The methodology should be treated as a versioned measurement program rather than a static prompt.

## 10.1 Blind Validation

Scripts should be evaluated without writer identity or career information.

## 10.2 Inter-Rater Evaluation

Model scores should be compared with assessments from multiple qualified human readers where possible.

Human disagreement should be measured rather than hidden.

## 10.3 Repeatability

A fixed evaluation set should be rescored after meaningful changes to:

- prompts
- models
- rubric definitions
- weights
- chunking
- excerpt selection
- schemas
- aggregation rules

## 10.4 Calibration

Score bands should be tested against:

- independent reader judgments
- consistency across evaluators
- professional read requests
- positive coverage or recommendation decisions
- meetings
- representation interest
- options, staffing, or production outcomes where available

These outcomes may inform validation but should not be treated as pure measurements of screenplay quality.

## 10.5 Precision at the Top of the Funnel

One important discovery measure is precision among highly ranked or spotlighted scripts.

For example:

> Of the scripts identified as especially promising, what proportion receive serious reads or positive judgments from experienced industry readers?

The methodology does not need to create a perfect ranking of every screenplay to be useful.

It should be dependable where consequential discovery decisions are made.

## 10.6 Bias Review

Evaluation should test for unintended disparities related to:

- genre
- format
- culture
- language variety
- writing style
- nonlinear structure
- experimental form
- demographic representation
- historical period
- production scale
- conventional versus unconventional storytelling

A difference in score is not automatically evidence of bias, but meaningful and repeated disparities should be investigated.

---

# 11. Model and Prompt Variance

Language-model evaluation may vary because of:

- model architecture
- model version
- prompt version
- context limits
- generation settings
- chunking
- summarization
- excerpt selection
- parsing
- randomness
- provider changes

Every result should retain enough version information to identify the method used.

At minimum, a result should record:

```json
{
  "methodologyVersion": "0.1.0",
  "rubricVersion": "rubric-v1",
  "scoringPromptVersion": "scoring-v1",
  "chunkSummaryPromptVersion": "chunk-summary-v1",
  "benchmarkVersion": "benchmark-v1",
  "model": "<model-id>"
}
```

Historical scores should not be silently rewritten after a methodology change.

When recalculation is possible, the original result and version should remain identifiable.

---

# 12. Known Limitations

This methodology has important limitations.

## 12.1 Artistic Judgment Is Not Fully Objective

Reasonable readers may disagree about quality, meaning, tone, originality, marketability, or effectiveness.

A structured rubric can make disagreement easier to inspect, but it cannot eliminate taste.

## 12.2 Models May Miss Context

A model may misunderstand:

- irony
- cultural context
- period-specific language
- genre conventions
- visual implication
- experimental structure
- intentional ambiguity
- subtle character behavior
- humor
- subtext

## 12.3 Summarization Can Remove Evidence

When long screenplays are summarized, details relevant to scoring may be compressed or lost.

The final score may therefore be affected by what survives the summarization and excerpt-selection process.

## 12.4 Marketability Is Time-Sensitive

Market conditions change.

A marketability score may depend on assumptions about audience demand, production costs, industry trends, and buyer preferences that can become outdated.

## 12.5 Benchmarks May Be Incomplete

Early benchmark distributions may be modeled rather than observed.

Even observed platform data may not represent all emerging writers, genres, cultures, markets, or submission channels.

## 12.6 High Scores Do Not Guarantee Outcomes

A high score does not guarantee:

- representation
- financing
- production
- awards
- commercial performance
- audience reception

## 12.7 Low Scores Do Not Determine Potential

A low score may reflect:

- an early draft
- an unusual creative choice
- insufficient evidence
- a limitation of the methodology
- model error
- a mismatch between the work and the evaluation framework

Scores should support revision and discovery, not close off opportunity.

---

# 13. Versioning

This methodology follows semantic versioning where practical.

## Patch Release

Examples:

- typographical corrections
- wording clarification
- documentation improvements
- changes that cannot affect scores

Example:

```text
0.1.0 → 0.1.1
```

## Minor Release

Examples:

- compatible additions
- clarified scoring anchors that may affect interpretation
- recalibration
- new optional fields
- revised benchmark assumptions
- changes that may affect scores without replacing the overall framework

Example:

```text
0.1.0 → 0.2.0
```

## Major Release

Examples:

- adding or removing a scoring category
- changing the 1–10 scale
- changing the overall-score formula
- changing category-weight architecture
- incompatible output-schema changes
- redesigning the methodology

Example:

```text
0.2.0 → 1.0.0
```

Every release that may affect results should explain:

- what changed
- why it changed
- which scores may be affected
- whether prior results remain comparable
- what evaluation supports the change

Changes should also be recorded in [`CHANGELOG.md`](./CHANGELOG.md).

---

# 14. Proposing Changes

Contributors are encouraged to challenge:

- category definitions
- subcategories
- weights
- score anchors
- evidence requirements
- confidence rules
- benchmark assumptions
- aggregation methods
- genre handling
- validation procedures
- known limitations

A methodology proposal should include:

- the problem
- the current behavior
- the proposed change
- the reasoning
- supporting evidence or examples
- expected scoring impact
- drawbacks and tradeoffs
- a proposed evaluation method
- compatibility implications

A proposed change should explain not only why it may improve the methodology, but also where it may fail.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`GOVERNANCE.md`](./GOVERNANCE.md) for the review and decision process.

---

# 15. Current Release Status

Version 0.1.0 is a draft for public comment.

It should not be described as an established industry standard.

The long-term goal is to build a methodology that may earn broader trust through:

- public scrutiny
- transparent changes
- independent evaluation
- professional-reader comparison
- genre- and format-specific validation
- bias review
- reproducible releases
- demonstrated discovery outcomes

Trust should be earned through evidence and outcomes rather than asserted by the project.
