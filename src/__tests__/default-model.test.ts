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

describe('Default Model Configuration', () => {
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
    delete process.env.CODEX_MCP_CALLBACK_URI;
  });

  test('should use gpt-5.3-codex as default model when no model specified', async () => {
    await codexTool.execute({ prompt: 'Test prompt' });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '--skip-git-repo-check',
      'Test prompt',
    ], undefined, undefined);
  });

  test('should override default model when explicit model provided', async () => {
    await codexTool.execute({
      prompt: 'Test prompt',
      model: 'gpt-4',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-4',
      '--skip-git-repo-check',
      'Test prompt',
    ], undefined, undefined);
  });

  test('should use default model with sessions', async () => {
    const sessionId = testSessionStorage.createSession();

    await codexTool.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '--skip-git-repo-check',
      'Test prompt',
    ], undefined, undefined);
  });

  test('should use default model with resume functionality', async () => {
    const sessionId = testSessionStorage.createSession();
    testSessionStorage.setCodexConversationId(sessionId, 'existing-conv-id');

    await codexTool.execute({
      prompt: 'Resume with default model',
      sessionId,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--skip-git-repo-check',
      '-c',
      'model="gpt-5.3-codex"',
      'resume',
      'existing-conv-id',
      'Resume with default model',
    ], undefined, undefined);
  });

  test('should combine default model with reasoning effort', async () => {
    await codexTool.execute({
      prompt: 'Complex task',
      reasoningEffort: 'high',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="high"',
      '--skip-git-repo-check',
      'Complex task',
    ], undefined, undefined);
  });

  test('should use CODEX_DEFAULT_MODEL environment variable when set', async () => {
    const originalEnv = process.env.CODEX_DEFAULT_MODEL;
    process.env.CODEX_DEFAULT_MODEL = 'gpt-4';

    try {
      await codexTool.execute({ prompt: 'Test with env var' });

      expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
        'exec',
        '--model',
        'gpt-4',
        '--skip-git-repo-check',
        'Test with env var',
      ], undefined, undefined);
    } finally {
      if (originalEnv) {
        process.env.CODEX_DEFAULT_MODEL = originalEnv;
      } else {
        delete process.env.CODEX_DEFAULT_MODEL;
      }
    }
  });

  test('should prioritize explicit model over environment variable', async () => {
    const originalEnv = process.env.CODEX_DEFAULT_MODEL;
    process.env.CODEX_DEFAULT_MODEL = 'gpt-4';

    try {
      await codexTool.execute({
        prompt: 'Test priority',
        model: 'gpt-3.5-turbo',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
        'exec',
        '--model',
        'gpt-3.5-turbo',
        '--skip-git-repo-check',
        'Test priority',
      ], undefined, undefined);
    } finally {
      if (originalEnv) {
        process.env.CODEX_DEFAULT_MODEL = originalEnv;
      } else {
        delete process.env.CODEX_DEFAULT_MODEL;
      }
    }
  });
});
