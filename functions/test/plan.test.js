// SMART START: plan review tests (2.40.0). Run with `npm test` in functions/. Nothing leaves this machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module");

const SRC = path.join(__dirname, "..", "index.js");
function load() {
  let s = fs.readFileSync(SRC, "utf8");
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = {};");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => "" };');
  s += "\nmodule.exports.__p = { progressSummary, PLAN_KEYS };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__p;
}
const T = load();

test("the plan review sees counts, never organisation names or notes", () => {
  const apps = [
    { org: "Harbourside Clinics", notes: "private note", stage: "1st interview", stages: [{ stage: "Applied" }, { stage: "1st interview" }], dateSubmitted: "2026-11-01", sector: "Healthcare" },
    { org: "Northwind Health", stage: "Rejected", stages: [{ stage: "Applied" }, { stage: "Rejected" }], dateSubmitted: "2026-08-01", sector: "Healthcare" },
    { org: "Meridian Learning", stage: "Applied", stages: [{ stage: "Applied" }], dateSubmitted: "2026-10-20" },
    { org: "Quiet Ltd", stage: "Saved", stages: [] }];
  const s = T.progressSummary(apps, "2026-11-09");
  assert.equal(s.applications, 4); assert.equal(s.sent, 3); assert.equal(s.sentLast6Weeks, 2);
  assert.equal(s.replied, 2); assert.equal(s.interviews, 1); assert.equal(s.offers, 0);
  assert.deepEqual(s.bySector.Healthcare, { applications: 2, interviews: 1 }); assert.equal(s.bySector["Not set"].applications, 2);
  assert.doesNotMatch(JSON.stringify(s), /Harbourside|Northwind|Meridian|Quiet|private note/);
  assert.ok(T.PLAN_KEYS.includes("grow.will") && T.PLAN_KEYS.includes("smart.timeBound"));
});
