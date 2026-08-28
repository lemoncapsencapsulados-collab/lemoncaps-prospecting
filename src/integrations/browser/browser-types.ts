export interface BrowserFailureEvidence {
  readonly screenshotPath: string | null;
  readonly accessibilitySnapshotPath: string | null;
  readonly metadataPath: string | null;
}

export interface BrowserPageClient {
  navigate(url: string): Promise<void>;
  typeMessage(message: string, delayMilliseconds: number): Promise<void>;
  send(): Promise<void>;
  captureEvidence(jobId: string, reason: string, error?: Error): Promise<BrowserFailureEvidence>;
  close(): Promise<void>;
}

export interface BrowserContextClient {
  newPage(): Promise<BrowserPageClient>;
}

export interface BrowserSessionClient {
  readonly contexts: readonly BrowserContextClient[];
}

export interface BrowserClient {
  connect(): Promise<BrowserSessionClient>;
}

export class BrowserUnavailableError extends Error {
  public constructor(message = "browser_unavailable") {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}
