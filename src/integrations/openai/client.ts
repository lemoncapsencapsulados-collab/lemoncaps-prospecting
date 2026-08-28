import { createHash } from "node:crypto";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  conversationDecisionSchema,
  type ConversationDecision,
} from "./decision-schema.ts";
import { buildDecisionPrompt, type DecisionPromptContext } from "./prompt.ts";

export interface DecisionModelInput {
  readonly model: string;
  readonly purpose: "intent" | "response";
  readonly context: DecisionPromptContext;
}

export interface ModelDecisionResult {
  readonly decision: ConversationDecision;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DecisionModel {
  decide(input: DecisionModelInput): Promise<ModelDecisionResult>;
}

type ResponsesClient = Pick<OpenAI, "responses">;

export class OpenAiDecisionModel implements DecisionModel {
  constructor(private readonly client: ResponsesClient) {}

  static fromApiKey(apiKey: string): OpenAiDecisionModel {
    if (!apiKey.trim()) throw new Error("OPENAI_API_KEY is required");
    return new OpenAiDecisionModel(new OpenAI({ apiKey }));
  }

  async decide(input: DecisionModelInput): Promise<ModelDecisionResult> {
    assertExactModelId(input.model);
    const prompt = buildDecisionPrompt(input.context);
    const response = await this.client.responses.parse({
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      text: {
        format: zodTextFormat(conversationDecisionSchema, "conversation_decision"),
        verbosity: "low",
      },
      reasoning: { effort: "low" },
      max_output_tokens: 800,
      store: false,
      prompt_cache_key: "instagram-prospecting:conversation-decision:v1",
      safety_identifier: safetyIdentifier(input.context.leadId),
    });
    if (!response.output_parsed) throw new Error("openai_invalid_structured_output");
    return {
      decision: conversationDecisionSchema.parse(response.output_parsed),
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}

export function assertExactModelId(model: string): void {
  const normalized = model.trim().toLocaleLowerCase("en-US");
  if (
    !normalized ||
    normalized.includes("latest") ||
    /^gpt-\d+(?:\.\d+)?$/u.test(normalized) ||
    !/^gpt-[a-z0-9]+(?:[.-][a-z0-9]+)+(?:-[a-z0-9]+)*$/u.test(normalized)
  ) {
    throw new Error(`OpenAI model must be an exact configured identifier: ${model}`);
  }
}

function safetyIdentifier(leadId: string): string {
  return createHash("sha256").update(leadId).digest("hex").slice(0, 32);
}
