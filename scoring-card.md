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

| Criterion                    | 1                          | 3                                      | 5                                                  | Score |
| ---------------------------- | -------------------------- | -------------------------------------- | -------------------------------------------------- | ----- |
| Problem statement            | Unclear or vague           | Understandable but not sharply defined | Very clear, concrete, and convincing               | __    |
| Relevance to target audience | Barely relevant            | Reasonably relevant                    | Clearly useful or important to a specific audience | __    |
| Scope definition             | Chaotic or unfocused       | Somewhat delimited                     | Clear boundaries and conscious choices             | __    |
| Distinctiveness              | Feels like everything else | Some original angle                    | Clear unique position or strong vision             | __    |

**Domain subtotal 1:** `____ / 20`

### Reflection questions

- Am I solving a real pain point, or mostly scratching my own itch?
- Can I explain in two sentences why this project should exist?
- Is the target audience specific enough?

---

## 2. Conceptual Design and Architecture

**Weight: 15%**

Assess whether the architecture is logical, coherent, and maintainable.

| Criterion               | 1                                  | 3                           | 5                                                   | Score |
| ----------------------- | ---------------------------------- | --------------------------- | --------------------------------------------------- | ----- |
| Architectural coherence | Loose parts without a clear line   | Reasonably coherent         | Strong, cohesive design with clear principles       | __    |
| Modularity              | Tightly coupled and hard to extend | Somewhat modular            | Clear separation of concerns                        | __    |
| Scalability of design   | Breaks quickly under growth        | Works for the current scope | Can credibly support more complex use cases         | __    |
| Type/interface design   | Inconsistent or leaky              | Reasonably usable           | Elegant, safe, and pleasant to use                  | __    |
| Technical trade-offs    | Barely considered                  | Some choices are motivated  | Clear trade-offs and consciously chosen limitations | __    |

**Domain subtotal 2:** `____ / 25`

### Reflection questions

- Is my architecture genuinely elegant, or just clever on paper?
- Where are my ugliest compromises?
- What breaks if the codebase becomes five times larger?

---

## 3. Technical Implementation and Code Quality

**Weight: 20%**

This is about execution. Not just whether it works, but whether it is built well.

| Criterion                            | 1                                    | 3                        | 5                                          | Score |
| ------------------------------------ | ------------------------------------ | ------------------------ | ------------------------------------------ | ----- |
| Correctness of implementation        | Many errors or inconsistent behavior | Mostly correct           | Robust and reliable                        | __    |
| Code readability                     | Messy or hard to follow              | Generally understandable | Clear, disciplined, and maintainable       | __    |
| Consistency of style/patterns        | All over the place                   | Somewhat consistent      | Highly consistent in code and API          | __    |
| Error handling                       | Weak or ad hoc                       | Basic level present      | Thoughtful, predictable, and well designed | __    |
| Maintainability                      | Hard to modify                       | Reasonably maintainable  | Easy to extend and refactor                | __    |
| Type safety / correctness guarantees | Barely present                       | Reasonable               | Strong and deliberately leveraged          | __    |

**Domain subtotal 3:** `____ / 30`

### Reflection questions

- How much of the quality is actually in the code, and how much is in pretty examples?
- Are errors treated as first-class citizens, or shoved under the rug?
- Is the type system genuinely useful, or am I just doing intellectual cosplay?

---

## 4. Functionality and Feature Completeness

**Weight: 15%**

Assess whether the promised functionality is actually delivered and whether it feels coherent.

| Criterion                        | 1                         | 3                           | 5                                                   | Score |
| -------------------------------- | ------------------------- | --------------------------- | --------------------------------------------------- | ----- |
| Core functionality present       | Crucial parts are missing | Most core parts are present | Complete and convincing                             | __    |
| Functional fit to goal           | Weak match                | Reasonable match            | Precisely aligned with the problem and audience     | __    |
| Depth of features                | Superficial or gimmicky   | Workable                    | Deep enough for real-world use cases                | __    |
| Coherence between features       | Feature soup              | Reasonably coherent         | Strong product logic, features reinforce each other | __    |
| Edge cases / real-world behavior | Barely addressed          | Partially addressed         | Convincingly thought through                        | __    |

**Domain subtotal 4:** `____ / 25`

### Reflection questions

- Are my features actually useful, or just demo material?
- Have I handled the boring but important cases properly?
- What would a critical first user immediately miss?

---

## 5. Developer Experience / Usability

**Weight: 15%**

For a framework, this matters a lot. If it is technically nice but feels awful to use, you are still screwed.

| Criterion                 | 1                             | 3                           | 5                                          | Score |
| ------------------------- | ----------------------------- | --------------------------- | ------------------------------------------ | ----- |
| API ergonomics            | Clumsy or confusing           | Reasonably usable           | Intuitive, pleasant, elegant               | __    |
| Learning curve            | Needlessly steep              | Manageable with some effort | Quick to grasp without dumbing things down | __    |
| Feedback / error messages | Vague or frustrating          | Acceptable                  | Clear, actionable, and pleasant            | __    |
| Documentation usability   | Incomplete or marketing fluff | Adequate                    | Strong, concrete, and convincing           | __    |
| Testability for users     | Difficult or painful          | Possible                    | Very well supported                        | __    |

**Domain subtotal 5:** `____ / 25`

### Reflection questions

- Would someone else actually enjoy using this?
- Is the first experience smooth or irritating?
- Are my docs real documentation, or just perfume sprayed over missing clarity?

---

## 6. Validation, Testing, and Reliability

**Weight: 15%**

Assess how well the project is supported by tests and evidence of reliability.

| Criterion                             | 1                                    | 3                      | 5                                                         | Score |
| ------------------------------------- | ------------------------------------ | ---------------------- | --------------------------------------------------------- | ----- |
| Test coverage of core functionality   | Weak                                 | Reasonable             | Strong and targeted                                       | __    |
| Quality of testing strategy           | Loose tests without a clear strategy | Somewhat systematic    | Thoughtful mix of unit, integration, and end-to-end tests | __    |
| Validation of edge cases              | Barely present                       | Some key cases covered | Broad and convincing coverage                             | __    |
| Reproducibility                       | Difficult                            | Reasonable             | Highly reproducible, CI/CD is clear                       | __    |
| Reliability across runtimes/platforms | Barely demonstrated                  | Partially demonstrated | Convincingly demonstrated                                 | __    |

**Domain subtotal 6:** `____ / 25`

### Reflection questions

- Am I testing what is actually risky, or only what is easy to test?
- Do I have evidence of reliability, or mostly confidence?
- Would I trust my own framework for something important?

---

## 7. Documentation, Presentation, and Professional / Academic Justification

**Weight: 10%**

This domain assesses how well the work is documented, transferable, and defensible.

| Criterion                       | 1                   | 3                          | 5                                 | Score |
| ------------------------------- | ------------------- | -------------------------- | --------------------------------- | ----- |
| Structure of documentation      | Messy               | Reasonably logical         | Very clear and easy to navigate   | __    |
| Technical depth of explanation  | Too superficial     | Adequate                   | Strong and precise                | __    |
| Transparency about limitations  | Barely acknowledged | Some limitations mentioned | Very honest and analytical        | __    |
| Justification of design choices | Weak                | Reasonable                 | Strongly motivated and convincing | __    |

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
