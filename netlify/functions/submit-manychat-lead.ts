import { timingSafeEqual } from "node:crypto";

// Netlify Function: receive a ManyChat External Request when a WhatsApp
// conversation starts, validate the bearer token, map to the Trigger.dev
// `lead-intake` task schema, and forward. Replaces nothing today — this is
// a new intake channel for WA-originated leads.
//
// Auth model: ManyChat doesn't sign payloads with HMAC, so we use a static
// shared secret carried in the `X-Manychat-Token` header. The secret lives
// in Netlify env (`WEBHOOK_MANYCHAT_TOKEN`) and in ManyChat's External
// Request "Custom Headers" config. Compromise impact is bounded to "someone
// can create fake WA-inbound leads" — same risk profile as a leaked form
// signing key. Rotate the env + ManyChat header to revoke.

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
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ManyChat External Request payload. Fields are configurable per-flow on
// the ManyChat side — we accept whatever the user wires up, with sensible
// defaults for the canonical shape:
//   first_name, last_name, phone, email, subscriber_id, last_input
//
// Phone is expected in E.164 (ManyChat's WA phones are already E.164).
// last_input is the user's most recent message text — useful as Lead audit
// context but not required.
interface ManychatPayload {
  first_name?: string;
  last_name?: string;
  name?: string; // fallback if first/last aren't split
  phone?: string;
  email?: string;
  subscriber_id?: string | number;
  last_input?: string;
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  const expectedToken = process.env.WEBHOOK_MANYCHAT_TOKEN;
  const triggerKey = process.env.TRIGGER_PROD_SECRET_KEY;
  if (!expectedToken || !triggerKey) {
    return json(500, { error: "server not configured" });
  }

  const providedToken =
    event.headers["x-manychat-token"] ??
    event.headers["X-Manychat-Token"] ??
    "";
  if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
    return json(401, { error: "invalid token" });
  }

  const rawBody = event.body ?? "";
  if (!rawBody) return json(400, { error: "empty body" });

  let payload: ManychatPayload;
  try {
    payload = JSON.parse(rawBody) as ManychatPayload;
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  // Build a name from whatever ManyChat gave us. Most flows wire first_name
  // + last_name separately, but we accept a bare `name` too.
  const firstName = (payload.first_name ?? "").trim();
  const lastName = (payload.last_name ?? "").trim();
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
  const name = fullNameFromParts || (payload.name ?? "").trim();
  const phone = (payload.phone ?? "").trim();

  if (!name || !phone) {
    return json(400, { error: "missing required fields (name + phone)" });
  }

  const leadIntakePayload: Record<string, unknown> = {
    name,
    phone,
    source_override: "Manychat",
    type_override: "Organic",
    source: "manychat-wa-inbound",
  };
  const email = (payload.email ?? "").trim();
  if (email) leadIntakePayload.email = email;
  const lastInput = (payload.last_input ?? "").trim();
  if (lastInput) {
    leadIntakePayload.notes = `Initial WA message: "${lastInput.slice(0, 500)}"`;
  }

  const res = await fetch(TRIGGER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: leadIntakePayload }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json(502, {
      error: "trigger.dev rejected",
      status: res.status,
      detail: text.slice(0, 500),
    });
  }

  const data = (await res.json()) as { id?: string };
  return json(200, { ok: true, runId: data.id ?? null });
}
