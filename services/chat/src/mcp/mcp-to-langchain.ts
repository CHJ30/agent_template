import { DynamicStructuredTool } from '@langchain/core/tools';
import * as z from 'zod';
import type { MCPClientService, MCPTool } from './mcp-client.service.js';

// ─── JSON Schema types ────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
}

// ─── Schema conversion ────────────────────────────────────────────────────────

/**
 * Recursively converts a JSON Schema node into a Zod schema.
 * Handles: string, number, integer, boolean, array, object, enum, optional.
 */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  // enum takes precedence over type
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum as string[];
    return z.enum(values as [string, ...string[]]);
  }

  switch (schema.type) {
    case 'string':
      return z.string();

    case 'number':
    case 'integer':
      return z.number();

    case 'boolean':
      return z.boolean();

    case 'array': {
      const itemSchema = schema.items
        ? jsonSchemaToZod(schema.items)
        : z.unknown();
      return z.array(itemSchema);
    }

    case 'object': {
      if (!schema.properties) return z.record(z.string(), z.unknown());
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const field = jsonSchemaToZod(prop);
        shape[key] = schema.required?.includes(key) ? field : field.optional();
      }
      return z.object(shape);
    }

    default:
      return z.unknown();
  }
}

// ─── Content serialiser ───────────────────────────────────────────────────────

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  mimeType: string;
  data?: string;
}

type MCPContentBlock = TextContent | ImageContent | { type: string };

/**
 * Converts an MCP content[] array into a plain string.
 * - text blocks → their text value
 * - image blocks → "[image: mimeType]"
 * - other blocks → "[<type>]"
 */
export function serializeMCPContent(content: MCPContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === 'text') return (block as TextContent).text;
      if (block.type === 'image')
        return `[image: ${(block as ImageContent).mimeType}]`;
      return `[${block.type}]`;
    })
    .join('\n');
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

/**
 * Wraps every tool registered in `client` as a LangChain DynamicStructuredTool.
 *
 * @param client  Already-connected MCPClientService (tools must be cached via connect())
 * @param prefix  Optional name prefix, e.g. "mcp_" → tool "analyze" becomes "mcp_analyze"
 */
export function bridgeMCPToLangChain(
  client: MCPClientService,
  prefix = '',
): DynamicStructuredTool[] {
  return client.getTools().map((tool: MCPTool) => {
    const inputSchema = tool.inputSchema as JsonSchema | undefined;
    let zodSchema: z.ZodObject<z.ZodRawShape>;

    if (inputSchema?.type === 'object' && inputSchema.properties) {
      const converted = jsonSchemaToZod(inputSchema);
      zodSchema = converted as z.ZodObject<z.ZodRawShape>;
    } else {
      zodSchema = z.object({});
    }

    return new DynamicStructuredTool({
      name: `${prefix}${tool.name}`,
      description: tool.description ?? tool.name,
      schema: zodSchema,
      func: async (args: Record<string, unknown>) => {
        const result = await client.callTool(tool.name, args);
        const content = (result as { content?: MCPContentBlock[] }).content;
        if (!content) return JSON.stringify(result);
        return serializeMCPContent(content);
      },
    });
  });
}
