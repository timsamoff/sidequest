// Boots the real app in jsdom and saves its sample library as the merge prototype's fixture.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { register } = require("module");
const { pathToFileURL } = require("url");
const root = path.join(__dirname, "..", "..");
register(pathToFileURL(path.join(root, "tests", "isolate-loader.mjs")));
(async () => {
  const html = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/", pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  global.window = dom.window; global.document = dom.window.document;
  Object.defineProperty(global, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
  global.FileReader = dom.window.FileReader;
  await import(pathToFileURL(path.join(root, "app", "app.js")).href + "?fixture=1");
  await Promise.resolve(); await Promise.resolve();
  const s = JSON.parse(dom.window.localStorage.getItem("sidequest-template-v1"));
  const guild = { quests: s.quests, tasks: s.tasks, decisions: s.decisions, workshop: s.workshop };
  fs.writeFileSync(path.join(__dirname, "fixture.json"), JSON.stringify(guild, null, 1));
  console.log("fixture: " + guild.quests.length + " quests, " + guild.tasks.length + " tasks, " + guild.decisions.length + " decisions, " + guild.workshop.length + " ideas, " + JSON.stringify(guild).length + " bytes");
  process.exit(0);
})();
