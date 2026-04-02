# Evaluation Form for a Software Project / Framework

**Project name:** `__________________________`\
**Version / date:** `__________________________`\
**Evaluator:** `__________________________`

## Rating scale

Use a score of **1 to 5** for each criterion:

- **1 = insufficient**
- **2 = weak**
- **3 = satisfactory**
- **4 = good**
- **5 = excellent**

You may also apply a **weighting** per domain. A suggested weighting is included below.

---

## 1. Problem Definition and Relevance

**Weight: 10%**

Assess whether the project solves a real problem and whether that problem is clearly defined.

| Criterion                    | 1                                     | 3                                          | 5                                             | Score |
| ---------------------------- | ------------------------------------- | ------------------------------------------ | --------------------------------------------- | ----- |
| Problem statement            | Absent or lacks specifics             | Identifiable but missing key constraints   | Fully specific, reproducible, and compelling  | __    |
| Relevance to target audience | No identified audience or use case    | Addresses a real audience with partial fit | Precisely matched to a defined audience need  | __    |
| Scope definition             | No stated boundaries or focus         | Boundaries exist but gaps remain           | Explicit boundaries with justified exclusions | __    |
| Distinctiveness              | Indistinguishable from existing tools | One differentiating angle articulated      | Unique position with a defensible rationale   | __    |

**Domain subtotal 1:** `____ / 20`

### Reflection questions

- Am I solving a real pain point, or mostly scratching my own itch?
- Can I explain in two sentences why this project should exist?
- Is the target audience specific enough?

---

## 2. Conceptual Design and Architecture

**Weight: 15%**

Assess whether the architecture is logical, coherent, and maintainable.

| Criterion               | 1                                         | 3                                                    | 5                                                             | Score |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- | ----- |
| Architectural coherence | No unifying design principle visible      | Coherent within modules but inconsistent across them | Single design philosophy applied consistently throughout      | __    |
| Modularity              | Components cannot be changed in isolation | Modules exist but share hidden dependencies          | Each module has an explicit contract and no implicit coupling | __    |
| Scalability of design   | Breaks under minimal growth               | Supports current scope without structural changes    | Supports ten-fold growth without architectural changes        | __    |
| Type/interface design   | Types leak internals or contradict usage  | Types are correct but not self-documenting           | Types encode invariants and guide correct usage               | __    |
| Technical trade-offs    | No trade-offs documented or considered    | Trade-offs acknowledged but rationale is incomplete  | Each trade-off documented with alternatives and rationale     | __    |

**Domain subtotal 2:** `____ / 25`

### Reflection questions

- Is my architecture genuinely elegant, or just clever on paper?
- Where are my ugliest compromises?
- What breaks if the codebase becomes five times larger?

---

## 3. Technical Implementation and Code Quality

**Weight: 20%**

This is about execution. Not just whether it works, but whether it is built well.

| Criterion                            | 1                                            | 3                                                  | 5                                                      | Score |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ----- |
| Correctness of implementation        | Produces wrong output for common inputs      | Correct for primary paths, edge cases untested     | Correct across all documented inputs and edge cases    | __    |
| Code readability                     | Control flow requires tracing to understand  | Readable with occasional indirection               | Each function readable in isolation without context    | __    |
| Consistency of style/patterns        | Multiple conflicting conventions in use      | One convention dominant, exceptions remain         | Single convention applied uniformly across codebase    | __    |
| Error handling                       | Errors silenced or handled inconsistently    | Errors surfaced but messages lack context          | Every error path returns actionable, typed diagnostics | __    |
| Maintainability                      | Changing one module forces changes elsewhere | Isolated changes possible with manual verification | Any module replaceable without modifying dependents    | __    |
| Type safety / correctness guarantees | No compile-time enforcement of invariants    | Key invariants typed, others left to runtime       | All domain invariants enforced at the type level       | __    |

**Domain subtotal 3:** `____ / 30`

### Reflection questions

- How much of the quality is actually in the code, and how much is in pretty examples?
- Are errors treated as first-class citizens, or shoved under the rug?
- Is the type system genuinely useful, or am I just doing intellectual cosplay?

---

## 4. Functionality and Feature Completeness

**Weight: 15%**

Assess whether the promised functionality is actually delivered and whether it feels coherent.

| Criterion                        | 1                                               | 3                                               | 5                                                        | Score |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- | ----- |
| Core functionality present       | One or more advertised features non-functional  | All advertised features work, minor gaps remain | Every documented feature complete and exercisable        | __    |
| Functional fit to goal           | Features do not map to stated problem           | Features address the problem with unused extras | Each feature traceable to a stated requirement           | __    |
| Depth of features                | Only trivial inputs or demo scenarios supported | Handles representative real-world inputs        | Handles production-scale inputs and compound workflows   | __    |
| Coherence between features       | Features conflict or duplicate each other       | Features coexist without friction               | Features compose — output of one feeds naturally to next | __    |
| Edge cases / real-world behavior | No edge cases identified or tested              | Known edge cases listed, most handled           | Edge cases enumerated, handled, and regression-tested    | __    |

**Domain subtotal 4:** `____ / 25`

### Reflection questions

- Are my features actually useful, or just demo material?
- Have I handled the boring but important cases properly?
- What would a critical first user immediately miss?

---

## 5. Developer Experience / Usability

