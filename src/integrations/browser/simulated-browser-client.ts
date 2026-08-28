import type {
  BrowserClient,
  BrowserFailureEvidence,
  BrowserPageClient,
  BrowserSessionClient,
} from "./browser-types.ts";
import { assertInstagramUrl } from "./playwright-browser-client.ts";

export class SimulatedBrowserClient implements BrowserClient {
  async connect(): Promise<BrowserSessionClient> {
    return {
      contexts: [
        {
          newPage: async () => new SimulatedBrowserPage(),
        },
      ],
    };
  }
}

class SimulatedBrowserPage implements BrowserPageClient {
  private navigated = false;
  private typed = false;
  private closed = false;

  async navigate(url: string): Promise<void> {
    assertInstagramUrl(url);
    this.navigated = true;
  }

  async typeMessage(message: string): Promise<void> {
    if (!this.navigated || this.closed) throw new Error("simulated_browser_page_not_ready");
    if (!message.trim()) throw new Error("simulated_browser_message_empty");
    this.typed = true;
  }

  async send(): Promise<void> {
    if (!this.typed || this.closed) throw new Error("simulated_browser_message_not_typed");
  }

  async captureEvidence(): Promise<BrowserFailureEvidence> {
    return { screenshotPath: null, accessibilitySnapshotPath: null, metadataPath: null };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
