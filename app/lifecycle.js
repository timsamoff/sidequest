/* quest lifecycle: history, completion, promote and demote, the Vault's entries, the Bin */
import { renderAll } from "./app.js";
import { playConfetti } from "./confetti.js";
import { TODAY, iso } from "./dates.js";
import { closeModal, confirmDialog, openModal } from "./dialogs.js";
import { el, notify, on, playSfx, setFocusKey, uid } from "./dom.js";
import { activeQuests, questNameTaken, findQuest, isPinned, liveQuests, openIssues, questRemainingUnits, questState, questTasksAllDone, questTotalUnits, recordHist, remainingUnits, short, totalUnits } from "./model.js";
import { changed, normalize, removeLinksTo, removeQuestTasks, save, setState, state } from "./state.js";
import { KIND_LABEL } from "./views.js";

// Records the main burndown's and each quest's task counts on every change
// (see recordHist() in model.js for how that history is kept and read back).
export function recordHistory() {
  if (totalUnits() > 0 || Object.keys(state.hist).length) recordHist(state.hist, totalUnits(), remainingUnits());
}

export function recordQuestHistory() {
  liveQuests().forEach(function (p) {
    if (p.status !== "active" && p.status !== "complete") return;
    var total = questTotalUnits(p);
    if (total > 0 || Object.keys(p.hist).length) recordHist(p.hist, total, questRemainingUnits(p));
  });
}

// Auto-completion only; runs on every changed(). Skips a quest Reopen just reactivated, so it does not refire.
export function sweepQuestCompletion() {
  activeQuests().forEach(function (p) {
    if (p.justReopened) { p.justReopened = false; return; }
    if (questTasksAllDone(p)) { p.status = "complete"; completionDialog(p); }
  });
}

// Shared vault path for the Vault button, Mark complete, and the auto-sweep.
export function vaultQuest(p) {
  removeToVault(p, "Quest", function () {
    state.tasks.forEach(function (t) { if (t.questId === p.id && !t.vault) t.vault = { at: iso(TODAY), why: "removed" }; });
  });
}

// Offers vaulting now or leaving it in Quests.
export function completionDialog(p) {
  // Unpinned directly (not unpinPage(), whose toast would compete with this
  // dialog), remembered via wasPinned so Reopen can restore it.
  var key = "quest:" + p.id;
  if (isPinned(key)) { p.wasPinned = true; state.pins = state.pins.filter(function (k) { return k !== key; }); changed(); }
  if (state.settings.audio) playSfx("../assets/sfx/complete.mp3");
  if (state.settings.completionFx) playConfetti();
  openModal("Quest complete", function (body) {
    body.appendChild(el("p", { "class": "first" }, "“" + p.name + "” is marked complete. Send it to the Vault now, or leave it in Quests."));
    var openTasks = questRemainingUnits(p);
    if (openTasks) body.appendChild(el("p", { "class": "hint" }, openTasks + (openTasks === 1 ? " open task is" : " open tasks are") + " no longer counted in the main burndown. Set the quest back to In progress to count " + (openTasks === 1 ? "it" : "them") + " again."));
    var oi = openIssues(p.id).length;
    if (oi) body.appendChild(el("p", { "class": "hint" }, oi + (oi === 1 ? " issue is" : " issues are") + " still open."));
    var acts = el("div", { "class": "actions" });
    var leave = el("button", { type: "button", "class": "small", title: "Keep visible on Quests" }, "Leave in Quests");
    var vault = el("button", { type: "button", "class": "small dangerfill", title: "Send to the Vault right now" }, "Vault now");
    on(leave, "click", closeModal);
    on(vault, "click", function () { closeModal(); vaultQuest(p); });
    acts.appendChild(leave); acts.appendChild(vault); body.appendChild(acts);
  });
}

// Promotes in place: the same record and id. Its links were kept while it was a Candidate.
export function overWip() { var n = state.settings.wipLimit; return !!n && activeQuests().length >= n; }

export function promoteToActive(id) {
  var p = findQuest(id);
  if (!p) return;
  var n = activeQuests().length;
  if (overWip() && p.status !== "active") {
    confirmDialog("Quest limit reached", "You already have " + n + (n === 1 ? " quest" : " quests") + " in progress. Do you want to move this quest to In progress anyway?", "Continue anyway", function () { doPromote(p); });
    return;
  }
  doPromote(p);
}

