import { randomUUID } from "node:crypto";

import { createDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { createDecisionModel, resolveAiConfig } from "../integrations/ai-provider.ts";
import { SimulatedBrowserClient } from "../integrations/browser/simulated-browser-client.ts";
import { loadBusinessConfig } from "../lib/business-config.ts";
import { loadEnv } from "../lib/env.ts";
import { createJobHandlers } from "./handlers.ts";
import { runOneJob } from "./runner.ts";
import { createRuntimeJobOperations, scheduleNextPoll } from "./runtime-operations.ts";

const env = loadEnv(process.env);
const business = loadBusinessConfig(env.businessConfigPath);
const database = createDatabase(env.databaseUrl);
migrateDatabase(database);

const workerId = `worker-${randomUUID()}`;

const aiConfig = resolveAiConfig(env);
const decisionModel = createDecisionModel(env, aiConfig);

const operations = createRuntimeJobOperations({
  database,
  business,
  env,
  browserClient: new SimulatedBrowserClient(),
  decisionModel,
  aiModel: aiConfig.model,
  aiModelFast: aiConfig.modelFast,
  aiPricing: aiConfig.pricing,
  projectedAiCallCostUsd: aiConfig.projectedCallCostUsd,
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

/*
 * Seed the recurring inbound poll. Each run queues the next one, so the schedule
 * lives in the job table; seeding with a past timestamp makes the first poll due
 * immediately, and the slot-based idempotency key stops a restart from stacking
 * duplicates.
 */
const pollSeedFrom = new Date(Date.now() - env.inboundPollSeconds * 1_000);
scheduleNextPoll({ database, env }, pollSeedFrom);

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

process.stdout.write(`Worker ready: ${env.databaseUrl}\n`);
process.stdout.write(
  `Provedor de IA: ${aiConfig.provider}${aiConfig.simulated ? " (simulado — sem chave)" : ""}\n`,
);
process.stdout.write(`Modelos: ${aiConfig.model} / ${aiConfig.modelFast}\n`);
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
