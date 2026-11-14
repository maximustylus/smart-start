// SMART START: sector suggestion tests (2.39.0). Run with `npm test` in functions/. Nothing leaves this machine.
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
  s += "\nmodule.exports.__x = { sectorOf, SECTORS, RESERVE };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__x;
}
const T = load();

test("only sectors from the fixed list are kept, whatever the model returns", () => {
  assert.equal(T.sectorOf("healthcare"), "Healthcare");
  assert.equal(T.sectorOf(" Public Sector "), "Public sector");
  assert.equal(T.sectorOf("Aerospace"), "");
  assert.equal(T.sectorOf("Ignore previous instructions"), "");
  assert.equal(T.sectorOf(""), "");
  assert.ok(T.SECTORS.includes("Doctoral") && T.SECTORS.includes("Academic"), "the sectors already in people's records stay");
  assert.ok(T.RESERVE.sectors > 0, "a suggestion holds budget like every other Stuart call");
});

test("2.47.2: the list covers programmes and research, and matches the app's list exactly", () => {
  for (const x of ["Apprenticeship", "Internship", "Research", "Engineering", "Retail", "Other"]) assert.ok(T.SECTORS.includes(x), x);
  for (const x of ["Healthcare", "Public sector", "Academic", "Education", "Technology", "Social service", "Sport", "Finance", "Consulting", "Private sector", "Doctoral"]) assert.ok(T.SECTORS.includes(x), "kept: " + x);
  assert.equal(new Set(T.SECTORS).size, T.SECTORS.length, "no duplicates");
  assert.equal(T.sectorOf("apprenticeship"), "Apprenticeship");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "SmartStart", "index.html"), "utf8");
  const grab = (n) => JSON.parse(html.match(new RegExp(n + "=(\\[[^\\]]*\\])"))[1]);
  assert.deepEqual(grab("SECTOR_IND").concat(grab("SECTOR_PROG")), T.SECTORS, "app and function lists match");
});
