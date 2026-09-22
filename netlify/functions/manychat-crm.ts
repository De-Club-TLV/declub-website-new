import { timingSafeEqual } from "node:crypto";

// Netlify Function: handle ManyChat WA conversation-start flow, on Arbox since
// 2026-09-22 (the Monday version is archived in _archive/netlify-functions/
// manychat-crm.monday.ts). Two actions
// dispatched via the `action` field:
//
//   1. action="greet" — looks up the Contact in Monday by phone.
//      • If found:    returns { exists: true, contact_id, first_name, last_name }
//      • If NOT found: returns { exists: false }   (NO contact_id)
//      The presence of `contact_id` in the response is the canonical signal
//      ManyChat uses to branch its flow: contact_id set → existing user,
//      send personalized greeting. contact_id missing → new user, collect
//      their name then call action="create".
//
//   2. action="create" — called by ManyChat AFTER the user has provided
//      their name in the conversation. Creates a fresh Contact + Lead with
//      the real name, source = Website (if user came via a wa.me link on
//      declub.co.il, detected by "hi de club" prefix in last_input) or
//      Manychat (default). Returns { contact_id, lead_id, name, source }.
//
// Why no placeholder Contact: an earlier design created a "WA Lead 1234"
// Contact during greet and patched the name later. That left orphan
// Contacts in CRM if the user dropped off before sending their name. The
// current design only creates real records once we have real data.
//
// Architecture: this endpoint talks to Monday GraphQL directly rather than
// going through Trigger.dev's `lead-intake` task. Reason: ManyChat needs a
// synchronous response (~1-2s tops) so the flow can branch on existence;
// Trigger.dev's HTTP trigger API is fire-and-forget and would force us to
// poll for the run result. Direct Monday calls cost ~300-500ms.
//
// Auth: bearer token `X-Manychat-Token` matching `WEBHOOK_MANYCHAT_TOKEN`
// in Netlify env. Same model as the website lead-intake path.

const MANYCHAT_API = "https://api.manychat.com/fb";

// The custom field our whole system searches by (findByCustomField). ManyChat
// auto-creates a subscriber the moment someone WhatsApps the business but never
// sets this field, so an inbound-only sub is invisible to phone lookups — a
// later Hot Form / Arbox lead can't be linked (the 2026-07-01 "Shir Etan"
// case). We stamp it here on every conversation-start so every subscriber is
// findable by phone forever. Default mirrors MANYCHAT_FIELD_PHONE_LOOKUP.
const PHONE_LOOKUP_FIELD_ID = Number(
  process.env.MANYCHAT_FIELD_PHONE_LOOKUP ?? "14505849"
);



// ManyChat page id — used to build the live-chat URL stored on the Contact's
// ManyChat Link column (https://app.manychat.com/fb<page>/chat/<subscriber>).
const MANYCHAT_PAGE_ID = process.env.MANYCHAT_PAGE_ID ?? "";
function buildLiveChatUrl(subscriberId: string): string {
  return MANYCHAT_PAGE_ID
    ? `https://app.manychat.com/fb${MANYCHAT_PAGE_ID}/chat/${subscriberId}`
    : "";
}

// Value for the Contact's ManyChat Link column: the URL points at the live
// chat, but the display TEXT reads `manychat.com/<first_name>` (falls back to
// the URL when no first name). Returns null when there's no page id.
function manychatLinkValue(
  subscriberId: string,
  firstName: string
): { url: string; text: string } | null {
  const url = buildLiveChatUrl(subscriberId);
  if (!url) return null;
  const fn = (firstName || "").trim().toLowerCase();
  return { url, text: fn ? `manychat.com/${fn}` : url };
}


// Magic prefix in `last_input` that tells us the user clicked a wa.me link
// on declub.co.il (every WA button on the site uses `?text=Hi%20De%20Club!`).
// Lets us attribute Source=Website instead of Source=Manychat for these.
// Match on the lowercase prefix only (no trailing `!`) so variants like
// "Hi De Club" (someone deleted the bang) or "Hi De Club! Looking for..."
// (someone appended their question before sending) still attribute correctly.
const WEBSITE_WA_PREFILL_PREFIX = "hi de club";

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

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// Mirror of General/src/shared/phone.ts::toWhatsappId: digits only,
// international, Israeli locals promoted to 972.
function toWhatsappId(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  let digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  if (digits.startsWith("0") && digits.length === 10) digits = "972" + digits.slice(1);
  else if (digits.startsWith("5") && digits.length === 9) digits = "972" + digits;
  return digits.replace(/\D/g, "");
}

