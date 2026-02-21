---
phase: quick-1
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/types.ts
  - src/utils/command.ts
  - src/tools/handlers.ts
  - src/tools/definitions.ts
  - src/__tests__/soft-timeout.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Callers can pass softTimeoutMs to the codex tool and the field is validated as a positive number"
    - "When softTimeoutMs is set, the LLM prompt is prefixed with a time budget hint (e.g. '[Time budget: 30m. Summarize what you have if running long — complete answer over exhaustive research.]')"
    - "If the Codex process is still running at softTimeoutMs, SIGTERM fires and the call resolves (does NOT reject) with partial output prefixed by '[Soft timeout - partial output]'"
    - "SIGKILL fires 5 seconds after SIGTERM as the final backstop to prevent zombie processes"
    - "Normal (non-timeout) executions are unaffected — the timeout timer is cleared on process close"
  artifacts:
    - path: "src/types.ts"
      provides: "softTimeoutMs optional field in CodexToolSchema Zod schema"
      contains: "softTimeoutMs"
    - path: "src/utils/command.ts"
      provides: "Soft-timeout logic in executeCommandStreaming and executeCommand"
      exports: ["executeCommand", "executeCommandStreaming", "StreamingCommandOptions"]
    - path: "src/tools/handlers.ts"
      provides: "Time budget hint prepending and softTimeoutMs forwarding"
      contains: "Time budget"
    - path: "src/tools/definitions.ts"
      provides: "softTimeoutMs MCP input schema property for codex tool"
      contains: "softTimeoutMs"
    - path: "src/__tests__/soft-timeout.test.ts"
      provides: "Jest tests for all soft-timeout behaviors"
  key_links:
    - from: "src/types.ts CodexToolSchema"
      to: "src/tools/handlers.ts CodexToolHandler.execute"
      via: "CodexToolSchema.parse(args).softTimeoutMs"
      pattern: "softTimeoutMs"
    - from: "src/tools/handlers.ts"
      to: "src/utils/command.ts executeCommandStreaming"
      via: "options.softTimeoutMs passed in StreamingCommandOptions"
      pattern: "softTimeoutMs"
    - from: "src/utils/command.ts setTimeout"
      to: "child.kill('SIGTERM') then child.kill('SIGKILL')"
      via: "SIGTERM at softTimeoutMs, SIGKILL at +5000ms"
      pattern: "SIGTERM.*SIGKILL"
---

<objective>
Implement a hybrid soft timeout for the codex MCP tool — a two-part mechanism where (1) a time budget hint is prepended to the LLM prompt so Codex self-regulates, and (2) a SIGTERM/SIGKILL backstop fires if the process runs over time, resolving gracefully with partial output.

Purpose: Prevent indefinite hangs on long Codex runs without losing partial work; mirror the pattern used in OpenCode.
Output: softTimeoutMs field plumbed through schema → handler → command utilities, plus Jest coverage.
</objective>

<execution_context>
@/Users/jonathanborduas/.claude/get-shit-done/workflows/execute-plan.md
@/Users/jonathanborduas/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/types.ts
@src/utils/command.ts
@src/tools/handlers.ts
@src/tools/definitions.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add softTimeoutMs to schema, command utilities, and MCP definition</name>
  <files>
    src/types.ts
    src/utils/command.ts
    src/tools/definitions.ts
  </files>
  <action>
**src/types.ts** — add `softTimeoutMs` to `CodexToolSchema`:
```ts
// After the callbackUri line in CodexToolSchema:
softTimeoutMs: z.number().positive().optional(),
```
The `CodexToolArgs` type is inferred automatically so no extra change needed.

**src/utils/command.ts** — add `softTimeoutMs` to `StreamingCommandOptions` and wire up the SIGTERM/SIGKILL backstop in BOTH `executeCommandStreaming` and `executeCommand`.

For `StreamingCommandOptions`:
```ts
export interface StreamingCommandOptions {
  onProgress?: ProgressCallback;
  envOverride?: ProcessEnv;
  softTimeoutMs?: number;  // ADD THIS
}
```

