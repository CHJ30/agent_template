/**
 * createDeepAgent
 *
 * A factory that wraps LangGraph's createReactAgent with:
 *   - Declarative systemPrompt parameter
 *   - Automatic tool-call chain recording
 *   - Structured invoke result (output + toolCallChain + outputLength)
 *
 * Intentionally standalone — no NestJS decorators, no module wiring.
 * Import directly from any script or service.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  step: number;
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface DeepAgentResult {
  output: string;
  toolCallChain: ToolCallRecord[];
  outputLength: number;
}

export interface DeepAgentConfig {
  model: ChatOpenAI;
  systemPrompt: string;
  tools: DynamicStructuredTool[];
}

export interface DeepAgent {
  invoke(input: string): Promise<DeepAgentResult>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

function wrapWithTracking(
  tool: DynamicStructuredTool,
  log: ToolCallRecord[],
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    // Access Zod schema stored on the instance — DynamicStructuredTool inherits
    // .schema from StructuredTool and sets it in the constructor.
    schema: (tool as any).schema,
    func: async (args: any) => {
      const t0 = Date.now();
      const result = await tool.func(args);
      log.push({
        step:       log.length + 1,
        name:       tool.name,
        args:       args as Record<string, unknown>,
        result:     String(result),
        durationMs: Date.now() - t0,
      });
      return result;
    },
  });
}

export function createDeepAgent(config: DeepAgentConfig): DeepAgent {
  const { model, systemPrompt, tools } = config;

  return {
    async invoke(input: string): Promise<DeepAgentResult> {
      const toolCallChain: ToolCallRecord[] = [];

      const trackedTools = tools.map((t) => wrapWithTracking(t, toolCallChain));

      const agent = createReactAgent({
        llm:           model,
        tools:         trackedTools,
        stateModifier: systemPrompt,
      });

      const result = await agent.invoke({
        messages: [new HumanMessage(input)],
      });

      const lastMsg = result.messages[result.messages.length - 1];
      const output =
        typeof lastMsg.content === "string"
          ? lastMsg.content
          : JSON.stringify(lastMsg.content);

      return { output, toolCallChain, outputLength: output.length };
    },
  };
}
