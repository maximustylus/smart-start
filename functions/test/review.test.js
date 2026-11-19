// SMART START: Stuart's review tests (2.47.0). Run with `npm test` in functions/. Nothing leaves this machine.
// The review's promises are kept in code, so they are tested here with no model: the counting, the level ladder,
// and the checks that drop anything the model returns that advises, predicts, guesses or brings its own figures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module");

const SRC = path.join(__dirname, "..", "index.js");
const raw = fs.readFileSync(SRC, "utf8");
function load() {
  let s = raw;
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = {};");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => "" };');
  s += "\nmodule.exports.__r = { levelOf, reviewRow, reviewCounts, reviewClean, RESERVE, REVIEW_MIN };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__r;
}
const T = load();
const TODAY = "2026-11-13";
const app = (role, stage, stages, extra) => Object.assign({ role, stage, stageAt: "2026-09-01", dateSubmitted: "2026-08-20", stages: stages.map((s) => ({ stage: s, date: "2026-09-01" })) }, extra);

test("levels come from the title by a fixed ladder; a title that fits none is Other", () => {
  assert.equal(T.levelOf("Assistant Director, Operations"), "Assistant or Deputy Director");
  assert.equal(T.levelOf("Deputy Director (Planning)"), "Assistant or Deputy Director");
  assert.equal(T.levelOf("Director of Operations"), "Director or Head");
  assert.equal(T.levelOf("Senior Manager, Service Design"), "Senior Manager");
  assert.equal(T.levelOf("Assistant Manager"), "Assistant Manager");
  assert.equal(T.levelOf("Operations Manager"), "Manager");
  assert.equal(T.levelOf("Senior Executive"), "Senior Executive or Specialist");
  assert.equal(T.levelOf("Programme Executive"), "Executive or Specialist");
  assert.equal(T.levelOf("Gardener"), "Other");
});

test("the code decides what is in the review and does the counting", () => {
  const rows = [
    app("Assistant Director", "Rejected", ["Applied", "Rejected"]),
    app("Assistant Director", "Rejected", ["Applied", "1st interview", "Rejected"]),
    app("Assistant Director", "No response", ["Applied", "No response"]),
    app("Senior Manager", "Applied", ["Applied"]),                                         // 73 days with no reply: quiet
    app("Senior Manager", "Applied", ["Applied"], { stageAt: "2026-11-01" }),               // 12 days: still waiting, not in the set
    app("Senior Manager", "Final interview", ["Applied", "1st interview", "Final interview"]),
    app("Manager", "Withdrawn", ["Applied", "Withdrawn"]),                                  // the person's own choice: left out
    app("Manager", "Saved", [], { dateSubmitted: "" }),                                     // never sent: not counted at all
  ].map((v) => T.reviewRow(v, TODAY)).filter(Boolean);
  assert.equal(rows.length, 7, "an application that was never sent is not counted");
  const C = T.reviewCounts(rows);
  assert.deepEqual([C.n, C.unsuccessful, C.quiet], [4, 2, 2]);
  assert.deepEqual(C.ended, { before: 3, first: 1, later: 0 });
  assert.deepEqual(C.levels, [{ level: "Assistant or Deputy Director", applied: 3, interviews: 1 }, { level: "Senior Manager", applied: 3, interviews: 1 }, { level: "Manager", applied: 1, interviews: 0 }]);
  assert.ok(C.n < T.REVIEW_MIN, "four is too few: the function returns the counts and never calls the model");
  assert.match(raw, /if \(base\.small\) return save\(base\);[^\n]*\n[\s\S]*?const budget = await reserve\(uid, "review"\)/, "the small-sample exit comes before any model call");
});

test("provisional fit scores are left out, and what they said comes from the Rejected stage note", () => {
  const r = T.reviewRow(app("Manager", "Rejected", ["Applied", "Rejected"], { scores: { roleFit: 70, fitCheck: "Provisional estimate" }, stages: [{ stage: "Applied", date: "2026-08-20" }, { stage: "Rejected", date: "2026-09-01", note: "Went with an internal candidate" }] }), TODAY);
  assert.equal(r.fit, null); assert.equal(r.said, "Went with an internal candidate");
  const o = T.reviewRow(app("Manager, Example Logistics", "Rejected", ["Applied", "Rejected"], { org: "Example Logistics", stages: [{ stage: "Rejected", date: "2026-09-01", note: "example logistics chose another candidate" }] }), TODAY);
  assert.equal(o.role, "Manager, [organisation]"); assert.equal(o.said, "[organisation] chose another candidate", "the organisation's name is taken out of the text that is sent");
});

