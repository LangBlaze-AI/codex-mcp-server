/**
 * Tests for the hybrid soft-timeout feature — tool level.
 *
 * Tests time budget hint prepending and softTimeoutMs forwarding via the tool.
 * Command utilities are mocked here; low-level SIGTERM/SIGKILL behavior is
 * tested in soft-timeout-command.test.ts.
 */

import { codexTool } from '../tools/codex.tool.js';
import { sessionStorage } from '../session/index.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand, executeCommandStreaming } from '../utils/command.js';

// Mock the command execution utilities
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
  executeCommandStreaming: jest.fn(),
}));

// Mock the session singleton
jest.mock('../session/index.js', () => ({
  sessionStorage: new (require('../session/storage.js').InMemorySessionStorage)(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<typeof executeCommand>;
const mockedExecuteCommandStreaming = executeCommandStreaming as jest.MockedFunction<typeof executeCommandStreaming>;

describe('codexTool — soft timeout / time budget hint', () => {
  let testSessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    testSessionStorage = (sessionStorage as unknown) as InMemorySessionStorage;
    const sessions = testSessionStorage.listSessions();
    sessions.forEach(s => testSessionStorage.deleteSession(s.id));
    mockedExecuteCommand.mockClear();
    mockedExecuteCommandStreaming.mockClear();
    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });
    mockedExecuteCommandStreaming.mockResolvedValue({ stdout: 'Response', stderr: '' });
  });

  test('prepends [Time budget: 30m.] hint to prompt when softTimeoutMs is 1800000', async () => {
    await codexTool.execute({ prompt: 'Do the thing', softTimeoutMs: 1800000 });

    expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);
    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toContain('[Time budget: 30m.');
    expect(promptArg).toContain('Summarize what you have if running long');
    expect(promptArg).toContain('Do the thing');
  });

  test('prepends [Time budget: 60m.] hint when softTimeoutMs is 3600000', async () => {
    await codexTool.execute({ prompt: 'Long task', softTimeoutMs: 3600000 });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toContain('[Time budget: 60m.');
    expect(promptArg).toContain('Long task');
  });

  test('does not prepend time budget hint when softTimeoutMs is not set', async () => {
    await codexTool.execute({ prompt: 'Normal task' });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toBe('Normal task');
    expect(promptArg).not.toContain('[Time budget:');
  });

  test('forwards softTimeoutMs as fourth argument to executeCommand', async () => {
    await codexTool.execute({ prompt: 'Timed task', softTimeoutMs: 120000 });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    // fourth argument is softTimeoutMs
    expect(callArgs[3]).toBe(120000);
  });

  test('softTimeoutMs rejects non-positive values (schema validation)', async () => {
    await expect(
      codexTool.execute({ prompt: 'Test', softTimeoutMs: -1000 })
    ).rejects.toThrow();

    await expect(
      codexTool.execute({ prompt: 'Test', softTimeoutMs: 0 })
    ).rejects.toThrow();
  });

  test('hint is prepended before session context is added', async () => {
    await codexTool.execute({ prompt: 'My task', softTimeoutMs: 900000 }); // 15 min

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg.startsWith('[Time budget: 15m.')).toBe(true);
    expect(promptArg).toContain('My task');
  });
});
