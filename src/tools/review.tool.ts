import { z } from 'zod';
import { UnifiedTool, ToolArguments } from './registry.js';
import {
  TOOLS,
  DEFAULT_CODEX_MODEL,
  CODEX_DEFAULT_MODEL_ENV_VAR,
  ReviewToolSchema,
} from '../types.js';
import { ToolExecutionError, ValidationError } from '../errors.js';
import { executeCommand, executeCommandStreaming } from '../utils/command.js';
import { ZodError } from 'zod';

const isStructuredContentEnabled = (): boolean => {
  const raw = process.env.STRUCTURED_CONTENT_ENABLED;
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

export const reviewTool: UnifiedTool = {
  name: TOOLS.REVIEW,
  description: 'Run a code review against the current repository using Codex CLI',
  zodSchema: ReviewToolSchema,
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Custom review instructions or focus areas (cannot be used with uncommitted=true; use base/commit review instead)',
      },
      uncommitted: {
        type: 'boolean',
        description: 'Review staged, unstaged, and untracked changes (working tree) - cannot be combined with custom prompt',
      },
      base: {
        type: 'string',
        description: 'Review changes against a specific base branch (e.g., "main", "develop")',
      },
      commit: {
        type: 'string',
        description: 'Review the changes introduced by a specific commit SHA',
      },
      title: {
        type: 'string',
        description: 'Optional title to display in the review summary',
      },
      model: {
        type: 'string',
        description: `Specify which model to use for the review (defaults to ${DEFAULT_CODEX_MODEL})`,
      },
      workingDirectory: {
        type: 'string',
        description: 'Working directory to run the review in (passed via -C as a global Codex option)',
      },
    },
    required: [],
  },
  annotations: {
    title: 'Code Review',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  category: 'codex',
  execute: async (args: ToolArguments, onProgress?: (newOutput: string) => void): Promise<string> => {
    try {
      const {
        prompt,
        uncommitted,
        base,
        commit,
        title,
        model,
        workingDirectory,
      } = ReviewToolSchema.parse(args);

      if (prompt && uncommitted) {
        throw new ValidationError(
          TOOLS.REVIEW,
          'The review prompt cannot be combined with uncommitted=true. Use a base/commit review or omit the prompt.'
        );
      }

      const cmdArgs: string[] = [];

      if (workingDirectory) {
        cmdArgs.push('-C', workingDirectory);
      }

      const selectedModel =
        model ||
        process.env[CODEX_DEFAULT_MODEL_ENV_VAR] ||
        DEFAULT_CODEX_MODEL;
      cmdArgs.push('-c', `model="${selectedModel}"`);

      cmdArgs.push('review');

      if (uncommitted) cmdArgs.push('--uncommitted');
      if (base) cmdArgs.push('--base', base);
      if (commit) cmdArgs.push('--commit', commit);
      if (title) cmdArgs.push('--title', title);
      if (prompt) cmdArgs.push(prompt);

      const result = onProgress
        ? await executeCommandStreaming('codex', cmdArgs, { onProgress: (message) => { onProgress(message); } })
        : await executeCommand('codex', cmdArgs);

      return result.stdout || result.stderr || 'No review output from Codex';
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError(TOOLS.REVIEW, error.message);
      if (error instanceof ValidationError) throw error;
      throw new ToolExecutionError(TOOLS.REVIEW, 'Failed to execute code review', error);
    }
  },
};
