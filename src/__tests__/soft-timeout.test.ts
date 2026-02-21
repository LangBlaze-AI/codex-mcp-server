/**
 * Tests for the hybrid soft-timeout feature — handler level.
 *
 * Tests time budget hint prepending and softTimeoutMs forwarding via the handler.
 * Command utilities are mocked here; low-level SIGTERM/SIGKILL behavior is
 * tested in soft-timeout-command.test.ts.
 */

import { CodexToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand, executeCommandStreaming } from '../utils/command.js';

// Mock the command execution utilities
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
  executeCommandStreaming: jest.fn(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<typeof executeCommand>;
const mockedExecuteCommandStreaming = executeCommandStreaming as jest.MockedFunction<typeof executeCommandStreaming>;

describe('CodexToolHandler — soft timeout / time budget hint', () => {
  let handler: CodexToolHandler;
  let sessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    sessionStorage = new InMemorySessionStorage();
    handler = new CodexToolHandler(sessionStorage);
    mockedExecuteCommand.mockClear();
    mockedExecuteCommandStreaming.mockClear();
    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });
    mockedExecuteCommandStreaming.mockResolvedValue({ stdout: 'Response', stderr: '' });
  });

  test('prepends [Time budget: 30m.] hint to prompt when softTimeoutMs is 1800000', async () => {
    await handler.execute({ prompt: 'Do the thing', softTimeoutMs: 1800000 });

    expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);
    const callArgs = mockedExecuteCommand.mock.calls[0];
    // callArgs: [file, cmdArgs[], envOverride, softTimeoutMs]
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toContain('[Time budget: 30m.');
    expect(promptArg).toContain('Summarize what you have if running long');
    expect(promptArg).toContain('Do the thing');
  });

  test('prepends [Time budget: 60m.] hint when softTimeoutMs is 3600000', async () => {
    await handler.execute({ prompt: 'Long task', softTimeoutMs: 3600000 });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toContain('[Time budget: 60m.');
    expect(promptArg).toContain('Long task');
  });

  test('does not prepend time budget hint when softTimeoutMs is not set', async () => {
    await handler.execute({ prompt: 'Normal task' });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    expect(promptArg).toBe('Normal task');
    expect(promptArg).not.toContain('[Time budget:');
  });

  test('forwards softTimeoutMs as fourth argument to executeCommand', async () => {
    await handler.execute({ prompt: 'Timed task', softTimeoutMs: 120000 });

    const callArgs = mockedExecuteCommand.mock.calls[0];
    // fourth argument is softTimeoutMs
    expect(callArgs[3]).toBe(120000);
  });

  test('softTimeoutMs rejects non-positive values (schema validation)', async () => {
    await expect(
      handler.execute({ prompt: 'Test', softTimeoutMs: -1000 })
    ).rejects.toThrow();

    await expect(
      handler.execute({ prompt: 'Test', softTimeoutMs: 0 })
    ).rejects.toThrow();
  });

  test('hint is prepended before session context is added', async () => {
    // Without session, enhancedPrompt starts as prompt — hint goes at the front
    await handler.execute({ prompt: 'My task', softTimeoutMs: 900000 }); // 15 min

    const callArgs = mockedExecuteCommand.mock.calls[0];
    const cmdArgs = callArgs[1] as string[];
    const promptArg = cmdArgs[cmdArgs.length - 1];

    // Hint should come first
    expect(promptArg.startsWith('[Time budget: 15m.')).toBe(true);
    expect(promptArg).toContain('My task');
  });
});
