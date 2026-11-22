// Shared pieces of the merge prototype: the guild shape, roles, the Bin rule, and helpers.
// Every approach exposes the same server and client interface so one set of scenarios runs on all three.
export const COLLS = ["quests", "tasks", "decisions", "workshop"];
export const GM = "guildmaster";
export const MEMBER = "member";

export function clone(x) { return JSON.parse(JSON.stringify(x)); }

// Arrays from the app's state become maps keyed by id, so each record merges on its own.
export function toMaps(fixture) {
  const out = {};
  COLLS.forEach((c) => { out[c] = {}; (fixture[c] || []).forEach((r) => { out[c][r.id] = r; }); });
  return out;
}

// A larger library for size and speed checks: the fixture repeated with fresh ids.
export function scaled(fixture, times) {
  const out = { quests: [], tasks: [], decisions: [], workshop: [] };
  for (let n = 0; n < times; n++) {
    const sfx = "_" + n;
    fixture.quests.forEach((q) => out.quests.push(Object.assign(clone(q), { id: q.id + sfx, name: q.name + " " + n, linkedQuestIds: q.linkedQuestIds.map((x) => x + sfx) })));
    fixture.tasks.forEach((t) => out.tasks.push(Object.assign(clone(t), { id: t.id + sfx, questId: t.questId + sfx, steps: t.steps.map((s) => Object.assign(clone(s), { id: s.id + sfx })) })));
    fixture.decisions.forEach((d) => out.decisions.push(Object.assign(clone(d), { id: d.id + sfx, step: d.step + sfx })));
    fixture.workshop.forEach((w) => out.workshop.push(Object.assign(clone(w), { id: w.id + sfx })));
  }
  return out;
}

// What a Guildmaster's delete takes with a quest: its tasks and the decisions on their steps.
export function questBundle(maps, questId) {
  const tasks = Object.values(maps.tasks).filter((t) => t.questId === questId);
  const steps = new Set();
  tasks.forEach((t) => (t.steps || []).forEach((s) => steps.add(s.id)));
  const decisions = Object.values(maps.decisions).filter((d) => steps.has(d.step));
  return { quest: maps.quests[questId], tasks: tasks, decisions: decisions };
}

// Plain JSON of a state, sorted, so states from different approaches compare exactly.
export function canon(maps) {
  const out = {};
  COLLS.forEach((c) => { out[c] = {}; Object.keys(maps[c] || {}).sort().forEach((id) => { out[c][id] = maps[c][id]; }); });
  return JSON.stringify(out);
}
