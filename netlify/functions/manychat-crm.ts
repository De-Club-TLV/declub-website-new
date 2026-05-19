import { timingSafeEqual } from "node:crypto";

// Netlify Function: handle ManyChat WA conversation-start flow. Two actions
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

const MONDAY_API = "https://api.monday.com/v2";

// De Club CRM board + column IDs (mirror of General/src/shared/config.ts).
// Hardcoded because Netlify Functions can't import from the General/ repo.
// Bump these alongside config.ts when the schema changes.
const CONTACTS_BOARD_ID = "5022104625";
const LEADS_BOARD_ID = "5022104620";
const CONTACTS_LEADS_GROUP_ID = "new_group95562";
const LEADS_NEW_GROUP_ID = "group_mkxq2aj9";
const CONTACT_PHONE_COL = "contact_phone";
const CONTACT_TYPE_COL = "status";
const LEAD_STATUS_COL = "lead_status";
const LEAD_SOURCE_COL = "color_mkwba3e8";
const LEAD_TYPE_COL = "color_mkwbcm0n";
const LEAD_DATE_COL = "date_mkwg62xr";
const LEAD_CONTACT_RELATION_COL = "board_relation_mkwaq2js";
const CONTACT_LEAD_RELATION_COL = "board_relation_mkzy8749";

const CONTACT_GENDER_COL = "color_mkwcfe01";

// Monday label indices (LEAD_SOURCE / LEAD_TYPE / etc — mirror of
// General/src/shared/monday.ts).
const LEAD_SOURCE_MANYCHAT = 4;
const LEAD_SOURCE_WEBSITE = 11;
const LEAD_TYPE_ORGANIC = 0;
const LEAD_STATUS_NEW = 5;
const CONTACT_TYPE_LEAD = 0;
const CONTACT_GENDER_MALE = 0;
const CONTACT_GENDER_FEMALE = 3;

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

async function gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN missing");
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.errors) throw new Error(`Monday: ${JSON.stringify(data.errors).slice(0, 300)}`);
  return data.data;
}

// Phone format variants — try the exact ManyChat-passed value, digits-only,
// E.164 with/without leading +, and the Israeli 05x form. Catches drift
// between how Contacts were saved historically (n8n era often used 0xx,
// new intake uses 972...).
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (digits) variants.add(digits);
  if (digits.startsWith("972")) {
    variants.add("+" + digits);
    variants.add("0" + digits.slice(3));
  } else if (digits.startsWith("0") && digits.length === 10) {
    variants.add("972" + digits.slice(1));
    variants.add("+972" + digits.slice(1));
  }
  return [...variants].filter(Boolean);
}

async function lookupContactByPhone(
  phone: string
): Promise<{ contactId: string; name: string } | null> {
  for (const value of phoneVariants(phone)) {
    const data = await gql<any>(
      `query ($boardId: ID!, $col: String!, $val: String!) {
        items_page_by_column_values(
          board_id: $boardId
          limit: 1
          columns: [{ column_id: $col, column_values: [$val] }]
        ) { items { id name } }
      }`,
      { boardId: CONTACTS_BOARD_ID, col: CONTACT_PHONE_COL, val: value }
    );
    const items = data.items_page_by_column_values.items;
    if (items.length > 0) {
      return { contactId: items[0].id, name: items[0].name };
    }
  }
  return null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function containsHebrew(s: string): boolean {
  return /[֐-׿יִ-ﭏ]/.test(s);
}

// Inline mirror of General/src/shared/translate.ts::analyzeName. Calls
// Anthropic Claude Haiku via direct HTTP (no SDK dep) to phonetically
// transliterate Hebrew names to English + detect gender. Used during
// Contact creation so Monday's CRM stays English-only per project convention.
//
// Non-throwing: on any failure, falls back to {englishName: rawName,
// gender: "female"}. Better to write a Hebrew-named Contact than refuse
// to create one. The nightly crm-cleanup re-syncs names from Leads later.
async function analyzeName(rawName: string): Promise<{ englishName: string; gender: "male" | "female" }> {
  const trimmed = rawName.trim();
  if (!trimmed) return { englishName: "", gender: "female" };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No API key — return raw. Production deploy should always have it.
    return { englishName: trimmed, gender: "female" };
  }

  // Skip the API call when input is purely Latin script — no transliteration
  // needed. We still don't get a gender guess that way; default to female,
  // crm-cleanup / sales can correct.
  if (!containsHebrew(trimmed)) {
    return { englishName: trimmed, gender: "female" };
  }

  const model = process.env.ANTHROPIC_TRANSLATE_MODEL || "claude-haiku-4-5-20251001";
  const system =
    "You analyze a person's name and return ONLY a JSON object of the form " +
    '{"englishName":"...","gender":"male"|"female"} with no surrounding text, ' +
    "no markdown, no explanation.\n\n" +
    "CRITICAL: Treat the ENTIRE input as a proper name — a single identifier. " +
    "Never translate meaning. Transliterate the SOUND, not the WORD. " +
    "This holds even when the name happens to be spelled the same as a common " +
    "Hebrew word. The person picked that spelling as their name; preserve it.\n\n" +
    "Rules:\n" +
    "1. englishName: if the input is in Hebrew, PHONETICALLY transliterate to English.\n" +
    "   Examples (correct → wrong):\n" +
    "   • 'יובל כץ' → 'Yuval Katz' (NOT 'Yield Edge')\n" +
    "   • 'אגוז' → 'Egoz' (NOT 'Nut')\n" +
    "   • 'שחר' → 'Shahar' (NOT 'Dawn')\n" +
    "   • 'ברק' → 'Barak' (NOT 'Lightning')\n" +
    "   • 'אור' → 'Or' (NOT 'Light')\n" +
    "   Use standard modern Israeli Hebrew romanization. If the input is already " +
    "in Latin script, pass it through unchanged (preserve original spelling/capitalization).\n" +
    "2. gender: MUST be exactly 'male' or 'female'. Never 'unknown' or anything else. " +
    "If the first name is truly ambiguous (unisex), pick your best statistical guess. " +
    "Israeli context: if the name suggests Israeli-Hebrew origin, weight by common " +
    "Israeli gender usage (e.g., 'יובל' is unisex but slightly more common as male).";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: trimmed }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
    const data: any = await res.json();
    const text = (data?.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`no JSON in response: ${text.slice(0, 100)}`);
    const parsed: any = JSON.parse(match[0]);
    const englishName =
      typeof parsed.englishName === "string" && parsed.englishName.trim()
        ? parsed.englishName.trim()
        : trimmed;
    const gender = parsed.gender === "male" ? "male" : "female";
    return { englishName, gender };
  } catch {
    return { englishName: trimmed, gender: "female" };
  }
}

