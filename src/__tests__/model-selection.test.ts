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

describe('Model Selection and Reasoning Effort', () => {
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

  test('should pass model parameter to codex CLI', async () => {
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

  test('should pass reasoning effort to codex CLI', async () => {
    await codexTool.execute({
      prompt: 'Complex analysis',
      reasoningEffort: 'high',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="high"',
      '--skip-git-repo-check',
      'Complex analysis',
    ], undefined, undefined);
  });

  test('should combine model and reasoning effort', async () => {
    await codexTool.execute({
      prompt: 'Advanced task',
      model: 'gpt-4',
      reasoningEffort: 'medium',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-4',
      '-c',
      'model_reasoning_effort="medium"',
      '--skip-git-repo-check',
      'Advanced task',
    ], undefined, undefined);
  });

  test('should return response text string', async () => {
    const result = await codexTool.execute({
      prompt: 'Test prompt',
      model: 'gpt-3.5-turbo',
      reasoningEffort: 'low',
    });

    expect(typeof result).toBe('string');
    expect(result).toBe('Test response');
  });

  test('should validate reasoning effort enum', async () => {
    await expect(
      codexTool.execute({
        prompt: 'Test',
        reasoningEffort: 'invalid' as 'low',
      })
    ).rejects.toThrow();
  });

  test('should pass minimal reasoning effort to CLI', async () => {
    await codexTool.execute({
      prompt: 'Quick task',
      reasoningEffort: 'minimal',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="minimal"',
      '--skip-git-repo-check',
      'Quick task',
    ], undefined, undefined);
  });

  test('should pass none reasoning effort to CLI', async () => {
    await codexTool.execute({
      prompt: 'Simple task',
      reasoningEffort: 'none',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="none"',
      '--skip-git-repo-check',
      'Simple task',
    ], undefined, undefined);
  });

  test('should pass xhigh reasoning effort to CLI', async () => {
    await codexTool.execute({
      prompt: 'Complex task',
      reasoningEffort: 'xhigh',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('codex', [
      'exec',
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="xhigh"',
      '--skip-git-repo-check',
      'Complex task',
    ], undefined, undefined);
  });
});