For `executeCommandStreaming` — add inside the `new Promise` callback, after the child is spawned:

```ts
let softTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
let timedOut = false;

if (options.softTimeoutMs) {
  softTimeoutTimer = setTimeout(() => {
    timedOut = true;
    console.error(chalk.yellow(`[soft-timeout] Sending SIGTERM after ${options.softTimeoutMs}ms`));
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        console.error(chalk.yellow('[soft-timeout] Sending SIGKILL (5s backstop)'));
        child.kill('SIGKILL');
      }
    }, 5000);
  }, options.softTimeoutMs);
}
```

Then in the `close` handler, clear the timer and check `timedOut` BEFORE the existing success/failure branch:

```ts
child.on('close', (code) => {
  if (softTimeoutTimer) clearTimeout(softTimeoutTimer);

  if (timedOut) {
    const partialOutput = stdout || stderr || '';
    resolve({
      stdout: `[Soft timeout - partial output]\n${partialOutput}`,
      stderr,
    });
    return;
  }
  // ... existing code unchanged ...
});
```

For `executeCommand` — apply the same pattern identically (add `softTimeoutMs?: number` as a third parameter or via an options object). The simplest approach given the existing signature is to add an optional `options?: { softTimeoutMs?: number }` fourth parameter — but to avoid a breaking change, add `softTimeoutMs` as the third optional parameter after `envOverride`:

```ts
export async function executeCommand(
  file: string,
  args: string[] = [],
  envOverride?: ProcessEnv,
  softTimeoutMs?: number  // ADD
): Promise<CommandResult>
```

Then apply the same `timedOut` / setTimeout / clearTimeout pattern inside its Promise callback.

**src/tools/definitions.ts** — add `softTimeoutMs` property to the `codex` tool's `inputSchema.properties`:

```ts
softTimeoutMs: {
  type: 'number',
  description:
    'Soft timeout in milliseconds. If set, prepends a time budget hint to the prompt and sends SIGTERM at this deadline, SIGKILL 5s later. Resolves with partial output (not an error). Example: 1800000 for 30 minutes.',
},
```
  </action>
  <verify>
    Run `npm run build` (or `npx tsc --noEmit`) — must compile with zero type errors.
    Check that `StreamingCommandOptions` exports `softTimeoutMs?: number`.
  </verify>
  <done>
    TypeScript compiles cleanly. `softTimeoutMs` exists in CodexToolSchema, StreamingCommandOptions, executeCommand signature, and toolDefinitions for codex.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire time budget hint and softTimeoutMs in the handler</name>
  <files>
    src/tools/handlers.ts
  </files>
  <action>
In `CodexToolHandler.execute`, destructure `softTimeoutMs` from the parsed args:

```ts
const {
  prompt,
  sessionId,
  resetSession,
  model,
  reasoningEffort,
  sandbox,
  fullAuto,
  workingDirectory,
  callbackUri,
  softTimeoutMs,   // ADD
}: CodexToolArgs = CodexToolSchema.parse(args);
```

Immediately after `let enhancedPrompt = prompt;` (line ~57), prepend the time budget hint when `softTimeoutMs` is set:

```ts
if (softTimeoutMs) {
  const minutes = Math.round(softTimeoutMs / 60000);
  enhancedPrompt = `[Time budget: ${minutes}m. Summarize what you have if running long — complete answer over exhaustive research.]\n\n${enhancedPrompt}`;
}
```

Pass `softTimeoutMs` to both execution paths:

Streaming path (update the `executeCommandStreaming` call):
```ts
await executeCommandStreaming('codex', cmdArgs, {
  onProgress: (message) => {
    context.sendProgress(message);
  },
  envOverride,
  softTimeoutMs,   // ADD
})
```

Non-streaming path (update the `executeCommand` call):
```ts
await executeCommand('codex', cmdArgs, envOverride, softTimeoutMs)
// and for the case with no envOverride:
await executeCommand('codex', cmdArgs, undefined, softTimeoutMs)
```

