import { randomUUID } from "node:crypto";

import { createDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { SimulatedBrowserClient } from "../integrations/browser/simulated-browser-client.ts";
import { OpenAiDecisionModel } from "../integrations/openai/client.ts";
import { SimulatedDecisionModel } from "../integrations/openai/simulated-decision-model.ts";
import { loadBusinessConfig } from "../lib/business-config.ts";
import { loadEnv } from "../lib/env.ts";
import { createJobHandlers } from "./handlers.ts";
import { runOneJob } from "./runner.ts";
import { createRuntimeJobOperations } from "./runtime-operations.ts";

const env = loadEnv(process.env);
const business = loadBusinessConfig(env.businessConfigPath);
const database = createDatabase(env.databaseUrl);
migrateDatabase(database);

const workerId = `worker-${randomUUID()}`;

const decisionModel =
  env.openAiApiKey && env.instagramMode !== "simulated"
    ? OpenAiDecisionModel.fromApiKey(env.openAiApiKey)
    : new SimulatedDecisionModel();

const operations = createRuntimeJobOperations({
  database,
  business,
  env,
  browserClient: new SimulatedBrowserClient(),
  decisionModel,
  aiPricing: {
    inputPerMillionUsd: env.openAiInputUsdPerMillion ?? 0,
    outputPerMillionUsd: env.openAiOutputUsdPerMillion ?? 0,
  },
  projectedAiCallCostUsd: env.openAiProjectedCallCostUsd ?? 0,
  workerId,
});

/*
 * Browser-initiated first contact is deliberately left unregistered in this
 * build. Any such job therefore fails loudly and lands in the dead-letter queue
 * where the panel shows it, instead of being silently dropped. Registering
 * `prepare_first_contact` and `send_browser_contact` from `operations` is all
 * that would be needed to enable it.
 */
const { prepare_first_contact, send_browser_contact, ...handlers } = createJobHandlers({
  database,
  operations,
});
void prepare_first_contact;
void send_browser_contact;

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

process.stdout.write(`Worker ready: ${env.databaseUrl}\n`);
process.stdout.write(
  `Modelo de decisão: ${decisionModel instanceof SimulatedDecisionModel ? "simulado" : "OpenAI"}\n`,
);
process.stdout.write(`Handlers ativos: ${Object.keys(handlers).join(", ")}\n`);

while (!stopping) {
  const result = await runOneJob({ database, workerId, handlers });
  if (result === "idle") await delay(1_000);
}

database.close();
process.stdout.write("Worker stopped\n");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
