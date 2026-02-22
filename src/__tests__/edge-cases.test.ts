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

describe('Edge Cases and Integration Issues', () => {
  let testSessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    testSessionStorage = (sessionStorage as unknown) as InMemorySessionStorage;
    const sessions = testSessionStorage.listSessions();
    sessions.forEach(s => testSessionStorage.deleteSession(s.id));
    mockedExecuteCommand.mockClear();
  });

  test('should handle model parameters with resume', async () => {
    const sessionId = testSessionStorage.createSession();
    testSessionStorage.setCodexConversationId(sessionId, 'existing-conv-id');

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    await codexTool.execute({
      prompt: 'Use different model',
      sessionId,
      model: 'gpt-4',
      reasoningEffort: 'high',
    });

    const call = mockedExecuteCommand.mock.calls[0];
    expect(call[1]).toEqual([
      'exec',
      '--skip-git-repo-check',
      '-c',
      'model="gpt-4"',
      '-c',
      'model_reasoning_effort="high"',
      'resume',
      'existing-conv-id',
      'Use different model',
    ]);
  });

  test('should handle missing session ID gracefully', async () => {
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Response without session ID',
      stderr: 'Some other output',
    });

    const sessionId = testSessionStorage.createSession();
    await codexTool.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(testSessionStorage.getCodexConversationId(sessionId)).toBeUndefined();
  });

  test('should handle various session ID formats', async () => {
    const testCases = [
      'session id: abc-123-def',
      'Session ID: XYZ789',
      'session id:uuid-format-here',
    ];

    for (const [index, stderr] of testCases.entries()) {
      const sessionId = testSessionStorage.createSession();
      mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr });

      await codexTool.execute({
        prompt: `Test ${index}`,
        sessionId,
      });

      const extractedId = testSessionStorage.getCodexConversationId(sessionId);
      expect(extractedId).toBeDefined();
      expect(extractedId).not.toContain('session');
      expect(extractedId).not.toContain(':');
    }
  });

  test('should handle command execution failures', async () => {
    mockedExecuteCommand.mockRejectedValue(new Error('Codex CLI not found'));

    await expect(codexTool.execute({ prompt: 'Test prompt' })).rejects.toThrow(
      'Failed to execute codex command'
    );
  });

  test('should handle empty/malformed CLI responses', async () => {
    mockedExecuteCommand.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await codexTool.execute({ prompt: 'Test prompt' });
    expect(result).toBe('No output from Codex');
  });

  test('should validate prompt parameter exists', async () => {
    await expect(
      codexTool.execute({}) // Missing required prompt
    ).rejects.toThrow();
  });

  test('should handle long conversation contexts', async () => {
    const sessionId = testSessionStorage.createSession();

    for (let i = 0; i < 10; i++) {
      testSessionStorage.addTurn(sessionId, {
        prompt: `Question ${i}`,
        response: `Answer ${i}`.repeat(100),
        timestamp: new Date(),
      });
    }

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    await codexTool.execute({
      prompt: 'Final question',
      sessionId,
    });

    const call = mockedExecuteCommand.mock.calls[0];
    const prompt = call?.[1]?.[call[1].length - 1];
    expect(typeof prompt).toBe('string');
    if (prompt) {
      expect(prompt.length).toBeLessThan(5000);
    }
  });
});
