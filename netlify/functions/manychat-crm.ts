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

// Monday label indices (LEAD_SOURCE / LEAD_TYPE / etc — mirror of
// General/src/shared/monday.ts).
const LEAD_SOURCE_MANYCHAT = 4;
const LEAD_SOURCE_WEBSITE = 11;
const LEAD_TYPE_ORGANIC = 0;
const LEAD_STATUS_NEW = 5;
const CONTACT_TYPE_LEAD = 0;

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

async function createContactAndLead(args: {
  name: string;
  phone: string;
  sourceIndex: number;
}): Promise<{ contactId: string; leadId: string }> {
  // Create Contact
  const contactCv: Record<string, unknown> = {
    [CONTACT_PHONE_COL]: { phone: args.phone, countryShortName: "IL" },
    [CONTACT_TYPE_COL]: { index: CONTACT_TYPE_LEAD },
  };
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
//   exists  → { exists: true, contact_id, name, first_name, last_name }
//   new     → { exists: false }    (no contact_id — that's the signal to ManyChat)
async function handleGreet(payload: any): Promise<NetlifyResponse> {
  const phone = String(payload?.phone ?? "").trim();
  if (!phone) return json(400, { error: "missing phone" });

  const existing = await lookupContactByPhone(phone);
  if (existing) {
    const { first, last } = splitName(existing.name);
    return json(200, {
      exists: true,
      contact_id: existing.contactId,
      name: existing.name,
      first_name: first,
      last_name: last,
    });
  }

  return json(200, { exists: false });
}

// ─── Action: create ───────────────────────────────────────────────────────
// Called by ManyChat AFTER it's collected the user's name in the flow.
// Creates a real Contact + Lead with that name. Skips creation if the
// contact already exists (race-safety: ManyChat could in theory call this
// after another path already created the Contact).
//
// Body: { phone, first_name, last_name?, last_input? }
// Returns: { contact_id, lead_id, name, source }
async function handleCreate(payload: any): Promise<NetlifyResponse> {
  const phone = String(payload?.phone ?? "").trim();
  const firstName = String(payload?.first_name ?? "").trim();
  const lastName = String(payload?.last_name ?? "").trim();

  if (!phone) return json(400, { error: "missing phone" });
  if (!firstName) return json(400, { error: "missing first_name" });

  // Race safety: re-lookup. If a Contact appeared between greet and create
  // (e.g. parallel flow, user double-tapped, etc.), just return the
  // existing record instead of creating a duplicate.
  const existing = await lookupContactByPhone(phone);
  if (existing) {
    return json(200, {
      contact_id: existing.contactId,
      name: existing.name,
      already_existed: true,
    });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  // Source attribution from the prefilled wa.me marker (see header comment).
  const lastInput = String(payload?.last_input ?? "").trim().toLowerCase();
  const cameFromWebsite = lastInput.startsWith(WEBSITE_WA_PREFILL_PREFIX);
  const sourceIndex = cameFromWebsite ? LEAD_SOURCE_WEBSITE : LEAD_SOURCE_MANYCHAT;

  const { contactId, leadId } = await createContactAndLead({
    name: fullName,
    phone,
    sourceIndex,
  });

  return json(200, {
    contact_id: contactId,
    lead_id: leadId,
    name: fullName,
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