The non-streaming case currently has two branches (`envOverride ? ... : ...`). Simplify to always pass `envOverride` (possibly undefined) and `softTimeoutMs`:
```ts
const result = useStreaming
  ? await executeCommandStreaming('codex', cmdArgs, {
      onProgress: (message) => { context.sendProgress(message); },
      envOverride,
      softTimeoutMs,
    })
  : await executeCommand('codex', cmdArgs, envOverride, softTimeoutMs);
```
  </action>
  <verify>
    Run `npm run build` — must compile cleanly.
    Grep confirms `softTimeoutMs` appears in both the streaming and non-streaming call sites in handlers.ts.
  </verify>
  <done>
    Time budget hint is prepended when softTimeoutMs is provided. softTimeoutMs is forwarded to both executeCommandStreaming and executeCommand. TypeScript has no type errors.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add Jest tests for soft-timeout behavior</name>
  <files>
    src/__tests__/soft-timeout.test.ts
  </files>
  <action>
Create `src/__tests__/soft-timeout.test.ts`. Use Jest fake timers to control setTimeout without real delays. Mock `child_process.spawn` to simulate a long-running process.

The test file must cover three behaviors:

**1. Time budget hint prepending**
Mock `executeCommandStreaming` (or `executeCommand`) to capture the args passed. Invoke `CodexToolHandler.execute` with `softTimeoutMs: 1800000`. Assert that the prompt passed to codex CLI starts with `[Time budget: 30m.`.

**2. SIGTERM resolves with partial output prefix**
Mock `spawn` to return a fake child that:
- emits stderr data `"partial work done"`
- does NOT emit `close` until `kill('SIGTERM')` is called
- on `kill('SIGTERM')` emits `close` with code `null`

Advance fake timers by `softTimeoutMs` ms. Assert that `executeCommandStreaming` resolves (does not reject) and that `result.stdout` starts with `[Soft timeout - partial output]`.

**3. SIGKILL fires 5s after SIGTERM**
Extend scenario 2: after SIGTERM, the process does NOT close. Assert that after advancing timers another 5000ms, `kill('SIGKILL')` is called on the child.

**Test skeleton pattern** (align with existing test style — see edge-cases.test.ts):

```ts
import { executeCommandStreaming } from '../utils/command.js';
import { CodexToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('Hybrid soft timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedSpawn.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ... tests here
});
```

For the handler-level hint test, mock `../utils/command.js` similar to edge-cases.test.ts instead of mocking spawn directly.

Ensure all tests pass: `npx jest src/__tests__/soft-timeout.test.ts`.
  </action>
  <verify>
    `npx jest src/__tests__/soft-timeout.test.ts --no-coverage` passes with all tests green.
    `npm run build` still compiles cleanly.
  </verify>
  <done>
    All three test scenarios pass. The full test suite (`npx jest`) passes with no regressions.
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — zero TypeScript errors across all modified files.
2. `npx jest` — all existing tests pass plus new soft-timeout tests.
3. Manual spot-check: grep `softTimeoutMs` in src/types.ts, src/utils/command.ts, src/tools/handlers.ts, src/tools/definitions.ts — appears in each.
4. Grep `Time budget` in src/tools/handlers.ts — confirms hint-prepending logic present.
5. Grep `SIGTERM` in src/utils/command.ts — confirms kill sequence present in both executeCommand and executeCommandStreaming.
</verification>

<success_criteria>
- softTimeoutMs is a validated optional field in CodexToolSchema (positive number).
- Passing softTimeoutMs: 1800000 causes the prompt to be prefixed with "[Time budget: 30m. ...]".
- A process still running at T=softTimeoutMs receives SIGTERM; the call resolves with stdout starting "[Soft timeout - partial output]" — it does NOT throw.
- A process still alive 5s after SIGTERM receives SIGKILL.
- Normal executions (no softTimeoutMs) are completely unaffected.
- All Jest tests green, TypeScript compiles cleanly.
</success_criteria>

<output>
After completion, create `.planning/quick/1-implement-hybrid-soft-timeout-for-codex-/1-SUMMARY.md` using the summary template.
</output>
