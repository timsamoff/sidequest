// Runs the brief's cases on all three approaches with real Sidequest data and prints the results.
// Usage: node proto/run.mjs (from server/). Writes proto/results.json for the write-up.
import fs from "fs";
import { performance } from "perf_hooks";
import { GM, MEMBER, canon, scaled } from "./common.mjs";
import * as LOG from "./log.mjs";
import * as YJS from "./yjs.mjs";
import * as AM from "./am.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixture.json", import.meta.url)));
const APPROACHES = [YJS, AM, LOG];
const active = fixture.quests.filter((q) => !q.vault && q.status !== "candidate");
const tasksOf = (qid) => fixture.tasks.filter((t) => t.questId === qid).map((t) => t.id);
const Q0 = active[0].id, Q1 = active[1].id, Q2 = (active[2] || fixture.quests[2]).id;
const T0 = tasksOf(Q0)[0], T2 = tasksOf(Q2)[0];

// Everyone syncs until the server and both devices agree, or gives up after a few rounds.
function settle(server, clients) {
  for (let i = 0; i < 4; i++) {
    clients.forEach((c) => c.sync());
    const s = canon(server.state());
    if (clients.every((c) => canon(c.view()) === s)) return true;
  }
  return false;
}

const SCENARIOS = [
  ["Two devices edit different fields of one task offline", (srv, gm, mb) => {
    gm.set("tasks", T0, "status", "In progress"); mb.set("tasks", T0, "due", "2027-01-15");
    const ok = settle(srv, [gm, mb]), t = srv.state().tasks[T0];
    return { ok: ok && t.status === "In progress" && t.due === "2027-01-15", note: "both kept" };
  }],
  ["Both change the same field offline", (srv, gm, mb) => {
    gm.set("tasks", T0, "what", "Guildmaster's title"); mb.set("tasks", T0, "what", "Member's title");
    const ok = settle(srv, [gm, mb]);
    return { ok: ok, note: "kept: " + srv.state().tasks[T0].what };
  }],
  ["Both type into the same quest's notes offline", (srv, gm, mb) => {
    gm.editText("quests", Q0, "notes", 0, "[GM] "); mb.editText("quests", Q0, "notes", String(srv.state().quests[Q0].notes || "").length, " [member]");
    const ok = settle(srv, [gm, mb]), n = String(srv.state().quests[Q0].notes);
    const both = n.includes("[GM]") && n.includes("[member]");
    return { ok: ok, both: both, note: both ? "both edits kept" : "one edit lost: later save wins" };
  }],
  ["Both add tasks offline", (srv, gm, mb) => {
    gm.create("tasks", { id: "gmNew", questId: Q0, what: "From the Guildmaster", steps: [] });
    mb.create("tasks", { id: "mbNew", questId: Q0, what: "From the member", steps: [] });
    const ok = settle(srv, [gm, mb]), s = srv.state();
    return { ok: ok && !!s.tasks.gmNew && !!s.tasks.mbNew, note: "both added" };
  }],
  ["Guildmaster vaults a quest while a member edits it offline", (srv, gm, mb) => {
    gm.set("quests", Q0, "vault", { at: "2026-11-21", why: "removed" }); mb.set("quests", Q0, "due", "2027-02-01");
    const ok = settle(srv, [gm, mb]), q = srv.state().quests[Q0];
    return { ok: ok && !!q.vault && q.due === "2027-02-01", note: "vaulted, edit kept" };
  }],
  ["A member tries to delete a quest", (srv, gm, mb) => {
    mb.remove("quests", Q1);
    const ok = settle(srv, [gm, mb]), s = srv.state();
    const back = !!s.quests[Q1] && !!mb.view().quests[Q1] && tasksOf(Q1).every((id) => !!s.tasks[id]);
    return { ok: ok && back && mb.rejected.length > 0, note: back ? "refused; the quest stays for everyone" : "QUEST LOST" };
  }],
  ["A member deletes a quest while the Guildmaster edits it offline", (srv, gm, mb) => {
    gm.set("quests", Q1, "due", "2027-03-03");
    mb.remove("quests", Q1); mb.sync();
    const ok = settle(srv, [gm, mb]), q = srv.state().quests[Q1];
    const kept = !!q && q.due === "2027-03-03";
    return { ok: ok && !!q, kept: kept, note: !q ? "QUEST LOST" : kept ? "quest restored and the Guildmaster's edit kept" : "quest restored, but the Guildmaster's edit was lost" };
  }],
  ["Guildmaster deletes a quest while a member edits it offline", (srv, gm, mb) => {
    mb.set("tasks", T2, "what", "Edited after the delete");
    gm.gmDelete(Q2); gm.sync(); mb.sync();
    const ok = settle(srv, [gm, mb]), s = srv.state(), b = srv.bin()[Q2];
    const edit = b && b.tasks.some((t) => t.id === T2 && t.what === "Edited after the delete");
    return { ok: ok && !s.quests[Q2] && !!b && edit, note: edit ? "gone for everyone; the edit reached the Bin copy" : "edit not in the Bin copy" };
  }],
  ["Long offline stretch: 200 edits on each device", (srv, gm, mb) => {
    const ids = Object.keys(srv.state().tasks);
    for (let i = 0; i < 200; i++) { gm.set("tasks", ids[i % ids.length], "notes", "gm " + i); mb.set("tasks", ids[(i * 7) % ids.length], "est", i % 9); }
    const before = gm.bytesUp + mb.bytesUp;
    const ok = settle(srv, [gm, mb]);
    return { ok: ok, note: (gm.bytesUp + mb.bytesUp - before) + " bytes up" };
  }]
];