export function doPromote(p) {
  p.status = "active";
  // Tasks added while it was a Candidate were part of the plan from the start, not scope added later.
  state.tasks.forEach(function (x) { if (x.questId === p.id) x.added = ""; });
  changed();
  if (state.settings.audio) playSfx("../assets/sfx/quest.mp3");
}

// Sends an active quest back to Candidates, keeping its links. A Candidate cannot be pinned, so its pin goes.
export function demoteToCandidate(id) {
  var p = findQuest(id);
  if (!p) return;
  p.status = "candidate";
  var pinKey = "quest:" + p.id; state.pins = state.pins.filter(function (k) { return k !== pinKey; });
  changed();
  notify("Sent back to Candidates.");
}

// Brings a Complete quest back to Active, and restores a pin completionDialog() removed.
function reopenQuest(p) {
  p.status = "active";
  // Lets sweepQuestCompletion() skip this quest once, so reopening one whose tasks are all Completed does not refire.
  p.justReopened = true;
  if (p.wasPinned) { var key = "quest:" + p.id; if (!isPinned(key)) state.pins.push(key); p.wasPinned = false; }
  changed(); notify("Reopened.");
  if (state.settings.audio) playSfx("../assets/sfx/quest.mp3");
}

// What each state's dropdown offers, in this order.
var STATE_ORDER = ["Candidate", "In progress", "Complete", "Vault"];
var STATE_CHOICES = {
  "Candidate": ["Candidate", "In progress", "Vault"],
  "In progress": ["Candidate", "In progress", "Complete", "Vault"],
  "Complete": ["In progress", "Complete", "Vault"]
};
// The status chip colors reuse the task pill styles in styles.css.
var STATE_PILL = { "Candidate": "Unpursued", "In progress": "In progress", "Complete": "Completed" };

// Moves a quest to a chosen state through the same handlers the old buttons used.
export function setQuestState(p, to) {
  var from = questState(p);
  if (to === from || p.vault || STATE_ORDER.indexOf(to) < 0) return;
  if (to === "Vault") { if (p.status === "candidate") removeToVault(p, "Quest"); else vaultQuest(p); return; }
  if (to === "Candidate") { demoteToCandidate(p.id); return; }
  if (to === "Complete") { p.status = "complete"; changed(); completionDialog(p); return; }
  if (from === "Candidate") promoteToActive(p.id);
  else if (from === "Complete") reopenQuest(p);
}

// The status dropdown for a quest (not used for a vaulted one). It shows the current state until a change takes effect.
export function questStatusSelect(p, focusKey) {
  var cur = questState(p);
  var sel = el("select", { "class": "status questsel", "aria-label": "Status of " + short(p.name, 40), title: "Change this quest’s status", "data-v": STATE_PILL[cur], "data-focus": focusKey });
  STATE_CHOICES[cur].forEach(function (s) { var o = el("option", { value: s }, s); if (s === cur) o.selected = true; sel.appendChild(o); });
  // Focus returns to the select only for keyboard use; after a tap or click it would look still open.
  var byPointer = false;
  on(sel, "pointerdown", function () { byPointer = true; });
  on(sel, "keydown", function () { byPointer = false; });
  on(sel, "change", function () {
    var to = sel.value;
    // A choice that opens a dialog or is canceled leaves the quest as it was, so show that.
    sel.value = cur;
    if (!byPointer) setFocusKey(focusKey);
    setQuestState(p, to);
  });
  return sel;
}

// Only Quests and Ideas go to the Vault independently -- see removeNow() for the rest.
export function removeToVault(item, label, before) {
  if (before) before();
  item.vault = { at: iso(TODAY), why: "removed" };
  changed();
  notify(label + " moved to the Vault.", function () { item.vault = null; changed(); });
}

// Immediate delete with a short-lived Undo toast, no Vault entry.
export function removeNow(item, list, label) {
  var arr = state[list], idx = arr.indexOf(item);
  if (idx < 0) return;
  arr.splice(idx, 1); changed();
  notify(label + " removed.", function () { arr.splice(idx, 0, item); changed(); });
}

