import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolAnnotations } from '../types.js';
import { ZodTypeAny, ZodError } from 'zod';

export type ToolArguments = Record<string, unknown>;

export interface UnifiedTool {
  name: string;
  description: string;
  zodSchema: ZodTypeAny;
  inputSchema: Tool['inputSchema'];
  annotations?: ToolAnnotations;

  execute: (
    args: ToolArguments,
    onProgress?: (newOutput: string) => void
  ) => Promise<string>;
  category?: 'simple' | 'codex' | 'utility';
}

export const toolRegistry: UnifiedTool[] = [];

export function toolExists(toolName: string): boolean {
  return toolRegistry.some((t) => t.name === toolName);
}

export function getToolDefinitions(): Tool[] {
  return toolRegistry.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations && { annotations: tool.annotations }),
  }));
}

export async function executeTool(
  toolName: string,
  args: ToolArguments,
  onProgress?: (newOutput: string) => void
): Promise<string> {
  const tool = toolRegistry.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  try {
    const validatedArgs = tool.zodSchema.parse(args) as ToolArguments;
    return tool.execute(validatedArgs, onProgress);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Invalid arguments for ${toolName}: ${issues}`);
    }
    throw error;
  }
}
