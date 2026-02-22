# CLAUDE OPERATING POLICY

This file is **executable policy**. Claude MUST follow every MUST/MUST NOT rule exactly.
If a mandatory rule cannot be satisfied, Claude MUST stop and escalate to the user.

---

## R0 — Scope & Enforcement

- Claude MUST treat this file as binding operational policy, not background context.
- Claude MUST NOT rationalize skipping any MUST rule for convenience, speed, or uncertainty.
- If any rule conflicts with another, Claude MUST escalate to the user before proceeding.
- Rationale and examples are in the Appendix. The Appendix is **non-normative**.

---

## R1 — Definitions

| Term | Strict Definition |
|---|---|
| `EXECUTION` | Running `/gsd:execute-phase` or applying code/file changes |
| `NON_EXECUTION` | Planning, research, roadmapping, verification, discuss-phase filtering |
| `QUORUM` | Five-model review: Claude + Codex (`mcp__codex-cli__review`) + Gemini (`mcp__gemini-cli__gemini`) + OpenCode (`mcp__opencode__opencode`) + Copilot (`mcp__copilot-cli__ask`) |
| `CONSENSUS` | All available models agree on the same answer |
| `BLOCKER` | Any reviewer output that rejects or flags a regression risk |
| `OSCILLATION` | ≥ 3 of the last 6 commits alternating changes to the same file set with no net stability improvement |
| `UNAVAILABLE` | A model returns an error, quota failure, or no response after 1 retry |

---

## R2 — Global Non-Negotiables

These rules apply in **all contexts** with no exceptions:

1. Claude MUST NOT present any plan, research output, roadmap, or verification result to the user without first completing QUORUM (R3).
2. Claude MUST NOT run QUORUM during EXECUTION. EXECUTION is single-model only.
3. Claude MUST NOT silently downgrade a required QUORUM step. If a model is UNAVAILABLE, Claude MUST apply R6.
4. Claude MUST NOT apply incremental fixes when a circuit breaker is active (R5).
5. Claude MUST pass the pre-response gate (R7) before every final response.

---

## R3 — Quorum Protocol (NON_EXECUTION only)

### R3.1 — When QUORUM is MANDATORY

QUORUM is triggered by **activity type** (NON_EXECUTION), not by top-level command name. Any command that internally orchestrates a NON_EXECUTION activity — including `/gsd:quick` when it spawns a planner — MUST complete QUORUM for that activity before presenting output to the user.

IF the current activity is any of the following (including when invoked as a sub-step of another command), Claude MUST invoke QUORUM before presenting output to the user:

- `/gsd:plan-phase`, `/gsd:new-project`, `/gsd:new-milestone`
- `/gsd:research-phase`
- Any roadmapping or architecture decision
- `/gsd:verify-work` or verifier agent output
- `/gsd:discuss-phase` question filtering (see R4)
- Planning step within `/gsd:quick` (i.e., when a planner agent is spawned)

### R3.2 — Round 1: Independent Positions

1. Claude MUST form its own position **before** querying other models.
2. Claude MUST query Codex, Gemini, OpenCode, and Copilot with identical prompts and full context. Each model MUST be called in a **separate, sequential tool call** — never as sibling tool calls in the same message. A failing sibling propagates an error to all co-submitted calls, producing false UNAVAILABLE signals.
3. Claude MUST collect all five positions with full reasoning before proceeding.

### R3.3 — Rounds 2–4: Deliberation

1. Claude MUST share all prior-round positions with every model.
2. Claude MUST ask each model to reconsider or defend its stance given the others' arguments.
3. Claude MUST stop deliberation **immediately** upon CONSENSUS.
4. Claude MUST NOT run more than 4 total rounds.

### R3.4 — After Round 4: Escalate to User

IF CONSENSUS is not reached after 4 rounds, Claude MUST escalate to the user with:
- Each model's final position (1–2 sentences each)
- The core point of disagreement
- Claude's recommendation with rationale

### R3.5 — Consensus Rules

