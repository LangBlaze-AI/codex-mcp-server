import { codexTool } from '../tools/codex.tool.js';
import { reviewTool } from '../tools/review.tool.js';
import { sessionStorage } from '../session/index.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';
import { ToolExecutionError, ValidationError } from '../errors.js';

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

describe('Error Handling Scenarios', () => {
  let testSessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    testSessionStorage = (sessionStorage as unknown) as InMemorySessionStorage;
    const sessions = testSessionStorage.listSessions();
    sessions.forEach(s => testSessionStorage.deleteSession(s.id));
    mockedExecuteCommand.mockClear();
  });

  test('should handle codex CLI authentication errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Authentication failed: Please run `codex login`')
    );

    await expect(codexTool.execute({ prompt: 'Test prompt' })).rejects.toThrow(
      ToolExecutionError
    );
  });

  test('should handle codex CLI not found errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('command not found: codex')
    );

    await expect(codexTool.execute({ prompt: 'Test prompt' })).rejects.toThrow(
      ToolExecutionError
    );
  });

  test('should handle invalid model parameters', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Invalid model: invalid-model')
    );

    await expect(
      codexTool.execute({
        prompt: 'Test prompt',
        model: 'invalid-model',
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle codex CLI timeout errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Timeout: Command took too long to execute')
    );

    await expect(
      codexTool.execute({ prompt: 'Complex analysis task' })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle network errors during codex execution', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Network error: Unable to reach OpenAI API')
    );

    await expect(codexTool.execute({ prompt: 'Test prompt' })).rejects.toThrow(
      ToolExecutionError
    );
  });

  test('should handle invalid session IDs gracefully', async () => {
    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    const result = await codexTool.execute({
      prompt: 'Test prompt',
      sessionId: 'non-existent-session-id',
    });

    expect(result).toBe('Response');
  });

  test('should reject review prompt with uncommitted', async () => {
    await expect(
      reviewTool.execute({
        prompt: 'Review instructions',
        uncommitted: true,
      })
    ).rejects.toThrow(ValidationError);

    expect(mockedExecuteCommand).not.toHaveBeenCalled();
  });

  test('should reject invalid sessionId values', async () => {
    await expect(
      codexTool.execute({
        prompt: 'Test prompt',
        sessionId: 'bad id',
      })
    ).rejects.toThrow(ValidationError);

    expect(mockedExecuteCommand).not.toHaveBeenCalled();
  });

  test('should handle corrupted session data', async () => {
    const sessionId = testSessionStorage.createSession();

    const session = testSessionStorage.getSession(sessionId);
    if (session) {
      (session.turns as unknown) = null;
    }

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    const result = await codexTool.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(result).toBe('Response');
  });

  test('should handle malformed resume conversation IDs', async () => {
    const sessionId = testSessionStorage.createSession();
    testSessionStorage.setCodexConversationId(sessionId, 'invalid-conv-id-format');

    mockedExecuteCommand.mockRejectedValue(
      new Error('Invalid conversation ID format')
    );

    await expect(
      codexTool.execute({
        prompt: 'Resume test',
        sessionId,
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle very long prompts', async () => {
    const longPrompt = 'A'.repeat(100000);

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    const result = await codexTool.execute({ prompt: longPrompt });

    expect(result).toBe('Response');
    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '--skip-git-repo-check',
      longPrompt,
    ], undefined, undefined);
  });
});
