import { createHmac, timingSafeEqual } from "node:crypto";

// Netlify Function: receive a website lead submission from the contact modal,
// HMAC-verify, and forward to the Trigger.dev `lead-intake` task. Replaces
// the previous n8n thin-forwarder at n8n.declub.co.il/webhook/446c500d-...
//
// The browser signs the raw request body bytes with WEBHOOK_HMAC_SECRET. We
// verify by HMAC-ing the exact same bytes we received — no re-canonicalization
// on the server side, so the client's canonical-JSON choice is immaterial here.

const TRIGGER_API = "https://api.trigger.dev/api/v1/tasks/lead-intake/trigger";

interface NetlifyEvent {
  httpMethod?: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded?: boolean;
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

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  const secret = process.env.WEBHOOK_HMAC_SECRET;
  const triggerKey = process.env.TRIGGER_PROD_SECRET_KEY;
  if (!secret || !triggerKey) {
    return json(500, { error: "server not configured" });
  }

  const rawBody = event.body ?? "";
  if (!rawBody) return json(400, { error: "empty body" });

  const providedSig =
    event.headers["x-webhook-signature"] ??
    event.headers["X-Webhook-Signature"] ??
    "";
  if (!providedSig) return json(401, { error: "missing signature" });

  const expectedSig = hmacHex(secret, rawBody);
  if (!constantTimeEquals(providedSig, expectedSig)) {
    return json(401, { error: "invalid signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const res = await fetch(TRIGGER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json(502, { error: "trigger.dev rejected", status: res.status, detail: text.slice(0, 500) });
  }

  const data = (await res.json()) as { id?: string };
  return json(200, { ok: true, runId: data.id ?? null });
}