- CONSENSUS requires all **available** models to agree on the same answer.
- IF models nominally agree but on answers with different long-term durability, Claude MUST prefer the answer that: avoids technical debt, is more general/reusable, does not require near-term rework.
- Claude MUST NOT proceed to execution if any BLOCKER is active.
- IF reviewers disagree on a BLOCKER, Claude MUST run deliberation (R3.3) before escalating.

---

## R4 — Discuss-Phase Pre-Filter

When `/gsd:discuss-phase` generates candidate questions, Claude MUST apply this filter **before** presenting anything to the user:

1. Claude MUST answer each question independently, biased toward the long-term solution.
2. Claude MUST query Codex, Gemini, OpenCode, and Copilot with the question and full codebase context.
3. Claude MUST apply the following decision table:

| Outcome | Action |
|---|---|
| CONSENSUS reached | Skip the question. Record it as an assumption. |
| No consensus | Run deliberation (R3.3, up to 3 rounds). |
| Still no consensus after deliberation | Present the question to the user. |

4. Claude MUST show the user **only** questions where consensus failed.
5. Claude MUST precede those questions with a list of auto-resolved questions and the assumption recorded for each.

---

## R5 — Circuit Breaker

### R5.1 — OSCILLATION Detection

Claude MUST check for OSCILLATION before each new fix attempt. OSCILLATION is active when:
- ≥ 3 of the last 6 commits alternate changes to the same file set, AND
- No net stability improvement is observable (tests still failing, same errors recurring)

### R5.2 — When Circuit Breaker Triggers

IF OSCILLATION is detected, Claude MUST **immediately STOP execution** and MUST NOT:
- Apply any further incremental fixes
- Reapply any previously attempted solution
- Apply local optimizations to either component

### R5.3 — Allowed Actions Under Circuit Breaker

While a circuit breaker is active, Claude MAY only:
- Perform root cause analysis
- Map dependencies between coupled components
- Design a unified solution that resolves both components simultaneously

Claude MUST NOT resume execution until a unified solution is designed and the user approves it.

---

## R6 — Tool Failure Policy

IF Codex, Gemini, OpenCode, or Copilot is UNAVAILABLE during a required QUORUM step:

1. Claude MUST NOT silently proceed as if QUORUM was completed.
2. Claude MUST note which model is unavailable and why.
3. IF one model is unavailable, Claude MUST proceed with the four available models and note the reduced quorum.
4. IF two models are unavailable, Claude MUST proceed with the three available models and note the reduced quorum.
5. IF three models are unavailable, Claude MUST proceed with the one available external model and note the severely reduced quorum.
6. IF all four external models are unavailable, Claude MUST stop and inform the user before proceeding.
7. Claude MUST NOT treat a single-model response as CONSENSUS.

---

## R7 — Pre-Response Gate

Before every final response, Claude MUST internally verify:

- [ ] If this is a NON_EXECUTION task: was QUORUM completed?
- [ ] If QUORUM was required: was CONSENSUS reached or was the conflict escalated?
- [ ] If a circuit breaker is active: did Claude avoid all prohibited actions?
- [ ] If a BLOCKER exists: is execution blocked?

IF any gate item fails, Claude MUST NOT deliver the response. Claude MUST instead report the failure and the corrective action required.

---

## Appendix (Non-Normative)

### Why Multi-Model Quorum

Diversity of opinion dramatically improves outcomes for all non-execution tasks. Planning, research, roadmapping, and verification benefit from three independent perspectives. Execution is the exception — a single, consistent actor avoids incoherence during implementation.

### Quorum Members

| Model | Tool | Role |
|-------|------|------|
| **Claude** (Sonnet 4.6) | self | Primary reasoner; sole executor |
| **Codex** | `mcp__codex-cli__review` | Independent reviewer |
| **Gemini** | `mcp__gemini-cli__gemini` | Independent reviewer |
| **OpenCode** | `mcp__opencode__opencode` | Independent reviewer |
| **Copilot** | `mcp__copilot-cli__ask` | Independent reviewer |

### Why Circuit Breaker

Repeated patching of coupled components where each fix breaks the other is a structural problem, not a local bug. Incremental fixes in this state waste effort and increase coupling. The only valid path is to stop, understand the full dependency graph, and design a unified solution.
