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

describe('Codex Resume Functionality', () => {
  let testSessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    testSessionStorage = (sessionStorage as unknown) as InMemorySessionStorage;
    const sessions = testSessionStorage.listSessions();
    sessions.forEach(s => testSessionStorage.deleteSession(s.id));
    mockedExecuteCommand.mockClear();
    delete process.env.CODEX_MCP_CALLBACK_URI;
  });

  test('should use exec for new session without codex session ID', async () => {
    const sessionId = testSessionStorage.createSession();
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: 'conversation id: abc-123-def',
    });

    await codexTool.execute({
      prompt: 'First message',
      sessionId,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '--skip-git-repo-check',
      'First message',
    ], undefined, undefined);
  });

  test('should extract and store session ID', async () => {
    const sessionId = testSessionStorage.createSession();
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: 'conversation id: abc-123-def',
    });

    await codexTool.execute({
      prompt: 'First message',
      sessionId,
    });

    expect(testSessionStorage.getCodexConversationId(sessionId)).toBe('abc-123-def');
  });

  test('should pass callback URI via environment when provided', async () => {
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: '',
    });

    await codexTool.execute({
      prompt: 'Callback check',
      callbackUri: 'http://localhost:1234/callback',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      { CODEX_MCP_CALLBACK_URI: 'http://localhost:1234/callback' },
      undefined
    );
  });

  test('should use resume for subsequent messages in session', async () => {
    const sessionId = testSessionStorage.createSession();
    testSessionStorage.setCodexConversationId(sessionId, 'existing-codex-session-id');

    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Resumed response',
      stderr: '',
    });

    await codexTool.execute({
      prompt: 'Continue the task',
      sessionId,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--skip-git-repo-check',
      '-c',
      'model="gpt-5.3-codex"',
      'resume',
      'existing-codex-session-id',
      'Continue the task',
    ], undefined, undefined);
  });

  test('should reset session ID when session is reset', async () => {
    const sessionId = testSessionStorage.createSession();
    testSessionStorage.setCodexConversationId(sessionId, 'old-session-id');

    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: 'conversation id: new-session-id',
    });

    await codexTool.execute({
      prompt: 'Reset and start new',
      sessionId,
      resetSession: true,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '--skip-git-repo-check',
      'Reset and start new',
    ], undefined, undefined);
    expect(testSessionStorage.getCodexConversationId(sessionId)).toBe('new-session-id');
  });

  test('should fall back to manual context if no codex session ID', async () => {
    const sessionId = testSessionStorage.createSession();

    testSessionStorage.addTurn(sessionId, {
      prompt: 'Previous question',
      response: 'Previous answer',
      timestamp: new Date(),
    });

    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Context-aware response',
      stderr: '',
    });

    await codexTool.execute({
      prompt: 'Follow up question',
      sessionId,
    });

    const call = mockedExecuteCommand.mock.calls[0];
    const sentPrompt = call?.[1]?.[call[1].length - 1];
    expect(sentPrompt).toContain('Context:');
    expect(sentPrompt).toContain('Task: Follow up question');
  });
});
