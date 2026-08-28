import { describe, expect, it, vi } from "vitest";

import { loadBusinessConfig } from "@/lib/business-config";

import { assertExactModelId, OpenAiDecisionModel } from "./client";

describe("OpenAI Responses adapter", () => {
  it("uses structured Responses output with bounded current-model parameters", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        intent: "asked_info",
        action: "respond",
        responseText: "Posso explicar como funciona.",
        confidence: 0.9,
        reasoningSummary: "Pedido de informação.",
        followUpAt: null,
        escalationReason: null,
      },
      model: "gpt-5.6-sol",
      usage: { input_tokens: 200, output_tokens: 80 },
    });
    const model = new OpenAiDecisionModel({ responses: { parse } } as never);

    const result = await model.decide({
      model: "gpt-5.6-sol",
      purpose: "response",
      context: {
        leadId: "lead-public-id",
        funnel: "customer",
        channelState: "api_eligible",
        publicProfile: { bio: "Perfil público" },
        conversationHistory: [
          { direction: "inbound", body: "Como funciona?", createdAt: "2026-08-28T16:00:00.000Z" },
        ],
        experimentAssignment: null,
        business: loadBusinessConfig("src/test/fixtures/business.json"),
      },
    });

    expect(result).toMatchObject({ model: "gpt-5.6-sol", inputTokens: 200, outputTokens: 80 });
    expect(parse).toHaveBeenCalledOnce();
    expect(parse.mock.calls[0]![0]).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 800,
      prompt_cache_key: "instagram-prospecting:conversation-decision:v1",
      text: { verbosity: "low", format: { type: "json_schema" } },
    });
    expect(parse.mock.calls[0]![0].safety_identifier).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("rejects floating or latest model aliases before any request", () => {
    expect(() => assertExactModelId("gpt-5.6")).toThrow("exact configured identifier");
    expect(() => assertExactModelId("gpt-latest")).toThrow("exact configured identifier");
    expect(() => assertExactModelId("gpt-5.6-luna")).not.toThrow();
  });
});