export function vaultEntries() {
  var out = [];
  state.quests.forEach(function (p) { if (p.vault) out.push({ kind: "quest", list: "quests", item: p, title: p.name }); });
  state.workshop.forEach(function (p) { if (p.vault) out.push({ kind: "idea", list: "workshop", item: p, title: p.text }); });
  return out.sort(function (a, b) { return a.item.vault.at < b.item.vault.at ? 1 : (a.item.vault.at > b.item.vault.at ? -1 : 0); });
}

export function dropEntry(e) {
  state[e.list] = state[e.list].filter(function (x) { return x !== e.item; });
  if (e.list === "quests") { removeLinksTo([e.item.id]); removeQuestTasks([e.item.id]); }
}

export function restoreEntry(e) {
  if (e.kind === "quest" && questNameTaken(e.item.name, e.item.id)) { notify("A quest named “" + e.item.name + "” already exists. Rename that one first, then restore this one.", null, "problem"); return; }
  e.item.vault = null;
  // Reverses vaultQuest()'s task cascade, or the quest comes back empty.
  if (e.kind === "quest") {
    state.tasks.forEach(function (t) { if (t.questId === e.item.id && t.vault) t.vault = null; });
  }
  var where = e.kind === "idea" ? "the Workshop" : e.item.status === "candidate" ? "Candidate quests" : "the Quests page";
  changed(); notify(KIND_LABEL[e.kind] + " restored to " + where + ".");
}

// The Bin holds only quests and ideas deleted from the Vault. An entry keeps a copy of the removed
// records: for a quest, its tasks, their decisions, and which quests linked to it.
function addToBin(kind, title, data) {
  state.bin.unshift({ id: uid(), at: iso(TODAY), kind: kind, title: String(title || "").slice(0, 300), data: JSON.parse(JSON.stringify(data)) });
}

export function binVaultEntry(e) {
  var data = {};
  if (e.kind === "quest") {
    var id = e.item.id, tasks = state.tasks.filter(function (t) { return t.questId === id; }), steps = {};
    tasks.forEach(function (t) { t.steps.forEach(function (s) { steps[s.id] = true; }); });
    data.quests = [e.item]; data.tasks = tasks;
    data.decisions = state.decisions.filter(function (d) { return steps[d.step]; });
    data.linkedFrom = state.quests.filter(function (q) { return q.id !== id && q.linkedQuestIds.indexOf(id) >= 0; }).map(function (q) { return q.id; });
    state.pins = state.pins.filter(function (k) { return k !== "quest:" + id; });
  } else data.workshop = [e.item];
  addToBin(e.kind, e.title, data);
  dropEntry(e);
  changed(); notify(KIND_LABEL[e.kind] + " sent to the Bin.");
}

// Puts a quest or idea back in the Vault, then re-runs normalize() so an older entry is brought up to date.
export function restoreFromBin(b) {
  var d = b.data;
  if (b.kind === "quest") {
    var q = d.quests[0];
    if (questNameTaken(q.name, q.id)) { notify("A quest named “" + q.name + "” already exists. Rename that one first, then restore this one.", null, "problem"); return; }
    state.quests.push(q);
    state.tasks = state.tasks.concat(d.tasks || []);
    state.decisions = state.decisions.concat(d.decisions || []);
    (d.linkedFrom || []).forEach(function (id) { var o = findQuest(id); if (o && o.linkedQuestIds.indexOf(q.id) < 0) o.linkedQuestIds.push(q.id); });
  } else state.workshop.push(d.workshop[0]);
  state.bin = state.bin.filter(function (x) { return x !== b; });
  setState(normalize(JSON.parse(JSON.stringify(state))));
  save(); renderAll();
  notify(KIND_LABEL[b.kind] + " sent to the Vault.");
}

export function deleteFromBin(b) {
  confirmDialog("Delete forever?", "“" + short(b.title, 80) + "” will be permanently deleted. This cannot be undone.", "Delete forever", function () {
    state.bin = state.bin.filter(function (x) { return x !== b; }); save(); renderAll(); notify("Deleted.");
  });
}

export function emptyBin() {
  var n = state.bin.length;
  confirmDialog("Empty the Bin?", n + (n === 1 ? " item" : " items") + " will be permanently deleted. This cannot be undone.", "Delete everything in the Bin", function () {
    state.bin = []; save(); renderAll(); notify("Bin emptied.");
  });
}
