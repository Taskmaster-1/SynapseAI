import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  SharedV4ProviderMetadata,
} from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { ModelSpec } from "./models";

/** One scripted model turn: optional text, then optional tool calls. */
export type ScriptedStep =
  | {
      text?: string;
      toolCalls?: { name: string; input: unknown; id?: string }[];
      providerMetadata?: SharedV4ProviderMetadata;
    }
  | { error: { statusCode: number; message: string } };

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

/**
 * A mock model that replays `steps` in order, one per call. `calls` records the prompts it
 * received, so tests can assert on exactly what the model saw.
 */
export function scriptedModel(steps: ScriptedStep[], ref = "anthropic:claude-sonnet-5-5") {
  const calls: LanguageModelV4CallOptions[] = [];
  let i = 0;
  const model = new MockLanguageModelV4({
    provider: ref.split(":")[0],
    modelId: ref.split(":")[1],
    doStream: async (options) => {
      calls.push(options);
      const step = steps[i++];
      if (!step) throw new Error(`scripted model ran out of steps (call ${i})`);
      if ("error" in step) {
        throw Object.assign(new Error(step.error.message), {
          name: "AI_APICallError",
          statusCode: step.error.statusCode,
          isRetryable: step.error.statusCode === 429 || step.error.statusCode >= 500,
        });
      }
      const chunks: LanguageModelV4StreamPart[] = [];
      if (step.text) {
        chunks.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: step.text },
          { type: "text-end", id: "t" },
        );
      }
      for (const [n, call] of (step.toolCalls ?? []).entries()) {
        chunks.push({
          type: "tool-call",
          toolCallId: call.id ?? `call_${i}_${n}`,
          toolName: call.name,
          input: typeof call.input === "string" ? call.input : JSON.stringify(call.input),
        });
      }
      chunks.push({
        type: "finish",
        usage,
        finishReason: { unified: step.toolCalls?.length ? "tool-calls" : "stop", raw: undefined },
        ...(step.providerMetadata ? { providerMetadata: step.providerMetadata } : {}),
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  const [provider, modelId] = ref.split(":") as [ModelSpec["provider"], string];
  return { spec: { provider, modelId, ref } satisfies ModelSpec, model, calls };
}
