import { createDatabase } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import {
  InvalidInstagramSignatureError,
  InvalidInstagramWebhookError,
  processInstagramWebhook,
  verifyWebhookChallenge,
} from "@/integrations/instagram/webhook-service";
import { loadEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const env = loadEnv(process.env);
  if (!env.instagramWebhookVerifyToken) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const search = new URL(request.url).searchParams;
  const challenge = verifyWebhookChallenge(
    {
      mode: search.get("hub.mode"),
      token: search.get("hub.verify_token"),
      challenge: search.get("hub.challenge"),
    },
    env.instagramWebhookVerifyToken,
  );
  if (!challenge) return Response.json({ error: "forbidden" }, { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const env = loadEnv(process.env);
  if (!env.instagramAppSecret) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const database = createDatabase(env.databaseUrl);
  try {
    migrateDatabase(database);
    const result = processInstagramWebhook({
      database,
      appSecret: env.instagramAppSecret,
      signatureHeader: request.headers.get("x-hub-signature-256"),
      rawBody,
    });
    return Response.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof InvalidInstagramSignatureError) {
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
    if (error instanceof InvalidInstagramWebhookError) {
      return Response.json({ error: "invalid_payload" }, { status: 400 });
    }
    throw error;
  } finally {
    database.close();
  }
}
