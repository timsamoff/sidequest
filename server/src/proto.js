// Runs one merge prototype case inside the Worker runtime, to prove each approach works on Cloudflare.
// Timing is not measured here: a Worker's clock does not advance during synchronous work.
import fixture from "../proto/fixture.json";
import { GM, MEMBER, canon } from "../proto/common.mjs";

export function runCase(mod) {
  const srv = mod.createServer(fixture), gm = srv.join(GM), mb = srv.join(MEMBER);
  const quests = Object.keys(srv.state().quests), tasks = Object.keys(srv.state().tasks);
  gm.set("tasks", tasks[0], "status", "In progress");
  mb.set("tasks", tasks[0], "due", "2027-01-15");
  mb.remove("quests", quests[1]);
  for (let i = 0; i < 3; i++) { gm.sync(); mb.sync(); }
  const s = canon(srv.state());
  return { approach: srv.name, converged: canon(gm.view()) === s && canon(mb.view()) === s, refusedDelete: !!srv.state().quests[quests[1]], joinBytes: gm.joinBytes };
}