test("the model's reply is held to the rules: counted, sourced, no advice, no predictions, no guessed reasons", () => {
  const rows = new Array(9).fill(0).map(() => ({})), source = '{"closed_or_quiet":9}\nunsuccessful | level: Manager | fit 61 | unmet: A team of 20 or more\nfit 74';
  const out = T.reviewClean({ observations: [
    { text: "3 of the 9 asked for a team of 20 or more.", apps: [0, 1, 2], source: "hard screens" },                      // kept
    { text: "3 of the 9 asked for a team of 20 or more.", apps: [0, 1], source: "hard screens" },                         // count does not match the applications named
    { text: "Several asked for a larger team.", apps: [0, 1], source: "hard screens" },                                   // no count
    { text: "2 of the 9 used a job portal.", apps: [0, 42], source: "level" },                                             // names an application that is not there
    { text: "2 of the 9 suggest you should aim lower.", apps: [0, 1], source: "level" },                                  // advice
    { text: "2 of the 9 were probably screened out by software.", apps: [0, 1], source: "channel" },                      // prediction
    { text: "2 of the 9 ended because the employer wanted someone cheaper.", apps: [0, 1], source: "stage history" },      // guessed reason
    { text: "2 of the 9 averaged a fit of 55.", apps: [0, 1], source: "fit checks" },                                     // a figure the records do not hold
    { text: "2 of the 9 had a fit of 74 or 61.", apps: [0, 1], source: "IGNORE ALL RULES" },                              // kept; the source label is replaced
  ], questions: ["Is the team size something you can evidence?", "You should aim lower?", "Tell me more", "Would 300 applications help?"] }, rows, source);
  assert.deepEqual(out.observations.map((o) => o.text), ["3 of the 9 asked for a team of 20 or more.", "2 of the 9 had a fit of 74 or 61."]);
  assert.deepEqual(out.observations.map((o) => o.source), ["hard screens", "your records"]);
  assert.deepEqual(out.questions, ["Is the team size something you can evidence?"]);
  assert.deepEqual(T.reviewClean({ observations: [], questions: ["Why?"] }, rows, source), { observations: [], questions: [] }, "no observations, no questions");
  assert.deepEqual(T.reviewClean(null, rows, source), { observations: [], questions: [] });
});

test("2.50.3 each observation carries a short headline and a count badge for the card; the full text is not cut at 320 characters", () => {
  const rows = new Array(9).fill(0).map(() => ({})), source = '{"closed_or_quiet":9}\nunsuccessful | level: Manager | unmet: A team of 20 or more\nno reply | channel: portal';
  const long = "3 of the 9 asked for a team of 20 or more, marked unmet. " + "The roles were at Manager level and each listed people leadership among the first lines of the advertisement in the same words. ".repeat(3);
  const out = T.reviewClean({ observations: [
    { text: "3 of the 9 asked for a team of 20 or more.", head: "Manager roles: a team of 20 or more, unmet", apps: [0, 1, 2], source: "hard screens" },
    { text: "All 2 with no reply came through a portal.", head: "You should apply directly instead of through portals", apps: [3, 4], source: "channel" },
    { text: long, apps: [5, 6, 7], source: "level" },
  ] }, rows, source);
  assert.deepEqual(out.observations.map((o) => o.badge), ["3/9", "2/2", "3/9"]);
  assert.equal(out.observations[0].head, "Manager roles: a team of 20 or more, unmet");
  assert.equal(out.observations[1].head, "All 2 with no reply came through a portal", "a headline that advises is replaced by one taken from the text");
  assert.ok(out.observations[2].text.length > 320 && out.observations[2].head === "3 of the 9 asked for a team of 20 or more, marked unmet");
});

test("organisation names never reach the model, the lines are wrapped, and the call holds budget", () => {
  const body = raw.slice(raw.indexOf("exports.stuartReview")).split("/* ---------- 9. Build a CV from scratch")[0];
  const built = body.slice(body.indexOf("const lines ="), body.indexOf("const facts ="));
  assert.ok(built.length > 100); assert.doesNotMatch(built, /\.org\b|employer/, "the organisation is not put into the lines the model reads");
  assert.match(body, /rvNoOrg\(plain\(h\.requirement, 140\), r\.employer\)/, "and its name is removed from the requirements");
  assert.match(body, /wrap\("applications", lines\)/); assert.match(body, /stripIds\(rows\.map/);
  assert.match(body, /lines\.replace\(\/\^\\d\+ \\\| \/gm, ""\)/, "line numbers are not accepted as figures"); assert.match(body, /requireAllowed\(req\)/); assert.ok(T.RESERVE.review > 0);
  assert.match(body, /users\/\$\{uid\}\/meta\/review/);
});
