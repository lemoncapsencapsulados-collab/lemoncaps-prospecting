import { describe, expect, it, vi } from "vitest";

import { createDecisionModel, resolveAiConfig } from "@/integrations/ai-provider";
import { SimulatedDecisionModel } from "@/integrations/openai/simulated-decision-model";
import type { DecisionPromptContext } from "@/integrations/openai/prompt";
import { loadBusinessConfig } from "@/lib/business-config";
import { loadEnv } from "@/lib/env";

import { AnthropicDecisionModel, assertExactAnthropicModelId } from "./client";

const validDecision = {
  intent: "asked_info",
  action: "respond",
  responseText: "Posso explicar como funciona a fabricação.",
  confidence: 0.8,
  reasoningSummary: "Pedido de informação sobre o processo.",
  followUpAt: null,
  escalationReason: null,
};

const context: DecisionPromptContext = {
  leadId: "lead-public-id",
  funnel: "customer",
  channelState: "api_eligible",
  publicProfile: { bio: "Perfil público" },
  conversationHistory: [
    { direction: "inbound", body: "Como funciona?", createdAt: "2026-08-28T16:00:00.000Z" },
  ],
  experimentAssignment: null,
  business: loadBusinessConfig("src/test/fixtures/business.json"),
};

function stubClient(response: unknown) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { messages: { parse } } as never, parse };
}

describe("exact Anthropic model identifiers", () => {
  it("accepts the pinned model identifiers", () => {
    expect(() => assertExactAnthropicModelId("claude-opus-5")).not.toThrow();
    expect(() => assertExactAnthropicModelId("claude-haiku-4-5")).not.toThrow();
  });

  it("rejects floating aliases and malformed identifiers", () => {
    for (const model of ["claude-latest", "claude", "", "gpt-5.6-sol", "claude-3-latest"]) {
      expect(() => assertExactAnthropicModelId(model), model).toThrow("exact configured identifier");
    }
  });
});

describe("AnthropicDecisionModel", () => {
  it("returns the parsed decision with the reported token usage", async () => {
    const { client } = stubClient({
      stop_reason: "end_turn",
      parsed_output: validDecision,
      model: "claude-opus-5",
      usage: { input_tokens: 1_200, output_tokens: 180 },
    });

    const result = await new AnthropicDecisionModel(client).decide({
      model: "claude-opus-5",
      purpose: "response",
      context,
    });

    expect(result.decision.action).toBe("respond");
    expect(result.model).toBe("claude-opus-5");
    expect(result.inputTokens).toBe(1_200);
    expect(result.outputTokens).toBe(180);
  });

  it("rejects a floating alias before spending a request", async () => {
    const { client, parse } = stubClient({});

    await expect(
      new AnthropicDecisionModel(client).decide({
        model: "claude-latest",
        purpose: "response",
        context,
      }),
    ).rejects.toThrow("exact configured identifier");
    expect(parse).not.toHaveBeenCalled();
  });

  it("fails loudly on a refusal instead of sending an empty reply", async () => {
    const { client } = stubClient({
      stop_reason: "refusal",
      parsed_output: null,
      model: "claude-opus-5",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    await expect(
      new AnthropicDecisionModel(client).decide({ model: "claude-opus-5", purpose: "response", context }),
    ).rejects.toThrow("anthropic_refused_request");
  });

  it("rejects a decision that breaks the cross-field rules", async () => {
    const { client } = stubClient({
      stop_reason: "end_turn",
      // escalate_human without an escalationReason violates the refined schema.
      parsed_output: { ...validDecision, action: "escalate_human", escalationReason: null },
      model: "claude-opus-5",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await expect(
      new AnthropicDecisionModel(client).decide({ model: "claude-opus-5", purpose: "response", context }),
    ).rejects.toThrow();
  });
});

describe("provider resolution", () => {
  it("defaults to Anthropic", () => {
    const config = resolveAiConfig(loadEnv({ DATABASE_URL: ":memory:" }));

    expect(config.provider).toBe("anthropic");
    expect(config.simulated).toBe(true);
  });

  it("carries the Anthropic models and pricing when configured", () => {
    const config = resolveAiConfig(
      loadEnv({
        DATABASE_URL: ":memory:",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_MODEL: "claude-opus-5",
        ANTHROPIC_MODEL_FAST: "claude-haiku-4-5",
        ANTHROPIC_INPUT_USD_PER_MILLION: "5",
        ANTHROPIC_OUTPUT_USD_PER_MILLION: "25",
        ANTHROPIC_PROJECTED_CALL_COST_USD: "0.02",
      }),
    );

    expect(config).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      modelFast: "claude-haiku-4-5",
      pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
      simulated: false,
    });
  });

  it("uses the real model whenever a key exists, independently of the send mode", () => {
    // Reviewing the real model's wording must not require enabling live sending;
    // INSTAGRAM_MODE gates the send itself, not the decision.
    const env = loadEnv({
      DATABASE_URL: ":memory:",
      INSTAGRAM_MODE: "simulated",
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_MODEL: "claude-opus-5",
      ANTHROPIC_MODEL_FAST: "claude-haiku-4-5",
      ANTHROPIC_INPUT_USD_PER_MILLION: "5",
      ANTHROPIC_OUTPUT_USD_PER_MILLION: "25",
      ANTHROPIC_PROJECTED_CALL_COST_USD: "0.02",
    });

    expect(createDecisionModel(env, resolveAiConfig(env))).toBeInstanceOf(AnthropicDecisionModel);
  });

  it("falls back to the simulated model when no key is configured", () => {
    const env = loadEnv({ DATABASE_URL: ":memory:" });

    expect(createDecisionModel(env, resolveAiConfig(env))).toBeInstanceOf(SimulatedDecisionModel);
  });
});

describe("Anthropic env validation", () => {
  it("requires both models once a key is configured", () => {
    expect(() => loadEnv({ DATABASE_URL: ":memory:", ANTHROPIC_API_KEY: "k" })).toThrow("ANTHROPIC_MODEL");
  });

  it("rejects a floating alias in the model identifier", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: ":memory:",
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_MODEL: "claude-latest",
        ANTHROPIC_MODEL_FAST: "claude-haiku-4-5",
      }),
    ).toThrow("exact model identifier");
  });

  it("requires pricing so cost per lead cannot silently read as zero", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: ":memory:",
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_MODEL: "claude-opus-5",
        ANTHROPIC_MODEL_FAST: "claude-haiku-4-5",
      }),
    ).toThrow("Anthropic pricing");
  });
});
