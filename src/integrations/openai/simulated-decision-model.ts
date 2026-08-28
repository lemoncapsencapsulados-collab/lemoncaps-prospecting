import type { DecisionModel, DecisionModelInput, ModelDecisionResult } from "./client.ts";
import type { ConversationDecision } from "./decision-schema.ts";

export class SimulatedDecisionModel implements DecisionModel {
  async decide(input: DecisionModelInput): Promise<ModelDecisionResult> {
    const latestInbound = [...input.context.conversationHistory]
      .reverse()
      .find((message) => message.direction === "inbound")?.body ?? "";
    const decision = simulatedDecision(latestInbound, input.purpose);
    return {
      decision,
      model: `simulated:${input.model}`,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

function simulatedDecision(
  latestInbound: string,
  purpose: "intent" | "response",
): ConversationDecision {
  const normalized = latestInbound.toLocaleLowerCase("pt-BR");
  if (/\b(?:pre[cç]o|valor|quanto custa)\b/iu.test(normalized)) {
    return {
      intent: "asked_pricing",
      action: purpose === "intent" ? "respond" : "escalate_human",
      responseText: purpose === "intent" ? "Vou verificar essa informação." : null,
      confidence: 0.9,
      reasoningSummary: "Preços não fazem parte das afirmações verificadas fornecidas.",
      followUpAt: null,
      escalationReason: purpose === "response" ? "pricing_requires_human" : null,
    };
  }
  return {
    intent: "asked_info",
    action: "respond",
    responseText:
      purpose === "intent"
        ? "Vou preparar uma resposta segura."
        : "Posso explicar como funciona e, se fizer sentido, seguir com o próximo passo.",
    confidence: 0.8,
    reasoningSummary: "Simulação local de uma solicitação de informações.",
    followUpAt: null,
    escalationReason: null,
  };
}
