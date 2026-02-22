import { exec } from 'child_process';
import { promisify } from 'util';

// Mock chalk to avoid ESM issues in Jest
jest.mock('chalk', () => ({
  default: {
    blue: (text: string) => text,
    yellow: (text: string) => text,
    green: (text: string) => text,
    red: (text: string) => text,
  },
}));

// Mock command execution to avoid actual codex calls
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn().mockResolvedValue({
    stdout: 'mocked output',
    stderr: '',
  }),
}));

import { TOOLS } from '../types.js';
import { getToolDefinitions, executeTool, toolExists } from '../tools/index.js';
import { pingTool, helpTool, listSessionsTool, identityTool } from '../tools/simple-tools.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { CodexMcpServer } from '../server.js';

const execAsync = promisify(exec);

describe('Codex MCP Server', () => {
  test('should build successfully', async () => {
    const { stdout } = await execAsync('npm run build');
    expect(stdout).toBeDefined();
  });

  describe('Tool Definitions', () => {
    test('should have all required tools defined', () => {
      const toolDefs = getToolDefinitions();
      expect(toolDefs).toHaveLength(6); // codex, review, ping, help, listSessions, identity

      const toolNames = toolDefs.map((tool) => tool.name);
      expect(toolNames).toContain(TOOLS.CODEX);
      expect(toolNames).toContain(TOOLS.REVIEW);
      expect(toolNames).toContain(TOOLS.PING);
      expect(toolNames).toContain(TOOLS.HELP);
      expect(toolNames).toContain(TOOLS.LIST_SESSIONS);
      expect(toolNames).toContain(TOOLS.IDENTITY);
    });

    test('codex tool should have required prompt parameter', () => {
      const toolDefs = getToolDefinitions();
      const codexToolDef = toolDefs.find((tool) => tool.name === TOOLS.CODEX);
      expect(codexToolDef).toBeDefined();
      expect(codexToolDef?.inputSchema.required).toContain('prompt');
      expect(codexToolDef?.description).toContain('Execute Codex CLI');
    });

    test('ping tool should have optional message parameter', () => {
      const toolDefs = getToolDefinitions();
      const pingToolDef = toolDefs.find((tool) => tool.name === TOOLS.PING);
      expect(pingToolDef).toBeDefined();
      expect(pingToolDef?.inputSchema.required).toEqual([]);
      expect(pingToolDef?.description).toContain('Test MCP server connection');
    });

    test('help tool should have no required parameters', () => {
      const toolDefs = getToolDefinitions();
      const helpToolDef = toolDefs.find((tool) => tool.name === TOOLS.HELP);
      expect(helpToolDef).toBeDefined();
      expect(helpToolDef?.inputSchema.required).toEqual([]);
      expect(helpToolDef?.description).toContain('Get Codex CLI help');
    });
  });

  describe('Tool Registry', () => {
    test('should have all tools registered', () => {
      expect(toolExists(TOOLS.CODEX)).toBe(true);
      expect(toolExists(TOOLS.REVIEW)).toBe(true);
      expect(toolExists(TOOLS.PING)).toBe(true);
      expect(toolExists(TOOLS.HELP)).toBe(true);
      expect(toolExists(TOOLS.LIST_SESSIONS)).toBe(true);
      expect(toolExists(TOOLS.IDENTITY)).toBe(true);
    });

    test('ping tool should return message', async () => {
      const result = await pingTool.execute({ message: 'test' });
      expect(typeof result).toBe('string');
      expect(result).toBe('test');
    });

    test('ping tool should use default message', async () => {
      const result = await pingTool.execute({});
      expect(result).toBe('pong');
    });

    test('listSessions tool should return no active sessions when empty', async () => {
      const result = await listSessionsTool.execute({});
      expect(typeof result).toBe('string');
      expect(result).toBe('No active sessions');
    });

    test('review tool should have correct definition', () => {
      const toolDefs = getToolDefinitions();
      const reviewToolDef = toolDefs.find((tool) => tool.name === TOOLS.REVIEW);
      expect(reviewToolDef).toBeDefined();
      expect(reviewToolDef?.inputSchema.required).toEqual([]);
      expect(reviewToolDef?.description).toContain('code review');
    });
  });

  describe('Server Initialization', () => {
    test('should initialize server with config', () => {
      const config = { name: 'test-server', version: '1.0.0' };
      const server = new CodexMcpServer(config);
      expect(server).toBeInstanceOf(CodexMcpServer);
    });
  });

  describe('MCP schema compatibility', () => {
    test('codex tool results should validate against CallToolResultSchema', () => {
      const result = {
        content: [{ type: 'text', text: 'ok', _meta: { threadId: 'th_123' } }],
        structuredContent: { threadId: 'th_123' },
        _meta: { model: 'gpt-5.3-codex' },
      };

      const parsed = CallToolResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    test('tool definitions should validate against ListToolsResultSchema', () => {
      const parsed = ListToolsResultSchema.safeParse({
        tools: getToolDefinitions(),
      });
      expect(parsed.success).toBe(true);
    });
  });
});
