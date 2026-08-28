import type { AiPricing } from "@/integrations/openai/budget";
import type { DecisionModel } from "@/integrations/openai/client";
import { OpenAiDecisionModel } from "@/integrations/openai/client";
import { SimulatedDecisionModel } from "@/integrations/openai/simulated-decision-model";
import { AnthropicDecisionModel } from "@/integrations/anthropic/client";
import type { AiProvider, AppEnv } from "@/lib/env";

export interface ResolvedAiConfig {
  readonly provider: AiProvider;
  readonly model: string;
  readonly modelFast: string;
  readonly pricing: AiPricing;
  readonly projectedCallCostUsd: number;
  /** True when no API key is configured and the simulated model stands in. */
  readonly simulated: boolean;
}

const simulatedFallback = {
  model: "simulated-main",
  modelFast: "simulated-fast",
} as const;

/**
 * Single place that decides which provider the conversation engine talks to, so
 * the worker, the panel and the evidence script cannot drift apart.
 */
export function resolveAiConfig(env: AppEnv): ResolvedAiConfig {
  if (env.aiProvider === "anthropic") {
    return {
      provider: "anthropic",
      model: env.anthropicModel ?? simulatedFallback.model,
      modelFast: env.anthropicModelFast ?? simulatedFallback.modelFast,
      pricing: {
        inputPerMillionUsd: env.anthropicInputUsdPerMillion ?? 0,
        outputPerMillionUsd: env.anthropicOutputUsdPerMillion ?? 0,
      },
      projectedCallCostUsd: env.anthropicProjectedCallCostUsd ?? 0,
      simulated: !env.anthropicApiKey,
    };
  }

  return {
    provider: "openai",
    model: env.openAiModel ?? simulatedFallback.model,
    modelFast: env.openAiModelFast ?? simulatedFallback.modelFast,
    pricing: {
      inputPerMillionUsd: env.openAiInputUsdPerMillion ?? 0,
      outputPerMillionUsd: env.openAiOutputUsdPerMillion ?? 0,
    },
    projectedCallCostUsd: env.openAiProjectedCallCostUsd ?? 0,
    simulated: !env.openAiApiKey,
  };
}

/**
 * Which model decides and whether a message is actually sent are separate
 * concerns: the send gate is INSTAGRAM_MODE, checked at send time. Tying them
 * together made it impossible to review the real model's wording without also
 * enabling live sending, so the only gate here is whether a key exists.
 */
export function createDecisionModel(env: AppEnv, config: ResolvedAiConfig): DecisionModel {
  if (config.simulated) {
    return new SimulatedDecisionModel();
  }

  return config.provider === "anthropic"
    ? AnthropicDecisionModel.fromApiKey(requiredKey(env.anthropicApiKey, "ANTHROPIC_API_KEY"))
    : OpenAiDecisionModel.fromApiKey(requiredKey(env.openAiApiKey, "OPENAI_API_KEY"));
}

function requiredKey(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the configured AI provider`);
  return value;
}
