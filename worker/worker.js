/**
 * MAFIA · Ночной город — Cloudflare Worker HTTP proxy to the Vercel relay.
 *
 * The Vercel function (api/index.mjs) still owns all room logic and state.
 * This worker is a thin, stateless proxy: the browser talks to
 * `*.workers.dev` (reachable where `*.vercel.app` edges are blocked), and the
 * worker forwards every request straight to Vercel.
 *
 * No KV, no Durable Objects, no bindings, no wrangler — just paste this file
 * into a Worker in the dashboard and hit Deploy.
 *
 *   browser → https://mafia.aleshkalarin2002.workers.dev/api/...
 *           → https://mafiarbovercel.vercel.app/api/...
 */

const UPSTREAM = "https://mafiarbovercel.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = new URL(UPSTREAM + url.pathname + url.search);

    const headers = new Headers(request.headers);
    // fetch() sets the correct Host for the upstream; don't forward the old one.
    headers.delete("Host");

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    let response;
    try {
      response = await fetch(target, init);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "Relay недоступен." }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const out = new Headers(response.headers);
    out.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  },
};
