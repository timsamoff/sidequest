// Staging Worker for the sync branch: serves the app from the branch the same way production does,
// plus the sync API under /api/. Only the health check exists until the merge prototype picks a design.
import { Guild } from "./guild.js";
import { runCase } from "./proto.js";
import * as PROTO_YJS from "../proto/yjs.mjs";
import * as PROTO_AM from "../proto/am.mjs";
import * as PROTO_LOG from "../proto/log.mjs";

export { Guild };

const API_VERSION = 1;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function api(request, env, url) {
  if (url.pathname === "/api/health") {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'").first();
    const stub = env.GUILD.get(env.GUILD.idFromName("health-check"));
    const guild = await (await stub.fetch("https://guild/ping")).json();
    return json({ ok: true, environment: env.ENVIRONMENT, api: API_VERSION, d1Schema: row ? row.value : null, durableObject: guild });
  }
  // Merge prototype: one case per approach, run inside the Worker. Removed once an approach is chosen.
  const proto = { "/api/proto/yjs": PROTO_YJS, "/api/proto/automerge": PROTO_AM, "/api/proto/log": PROTO_LOG }[url.pathname];
  if (proto) return json(runCase(proto));
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    // Static files, as in production: a directory serves its index.html, and "/dir" redirects to "/dir/".
    const last = url.pathname.split("/").pop();
    if (url.pathname.endsWith("/")) {
      url.pathname += "index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (!last.includes(".")) {
      const dir = new URL(request.url);
      dir.pathname += "/";
      const probe = new URL(dir);
      probe.pathname += "index.html";
      const res = await env.ASSETS.fetch(new Request(probe, request));
      if (res.ok) return Response.redirect(dir.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  }
};
