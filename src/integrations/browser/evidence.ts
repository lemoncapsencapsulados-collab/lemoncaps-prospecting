import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "playwright";

import type { BrowserFailureEvidence } from "./browser-types.ts";

export interface BrowserDiagnostics {
  readonly consoleErrors: readonly string[];
  readonly failedRequests: readonly { url: string; errorText: string | null }[];
}

export async function captureBrowserEvidence(
  page: Page,
  directory: string,
  jobId: string,
  reason: string,
  diagnostics: BrowserDiagnostics,
  error?: Error,
): Promise<BrowserFailureEvidence> {
  const absoluteDirectory = resolve(directory, sanitizeSegment(jobId));
  await mkdir(absoluteDirectory, { recursive: true });
  const screenshotPath = resolve(absoluteDirectory, "page.png");
  const accessibilitySnapshotPath = resolve(absoluteDirectory, "accessibility.txt");
  const metadataPath = resolve(absoluteDirectory, "metadata.json");

  await page.screenshot({ fullPage: true, path: screenshotPath });
  const accessibilitySnapshot = await page.locator("body").ariaSnapshot();
  await writeFile(accessibilitySnapshotPath, accessibilitySnapshot, "utf8");
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        jobId,
        reason,
        url: page.url(),
        error: error ? { name: error.name, message: error.message } : null,
        consoleErrors: diagnostics.consoleErrors,
        failedRequests: diagnostics.failedRequests,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { screenshotPath, accessibilitySnapshotPath, metadataPath };
}

function sanitizeSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120);
}