async function createContactAndLead(args: {
  name: string;
  phone: string;
  sourceIndex: number;
  genderIndex?: number;
}): Promise<{ contactId: string; leadId: string }> {
  // Create Contact
  const contactCv: Record<string, unknown> = {
    [CONTACT_PHONE_COL]: { phone: args.phone, countryShortName: "IL" },
    [CONTACT_TYPE_COL]: { index: CONTACT_TYPE_LEAD },
  };
  if (args.genderIndex != null) {
    contactCv[CONTACT_GENDER_COL] = { index: args.genderIndex };
  }
  const cdata = await gql<any>(
    `mutation ($boardId: ID!, $groupId: String!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, group_id: $groupId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      boardId: CONTACTS_BOARD_ID,
      groupId: CONTACTS_LEADS_GROUP_ID,
      name: args.name,
      cv: JSON.stringify(contactCv),
    }
  );
  const contactId: string = cdata.create_item.id;

  // Create Lead (without the relation; set in step 2 to mirror createLead in
  // General/src/shared/monday.ts which separates create + relation linkage)
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);
  const leadCv: Record<string, unknown> = {
    [LEAD_STATUS_COL]: { index: LEAD_STATUS_NEW },
    [LEAD_SOURCE_COL]: { index: args.sourceIndex },
    [LEAD_TYPE_COL]: { index: LEAD_TYPE_ORGANIC },
    [LEAD_DATE_COL]: { date: dateStr, time: timeStr },
  };
  const ldata = await gql<any>(
    `mutation ($boardId: ID!, $groupId: String!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, group_id: $groupId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      boardId: LEADS_BOARD_ID,
      groupId: LEADS_NEW_GROUP_ID,
      name: args.name,
      cv: JSON.stringify(leadCv),
    }
  );
  const leadId: string = ldata.create_item.id;

  // Link Lead → Contact (relation column needs a separate mutation per Monday convention)
  await gql<any>(
    `mutation ($leadId: ID!, $boardId: ID!, $col: String!, $val: JSON!) {
      change_column_value(item_id: $leadId, board_id: $boardId, column_id: $col, value: $val) { id }
    }`,
    {
      leadId,
      boardId: LEADS_BOARD_ID,
      col: LEAD_CONTACT_RELATION_COL,
      val: JSON.stringify({ item_ids: [parseInt(contactId, 10)] }),
    }
  );

  return { contactId, leadId };
}

async function fetchLinkedLeadIds(contactId: string): Promise<string[]> {
  const data = await gql<any>(
    `query ($itemId: ID!, $col: [String!]) {
      items(ids: [$itemId]) {
        column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } }
      }
    }`,
    { itemId: contactId, col: [CONTACT_LEAD_RELATION_COL] }
  );
  const ids: string[] = data?.items?.[0]?.column_values?.[0]?.linked_item_ids ?? [];
  return ids.map((id) => String(id));
}

async function renameItem(itemId: string, boardId: string, newName: string): Promise<void> {
  // Use change_multiple_column_values with `{name: newName}` — that's how
  // shared/monday.ts in General/ does it. change_simple_column_value with
  // column_id="name" isn't documented and rejection-prone.
  await gql<any>(
    `mutation ($itemId: ID!, $boardId: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $cv) { id }
    }`,
    {
      itemId,
      boardId,
      cv: JSON.stringify({ name: newName }),
    }
  );
}

