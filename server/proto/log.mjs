// Approach C, a server-ordered change log. A client sends small JSON changes; the guild's server checks
// each one, numbers it, and every client replays the numbered log. No library.
import { COLLS, GM, clone, questBundle, toMaps } from "./common.mjs";

// Applies one change to a state. Returns false when the target no longer exists.
function applyChange(state, ch) {
  if (ch.type === "set") {
    const r = state[ch.coll][ch.id];
    if (!r) return false;
    r[ch.field] = ch.value;
    return true;
  }
  if (ch.type === "create") { state[ch.coll][ch.id] = clone(ch.record); return true; }
  if (ch.type === "remove") { delete state[ch.coll][ch.id]; return true; }
  if (ch.type === "gmDelete") {
    const b = questBundle(state, ch.questId);
    delete state.quests[ch.questId];
    b.tasks.forEach((t) => delete state.tasks[t.id]);
    b.decisions.forEach((d) => delete state.decisions[d.id]);
    return true;
  }
  return false;
}

export function createServer(fixture) {
  const state = clone(toMaps(fixture));
  const log = [], bin = {};
  let seq = 0;

  // The permission check is plain code over a readable change.
  function check(ch, user) {
    if (ch.type === "remove" && ch.coll === "quests") return "Only the Guildmaster deletes quests.";
    if (ch.type === "gmDelete" && user !== GM) return "Only the Guildmaster deletes quests.";
    return "";
  }

  function receive(changes, user) {
    return changes.map((ch) => {
      const problem = check(ch, user);
      if (problem) return { id: ch.cid, ok: false, reason: problem };
      if (ch.type === "gmDelete") bin[ch.questId] = clone(questBundle(state, ch.questId));
      if (!applyChange(state, ch)) {
        // An edit to a record the Guildmaster deleted lands on the copy in the Bin.
        const entry = Object.values(bin).find((b) => (ch.coll === "quests" && b.quest.id === ch.id) || b.tasks.some((t) => t.id === ch.id));
        if (entry && ch.type === "set") {
          const rec = ch.coll === "quests" ? entry.quest : entry.tasks.find((t) => t.id === ch.id);
          rec[ch.field] = ch.value;
          return { id: ch.cid, ok: true, binned: true };
        }
        return { id: ch.cid, ok: false, reason: "gone" };
      }
      log.push({ seq: ++seq, ch: ch });
      return { id: ch.cid, ok: true };
    });
  }

  return {
    name: "Change log",
    state: () => state, bin: () => bin, storageBytes: () => JSON.stringify(state).length + JSON.stringify(log).length,
    join(user) { return createClient(this, user); },
    _receive: receive, _since: (n) => log.filter((e) => e.seq > n), _snapshot: () => ({ state: clone(state), seq: seq })
  };
}

function createClient(server, user) {
  const snap = server._snapshot();
  let confirmed = snap.state, seq = snap.seq, pending = [], cid = 0;
  const c = {
    user: user, bytesUp: 0, bytesDown: JSON.stringify(snap).length, joinBytes: JSON.stringify(snap).length, rejected: [],
    view() { const s = clone(confirmed); pending.forEach((ch) => applyChange(s, ch)); return s; },
    set(coll, id, field, value) { pending.push({ cid: ++cid, type: "set", coll, id, field, value }); },
    editText(coll, id, field, index, text) {
      // No text merging: the whole field is the change, and the later one wins.
      const cur = String(this.view()[coll][id][field] || "");
      this.set(coll, id, field, cur.slice(0, index) + text + cur.slice(index));
    },
    create(coll, record) { pending.push({ cid: ++cid, type: "create", coll, id: record.id, record: clone(record) }); },
    remove(coll, id) { pending.push({ cid: ++cid, type: "remove", coll, id }); },
    gmDelete(questId) { pending.push({ cid: ++cid, type: "gmDelete", questId }); },
    sync() {
      if (pending.length) {
        const body = JSON.stringify(pending);
        this.bytesUp += body.length;
        server._receive(JSON.parse(body), user).forEach((r) => { if (!r.ok && r.reason !== "gone") c.rejected.push(r.reason); });
        pending = [];
      }
      const entries = server._since(seq), body = JSON.stringify(entries);
      this.bytesDown += body.length;
      entries.forEach((e) => applyChange(confirmed, e.ch));
      if (entries.length) seq = entries[entries.length - 1].seq;
    }
  };
  return c;
}
