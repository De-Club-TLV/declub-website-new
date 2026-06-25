import { timingSafeEqual } from "node:crypto";

// Netlify Function: receive an Instagram DM lead from ManyChat and forward it to
// the `lead-intake` Trigger.dev task with source = Instagram. Replaces the old
// n8n "Manychat | Instagram" flow — lead-intake already does name
// transliteration (Claude), 3-tier Contact dedup, the 1-Contact-1-Lead upsert,
// ManyChat subscriber sync, audit notes and Meta CAPI, all more robustly.
//
// Fire-and-forget: ManyChat doesn't use the response, so we just trigger the
// task and return 200. The IG subscriber id is passed through so lead-intake
// adopts the existing subscriber instead of creating a duplicate by phone.
//
// Auth: `X-Manychat-Token` header == WEBHOOK_MANYCHAT_TOKEN (same as the other
// ManyChat-facing functions).

const TRIGGER_API = "https://api.trigger.dev/api/v1/tasks/lead-intake/trigger";

interface NetlifyEvent {
  httpMethod?: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}
interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

function json(statusCode: number, body: unknown): NetlifyResponse {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Instagram display names are full of fancy unicode (math-bold, emoji, etc.).
// NFKD folds math-alphanumerics back to ASCII; the character class then keeps
// only letters (INCLUDING Hebrew, unlike the old n8n flow which stripped all
// non-ASCII), spaces, apostrophes and hyphens — dropping emoji, symbols and
// combining marks. lead-intake's Claude step does the real transliteration.
function cleanName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  const expectedToken = process.env.WEBHOOK_MANYCHAT_TOKEN;
  const triggerKey = process.env.TRIGGER_PROD_SECRET_KEY;
  if (!expectedToken || !triggerKey) return json(500, { error: "server not configured" });

  const provided =
    event.headers["x-manychat-token"] ?? event.headers["X-Manychat-Token"] ?? "";
  if (!provided || !constantTimeEquals(provided, expectedToken)) {
    return json(401, { error: "invalid token" });
  }

  const rawBody = event.body ?? "";
  if (!rawBody) return json(400, { error: "empty body" });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const fullName = String(input["Full Name"] ?? input["full_name"] ?? "").trim();
  const phone = String(input["Phone Number"] ?? input["phone"] ?? "").trim();
  const subscriberId = String(input["Subscriber ID"] ?? input["subscriber_id"] ?? "").trim();

  const name = cleanName(fullName);
  if (!name || !phone) {
    return json(400, { error: "missing Full Name or Phone Number" });
  }

  const res = await fetch(TRIGGER_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${triggerKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      payload: {
        name,
        phone,
        source_override: "Instagram",
        type_override: "Organic",
        source: "manychat-instagram",
        ...(subscriberId ? { subscriber_id: subscriberId } : {}),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json(502, { error: "trigger.dev rejected", status: res.status, detail: text.slice(0, 500) });
  }

  const data = (await res.json()) as { id?: string };
  return json(200, { ok: true, run_id: data.id ?? null });
}
