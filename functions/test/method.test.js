// SMART START: Stuart's method and the appointments section (2.49.0). Run with `npm test` in functions/. Nothing leaves this machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module");

const SRC = path.join(__dirname, "..", "index.js");
const RAW = fs.readFileSync(SRC, "utf8");
function load() {
  let s = RAW;
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = {};");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => "" };');
  s += "\nmodule.exports.__m = { mergeDoc, fitPages, estPages, whereTerm, SECTIONS, WRITE_METHOD };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__m;
}
const T = load();
const master = { name: "Adam", headline: "Operations leader", summary: "Leads clinics.", skills: ["Operations"],
  experience: [{ id: "r1", title: "Head of Operations", org: "Meridian Care Group", start: "2021", end: "present", bullets: [{ text: "Led a team of 12." }] }],
  appointments: [{ text: "Member, Example Society (2024 – Present)" }, { text: "Chair, Example Committee (2025 – Present)" }],
  education: [], certifications: [], awards: [], publications: [], referees: [] };

test("appointments travel into every tailored document and are searchable", () => {
  assert.ok(T.SECTIONS.includes("appointments"));
  const d = T.mergeDoc(master, { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 3);
  assert.equal(d.appointments.length, 2);
  assert.equal(T.whereTerm(d, "cv", "Example Society"), "Appointments and memberships");
  assert.ok(T.estPages(d, "cv") >= 1);
});

test("a long appointments list is trimmed to fit a two-page resume before any role is cut", () => {
  const big = JSON.parse(JSON.stringify(master));
  big.appointments = Array.from({ length: 40 }, (_, i) => ({ text: "Member, Example Committee number " + i + ", Example Organisation, with a long description of the work done (2020 – Present)" }));
  const d = T.fitPages(T.mergeDoc(big, { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 3), "resume", 2);
  assert.ok(T.estPages(d, "resume") <= 2);
  assert.equal(d.experience[0].bullets.length, 1);
});

test("the CV import keeps leads inside a job as bullets and appointments out of roles", () => {
  assert.match(RAW, /never make it a role of its own/);
  assert.match(RAW, /A section of appointments, memberships, committees or positions held outside the work history is type "appointments"/);
  assert.doesNotMatch(RAW, /roles: every job and appointment, including part-time, teaching, honorary, committee and community roles/);
});

test("the fit check reads the advertisement as the employer: match table, bridge and angle", () => {
  for (const k of ['"employer"', '"matchTable"', '"bridge"', '"angle"']) assert.ok(RAW.includes(k), k);
  assert.match(RAW, /never a job title the person has not held/);
});

test("the writing method is shared by the build and Make a document", () => {
  assert.equal((RAW.match(/\$\{WRITE_METHOD\}/g) || []).length, 2);
  for (const k of ["80 to 120 words", "Translate, never upgrade", "Co-leads stays co-leads", "never claim it in the CV or resume", "copied exactly"]) assert.ok(T.WRITE_METHOD.includes(k), k);
  assert.doesNotMatch(T.WRITE_METHOD, /—/);
});
