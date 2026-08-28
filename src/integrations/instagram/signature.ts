import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function createInstagramSignature(rawBody: Uint8Array, appSecret: string): string {
  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return `${SIGNATURE_PREFIX}${digest}`;
}

export function verifyInstagramSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = Buffer.from(createInstagramSignature(rawBody, appSecret), "utf8");
  const received = Buffer.from(signatureHeader, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
