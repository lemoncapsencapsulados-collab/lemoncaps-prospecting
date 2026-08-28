import type { ChannelOwner, ChannelState } from "@/features/leads/types";

export interface BrowserContactLimitContext {
  readonly generalPaused: boolean;
  readonly browserCircuitOpen: boolean;
  readonly doNotContact: boolean;
  readonly channelState: ChannelState;
  readonly channelOwner: ChannelOwner;
  readonly now: Date;
  readonly operatingHours: string;
  readonly operatingTimezone: string;
  readonly maxDmsPerDay: number;
  readonly minSecondsBetweenDms: number;
  readonly maxSecondsBetweenDms: number;
  readonly warmupStartedAt: Date;
  readonly sentToday: number;
  readonly lastSentAt: Date | null;
  readonly spacingRandomValue: number;
}

export type BrowserContactLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly nextRunAt?: string };

export function evaluateBrowserContactLimits(
  context: BrowserContactLimitContext,
): BrowserContactLimitDecision {
  if (context.generalPaused) return deny("general_pause");
  if (context.browserCircuitOpen) return deny("browser_circuit_open");
  if (context.doNotContact || context.channelState === "do_not_contact") return deny("do_not_contact");
  if (context.channelState !== "browser_contact_pending" || context.channelOwner !== "browser") {
    return deny("browser_channel_not_owned");
  }
  if (!isInsideOperatingHours(context.now, context.operatingTimezone, context.operatingHours)) {
    return deny("outside_operating_hours");
  }
  if (context.sentToday >= context.maxDmsPerDay) return deny("daily_limit_reached");
  if (context.sentToday >= warmupDailyLimit(context)) return deny("warmup_daily_limit_reached");

  const spacing = evaluateSpacing(context);
  if (!spacing.allowed) return spacing;
  return { allowed: true };
}

function deny(reason: string, nextRunAt?: string): BrowserContactLimitDecision {
  return nextRunAt ? { allowed: false, reason, nextRunAt } : { allowed: false, reason };
}

function warmupDailyLimit(context: BrowserContactLimitContext): number {
  const elapsedDays = Math.max(0, Math.floor((context.now.getTime() - context.warmupStartedAt.getTime()) / 86_400_000));
  const weekIndex = Math.floor(elapsedDays / 7);
  return Math.min(context.maxDmsPerDay, 5 + weekIndex * 5);
}

function evaluateSpacing(context: BrowserContactLimitContext): BrowserContactLimitDecision {
  if (!context.lastSentAt) return { allowed: true };
  const boundedRandom = Math.min(1, Math.max(0, context.spacingRandomValue));
  const requiredSeconds = Math.round(
    context.minSecondsBetweenDms +
      (context.maxSecondsBetweenDms - context.minSecondsBetweenDms) * boundedRandom,
  );
  const nextRunAt = new Date(context.lastSentAt.getTime() + requiredSeconds * 1_000);
  return context.now >= nextRunAt ? { allowed: true } : deny("spacing_required", nextRunAt.toISOString());
}

function isInsideOperatingHours(now: Date, timezone: string, operatingHours: string): boolean {
  const [start, end] = operatingHours.split("-");
  if (!start || !end) throw new Error("Invalid operating hours");
  const localMinutes = minutesInTimezone(now, timezone);
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  return startMinutes <= endMinutes
    ? localMinutes >= startMinutes && localMinutes < endMinutes
    : localMinutes >= startMinutes || localMinutes < endMinutes;
}

function minutesInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: timezone,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error(`Unable to resolve timezone: ${timezone}`);
  return hour * 60 + minute;
}

function parseClockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Invalid clock value");
  return (hour ?? 0) * 60 + (minute ?? 0);
}
