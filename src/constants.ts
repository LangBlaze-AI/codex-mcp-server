/**
 * Constants for the Codex MCP Server
 */

// Server identity
export const SERVER_NAME = 'codex-mcp-server' as const;

// Logging
export const LOG_PREFIX = '[CDMCP]';

// Error messages
export const ERROR_MESSAGES = {
  TOOL_NOT_FOUND: 'not found in registry',
  NO_PROMPT_PROVIDED: 'Please provide a prompt.',
} as const;

// Status messages
export const STATUS_MESSAGES = {
  PROCESSING_START: 'Starting Codex analysis...',
  PROCESSING_COMPLETE: 'Analysis completed successfully',
} as const;

// MCP Protocol Constants
export const PROTOCOL = {
  ROLES: {
    USER: 'user',
    ASSISTANT: 'assistant',
  },
  CONTENT_TYPES: {
    TEXT: 'text',
  },
  STATUS: {
    SUCCESS: 'success',
    ERROR: 'error',
    FAILED: 'failed',
    REPORT: 'report',
  },
  NOTIFICATIONS: {
    PROGRESS: 'notifications/progress',
  },
  KEEPALIVE_INTERVAL: 25000,
} as const;
