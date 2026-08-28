import { z } from "zod";

const webhookMessageSchema = z
  .object({
    sender: z.object({ id: z.string().min(1), username: z.string().min(1).optional() }).passthrough(),
    recipient: z.object({ id: z.string().min(1) }).passthrough(),
    timestamp: z.number().int().nonnegative(),
    message: z
      .object({
        mid: z.string().min(1),
        text: z.string().optional(),
        is_echo: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const instagramWebhookSchema = z
  .object({
    object: z.literal("instagram"),
    entry: z.array(
      z
        .object({
          id: z.string().min(1),
          time: z.number().int().nonnegative(),
          messaging: z.array(webhookMessageSchema).default([]),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type InstagramWebhook = z.infer<typeof instagramWebhookSchema>;
export type InstagramWebhookMessage = z.infer<typeof webhookMessageSchema>;
