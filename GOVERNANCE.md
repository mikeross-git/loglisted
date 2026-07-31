# Governance

## Purpose

This project maintains an open, transparent methodology for analyzing scripts and providing feedback to writers.

The goal is to develop a useful, testable, and openly governed framework that can improve through evidence, criticism, and contributions from writers, editors, creators, researchers, educators, developers, and other industry participants.

## Project Scope

This repository governs:

* The scoring methodology
* Definitions of scoring dimensions
* Weighting and aggregation rules
* Calibration guidance
* Evaluation examples and test cases
* The reference implementation
* Documentation related to interpretation and limitations

This repository does not necessarily include the full commercial product, user interface, infrastructure, private datasets, or internal services that may use the methodology.

## Decision-Making Principles

Project decisions should favor:

1. Transparency
2. Explainability
3. Reproducibility
4. Practical value for writers
5. Evidence over personal preference
6. Clear documentation
7. Backward compatibility where reasonable
8. Respect for creative diversity

No score should be presented as a definitive judgment of a writer, script, genre, culture, or artistic approach. Rather, they should provide something that is repeatable and can be benchmarked against a population.

## Roles

### Users

Users may read the methodology, use the reference implementation, open issues, and participate in discussions.

### Contributors

Contributors may propose methodology changes, improve documentation, add examples, submit tests, report inconsistencies, and open pull requests.

### Maintainers

Maintainers review contributions, manage releases, moderate project spaces, and decide whether proposed changes are accepted.

Maintainers are expected to explain significant decisions and disclose relevant conflicts of interest.

### Project Lead

The Project Lead has final responsibility for:

* Resolving decisions that cannot reach consensus
* Appointing or removing maintainers
* Approving major releases
* Protecting the project’s scope and integrity
* Responding to urgent security, legal, or safety concerns

The current Project Lead is the repository owner unless otherwise documented.

## Types of Changes

### Minor Changes

Minor changes include:

* Typographical corrections
* Clarifications that do not change scoring behavior
* Documentation improvements
* New examples that do not alter the methodology
* Internal refactoring that does not change outputs

Minor changes may be approved through a normal pull request.

### Methodology Changes

Methodology changes include:

* Adding or removing a scoring dimension
* Changing a dimension definition
* Changing weights, thresholds, or formulas
* Changing how evidence is interpreted
* Changing expected scores for existing evaluation cases
* Introducing a new calibration approach
* Making a change that materially affects prior results
* Changing an LLM provider used for the analysis
* Changing prompts to an LLM
* Changing results from an LLM

Methodology changes should begin with an issue or proposal before implementation.

### Major Changes

Major changes include:

* Redesigning the overall scoring framework
* Changing the meaning of published score ranges
* Introducing incompatible output formats
* Removing substantial methodology components
* Changing the project’s governance or licensing model
* Redesigning the LLM structure and prompts

Major changes require an extended public review period and approval from the Project Lead.

## Proposal Process

A methodology proposal should include:

* The problem being addressed
* The current behavior
* The proposed change
* The reasoning behind the change
* Examples or evidence supporting it
* Expected effects on existing scores
* Known drawbacks or tradeoffs
* New or updated evaluation cases
* Any compatibility concerns

Proposals should be discussed in a GitHub Issue before a pull request is opened, unless the change is clearly minor.

For substantial changes, maintainers may request a formal proposal in an `rfcs/` directory.

## Review and Approval

Maintainers should evaluate contributions based on:

* Alignment with project goals
* Clarity of reasoning
* Quality of supporting evidence
* Effect on writers and end users
* Reproducibility
* Test coverage
* Documentation quality
* Compatibility with existing methodology
* Risk of unintended bias or misuse

Acceptance is not based solely on popularity or the number of reactions a proposal receives.

A pull request normally requires:

* Review by at least one maintainer
* Resolution of review comments
* Passing required automated checks
* Updated documentation when behavior changes
* Updated evaluation cases when scoring changes

## Consensus and Final Decisions

The project should seek consensus through open discussion.

Consensus does not require unanimous agreement. It means that major concerns have been considered, documented, and addressed where practical.

When consensus cannot be reached, the Project Lead may make a final decision. The reasoning should be recorded publicly unless legal, security, privacy, or safety concerns prevent disclosure.

## Versioning

Published versions should follow semantic versioning where practical:

* Patch release: corrections or clarifications that do not materially change scoring
* Minor release: backward-compatible additions or limited scoring changes
* Major release: substantial or incompatible methodology changes

Methodology versions should be identifiable so that a score can be associated with the exact rules used to produce it.

## Deprecation

When a scoring rule or output field is replaced, the project should document:

* What is being deprecated
* Why it is being deprecated
* What replaces it
* When support will end
* Whether prior scores remain comparable

Where reasonable, deprecated behavior should remain available for at least one published release.

## Conflicts of Interest

Contributors and maintainers should disclose conflicts that could materially affect a proposal, including:

* Commercial relationships
* Paid consulting
* Ownership interests
* Vendor affiliations
* Research sponsorship
* Personal involvement in the material being evaluated

Disclosure does not automatically disqualify participation. It helps the community interpret recommendations appropriately.

## Moderation

Participation is governed by the project’s `CODE_OF_CONDUCT.md`.

Maintainers may edit, hide, lock, or remove content that violates project rules. They may also restrict participation when necessary to protect contributors or maintain productive discussion.

## Security and Privacy

Security vulnerabilities should not be reported through public issues when doing so could expose users or systems.

Do not submit:

* Private scripts without permission
* Customer data
* Personal information
* API keys or credentials
* Confidential evaluation material
* Copyrighted material that cannot legally be redistributed

## Governance Changes

Changes to this document should be proposed through a pull request.

Material governance changes should include a public discussion period before approval.
