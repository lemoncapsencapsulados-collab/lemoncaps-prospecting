import { describe, expect, it } from "vitest";

import { conversationDecisionSchema } from "./decision-schema";

describe("conversation decision schema", () => {
  it("parses the strict supported decision vocabulary", () => {
    const decision = conversationDecisionSchema.parse({
      intent: "asked_info",
      action: "respond",
      responseText: "Posso explicar como funciona.",
      confidence: 0.91,
      reasoningSummary: "A pessoa pediu informações.",
      followUpAt: null,
      escalationReason: null,
    });

    expect(decision.intent).toBe("asked_info");
  });

  it("rejects extra keys, invalid enums, and missing action requirements", () => {
    expect(() =>
      conversationDecisionSchema.parse({
        intent: "invented_intent",
        action: "respond",
        responseText: null,
        confidence: 2,
        reasoningSummary: "Inválido",
        followUpAt: null,
        escalationReason: null,
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      conversationDecisionSchema.parse({
        intent: "asked_info",
        action: "respond",
        responseText: null,
        confidence: 0.8,
        reasoningSummary: "Sem resposta",
        followUpAt: null,
        escalationReason: null,
      }),
    ).toThrow();
  });
});
