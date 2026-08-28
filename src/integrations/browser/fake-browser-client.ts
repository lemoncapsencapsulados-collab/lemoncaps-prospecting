import {
  BrowserUnavailableError,
  type BrowserClient,
  type BrowserFailureEvidence,
  type BrowserPageClient,
  type BrowserSessionClient,
} from "./browser-types.ts";

export class FakeBrowserClient implements BrowserClient {
  public readonly events: string[] = [];

  public constructor(private readonly connectionUnavailable = false) {}

  public static unavailable(): FakeBrowserClient {
    return new FakeBrowserClient(true);
  }

  public async connect(): Promise<BrowserSessionClient> {
    this.events.push("connect");
    if (this.connectionUnavailable) throw new BrowserUnavailableError();
    this.events.push("reuse-context-0");
    return {
      contexts: [
        {
          newPage: async () => {
            this.events.push("new-page");
            return new FakeBrowserPage(this.events);
          },
        },
      ],
    };
  }
}

class FakeBrowserPage implements BrowserPageClient {
  public constructor(private readonly events: string[]) {}

  public async navigate(): Promise<void> {
    this.events.push("navigate-instagram");
  }

  public async typeMessage(): Promise<void> {
    this.events.push("type");
  }

  public async send(): Promise<void> {
    this.events.push("send");
  }

  public async captureEvidence(): Promise<BrowserFailureEvidence> {
    this.events.push("capture-evidence");
    return {
      screenshotPath: "screenshots/fake.png",
      accessibilitySnapshotPath: "screenshots/fake.aria.txt",
      metadataPath: "screenshots/fake.json",
    };
  }

  public async close(): Promise<void> {
    this.events.push("close-page");
  }
}
