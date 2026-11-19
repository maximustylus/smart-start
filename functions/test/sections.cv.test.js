// SMART START: Writer keeps the whole record (2.50.0, Phase W). Run with `npm test` in functions/. Nothing leaves this machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module");

const SRC = path.join(__dirname, "..", "index.js"), APP = path.join(__dirname, "..", "..", "SmartStart", "stuart.js");
const RAW = fs.readFileSync(SRC, "utf8");
function load() {
  let s = RAW;
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = {};");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => "" };');
  s += "\nmodule.exports.__s = { CV_CAT, CV_OFF, cvSecs, printSecs, applyPick, mergeDoc, fitPages, estPages, whereTerm, pageCap, enforceRules, SECTION_TYPES, headCase };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__s;
}
const T = load();
const lit = (src, name) => { const m = src.match(new RegExp("const " + name + " = (\\[[^;]*\\]);")); assert.ok(m, name + " not found"); return JSON.parse(m[1]); };
const master = () => ({ name: "Adam", headline: "Operations leader", summary: "Leads clinics.", skills: ["Operations"],
  experience: [{ id: "r1", title: "Head of Operations", org: "Meridian Care Group", start: "2021", end: "present", bullets: [{ text: "Led a team of 12." }] }],
  education: [{ text: "MSc Health Services Management, Example University, 2016" }],
  presentations: [{ text: "2026 Example Health Forum: missed appointments" }, { text: "2025 Example University guest lecture" }],
  certifications: [{ text: "First aid certificate, 2024" }], interests: [{ text: "Running" }], referees: [{ text: "Available on request" }],
  own: [{ id: "o1", heading: "Example Society roles", items: [{ text: "Treasurer, 2023" }] }],
  layout: { order: ["presentations", "own:o1", "certifications"], mode: { certifications: "always" }, heading: { presentations: "Presentations and Speaking Engagements" } } });

test("the app and the functions share one section catalogue", () => {
  const app = fs.readFileSync(APP, "utf8");
  assert.deepEqual(lit(app, "CV_CAT"), T.CV_CAT);
  assert.deepEqual(lit(app, "CV_OFF"), T.CV_OFF);
});

test("sections keep the user's order; interests and referees are off by default; own headings are kept, standard ones print", () => {
  const S = T.cvSecs(master());
  assert.deepEqual(S.map((s) => s.key), ["presentations", "own:o1", "certifications", "interests", "referees"]);
  assert.equal(S[0].own, "Presentations and Speaking Engagements"); assert.equal(S[0].print, "Presentations");
  assert.deepEqual(S.filter((s) => s.off).map((s) => s.key), ["interests", "referees"]);
  assert.deepEqual(T.printSecs(master(), "cv").map((s) => s.key), ["presentations", "own:o1", "certifications"]);
});

test("Stuart's pick decides auto sections; always sections stay; what is left out is listed", () => {
  const cv = T.mergeDoc(master(), { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 12);
  const left = T.applyPick(cv, { presentations: [1] }, "cv");
  assert.equal(cv.presentations.length, 2, "a CV prints a picked section in full");
  assert.equal(cv.certifications.length, 1, "always");
  assert.deepEqual(cv.own[0].items, [], "not picked, so left out");
  assert.deepEqual(left, ["Example Society roles"]);
  assert.deepEqual(cv.interests, [], "off sections never print");
  const rs = T.mergeDoc(master(), { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 3);
  T.applyPick(rs, { presentations: [1, 0, 1, 7] }, "resume");
  assert.deepEqual(rs.presentations.map((x) => x.text), ["2025 Example University guest lecture", "2026 Example Health Forum: missed appointments"], "a resume keeps the picked entries, most relevant first, no repeats or bad numbers");
});

test("the academic preset lifts the CV page limit; others keep six pages and resumes two", () => {
  const m = master(); assert.equal(T.pageCap(m, "cv"), 6); assert.equal(T.pageCap(m, "resume"), 2);
  m.layout.preset = "academic"; assert.equal(T.pageCap(m, "cv"), Infinity); assert.equal(T.pageCap(m, "resume"), 2);
  const big = master(); big.presentations = Array.from({ length: 400 }, (_, i) => ({ text: "Invited talk number " + i + " at an example conference on clinic operations and service design" }));
  big.layout.preset = "academic"; const d = T.fitPages(T.mergeDoc(big, { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 12), "cv", T.pageCap(big, "cv"));
  assert.equal(d.presentations.length, 400, "nothing trimmed for an academic CV");
  big.layout.preset = ""; const d2 = T.fitPages(T.mergeDoc(big, { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 12), "cv", T.pageCap(big, "cv"));
  assert.ok(T.estPages(d2, "cv") <= 6 && d2.presentations.length <= 12);
});

test("keywords are found in any section, and the user's rules reach own sections", () => {
  const d = T.mergeDoc(master(), { experience: [{ id: "r1", bullets: ["Led a team of 12."] }] }, 12);
  assert.equal(T.whereTerm(d, "cv", "guest lecture"), "Presentations");
  const out = T.enforceRules(d, [{ type: "leave", term: "Treasurer" }], "cv");
  assert.deepEqual(d.own[0].items, []); assert.equal(out.removed, 1);
});

test("the CV import keeps every section, in order, with a type and a second choice when unsure", () => {
  assert.match(RAW, /sections \[ \{heading, type, alt, items\[\]\} \]/);
  assert.match(RAW, /Use "other" when no type fits; the section is kept under its own heading/);
  assert.match(RAW, /never copy a referee's phone number or email/);
  assert.ok(T.SECTION_TYPES.includes("presentations (presentations)") && T.SECTION_TYPES.startsWith("education"));
});

test("2.50.1 headings read alike: capitals become sentence case, acronyms stay; Title Case only at import; the app has the same function", () => {
  assert.equal(T.headCase("COURSES ATTENDED"), "Courses attended");
  assert.equal(T.headCase("PROFESSIONAL APPOINTMENTS AND MEMBERSHIPS"), "Professional appointments and memberships");
  assert.equal(T.headCase("CPD AND TRAINING"), "CPD and training");
  assert.equal(T.headCase("Honours and Awards"), "Honours and Awards");
  assert.equal(T.headCase("Honours and Awards", true), "Honours and awards");
  assert.equal(T.headCase("Publications", true), "Publications");
  assert.equal(T.headCase("MSc Research Projects", true), "MSc research projects");
  const S = T.cvSecs(Object.assign(master(), { own: [{ id: "o1", heading: "RESEARCH AND PROJECT INVOLVEMENT", items: [{ text: "Example study, 2024" }] }] }));
  assert.equal(S.find((x) => x.key === "own:o1").print, "Research and project involvement");
  const fn = (src) => { const a = src.indexOf("function headCase("); return src.slice(a, src.indexOf("\n}\n", a)); };
  assert.equal(fn(fs.readFileSync(APP, "utf8")), fn(RAW));
});

test("2.50.1 the CV import reads the owner's contact details, never a referee's or a street address", () => {
  assert.match(RAW, /with keys: name, contact \{email, phone, location, links\}/);
  assert.match(RAW, /never a street address or postal code/);
  assert.match(RAW, /Never a referee's details/);
});
