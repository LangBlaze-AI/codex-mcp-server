import { z } from 'zod';
import { UnifiedTool, ToolArguments } from './registry.js';
import {
  TOOLS,
  DEFAULT_CODEX_MODEL,
  CODEX_DEFAULT_MODEL_ENV_VAR,
  AVAILABLE_CODEX_MODELS,
  PingToolSchema,
  HelpToolSchema,
  ListSessionsToolSchema,
} from '../types.js';
import { sessionStorage } from '../session/index.js';
import { ToolExecutionError, ValidationError } from '../errors.js';
import { executeCommand } from '../utils/command.js';
import { ZodError } from 'zod';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load package.json using process.cwd() — compatible with both ESM runtime and ts-jest
function loadPackageVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const data = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return data.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function detectInstallMethod(): string {
  const argv1 = process.argv[1] ?? '';
  if (argv1.includes('node_modules')) return 'npm';
  if (argv1.includes('homebrew') || argv1.includes('/opt/homebrew')) return 'brew';
  if (process.env['npm_config_prefix']) return 'npm';
  return 'unknown';
}

const pkgVersion = loadPackageVersion();

export const pingTool: UnifiedTool = {
  name: TOOLS.PING,
  description: 'Test MCP server connection',
  zodSchema: PingToolSchema,
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Message to echo back',
      },
    },
    required: [],
  },
  annotations: {
    title: 'Ping Server',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  category: 'simple',
  execute: async (args: ToolArguments): Promise<string> => {
    try {
      const { message = 'pong' } = PingToolSchema.parse(args);
      return message;
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError(TOOLS.PING, error.message);
      throw new ToolExecutionError(TOOLS.PING, 'Failed to execute ping command', error);
    }
  },
};

export const helpTool: UnifiedTool = {
  name: TOOLS.HELP,
  description: 'Get Codex CLI help information',
  zodSchema: HelpToolSchema,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: {
    title: 'Get Help',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  category: 'simple',
  execute: async (_args: ToolArguments): Promise<string> => {
    try {
      HelpToolSchema.parse(_args);
      const result = await executeCommand('codex', ['--help']);
      return result.stdout || 'No help information available';
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError(TOOLS.HELP, error.message);
      throw new ToolExecutionError(TOOLS.HELP, 'Failed to execute help command', error);
    }
  },
};

export const listSessionsTool: UnifiedTool = {
  name: TOOLS.LIST_SESSIONS,
  description: 'List all active conversation sessions with metadata',
  zodSchema: ListSessionsToolSchema,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: {
    title: 'List Sessions',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  category: 'simple',
  execute: async (_args: ToolArguments): Promise<string> => {
    try {
      ListSessionsToolSchema.parse(_args);
      const sessions = sessionStorage.listSessions();
      const sessionInfo = sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastAccessedAt: session.lastAccessedAt.toISOString(),
        turnCount: session.turns.length,
      }));
      return sessionInfo.length > 0
        ? JSON.stringify(sessionInfo, null, 2)
        : 'No active sessions';
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError(TOOLS.LIST_SESSIONS, error.message);
      throw new ToolExecutionError(TOOLS.LIST_SESSIONS, 'Failed to list sessions', error);
    }
  },
};

const identityArgsSchema = z.object({});

export const identityTool: UnifiedTool = {
  name: TOOLS.IDENTITY,
  description: 'Get server identity: name, version, active LLM model, and MCP server name. Used by QGSD to fingerprint the active quorum team.',
  zodSchema: identityArgsSchema,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: {
    title: 'Server Identity',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  category: 'simple',
  execute: async (_args: ToolArguments): Promise<string> => {
    return JSON.stringify({
      name: 'codex-mcp-server',
      version: loadPackageVersion(),
      model: process.env[CODEX_DEFAULT_MODEL_ENV_VAR] ?? DEFAULT_CODEX_MODEL,
      available_models: AVAILABLE_CODEX_MODELS,
      install_method: detectInstallMethod(),
    }, null, 2);
  },
};
