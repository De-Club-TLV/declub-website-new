// Netlify Function: serve the public class schedule for the marketing site.
//
// The schedule is synced hourly from Arbox into the Supabase `site_schedule`
// table (single row id='current') by the public-schedule Trigger.dev task.
// This function reads that one row and returns its JSON, cached at the edge,
// so the browser hits a same-origin endpoint and never sees Supabase.

interface NetlifyEvent {
  httpMethod?: string;
}

interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

const CACHE = "public, max-age=600, stale-while-revalidate=1800";

function json(statusCode: number, body: unknown, cache = false): NetlifyResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...(cache ? { "cache-control": CACHE } : {}),
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "method not allowed" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return json(500, { error: "server not configured" });

  try {
    const res = await fetch(
      `${url}/rest/v1/site_schedule?id=eq.current&select=data,updated_at`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) {
      return json(502, { error: "supabase read failed", status: res.status });
    }
    const rows = (await res.json()) as Array<{ data: unknown; updated_at: string }>;
    const row = rows[0];
    if (!row) return json(200, { days: {}, updated_at: null }, true);

    const payload =
      row.data && typeof row.data === "object"
        ? { updated_at: row.updated_at, ...(row.data as Record<string, unknown>) }
        : { days: {}, updated_at: row.updated_at };
    return json(200, payload, true);
  } catch (err) {
    return json(502, { error: "fetch error", detail: (err as Error).message });
  }
}
