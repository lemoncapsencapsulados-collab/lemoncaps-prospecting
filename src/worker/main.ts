import { randomUUID } from "node:crypto";

import { createDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { loadEnv } from "../lib/env.ts";
import { runOneJob } from "./runner.ts";

const env = loadEnv(process.env);
const database = createDatabase(env.databaseUrl);
migrateDatabase(database);

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

process.stdout.write(`Worker ready: ${env.databaseUrl}\n`);

while (!stopping) {
  const result = await runOneJob({ database, workerId: `worker-${randomUUID()}`, handlers: {} });
  if (result === "idle") await delay(1_000);
}

database.close();
process.stdout.write("Worker stopped\n");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
