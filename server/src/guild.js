import { DurableObject } from "cloudflare:workers";

// One of these per guild once sync is built. For now it only proves the binding and its SQLite storage work.
export class Guild extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
  }

  async fetch() {
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT INTO meta (k, v) VALUES ('pings', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1");
    const pings = sql.exec("SELECT v FROM meta WHERE k = 'pings'").one().v;
    return Response.json({ ok: true, pings: pings });
  }
}
