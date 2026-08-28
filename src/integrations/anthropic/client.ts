import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  conversationDecisionObject,
  conversationDecisionSchema,
} from "@/integrations/openai/decision-schema";
import { buildDecisionPrompt } from "@/integrations/openai/prompt";
import type { DecisionModel, DecisionModelInput, ModelDecisionResult } from "@/integrations/openai/client";

/** Only the surface this client uses, so tests can supply a stub. */
type MessagesClient = Pick<Anthropic, "messages">;

export class AnthropicDecisionModel implements DecisionModel {
  private readonly client: MessagesClient;

  constructor(client: MessagesClient) {
    this.client = client;
  }

  static fromApiKey(apiKey: string): AnthropicDecisionModel {
    if (!apiKey.trim()) throw new Error("ANTHROPIC_API_KEY is required");
    return new AnthropicDecisionModel(new Anthropic({ apiKey }));
  }

  async decide(input: DecisionModelInput): Promise<ModelDecisionResult> {
    assertExactAnthropicModelId(input.model);
    const prompt = buildDecisionPrompt(input.context);

    const response = await this.client.messages.parse({
      model: input.model,
      max_tokens: 2_000,
      system: prompt.instructions,
      messages: [{ role: "user", content: prompt.input }],
      output_config: {
        format: zodOutputFormat(conversationDecisionObject),
        effort: "low",
      },
    });

    if (response.stop_reason === "refusal") {
      throw new Error("anthropic_refused_request");
    }
    if (!response.parsed_output) {
      throw new Error("anthropic_invalid_structured_output");
    }

    return {
      // The cross-field rules live in the refined schema, not in the JSON Schema
      // the model was given, so they are checked here.
      decision: conversationDecisionSchema.parse(response.parsed_output),
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

/**
 * Rejects floating aliases for the same reason the OpenAI client does: a model
 * that changes under the operator changes the wording of every message sent.
 */
export function assertExactAnthropicModelId(model: string): void {
  const normalized = model.trim().toLocaleLowerCase("en-US");
  if (!normalized || normalized.includes("latest") || !/^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(normalized)) {
    throw new Error(`Anthropic model must be an exact configured identifier: ${model}`);
  }
}
