import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const BOOKING_RATE_LIMIT_MAX_ATTEMPTS = 8;
const BOOKING_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

type RateLimitRow = {
  allowed: boolean;
  retry_after_seconds: number;
};

export type BookingRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  const candidates = [
    firstForwardedIp,
    request.headers.get("x-real-ip"),
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-vercel-forwarded-for"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.trim().replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(normalized)) return normalized;
  }

  return null;
}

function getRateLimitSubject(request: Request): string {
  const clientIp = getClientIp(request);
  if (clientIp) return `ip:${clientIp}`;

  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 200);
  return `unknown:${userAgent || "none"}`;
}

function hashRateLimitSubject(subject: string): string {
  const secret = process.env.BOOKING_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Booking rate limit secret is not configured");
  }

  return createHmac("sha256", secret).update(subject).digest("hex");
}

export async function consumeBookingRateLimit(
  request: Request
): Promise<BookingRateLimitResult> {
  const keyHash = hashRateLimitSubject(getRateLimitSubject(request));
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("consume_booking_rate_limit", {
    p_key_hash: keyHash,
    p_max_attempts: BOOKING_RATE_LIMIT_MAX_ATTEMPTS,
    p_window_seconds: BOOKING_RATE_LIMIT_WINDOW_SECONDS,
  });

  if (error) {
    throw new Error("Booking rate limit check failed");
  }

  const row = Array.isArray(data) ? (data[0] as RateLimitRow | undefined) : null;
  if (!row || typeof row.allowed !== "boolean") {
    throw new Error("Booking rate limit response was invalid");
  }

  return {
    allowed: row.allowed,
    retryAfterSeconds: Math.max(0, Number(row.retry_after_seconds) || 0),
  };
}