// Stamp the phone_lookup custom field on the ManyChat subscriber so our system
// can always resolve them by phone. Non-fatal: never block the greet branch.
async function stampPhoneLookup(subscriberId: string, phone: string): Promise<void> {
  const token = process.env.MANYCHAT_API_TOKEN;
  if (!token || !subscriberId) return;
  const waId = toWhatsappId(phone);
  if (!waId) return;
  const res = await fetch(`${MANYCHAT_API}/subscriber/setCustomFields`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      fields: [{ field_id: PHONE_LOOKUP_FIELD_ID, field_value: waId }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `manychat setCustomFields HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  }
}

// Fold fancy unicode / emoji out of a WhatsApp/IG display name (mirror of
// General shared/translate.ts::cleanName). Keeps letters (incl Hebrew), space,
// apostrophe, hyphen. The nightly crm-cleanup transliterates Hebrew → English.
function cleanNameInline(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Read a Contact's current ManyChat id + link so we only set what's missing.
async function getContactManychatFields(
  contactId: string
): Promise<{ id: string | null; link: string | null }> {
  const data = await gql<any>(
    `query ($id: ID!, $cols: [String!]) {
      items(ids: [$id]) { column_values(ids: $cols) { id text } }
    }`,
    { id: contactId, cols: [CONTACT_MANYCHAT_ID_COL, CONTACT_MANYCHAT_LINK_COL] }
  );
  const cols: any[] = data?.items?.[0]?.column_values ?? [];
  const idCol = cols.find((c) => c.id === CONTACT_MANYCHAT_ID_COL);
  const linkCol = cols.find((c) => c.id === CONTACT_MANYCHAT_LINK_COL);
  return {
    id: idCol?.text?.trim() || null,
    link: linkCol?.text?.trim() || null,
  };
}



// ─── Arbox: the CRM since 2026-09-22 ────────────────────────────────────────
// Monday Contacts / Leads are retired. `contact_id` returned to ManyChat is now
// the Arbox user id (ManyChat only needs it non-empty to branch). Facts verified
// live 2026-09-21: POST /v3/leads does not dedupe (search first), searchUser
// matches Israeli phones in any format, names can be PATCHed, email cannot.
const ARBOX_API = process.env.ARBOX_BASE_URL ?? "https://arboxserver.arboxapp.com/api/public";
const ARBOX_LEADS_LOCATION_ID = Number(process.env.ARBOX_LEADS_LOCATION_ID ?? "21230");
const ARBOX_STATUS_FOLLOW_UP = 54453;
const ARBOX_SOURCE_WHATSAPP = 125545;
const ARBOX_FIELD_WHATSAPP_OPT_IN = "custom-field-1881";
const ARBOX_FIELD_MANYCHAT_ID = "custom-field-1882";
const ARBOX_FIELD_LEAD_TYPE = "custom-field-1883";
const ARBOX_TIMEOUT_MS = 6000;

async function arbox<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ARBOX_API}${path}`, {
    method,
    headers: {
      "api-key": process.env.ARBOX_API_KEY ?? "",
      "Content-Type": "application/json",
      "User-Agent": "declub-automation/1.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(ARBOX_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Arbox HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface ArboxPerson { user_id: number; first_name: string | null; last_name: string | null; user_role: string | null }

async function arboxFindByPhone(phone: string): Promise<ArboxPerson | null> {
  const digits = toWhatsappId(phone);
  if (!digits) return null;
  const res = await arbox<{ data?: ArboxPerson[] | null }>("GET", `/v3/users/searchUser?type=phone&value=${encodeURIComponent(digits)}`);
  const matches = res.data ?? [];
  if (matches.length === 0) return null;
  // A member wins over a lead, so a client is never treated as a fresh lead.
  return matches.find((m) => (m.user_role ?? "").toLowerCase() !== "lead") ?? matches[0];
}

/** Israeli numbers go in the local 05X form staff use; foreign ones as +digits. */
function arboxPhoneFormat(phone: string): string {
  const digits = toWhatsappId(phone);
  return digits.startsWith("972") ? "0" + digits.slice(3) : "+" + digits;
}

async function arboxCreateWhatsappLead(args: {
  firstName: string;
  lastName: string;
  phone: string;
  subscriberId: string;
  viaWebsiteButton: boolean;
}): Promise<number> {
  const res = await arbox<{ data: { user_id: number } }>("POST", "/v3/leads", {
    first_name: args.firstName || "WhatsApp Lead",
    last_name: args.lastName || null,
    phone: arboxPhoneFormat(args.phone),
    location_id: ARBOX_LEADS_LOCATION_ID,
    status_id: ARBOX_STATUS_FOLLOW_UP,
    source_id: ARBOX_SOURCE_WHATSAPP,
    campaign: args.viaWebsiteButton ? "Website WhatsApp button" : null,
    comment: args.viaWebsiteButton
      ? "First WhatsApp message, via a WhatsApp button on declub.co.il"
      : "First WhatsApp message (direct)",
    customFields: [
      { [ARBOX_FIELD_WHATSAPP_OPT_IN]: "yes" },
      { [ARBOX_FIELD_LEAD_TYPE]: "Organic" },
      ...(args.subscriberId ? [{ [ARBOX_FIELD_MANYCHAT_ID]: args.subscriberId }] : []),
    ],
  });
  return res.data.user_id;
}

// ─── Action: capture ──────────────────────────────────────────────────────
// Fires on the FIRST WhatsApp message from a contact, whatever the text.
// - Already in CRM: do nothing except ensure the ManyChat id + link are set.
// - New: create Contact + Lead with the WhatsApp given name + phone, status
//   Follow Up. Always returns contact_id so the flow can later call
//   update_name once it has collected the person's real name.
//
// Body: { phone, first_name?, last_name?, subscriber_id?, last_input? }
// Returns: { exists: bool, contact_id, lead_id? }
async function handleCapture(payload: any): Promise<NetlifyResponse> {
  const phone = String(payload?.phone ?? "").trim();
  if (!phone) return json(400, { error: "missing phone" });
  const subscriberId = String(payload?.subscriber_id ?? "").trim();
  const firstName = String(payload?.first_name ?? "").trim();
  const lastName = String(payload?.last_name ?? "").trim();
  const lastInput = String(payload?.last_input ?? "").trim().toLowerCase();

  // Make the subscriber findable by phone forever (best-effort, non-fatal).
  if (subscriberId) {
    try {
      await stampPhoneLookup(subscriberId, phone);
    } catch (err) {
      console.error("capture stampPhoneLookup failed (non-fatal):", (err as Error).message);
    }
  }

  const existing = await arboxFindByPhone(phone);
  if (existing) {
    // Already in Arbox: leave status alone, only link the ManyChat id.
    if (subscriberId) {
      try {
        await arbox("PATCH", "/v3/users", { user_id: existing.user_id, customFields: [{ [ARBOX_FIELD_MANYCHAT_ID]: subscriberId }] });
      } catch (err) {
        console.error("arbox link failed (non-fatal):", (err as Error).message);
      }
    }
    return json(200, { exists: true, contact_id: String(existing.user_id) });
  }

  const userId = await arboxCreateWhatsappLead({
    firstName: cleanNameInline(firstName),
    lastName: cleanNameInline(lastName),
    phone,
    subscriberId,
    viaWebsiteButton: lastInput.startsWith(WEBSITE_WA_PREFILL_PREFIX),
  });
  return json(200, { exists: false, contact_id: String(userId), lead_id: String(userId) });
}

// ─── Actions: greet / create (retired 2026-07-01, superseded by capture) ───
// Kept as explicit 410s so a forgotten ManyChat branch fails loudly instead of
// writing to the retired Monday boards. Old code: _archive/netlify-functions.
async function handleRetired(action: string): Promise<NetlifyResponse> {
  console.error(`manychat-crm action=${action} is retired; use capture`);
  return json(410, { error: `action '${action}' is retired, use 'capture'` });
}

// ─── Action: update_name ──────────────────────────────────────────────────
// Body: { contact_id, first_name, last_name }
// contact_id is the Arbox user id for everyone captured since 2026-09-22.
// Subscribers captured earlier hold a Monday item id (10 digits); those were
// renamed on Monday already and are skipped here.
async function handleUpdateName(payload: any): Promise<NetlifyResponse> {
  const contactId = String(payload?.contact_id ?? "").trim();
  const firstName = String(payload?.first_name ?? "").trim();
  const lastName = String(payload?.last_name ?? "").trim();
  if (!contactId || !firstName) {
    return json(400, { error: "missing contact_id or first_name" });
  }
  const userId = Number(contactId);
  if (!Number.isFinite(userId) || userId <= 0 || userId > 1_000_000_000) {
    return json(200, { ok: true, contact_id: contactId, renamed_leads: 0, skipped: "not an Arbox id" });
  }
  await arbox("PATCH", "/v3/users", {
    user_id: userId,
    first_name: firstName,
    ...(lastName ? { last_name: lastName } : {}),
  });
  return json(200, { ok: true, contact_id: contactId, renamed_leads: 1 });
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== "POST") return json(405, { error: "method not allowed" });

  const expectedToken = process.env.WEBHOOK_MANYCHAT_TOKEN;
  if (!expectedToken) return json(500, { error: "server not configured" });

  const provided =
    event.headers["x-manychat-token"] ??
    event.headers["X-Manychat-Token"] ??
    "";
  if (!provided || !constantTimeEquals(provided, expectedToken)) {
    return json(401, { error: "invalid token" });
  }

  const rawBody = event.body ?? "";
  if (!rawBody) return json(400, { error: "empty body" });

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const action = String(payload?.action ?? "").trim();
  console.log(
    `manychat-crm request action=${action} phone=${String(payload?.phone ?? "")} sub=${String(payload?.subscriber_id ?? "")}`
  );
  try {
    if (action === "capture") return await handleCapture(payload);
    if (action === "greet" || action === "create") return await handleRetired(action);
    if (action === "update_name") return await handleUpdateName(payload);
    return json(400, { error: `unknown action '${action}', expected 'capture', 'greet', 'create', or 'update_name'` });
  } catch (err) {
    console.error(
      `manychat-crm action=${action} error:`,
      (err as Error).message,
      (err as Error).stack
    );
    return json(500, { error: (err as Error).message });
  }
}