// ─── Action: greet ────────────────────────────────────────────────────────
// Lookup-only. NO writes to Monday. ManyChat's flow branches on whether
// `contact_id` is set in the response.
//
// Body: { phone }
// Returns:
//   exists  → { exists: true, contact_id }
//   new     → { exists: false }    (no contact_id — that's the signal to ManyChat)
//
// We deliberately don't return the CRM name back to ManyChat: for existing
// contacts ManyChat already has the user's WA profile {{first_name}} which
// is what we want for the personalized greeting. For new contacts we
// collect Hebrew name in the chat and send via action="create".
async function handleGreet(payload: any): Promise<NetlifyResponse> {
  const phone = String(payload?.phone ?? "").trim();
  if (!phone) return json(400, { error: "missing phone" });

  const existing = await lookupContactByPhone(phone);
  if (existing) {
    return json(200, {
      exists: true,
      contact_id: existing.contactId,
    });
  }

  return json(200, { exists: false });
}

// ─── Action: create ───────────────────────────────────────────────────────
// Called by ManyChat AFTER it's collected the user's name in the flow.
// Forwards to the canonical `lead-intake` Trigger.dev task, which handles:
//   - Hebrew → English name transliteration (via Claude Haiku)
//   - Contact upsert with 3-tier dedup (phone, email, fuzzy phone)
//   - upsertLead: 1 Contact = 1 Lead, with re-engagement updates in place
//   - Meta CAPI Lead event firing
//   - ManyChat subscriber upsert
//   - Audit notes on the Lead
//
// Source detection: if the user's first message starts with "Hi De Club!"
// (the prefilled text on every wa.me link on declub.co.il), we tag the
// Lead as Source=Website. Otherwise Source=Manychat (channel of contact).
//
// Body: { phone, first_name, last_name?, last_input? }
// Returns: { ok: true, queued: true, source } — no contact_id (async). If
// ManyChat needs the contact_id, call action=greet on the next interaction.
async function handleCreate(payload: any): Promise<NetlifyResponse> {
  const phone = String(payload?.phone ?? "").trim();
  const firstName = String(payload?.first_name ?? "").trim();
  const lastName = String(payload?.last_name ?? "").trim();

  if (!phone) return json(400, { error: "missing phone" });
  if (!firstName) return json(400, { error: "missing first_name" });

  const triggerKey = process.env.TRIGGER_PROD_SECRET_KEY;
  if (!triggerKey) return json(500, { error: "TRIGGER_PROD_SECRET_KEY missing" });

  // Source attribution from the prefilled wa.me marker (see header comment).
  const lastInput = String(payload?.last_input ?? "").trim().toLowerCase();
  const cameFromWebsite = lastInput.startsWith(WEBSITE_WA_PREFILL_PREFIX);

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  // Forward to Trigger.dev lead-intake. Fire-and-wait: we wait for the
  // task to be queued (HTTP 200 from Trigger.dev) but NOT for the run to
  // complete (Trigger.dev's trigger API is async by design).
  const res = await fetch(
    "https://api.trigger.dev/api/v1/tasks/lead-intake/trigger",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          name: fullName,
          phone,
          source_override: cameFromWebsite ? "Website" : "Manychat",
          type_override: "Organic",
          source: "manychat-wa-inbound",
          notes: lastInput ? `Initial WA message: "${lastInput.slice(0, 500)}"` : undefined,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return json(502, {
      error: "trigger.dev rejected",
      status: res.status,
      detail: text.slice(0, 500),
    });
  }

  const data = (await res.json()) as { id?: string };
  return json(200, {
    ok: true,
    queued: true,
    run_id: data.id ?? null,
    source: cameFromWebsite ? "Website" : "Manychat",
  });
}

// ─── Action: update_name ──────────────────────────────────────────────────
// Body: { contact_id, first_name, last_name }
// Renames the Contact + every linked Lead so sales sees the real name
// instead of the placeholder created during the greet step.
async function handleUpdateName(payload: any): Promise<NetlifyResponse> {
  const contactId = String(payload?.contact_id ?? "").trim();
  const firstName = String(payload?.first_name ?? "").trim();
  const lastName = String(payload?.last_name ?? "").trim();
  if (!contactId || !firstName) {
    return json(400, { error: "missing contact_id or first_name" });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  await renameItem(contactId, CONTACTS_BOARD_ID, fullName);

  const leadIds = await fetchLinkedLeadIds(contactId);
  for (const leadId of leadIds) {
    try {
      await renameItem(leadId, LEADS_BOARD_ID, fullName);
    } catch {
      // non-fatal — Contact rename is the primary effect; nightly
      // crm-cleanup will reconcile any lingering name drift.
    }
  }

  return json(200, { ok: true, contact_id: contactId, renamed_leads: leadIds.length });
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
  try {
    if (action === "greet") return await handleGreet(payload);
    if (action === "create") return await handleCreate(payload);
    if (action === "update_name") return await handleUpdateName(payload);
    return json(400, { error: `unknown action '${action}', expected 'greet', 'create', or 'update_name'` });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
}