function measure(mod, data) {
  const t0 = performance.now();
  const srv = mod.createServer(data);
  const tJoin0 = performance.now(), c = srv.join(GM), tJoin = performance.now() - tJoin0;
  const firstTask = Object.keys(srv.state().tasks)[0];
  const up0 = c.bytesUp; c.set("tasks", firstTask, "status", "Completed"); c.sync();
  const oneEdit = c.bytesUp - up0;
  const t1 = performance.now();
  for (let i = 0; i < 300; i++) { c.set("tasks", firstTask, "est", i % 9); c.sync(); }
  const per = (performance.now() - t1) / 300;
  return { build: Math.round(tJoin0 - t0), joinMs: Math.round(tJoin), joinBytes: c.joinBytes, oneEditBytes: oneEdit, msPerEditSync: +per.toFixed(2), storageBytes: srv.storageBytes() };
}

const results = { fixture: { quests: fixture.quests.length, tasks: fixture.tasks.length }, scenarios: [], sizes: {} };
SCENARIOS.forEach(([title, fn]) => {
  const row = { title: title };
  APPROACHES.forEach((mod) => {
    const srv = mod.createServer(fixture), gm = srv.join(GM), mb = srv.join(MEMBER);
    try { row[srv.name] = fn(srv, gm, mb); } catch (e) { row[srv.name] = { ok: false, note: "error: " + e.message }; }
  });
  results.scenarios.push(row);
});
const big = scaled(fixture, 25);
results.bigFixture = { quests: big.quests.length, tasks: big.tasks.length, jsonBytes: JSON.stringify(big).length };
APPROACHES.forEach((mod) => { const name = mod.createServer(fixture).name; results.sizes[name] = { sample: measure(mod, fixture), large: measure(mod, big) }; });

results.scenarios.forEach((r) => {
  console.log("\n" + r.title);
  ["Yjs", "Automerge", "Change log"].forEach((n) => console.log("  " + (r[n].ok ? "PASS" : "FAIL") + "  " + n.padEnd(11) + r[n].note));
});
console.log("\nSizes and speed (sample library, then " + big.quests.length + " quests / " + big.tasks.length + " tasks)");
Object.keys(results.sizes).forEach((n) => console.log("  " + n.padEnd(11) + JSON.stringify(results.sizes[n])));
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 1));
