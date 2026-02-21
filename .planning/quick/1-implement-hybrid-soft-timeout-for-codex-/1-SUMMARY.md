---
phase: quick-1
plan: 1
subsystem: codex-tool
tags: [soft-timeout, sigterm, sigkill, streaming, schema, testing]
dependency_graph:
  requires: []
  provides: [soft-timeout-for-codex-tool]
  affects: [executeCommand, executeCommandStreaming, CodexToolHandler, CodexToolSchema, toolDefinitions]
tech_stack:
  added: []
  patterns: [SIGTERM-SIGKILL-backstop, time-budget-prompt-hint]
key_files:
  created:
    - src/__tests__/soft-timeout.test.ts
    - src/__tests__/soft-timeout-command.test.ts
  modified:
    - src/types.ts
    - src/utils/command.ts
    - src/tools/handlers.ts
    - src/tools/definitions.ts
    - src/__tests__/model-selection.test.ts
    - src/__tests__/default-model.test.ts
    - src/__tests__/resume-functionality.test.ts
    - src/__tests__/error-scenarios.test.ts
decisions:
  - "Split tests into two files (soft-timeout.test.ts and soft-timeout-command.test.ts) to avoid ESM chalk import conflict: handler tests mock the command module entirely, command-level tests mock child_process + chalk directly"
  - "executeCommand signature extended with optional softTimeoutMs as fourth parameter (not breaking: defaults to undefined)"
  - "Fixed autoCloseOnSigterm logic in FakeChild: when SIGTERM is ignored (stubborn process), child.killed must stay false so the SIGKILL backstop's !child.killed check succeeds"
metrics:
  duration: 608s
  completed: "2026-02-21"
  tasks_completed: 3
  files_changed: 8
---

# Quick Task 1: Implement Hybrid Soft Timeout for Codex Summary

**One-liner:** SIGTERM/SIGKILL backstop with time-budget prompt hint plumbed through Zod schema, handler, and both command utilities, plus 14 Jest tests covering all behaviors.

## Tasks Completed

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Add softTimeoutMs to schema, command utilities, and MCP definition | bbc4374 | Done |
| 2 | Wire time budget hint and softTimeoutMs in the handler | 0bfe4d3 | Done |
| 3 | Add Jest tests for soft-timeout behavior | 32a3bd4 | Done |

## What Was Built

**Schema and type changes (src/types.ts):**
- Added `softTimeoutMs: z.number().positive().optional()` to `CodexToolSchema`
- `CodexToolArgs` type inferred automatically — includes softTimeoutMs

**Command utilities (src/utils/command.ts):**
- Added `softTimeoutMs?: number` to `StreamingCommandOptions` interface
- Added `softTimeoutMs?: number` as fourth optional parameter to `executeCommand`
- Both `executeCommandStreaming` and `executeCommand` now implement:
  - Set a `setTimeout` at `softTimeoutMs` that sends SIGTERM
  - A nested `setTimeout` at `+5000ms` that sends SIGKILL if `!child.killed`
  - The `close` handler clears the timer and checks `timedOut` before normal flow
  - On timeout: resolves (not rejects) with `stdout: "[Soft timeout - partial output]\n{partial}"``

**Handler (src/tools/handlers.ts):**
- Destructures `softTimeoutMs` from `CodexToolSchema.parse(args)`
- Prepends `[Time budget: {N}m. Summarize what you have if running long — complete answer over exhaustive research.]` to `enhancedPrompt` when set
- Passes `softTimeoutMs` to both `executeCommandStreaming` options and `executeCommand` fourth arg
- Simplified non-streaming branch: always passes `envOverride` (possibly undefined) and `softTimeoutMs`

**MCP definition (src/tools/definitions.ts):**
- Added `softTimeoutMs` property to codex tool inputSchema with description

**Tests (14 new tests across 2 files):**
- `soft-timeout.test.ts`: 6 handler-level tests (time budget hint, forwarding, validation)
- `soft-timeout-command.test.ts`: 8 command-level tests (SIGTERM resolves with partial output, SIGKILL fires 5s after SIGTERM, normal runs unaffected)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing test assertions broke due to executeCommand signature change**
- **Found during:** Task 3 (full test suite run)
- **Issue:** Simplifying the handler's non-streaming path to always pass `envOverride` meant `executeCommand` is now called with 4 args `(file, args, envOverride, softTimeoutMs)` even when both are `undefined`. Existing `toHaveBeenCalledWith` assertions with 2 args failed strict equality.
- **Fix:** Added `undefined, undefined` (or `undefined` for 4th arg) to all affected `toHaveBeenCalledWith` calls in 4 test files
- **Files modified:** `src/__tests__/model-selection.test.ts`, `src/__tests__/default-model.test.ts`, `src/__tests__/resume-functionality.test.ts`, `src/__tests__/error-scenarios.test.ts`
- **Commit:** 32a3bd4

**2. [Rule 1 - Bug] SIGKILL test: fake child's kill() was setting child.killed=true on SIGTERM even when autoCloseOnSigterm=false**
- **Found during:** Task 3 (SIGKILL tests timing out at 15s)
- **Issue:** The `createFakeChild` helper set `child.killed = true` on both SIGTERM and SIGKILL. The real timeout code checks `if (!child.killed)` before sending SIGKILL — with killed=true after SIGTERM, SIGKILL never fired.
- **Fix:** Modified `createFakeChild` so SIGTERM only sets `child.killed = true` when `autoCloseOnSigterm=true`. Stubborn-process tests leave `killed=false` after SIGTERM so SIGKILL backstop fires correctly.
- **Files modified:** `src/__tests__/soft-timeout-command.test.ts`
- **Commit:** 32a3bd4

**3. [Rule 3 - Blocking] chalk ESM incompatibility in Jest worker processes**
- **Found during:** Task 3 (test file failed to run)
- **Issue:** Importing `executeCommandStreaming` directly in tests caused chalk (pure ESM module) to load in Jest worker processes, crashing with `SyntaxError: Cannot use import statement outside a module`
- **Fix:** Split tests into two files. Handler tests mock the entire `../utils/command.js` module (chalk never loads). Command tests mock `child_process` AND `chalk` with `jest.mock('chalk', () => ({ __esModule: true, default: chalkMock }))`. The `__esModule: true` flag is required so TypeScript/ts-jest interop correctly resolves `chalk_1.default.blue`.
- **Files created:** `src/__tests__/soft-timeout-command.test.ts` (separate from handler tests)
- **Commit:** 32a3bd4

## Decisions Made

1. Split test files to isolate chalk ESM mock scope from handler module mocks — the two concerns cannot coexist in one Jest module scope
2. `executeCommand` signature: optional 4th parameter vs options object — chose simple 4th parameter to minimize change surface; consistent with the plan's specification
3. Used `__esModule: true` in chalk mock factory to align with ts-jest's CommonJS interop behavior

## Self-Check: PASSED

All key files exist and all 3 task commits verified in git history.
