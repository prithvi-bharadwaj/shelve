// Shelve free-actions proxy — a zero-logging Cloudflare Worker that lets new
// installs try AI actions without an API key. Each install gets FREE_ACTIONS
// metered calls to Gemini; after that the extension falls back to BYOK or the
// hosted paid tier.
//
// Privacy contract (documented publicly in the repo): request bodies are
// forwarded to the provider and never stored; the only persisted state is
// installToken -> action count. No URLs, titles, or IPs are written.

export interface Env {
  GEMINI_API_KEY: string;
  METER: KVNamespace;
  FREE_ACTIONS?: string; // default "25"
  MODEL?: string; // default "gemini-3.1-flash-lite"
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TOKEN_RE = /^[a-f0-9-]{36}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "authorization,content-type",
        },
      });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/generate") {
      return json(404, { error: "Not found." });
    }

    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!TOKEN_RE.test(token)) return json(401, { error: "Missing install token." });

    const limit = Number(env.FREE_ACTIONS || "25");
    const used = Number((await env.METER.get(token)) || "0");
    if (used >= limit) {
      return json(402, { error: "free_actions_exhausted", used, limit });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    const model = env.MODEL || "gemini-3.1-flash-lite";
    const upstream = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Count only successful generations — a provider outage must not burn
    // anyone's free actions.
    if (upstream.ok) {
      await env.METER.put(token, String(used + 1), { expirationTtl: 60 * 60 * 24 * 90 });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "x-shelve-actions-remaining": String(Math.max(0, limit - used - (upstream.ok ? 1 : 0))),
      },
    });
  },
};
