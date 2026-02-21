/**
 * Tests for SIGTERM/SIGKILL backstop behavior in executeCommandStreaming and executeCommand.
 *
 * Uses fake timers + child_process mock to simulate long-running processes.
 * chalk is mocked to avoid ESM transform issues in the test environment.
 */

import { EventEmitter } from 'events';
import { Writable } from 'stream';

// Must be declared before any imports that use them (Jest hoists jest.mock calls)
jest.mock('chalk', () => {
  const identity = (s: unknown) => s;
  // Return both a callable default and named exports
  const chalkMock = Object.assign(identity, {
    blue: identity,
    yellow: identity,
    red: identity,
    green: identity,
    bold: identity,
    dim: identity,
    reset: identity,
  });
  return {
    __esModule: true,
    default: chalkMock,
  };
});

jest.mock('child_process');

import { spawn } from 'child_process';
import { executeCommandStreaming, executeCommand } from '../utils/command.js';

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: Writable;
  killed: boolean;
  kill: jest.Mock;
};

/**
 * Create a fake ChildProcess. By default, SIGTERM auto-closes the process.
 * Set autoCloseOnSigterm: false to simulate a stubborn process that needs SIGKILL.
 */
function createFakeChild(options: { autoCloseOnSigterm?: boolean } = {}): FakeChild {
  const { autoCloseOnSigterm = true } = options;

  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.killed = false;

  child.kill = jest.fn((signal?: string) => {
    if (signal === 'SIGTERM') {
      if (autoCloseOnSigterm) {
        // Process terminates on SIGTERM — mark killed and close
        child.killed = true;
        setImmediate(() => child.emit('close', null));
      }
      // When autoCloseOnSigterm is false: process ignores SIGTERM, stays alive
      // child.killed remains false so the SIGKILL backstop can fire
    } else if (signal === 'SIGKILL') {
      child.killed = true;
      setImmediate(() => child.emit('close', null));
    }
    return true;
  });

  return child;
}

// =============================================================================
// executeCommandStreaming
// =============================================================================
describe('executeCommandStreaming — soft timeout SIGTERM/SIGKILL', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedSpawn.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('resolves with [Soft timeout - partial output] prefix when SIGTERM fires', async () => {
    const child = createFakeChild({ autoCloseOnSigterm: true });
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 5000;
    const resultPromise = executeCommandStreaming('codex', ['exec', 'long task'], {
      softTimeoutMs,
    });

    // Emit partial stderr data before timeout fires
    child.stderr.emit('data', Buffer.from('partial work done'));

    // Advance fake timers to trigger the soft timeout
    jest.advanceTimersByTime(softTimeoutMs);

    // Allow setImmediate callbacks (close event) to run
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.stdout).toMatch(/^\[Soft timeout - partial output\]/);
    expect(result.stdout).toContain('partial work done');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('resolves (does not reject) on soft timeout', async () => {
    const child = createFakeChild({ autoCloseOnSigterm: true });
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 2000;
    const resultPromise = executeCommandStreaming('codex', ['exec', 'task'], {
      softTimeoutMs,
    });

    child.stderr.emit('data', Buffer.from('work output'));
    jest.advanceTimersByTime(softTimeoutMs);
    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.stdout).toMatch(/^\[Soft timeout - partial output\]/);
    // Ensure it resolved, not rejected
    await expect(Promise.resolve(result)).resolves.toBeDefined();
  });

  test('SIGKILL fires 5s after SIGTERM when process does not close', async () => {
    // Process stays alive after SIGTERM — only closes on SIGKILL
    const child = createFakeChild({ autoCloseOnSigterm: false });
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 5000;
    const resultPromise = executeCommandStreaming('codex', ['exec', 'stubborn task'], {
      softTimeoutMs,
    });

    child.stderr.emit('data', Buffer.from('stubborn partial output'));

    // Advance to softTimeoutMs — SIGTERM fires but process stays alive
    jest.advanceTimersByTime(softTimeoutMs);

    // Verify SIGTERM was sent
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // Not yet killed (stubborn process)
    const killCallsAfterSigterm = child.kill.mock.calls.length;
    expect(killCallsAfterSigterm).toBe(1);

    // Advance another 5000ms — SIGKILL backstop fires
    jest.advanceTimersByTime(5000);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    // Both SIGTERM and SIGKILL should have been called
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.stdout).toMatch(/^\[Soft timeout - partial output\]/);
    expect(result.stdout).toContain('stubborn partial output');
  }, 15000);

  test('timer is cleared on normal completion — SIGTERM never fires', async () => {
    const child = createFakeChild();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 10000;
    const resultPromise = executeCommandStreaming('codex', ['exec', 'fast task'], {
      softTimeoutMs,
    });

    // Process completes normally before timeout
    child.stderr.emit('data', Buffer.from('normal output'));
    child.emit('close', 0);

    const result = await resultPromise;

    expect(result.stderr).toBe('normal output');
    expect(result.stdout).not.toContain('[Soft timeout - partial output]');
    // kill should NOT have been called
    expect(child.kill).not.toHaveBeenCalled();
  });

  test('normal execution without softTimeoutMs is completely unaffected', async () => {
    const child = createFakeChild();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultPromise = executeCommandStreaming('codex', ['exec', 'quick task'], {});

    child.stderr.emit('data', Buffer.from('normal output'));
    child.emit('close', 0);

    const result = await resultPromise;

    expect(result.stderr).toBe('normal output');
    expect(result.stdout).not.toContain('[Soft timeout - partial output]');
    expect(child.kill).not.toHaveBeenCalled();
  });
});

// =============================================================================
// executeCommand
// =============================================================================
describe('executeCommand — soft timeout SIGTERM/SIGKILL', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedSpawn.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('resolves with [Soft timeout - partial output] prefix on timeout', async () => {
    const child = createFakeChild({ autoCloseOnSigterm: true });
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 3000;
    const resultPromise = executeCommand('codex', ['exec', 'long task'], undefined, softTimeoutMs);

    child.stderr.emit('data', Buffer.from('some partial output'));

    jest.advanceTimersByTime(softTimeoutMs);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.stdout).toMatch(/^\[Soft timeout - partial output\]/);
    expect(result.stdout).toContain('some partial output');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('SIGKILL fires 5s after SIGTERM in executeCommand', async () => {
    const child = createFakeChild({ autoCloseOnSigterm: false });
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const softTimeoutMs = 3000;
    const resultPromise = executeCommand('codex', ['exec', 'slow task'], undefined, softTimeoutMs);

    child.stderr.emit('data', Buffer.from('partial content'));

    jest.advanceTimersByTime(softTimeoutMs);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    jest.advanceTimersByTime(5000);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.stdout).toMatch(/^\[Soft timeout - partial output\]/);
    expect(result.stdout).toContain('partial content');
  }, 15000);

  test('normal completion without timeout is unaffected', async () => {
    const child = createFakeChild();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultPromise = executeCommand('codex', ['exec', 'fast task'], undefined, 10000);

    child.stderr.emit('data', Buffer.from('quick output'));
    child.emit('close', 0);

    const result = await resultPromise;

    expect(result.stderr).toBe('quick output');
    expect(result.stdout).not.toContain('[Soft timeout - partial output]');
    expect(child.kill).not.toHaveBeenCalled();
  });
});
