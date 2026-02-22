import { z } from 'zod';
import { UnifiedTool, ToolArguments } from './registry.js';
import {
  TOOLS,
  DEFAULT_CODEX_MODEL,
  CODEX_DEFAULT_MODEL_ENV_VAR,
  CodexToolSchema,
} from '../types.js';
import { sessionStorage } from '../session/index.js';
import { ToolExecutionError, ValidationError } from '../errors.js';
import { executeCommand, executeCommandStreaming } from '../utils/command.js';
import type { ConversationTurn } from '../session/storage.js';
import { ZodError } from 'zod';

function buildEnhancedPrompt(
  turns: ConversationTurn[],
  newPrompt: string
): string {
  if (turns.length === 0) return newPrompt;

  const recentTurns = turns.slice(-2);
  const contextualInfo = recentTurns
    .map((turn) => {
      if (
        turn.response.includes('function') ||
        turn.response.includes('def ')
      ) {
        return `Previous code context: ${turn.response.slice(0, 200)}...`;
      }
      return `Context: ${turn.prompt} -> ${turn.response.slice(0, 100)}...`;
    })
    .join('\n');

  return `${contextualInfo}\n\nTask: ${newPrompt}`;
}

export const codexTool: UnifiedTool = {
  name: TOOLS.CODEX,
  description: 'Execute Codex CLI in non-interactive mode for AI assistance',
  zodSchema: CodexToolSchema,
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The coding task, question, or analysis request',
      },
      sessionId: {
        type: 'string',
        description: 'Optional session ID for conversational context. Note: when resuming a session, sandbox/fullAuto/workingDirectory parameters are not applied (CLI limitation)',
      },
      resetSession: {
        type: 'boolean',
        description: 'Reset the session history before processing this request',
      },
      model: {
        type: 'string',
        description: `Specify which model to use (defaults to ${DEFAULT_CODEX_MODEL})`,
      },
      reasoningEffort: {
        type: 'string',
        enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
        description: 'Control reasoning depth (none < minimal < low < medium < high < xhigh)',
      },
      sandbox: {
        type: 'string',
        enum: ['read-only', 'workspace-write', 'danger-full-access'],
        description: 'Sandbox policy for shell command execution.',
      },
      fullAuto: {
        type: 'boolean',
        description: 'Enable full-auto mode: sandboxed automatic execution without approval prompts',
      },
      workingDirectory: {
        type: 'string',
        description: 'Working directory for the agent to use as its root (passed via -C flag)',
      },
      callbackUri: {
        type: 'string',
        description: 'Static MCP callback URI to pass to Codex via environment (if provided)',
      },
      softTimeoutMs: {
        type: 'number',
        description: 'Soft timeout in milliseconds. If set, prepends a time budget hint to the prompt and sends SIGTERM at this deadline, SIGKILL 5s later.',
      },
    },
    required: ['prompt'],
  },
  annotations: {
    title: 'Execute Codex CLI',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  category: 'codex',
  execute: async (args: ToolArguments, onProgress?: (newOutput: string) => void): Promise<string> => {
    try {
      const {
        prompt,
        sessionId,
        resetSession,
        model,
        reasoningEffort,
        sandbox,
        fullAuto,
        workingDirectory,
        callbackUri,
        softTimeoutMs,
      } = CodexToolSchema.parse(args);

      let activeSessionId = sessionId;
      let enhancedPrompt = prompt;

      if (softTimeoutMs) {
        const minutes = Math.round(softTimeoutMs / 60000);
        enhancedPrompt = `[Time budget: ${minutes}m. Summarize what you have if running long — complete answer over exhaustive research.]\n\n${enhancedPrompt}`;
      }

      let useResume = false;
      let codexConversationId: string | undefined;

      if (sessionId) {
        sessionStorage.ensureSession(sessionId);
        if (resetSession) {
          sessionStorage.resetSession(sessionId);
        }

        codexConversationId = sessionStorage.getCodexConversationId(sessionId);
        if (codexConversationId) {
          useResume = true;
        } else {
          const session = sessionStorage.getSession(sessionId);
          if (session && Array.isArray(session.turns) && session.turns.length > 0) {
            enhancedPrompt = buildEnhancedPrompt(session.turns, prompt);
          }
        }
      }

      const selectedModel =
        model ||
        process.env[CODEX_DEFAULT_MODEL_ENV_VAR] ||
        DEFAULT_CODEX_MODEL;

      const effectiveCallbackUri =
        callbackUri || process.env.CODEX_MCP_CALLBACK_URI;

      let cmdArgs: string[];

      if (useResume && codexConversationId) {
        cmdArgs = ['exec', '--skip-git-repo-check'];
        cmdArgs.push('-c', `model="${selectedModel}"`);
        if (reasoningEffort) {
          cmdArgs.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
        }
        cmdArgs.push('resume', codexConversationId, enhancedPrompt);
      } else {
        cmdArgs = ['exec'];
        cmdArgs.push('--model', selectedModel);
        if (reasoningEffort) {
          cmdArgs.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
        }
        if (sandbox) {
          cmdArgs.push('--sandbox', sandbox);
        }
        if (fullAuto) {
          cmdArgs.push('--full-auto');
        }
        if (workingDirectory) {
          cmdArgs.push('-C', workingDirectory);
        }
        cmdArgs.push('--skip-git-repo-check');
        cmdArgs.push(enhancedPrompt);
      }

      const envOverride = effectiveCallbackUri
        ? { CODEX_MCP_CALLBACK_URI: effectiveCallbackUri }
        : undefined;

      const result = onProgress
        ? await executeCommandStreaming('codex', cmdArgs, {
            onProgress: (message) => { onProgress(message); },
            envOverride,
            softTimeoutMs,
          })
        : await executeCommand('codex', cmdArgs, envOverride, softTimeoutMs);

      const response = result.stdout || result.stderr || 'No output from Codex';

      if (activeSessionId && !useResume) {
        const conversationIdMatch = result.stderr?.match(
          /(conversation|session)\s*id\s*:\s*([a-zA-Z0-9-]+)/i
        );
        if (conversationIdMatch) {
          sessionStorage.setCodexConversationId(activeSessionId, conversationIdMatch[2]);
        }
      }

      if (activeSessionId) {
        const turn: ConversationTurn = {
          prompt,
          response,
          timestamp: new Date(),
        };
        sessionStorage.addTurn(activeSessionId, turn);
      }

      return response;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (error instanceof ZodError) throw new ValidationError(TOOLS.CODEX, error.message);
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(TOOLS.CODEX, 'Failed to execute codex command', error);
    }
  },
};
