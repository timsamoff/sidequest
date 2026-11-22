// Approach B, Automerge. Every device holds a full CRDT document and exchanges binary changes. Changes
// can be inspected, but the server still applies them first, then re-adds anything a member may not remove.
import * as A from "@automerge/automerge";
import { COLLS, GM, clone, questBundle, toMaps } from "./common.mjs";

function json(doc) { const o = {}; COLLS.forEach((c) => { o[c] = clone(doc[c] || {}); }); return o; }

export function createServer(fixture) {
  let doc = A.from(toMaps(fixture), { actor: "00" });
  // A copy that never applies a Guildmaster delete, so edits to deleted records can reach the Bin.
  let shadow = A.clone(doc, { actor: "01" });
  const bin = {};

  function receive(changes, user, commands) {
    const before = json(doc);
    [doc] = A.applyChanges(doc, changes);
    [shadow] = A.applyChanges(shadow, changes);
    if (user !== GM) {
      const after = json(doc);
      const gone = Object.keys(before.quests).filter((id) => !after.quests[id] && !bin[id]);
      if (gone.length) {
        doc = A.change(doc, (d) => {
          gone.forEach((id) => {
            const b = questBundle(before, id);
            d.quests[id] = b.quest;
            b.tasks.forEach((t) => { if (!after.tasks[t.id]) d.tasks[t.id] = t; });
            b.decisions.forEach((x) => { if (!after.decisions[x.id]) d.decisions[x.id] = x; });
          });
        });
        return { rejected: ["Only the Guildmaster deletes quests."] };
      }
    }
    (commands || []).forEach((cmd) => {
      if (cmd.type !== "gmDelete" || user !== GM) return;
      const b = questBundle(json(doc), cmd.questId);
      bin[cmd.questId] = clone(b);
      doc = A.change(doc, (d) => {
        delete d.quests[cmd.questId];
        b.tasks.forEach((t) => delete d.tasks[t.id]);
        b.decisions.forEach((x) => delete d.decisions[x.id]);
      });
    });
    const sh = json(shadow);
    Object.keys(bin).forEach((qid) => {
      if (sh.quests[qid]) bin[qid].quest = sh.quests[qid];
      bin[qid].tasks = bin[qid].tasks.map((t) => sh.tasks[t.id] || t);
    });
    return { rejected: [] };
  }

  return {
    name: "Automerge",
    state: () => json(doc), bin: () => bin,
    storageBytes: () => A.save(doc).length + A.save(shadow).length,
    join(user) { return createClient(this, () => doc, user); },
    _receive: receive
  };
}

let actorN = 16;
function createClient(server, serverDoc, user) {
  const first = A.save(serverDoc());
  let doc = A.load(first, { actor: (actorN++).toString(16).padStart(2, "0") + "aa" });
  let synced = A.getHeads(doc), commands = [];
  return {
    user: user, bytesUp: 0, bytesDown: first.length, joinBytes: first.length, rejected: [],
    view: () => json(doc),
    set(coll, id, field, value) { if (!doc[coll][id]) return; doc = A.change(doc, (d) => { d[coll][id][field] = value; }); },
    editText(coll, id, field, index, text) { if (!doc[coll][id]) return; doc = A.change(doc, (d) => { A.splice(d, [coll, id, field], index, 0, text); }); },
    create(coll, record) { doc = A.change(doc, (d) => { d[coll][record.id] = clone(record); }); },
    remove(coll, id) { doc = A.change(doc, (d) => { delete d[coll][id]; }); },
    gmDelete(questId) { commands.push({ type: "gmDelete", questId }); },
    sync() {
      const up = A.getChangesSince(doc, synced);
      this.bytesUp += up.reduce((n, ch) => n + ch.length, 0) + JSON.stringify(commands).length;
      const r = server._receive(up, user, commands);
      this.rejected.push.apply(this.rejected, r.rejected);
      commands = [];
      const down = A.getChangesSince(serverDoc(), A.getHeads(doc).filter((h) => A.hasHeads(serverDoc(), [h])));
      this.bytesDown += down.reduce((n, ch) => n + ch.length, 0);
      [doc] = A.applyChanges(doc, down);
      synced = A.getHeads(doc);
    }
  };
}
