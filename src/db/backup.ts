import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import type { AppDatabase } from "./client.ts";

export interface BackupResult {
  readonly path: string;
  readonly integrityCheck: "ok";
}

export async function createVerifiedBackup(database: AppDatabase, destination: string): Promise<BackupResult> {
  const absoluteDestination = resolve(destination);
  mkdirSync(dirname(absoluteDestination), { recursive: true });
  await database.sqlite.backup(absoluteDestination);

  const verification = new Database(absoluteDestination, { fileMustExist: true, readonly: true });
  try {
    const integrityCheck = verification.pragma("integrity_check", { simple: true });
    if (integrityCheck !== "ok") {
      throw new Error(`Backup integrity verification failed: ${String(integrityCheck)}`);
    }
  } finally {
    verification.close();
  }

  return { path: absoluteDestination, integrityCheck: "ok" };
}
