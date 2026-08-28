import { z } from "zod";

export const integrationModes = ["simulated", "dry_run", "live"] as const;

export type IntegrationMode = (typeof integrationModes)[number];

const booleanString = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalPositiveNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().positive().optional(),
);

const rawEnvSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  BUSINESS_CONFIG_PATH: z.string().trim().min(1).default("config/business.json"),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: optionalSecret,
  OPENAI_MODEL_FAST: optionalSecret,
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(25),
  OPENAI_INPUT_USD_PER_MILLION: optionalPositiveNumber,
  OPENAI_OUTPUT_USD_PER_MILLION: optionalPositiveNumber,
  OPENAI_PROJECTED_CALL_COST_USD: optionalPositiveNumber,
  CHROME_CDP_URL: z.url().default("http://127.0.0.1:9222"),
  CHROME_PROFILE_DIR: z.string().trim().min(1).default(".chrome-profile"),
  INSTAGRAM_APP_SECRET: optionalSecret,
  INSTAGRAM_PAGE_ACCESS_TOKEN: optionalSecret,
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: optionalSecret,
  INSTAGRAM_BUSINESS_ACCOUNT_ID: optionalSecret,
  INSTAGRAM_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  MAX_DMS_PER_DAY: z.coerce.number().int().positive().default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
  OPERATING_HOURS: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().trim().min(1).default("America/Cuiaba"),
  BROWSER_MODE: z.enum(integrationModes).default("simulated"),
  INSTAGRAM_MODE: z.enum(integrationModes).default("simulated"),
  BROWSER_LIVE_AUTHORIZED: booleanString.default(false),
  INSTAGRAM_LIVE_AUTHORIZED: booleanString.default(false),
});

export interface AppEnv {
  readonly databaseUrl: string;
  readonly businessConfigPath: string;
  readonly openAiApiKey?: string;
  readonly openAiModel?: string;
  readonly openAiModelFast?: string;
  readonly openAiMonthlyBudgetUsd: number;
  readonly openAiInputUsdPerMillion?: number;
  readonly openAiOutputUsdPerMillion?: number;
  readonly openAiProjectedCallCostUsd?: number;
  readonly chromeCdpUrl: string;
  readonly chromeProfileDir: string;
  readonly instagramAppSecret?: string;
  readonly instagramPageAccessToken?: string;
  readonly instagramWebhookVerifyToken?: string;
  readonly instagramBusinessAccountId?: string;
  readonly instagramGraphApiVersion: string;
  readonly maxDmsPerDay: number;
  readonly minSecondsBetweenDms: number;
  readonly maxSecondsBetweenDms: number;
  readonly operatingHours: string;
  readonly operatingTimezone: string;
  readonly browserMode: IntegrationMode;
  readonly instagramMode: IntegrationMode;
  readonly browserLiveAuthorized: boolean;
  readonly instagramLiveAuthorized: boolean;
}

export function loadEnv(source: Readonly<Record<string, string | undefined>>): AppEnv {
  const env = rawEnvSchema.parse(source);
  assertLiveAuthorization(env);
  assertOpenAiConfiguration(env);
  assertOperationalBounds(env);
  assertLocalCdpEndpoint(env.CHROME_CDP_URL);

  return {
    databaseUrl: env.DATABASE_URL,
    businessConfigPath: env.BUSINESS_CONFIG_PATH,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL,
    openAiModelFast: env.OPENAI_MODEL_FAST,
    openAiMonthlyBudgetUsd: env.OPENAI_MONTHLY_BUDGET_USD,
    openAiInputUsdPerMillion: env.OPENAI_INPUT_USD_PER_MILLION,
    openAiOutputUsdPerMillion: env.OPENAI_OUTPUT_USD_PER_MILLION,
    openAiProjectedCallCostUsd: env.OPENAI_PROJECTED_CALL_COST_USD,
    chromeCdpUrl: env.CHROME_CDP_URL,
    chromeProfileDir: env.CHROME_PROFILE_DIR,
    instagramAppSecret: env.INSTAGRAM_APP_SECRET,
    instagramPageAccessToken: env.INSTAGRAM_PAGE_ACCESS_TOKEN,
    instagramWebhookVerifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    instagramBusinessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    instagramGraphApiVersion: env.INSTAGRAM_GRAPH_API_VERSION,
    maxDmsPerDay: env.MAX_DMS_PER_DAY,
    minSecondsBetweenDms: env.MIN_SECONDS_BETWEEN_DMS,
    maxSecondsBetweenDms: env.MAX_SECONDS_BETWEEN_DMS,
    operatingHours: env.OPERATING_HOURS,
    operatingTimezone: env.OPERATING_TIMEZONE,
    browserMode: env.BROWSER_MODE,
    instagramMode: env.INSTAGRAM_MODE,
    browserLiveAuthorized: env.BROWSER_LIVE_AUTHORIZED,
    instagramLiveAuthorized: env.INSTAGRAM_LIVE_AUTHORIZED,
  };
}

function assertOpenAiConfiguration(env: z.infer<typeof rawEnvSchema>): void {
  if (env.OPENAI_API_KEY && (!env.OPENAI_MODEL || !env.OPENAI_MODEL_FAST)) {
    throw new Error("OPENAI_MODEL and OPENAI_MODEL_FAST are required when OPENAI_API_KEY is configured");
  }

  for (const [name, value] of [
    ["OPENAI_MODEL", env.OPENAI_MODEL],
    ["OPENAI_MODEL_FAST", env.OPENAI_MODEL_FAST],
  ] as const) {
    if (value && !isExactOpenAiModelId(value)) {
      throw new Error(`${name} must be an exact model identifier`);
    }
  }

  if (
    env.OPENAI_API_KEY &&
    (!env.OPENAI_INPUT_USD_PER_MILLION ||
      !env.OPENAI_OUTPUT_USD_PER_MILLION ||
      !env.OPENAI_PROJECTED_CALL_COST_USD)
  ) {
    throw new Error(
      "OpenAI pricing and projected call cost are required when OPENAI_API_KEY is configured",
    );
  }
}

function isExactOpenAiModelId(value: string): boolean {
  const model = value.trim().toLocaleLowerCase("en-US");
  return (
    !model.includes("latest") &&
    !/^gpt-\d+(?:\.\d+)?$/u.test(model) &&
    /^gpt-[a-z0-9]+(?:[.-][a-z0-9]+)+(?:-[a-z0-9]+)*$/u.test(model)
  );
}

function assertLiveAuthorization(env: z.infer<typeof rawEnvSchema>): void {
  if (env.BROWSER_MODE === "live" && !env.BROWSER_LIVE_AUTHORIZED) {
    throw new Error("BROWSER_LIVE_AUTHORIZED must be true for live browser mode");
  }

  if (env.INSTAGRAM_MODE === "live" && !env.INSTAGRAM_LIVE_AUTHORIZED) {
    throw new Error("INSTAGRAM_LIVE_AUTHORIZED must be true for live Instagram mode");
  }
}

function assertOperationalBounds(env: z.infer<typeof rawEnvSchema>): void {
  if (env.MAX_SECONDS_BETWEEN_DMS < env.MIN_SECONDS_BETWEEN_DMS) {
    throw new Error("MAX_SECONDS_BETWEEN_DMS must be greater than or equal to MIN_SECONDS_BETWEEN_DMS");
  }
}

function assertLocalCdpEndpoint(value: string): void {
  const hostname = new URL(value).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("CHROME_CDP_URL must use 127.0.0.1 or localhost");
  }
}
