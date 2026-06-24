import { timingSafeEqual } from "node:crypto";

// Netlify Function: receive a ManyChat reply to the Initial-Contact nurture
// sequence (a flow-button tap or a Default-Reply free-text message) and forward
// it to the `lead-nurture-reply` Trigger.dev task. Thin by design — all logic
// (status gate, Follow Up / Lost move, analytics) lives in the task, which owns
// the Supabase nurture tables.
//
// Auth: `X-Manychat-Token` header matching WEBHOOK_MANYCHAT_TOKEN (same token
// as manychat-crm). This function is separate from manychat-crm on purpose:
// that one handles conversation-start CRM sync, this one handles nurture replies.

const TRIGGER_API =
  "https://api.trigger.dev/api/v1/tasks/lead-nurture-reply/trigger";

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

interface ReplyInput {
  subscriber_id?: string;
  phone?: string;
  reply_type?: "button_more" | "button_remove" | "free_text";
  last_text?: string;
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  const expectedToken = process.env.WEBHOOK_MANYCHAT_TOKEN;
  const triggerKey = process.env.TRIGGER_PROD_SECRET_KEY;
  if (!expectedToken || !triggerKey) {
    return json(500, { error: "server not configured" });
  }

  const provided =
    event.headers["x-manychat-token"] ??
    event.headers["X-Manychat-Token"] ??
    "";
  if (!provided || !constantTimeEquals(provided, expectedToken)) {
    return json(401, { error: "invalid token" });
  }

  const rawBody = event.body ?? "";
  if (!rawBody) return json(400, { error: "empty body" });

  let input: ReplyInput;
  try {
    input = JSON.parse(rawBody) as ReplyInput;
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  if (!input.subscriber_id && !input.phone) {
    return json(400, { error: "missing subscriber_id or phone" });
  }

  const res = await fetch(TRIGGER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: {
        subscriber_id: input.subscriber_id,
        phone: input.phone,
        reply_type: input.reply_type,
        last_text: input.last_text,
      },
    }),
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
  return json(200, { ok: true, run_id: data.id ?? null });
}
