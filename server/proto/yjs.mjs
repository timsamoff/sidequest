// Approach A, Yjs. Every device holds a full CRDT document and exchanges binary updates. The server
// cannot refuse part of an update, so it applies it, then re-adds anything a member was not allowed to remove.
import * as Y from "yjs";
import { COLLS, GM, clone, questBundle, toMaps } from "./common.mjs";

function entity(obj) {
  const m = new Y.Map();
  Object.keys(obj).forEach((k) => {
    if (k === "notes") { const t = new Y.Text(); t.insert(0, String(obj[k] || "")); m.set(k, t); }
    else m.set(k, obj[k]);
  });
  return m;
}
function fill(doc, maps) {
  doc.transact(() => { COLLS.forEach((c) => { const ym = doc.getMap(c); Object.keys(maps[c]).forEach((id) => ym.set(id, entity(maps[c][id]))); }); });
}
function json(doc) { const o = {}; COLLS.forEach((c) => { o[c] = doc.getMap(c).toJSON(); }); return o; }

export function createServer(fixture) {
  const doc = new Y.Doc({ gc: false });
  // A second copy that never applies a Guildmaster delete, so edits to deleted records can reach the Bin.
  const shadow = new Y.Doc({ gc: false });
  fill(doc, toMaps(fixture));
  Y.applyUpdate(shadow, Y.encodeStateAsUpdate(doc));
  const bin = {};

  function receive(update, user, commands) {
    const before = json(doc);
    Y.applyUpdate(doc, update);
    Y.applyUpdate(shadow, update);
    if (user !== GM) {
      const after = json(doc);
      const gone = Object.keys(before.quests).filter((id) => !after.quests[id] && !bin[id]);
      if (gone.length) {
        // Re-adding makes new records with the same content; any edit to the removed copy made elsewhere is lost.
        doc.transact(() => {
          gone.forEach((id) => {
            const b = questBundle(before, id);
            doc.getMap("quests").set(id, entity(b.quest));
            b.tasks.forEach((t) => { if (!after.tasks[t.id]) doc.getMap("tasks").set(t.id, entity(t)); });
            b.decisions.forEach((d) => { if (!after.decisions[d.id]) doc.getMap("decisions").set(d.id, entity(d)); });
          });
        });
        return { rejected: ["Only the Guildmaster deletes quests."] };
      }
    }
    (commands || []).forEach((cmd) => {
      if (cmd.type !== "gmDelete") return;
      if (user !== GM) return;
      const b = questBundle(json(doc), cmd.questId);
      bin[cmd.questId] = clone(b);
      doc.transact(() => {
        doc.getMap("quests").delete(cmd.questId);
        b.tasks.forEach((t) => doc.getMap("tasks").delete(t.id));
        b.decisions.forEach((d) => doc.getMap("decisions").delete(d.id));
      });
    });
    // Refresh each Bin copy from the shadow, which still holds the deleted records and any later edits.
    const sh = json(shadow);
    Object.keys(bin).forEach((qid) => {
      if (sh.quests[qid]) bin[qid].quest = sh.quests[qid];
      bin[qid].tasks = bin[qid].tasks.map((t) => sh.tasks[t.id] || t);
    });
    return { rejected: [] };
  }

  return {
    name: "Yjs",
    state: () => json(doc), bin: () => bin,
    storageBytes: () => Y.encodeStateAsUpdate(doc).length + Y.encodeStateAsUpdate(shadow).length,
    join(user) { return createClient(this, doc, user); },
    _receive: receive
  };
}

function createClient(server, serverDoc, user) {
  const doc = new Y.Doc({ gc: false });
  const first = Y.encodeStateAsUpdate(serverDoc);
  Y.applyUpdate(doc, first);
  let serverSV = Y.encodeStateVector(serverDoc), commands = [];
  return {
    user: user, bytesUp: 0, bytesDown: first.length, joinBytes: first.length, rejected: [],
    view: () => json(doc),
    set(coll, id, field, value) { const r = doc.getMap(coll).get(id); if (r) r.set(field, value); },
    editText(coll, id, field, index, text) { const r = doc.getMap(coll).get(id); if (r) r.get(field).insert(index, text); },
    create(coll, record) { doc.getMap(coll).set(record.id, entity(record)); },
    remove(coll, id) { doc.getMap(coll).delete(id); },
    gmDelete(questId) { commands.push({ type: "gmDelete", questId }); },
    sync() {
      const up = Y.encodeStateAsUpdate(doc, serverSV);
      this.bytesUp += up.length + JSON.stringify(commands).length;
      const r = server._receive(up, user, commands);
      this.rejected.push.apply(this.rejected, r.rejected);
      commands = [];
      const down = Y.encodeStateAsUpdate(serverDoc, Y.encodeStateVector(doc));
      this.bytesDown += down.length;
      Y.applyUpdate(doc, down);
      serverSV = Y.encodeStateVector(serverDoc);
    }
  };
}
