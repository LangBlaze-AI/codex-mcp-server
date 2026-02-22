import { codexTool } from '../tools/codex.tool.js';
import { sessionStorage } from '../session/index.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';

// Mock the command execution
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
}));

// Mock the session singleton
jest.mock('../session/index.js', () => ({
  sessionStorage: new (require('../session/storage.js').InMemorySessionStorage)(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<
  typeof executeCommand
>;

describe('Context Building Analysis', () => {
  let testSessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    testSessionStorage = (sessionStorage as unknown) as InMemorySessionStorage;
    const sessions = testSessionStorage.listSessions();
    sessions.forEach(s => testSessionStorage.deleteSession(s.id));
    mockedExecuteCommand.mockClear();
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: '',
    });
  });

  test('should build enhanced prompt correctly', async () => {
    const sessionId = testSessionStorage.createSession();

    testSessionStorage.addTurn(sessionId, {
      prompt: 'What is recursion?',
      response: 'Recursion is a programming technique where a function calls itself.',
      timestamp: new Date(),
    });

    testSessionStorage.addTurn(sessionId, {
      prompt: 'Show me an example',
      response: 'def factorial(n): return 1 if n <= 1 else n * factorial(n-1)',
      timestamp: new Date(),
    });

    await codexTool.execute({ prompt: 'Make it more efficient', sessionId });

    const call = mockedExecuteCommand.mock.calls[0];
    const sentPrompt = call?.[1]?.[call[1].length - 1];
    expect(sentPrompt).toContain('Previous code context:');
    expect(sentPrompt).toContain('Task: Make it more efficient');
    expect(sentPrompt).not.toContain('Previous: What is recursion?');
  });

  test('should not automatically create sessions', async () => {
    const initialSessions = testSessionStorage.listSessions().length;

    await codexTool.execute({ prompt: 'Simple test' });

    const newSessions = testSessionStorage.listSessions().length;
    expect(newSessions).toBe(initialSessions);
  });

  test('should work without sessions by default', async () => {
    const result = await codexTool.execute({ prompt: 'Simple test' });
    expect(typeof result).toBe('string');
    expect(result).toBe('Test response');
  });

  test('should not save turn on command failure', async () => {
    mockedExecuteCommand.mockRejectedValue(new Error('Command failed'));

    const sessionId = testSessionStorage.createSession();
    const initialTurns = testSessionStorage.getSession(sessionId)?.turns.length || 0;

    try {
      await codexTool.execute({ prompt: 'Test prompt', sessionId });
    } catch {
      // Expected to fail
    }

    const finalTurns = testSessionStorage.getSession(sessionId)?.turns.length || 0;
    expect(finalTurns).toBe(initialTurns);
  });
});
