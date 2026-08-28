import { chromium, type Page } from "playwright";

import {
  BrowserUnavailableError,
  type BrowserClient,
  type BrowserContextClient,
  type BrowserFailureEvidence,
  type BrowserPageClient,
  type BrowserSessionClient,
} from "./browser-types.ts";
import { captureBrowserEvidence } from "./evidence.ts";

export interface PlaywrightBrowserClientOptions {
  readonly cdpUrl: string;
  readonly evidenceDirectory?: string;
}

export class PlaywrightBrowserClient implements BrowserClient {
  private readonly options: PlaywrightBrowserClientOptions;

  public constructor(options: PlaywrightBrowserClientOptions) {
    this.options = options;
  }

  public async connect(): Promise<BrowserSessionClient> {
    try {
      const browser = await chromium.connectOverCDP(this.options.cdpUrl);
      const contexts = browser.contexts();
      if (!contexts[0]) throw new BrowserUnavailableError("browser_context_unavailable");
      return {
        contexts: contexts.map(
          (context): BrowserContextClient => ({
            newPage: async () =>
              new PlaywrightPageClient(
                await context.newPage(),
                this.options.evidenceDirectory ?? "screenshots",
              ),
          }),
        ),
      };
    } catch (error) {
      if (error instanceof BrowserUnavailableError) throw error;
      throw new BrowserUnavailableError(toError(error).message);
    }
  }
}

class PlaywrightPageClient implements BrowserPageClient {
  private readonly consoleErrors: string[] = [];
  private readonly failedRequests: Array<{ url: string; errorText: string | null }> = [];

  private readonly page: Page;
  private readonly evidenceDirectory: string;

  public constructor(page: Page, evidenceDirectory: string) {
    this.page = page;
    this.evidenceDirectory = evidenceDirectory;
    this.page.on("console", (message) => {
      if (message.type() === "error") this.consoleErrors.push(message.text());
    });
    this.page.on("requestfailed", (request) => {
      this.failedRequests.push({ url: request.url(), errorText: request.failure()?.errorText ?? null });
    });
  }

  public async navigate(url: string): Promise<void> {
    await this.page.goto(assertInstagramUrl(url), { waitUntil: "domcontentloaded" });
    assertInstagramUrl(this.page.url());
    const messageControl = this.page
      .getByRole("button", { name: /mensagem|message/iu })
      .or(this.page.getByRole("link", { name: /mensagem|message/iu }))
      .first();
    if (await messageControl.isVisible()) await messageControl.click();
  }

  public async typeMessage(message: string, delayMilliseconds: number): Promise<void> {
    const composer = this.page.getByRole("textbox", { name: /mensagem|message/iu }).last();
    await composer.click();
    for (const character of message) {
      await composer.pressSequentially(character, { delay: delayMilliseconds });
    }
  }

  public async send(): Promise<void> {
    await this.page.getByRole("button", { name: /enviar|send/iu }).last().click();
  }

  public async captureEvidence(jobId: string, reason: string, error?: Error): Promise<BrowserFailureEvidence> {
    return captureBrowserEvidence(
      this.page,
      this.evidenceDirectory,
      jobId,
      reason,
      { consoleErrors: this.consoleErrors, failedRequests: this.failedRequests },
      error,
    );
  }

  public async close(): Promise<void> {
    if (!this.page.isClosed()) await this.page.close();
  }
}

export function assertInstagramUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.hostname !== "instagram.com" && url.hostname !== "www.instagram.com")) {
    throw new Error("Browser navigation is restricted to Instagram");
  }
  return value;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