**Weight: 15%**

For a framework, this matters a lot. If it is technically nice but feels awful to use, you are still screwed.

| Criterion                 | 1                                              | 3                                                   | 5                                                           | Score |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ----- |
| API ergonomics            | Common tasks require non-obvious steps         | Common tasks achievable in expected number of steps | Every task achievable via the shortest plausible call chain | __    |
| Learning curve            | Requires reading source code to get started    | Usable after reading docs, few surprises            | First working example achievable within minutes from docs   | __    |
| Feedback / error messages | Errors lack location, cause, or next steps     | Errors identify the cause but not how to fix it     | Every error includes location, cause, and suggested fix     | __    |
| Documentation usability   | Key sections missing or contain only marketing | All features documented, examples are sparse        | Each feature documented with runnable example and rationale | __    |
| Testability for users     | No testing utilities or guidance provided      | Tests possible with manual setup                    | Dedicated test helpers, fixtures, and documented patterns   | __    |

**Domain subtotal 5:** `____ / 25`

### Reflection questions

- Would someone else actually enjoy using this?
- Is the first experience smooth or irritating?
- Are my docs real documentation, or just perfume sprayed over missing clarity?

---

## 6. Validation, Testing, and Reliability

**Weight: 15%**

Assess how well the project is supported by tests and evidence of reliability.

| Criterion                             | 1                                                   | 3                                                      | 5                                                           | Score |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | ----- |
| Test coverage of core functionality   | Core paths untested or tests do not assert outcomes | Primary paths tested, secondary paths uncovered        | Every public API path tested with expected and error inputs | __    |
| Quality of testing strategy           | Tests exist without a visible strategy              | One test type dominant, other layers missing           | Distinct unit, integration, and end-to-end layers present   | __    |
| Validation of edge cases              | No edge-case tests identifiable                     | Known edge cases listed, most covered by tests         | Edge cases enumerated in tests with boundary-value coverage | __    |
| Reproducibility                       | Test results vary between runs or environments      | Reproducible locally, CI not configured                | Deterministic results in CI with pinned dependencies        | __    |
| Reliability across runtimes/platforms | Tested on one runtime only                          | Tested on target runtime, other platforms not verified | Tested on all supported runtimes with documented results    | __    |

**Domain subtotal 6:** `____ / 25`

### Reflection questions

- Am I testing what is actually risky, or only what is easy to test?
- Do I have evidence of reliability, or mostly confidence?
- Would I trust my own framework for something important?

---

## 7. Documentation, Presentation, and Professional / Academic Justification

**Weight: 10%**

This domain assesses how well the work is documented, transferable, and defensible.

| Criterion                       | 1                                           | 3                                                 | 5                                                        | Score |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ----- |
| Structure of documentation      | No table of contents or logical ordering    | Sections organized but cross-references missing   | Hierarchical structure with working cross-references     | __    |
| Technical depth of explanation  | Describes what, never why or how            | Explains how, but omits design rationale          | Covers what, how, and why for each major decision        | __    |
| Transparency about limitations  | No limitations section or known-issues list | Limitations listed without impact analysis        | Each limitation documented with scope and workarounds    | __    |
| Justification of design choices | Choices presented without rationale         | Rationale given for major choices, minor ones not | Every design choice linked to a requirement or trade-off | __    |

**Domain subtotal 7:** `____ / 20`

### Reflection questions

- Am I only showing strengths, or also my limits?
- Can an outsider understand why I made these choices?
- Is the presentation professional enough for serious evaluation?

---

## Total Score

Multiply each domain by its weighting, or simply use the subtotals for a rough overall impression.

### Raw total score

Sum of all subtotals: `____ / 170`

### Weighted total score

`____ / 100`

---

## Interpretation of final score

| Final score | Judgment                                                |
| ----------- | ------------------------------------------------------- |
| 90–100      | Excellent, close to publication-ready or release-ready  |
| 80–89       | Very good, with minor weaknesses                        |
| 70–79       | Good, but with clear areas for improvement              |
| 60–69       | Satisfactory, the foundation is there but still fragile |
| 50–59       | Questionable, several core issues remain                |
| \<50        | Insufficient, major revision needed                     |

---

## Final reflection

### Strongest aspects of the project

`__________________________________________________________________`\
`__________________________________________________________________`\
`__________________________________________________________________`

### Weakest aspects of the project

`__________________________________________________________________`\
`__________________________________________________________________`\
`__________________________________________________________________`

### Greatest risk for adoption / success

`__________________________________________________________________`

### Three concrete improvement actions

1. `______________________________________________________________`
2. `______________________________________________________________`
3. `______________________________________________________________`

### Overall judgment in one sentence

`__________________________________________________________________`

---

## Extra: Faster lecturer-style rubric for a framework / developer tool

For a project such as a CLI framework, these eight guiding questions may deserve extra weight:

1. **Is the core vision clear and distinctive?**
2. **Does the type inference remain elegant beyond demos?**
3. **Are the runtime semantics predictable and consistent?**
4. **Is the API genuinely pleasant for other developers to use?**
5. **Are errors, help, config, and testing treated as first-class concerns?**
6. **Is the documentation evidence-driven rather than merely attractive?**
7. **Is the release surface stable and consciously scoped?**
8. **Does it feel like a real product rather than a clever coding exercise?**
