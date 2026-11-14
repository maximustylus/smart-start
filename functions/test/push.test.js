// SMART START: phone notification tests (2.37.0). Run with `npm test` in functions/. No message leaves this machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module"), crypto = require("crypto");

const SRC = path.join(__dirname, "..", "index.js");
function load() {
  let s = fs.readFileSync(SRC, "utf8");
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = global.__db;");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => global.__vapid || "" };');
  s += "\nmodule.exports.__p = { pushPrefs, summaryText, vapidKeys, reminders, PUSH_HOSTS, SUMMARY_TIMES };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__p;
}
// a tiny in-memory Firestore: collection(path).get() and doc(path).get()
function fakeDb(cols) {
  const docs = (p) => Object.entries(cols[p] || {}).map(([id, v]) => ({ id, data: () => v }));
  return { collection: (p) => ({ get: async () => ({ docs: docs(p) }) }), doc: (p) => ({ get: async () => ({ exists: false, data: () => undefined }) }) };
}
global.__db = fakeDb({});
const T = load();
const ymd = (d) => new Date(Date.now() + 8 * 36e5 + d * 864e5).toISOString().slice(0, 10);

test("the public key is worked out from the private key, which never leaves the server", () => {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  global.__vapid = b64u(ecdh.getPrivateKey());
  const k = T.vapidKeys();
  assert.equal(k.publicKey, b64u(ecdh.getPublicKey()));
  global.__vapid = "";
  assert.throws(() => T.vapidKeys(), /not set up yet/);
});

test("switches: defaults on, 8 am summary; unknown values fall back", () => {
  assert.deepEqual(T.pushPrefs(null), { on: true, sumAt: "08:00", stuart: true, names: true, dates: true, lead: 14, follow: true, steps: true });
  const p = T.pushPrefs({ on: true, sumAt: "03:13", pstuart: false, pnames: false, lead: 5, follow: false });
  assert.equal(p.sumAt, "08:00"); assert.equal(p.stuart, false); assert.equal(p.names, false); assert.equal(p.lead, 14); assert.equal(p.follow, false);
  assert.equal(T.pushPrefs({ stuart: false }).stuart, false, "the in-app Stuart switch also stops Stuart on the phone");
});

test("names off: no employer name reaches the lock screen", () => {
  const items = [{ t: "Harbourside Clinics closes in 3 days" }, { t: "Follow up with Meridian Care Group" }];
  const on = T.summaryText(items, true), off = T.summaryText(items, false);
  assert.equal(on.title, "Your daily summary"); assert.equal(on.body, "Harbourside Clinics closes in 3 days. Follow up with Meridian Care Group.");
  assert.equal(off.title, "Your daily summary"); assert.equal(off.body, "2 things to look at. Open SMART START to see them.");
  assert.equal(T.summaryText([{ t: "x" }], false).body, "1 thing to look at. Open SMART START to see them.");
  assert.doesNotMatch(JSON.stringify(off), /Harbourside|Meridian/);
  assert.match(T.summaryText(items.concat(items, items), true).body, /And 3 more\.$/);
});

test("reminders match the bell: items, rules and wording", async () => {
  global.__db.collection = fakeDb({
    "users/u/applications": {
      a: { org: "Harbourside Clinics", stage: "Saved", closingDate: ymd(3), nextAction: "Finish the cover letter" },
      b: { org: "Meridian Care Group (Singapore)", stage: "Applied", dateSubmitted: ymd(-20) },
      c: { org: "Northwind Health", stage: "1st interview", nextAction: "Prepare your interview answers" },
      d: { org: "Closed Co", stage: "Rejected", closingDate: ymd(1), nextAction: "Apply" },
      e: { org: "Far Away Ltd", stage: "Saved", closingDate: ymd(10), nextAction: "Ask for a referee" },
      f: { org: "Quiet Ltd", stage: "Applied", dateSubmitted: ymd(-20), nextAction: "Do not chase" },
      g: { org: "Acked Ltd", stage: "Acknowledged", dateSubmitted: ymd(-20) },
      h: { org: "Long Wait Ltd", stage: "Acknowledged", dateSubmitted: ymd(-30) },
      i: { org: "No Step Ltd", stage: "Saved", closingDate: ymd(2) } },
    "users/u/deadlines": { x: { date: ymd(1), what: "Referee forms due" }, y: { date: ymd(5), what: "Ward Nurse closes" } } }).collection;
  const all = (await T.reminders("u", T.pushPrefs({}))).map((x) => x.t);
  assert.deepEqual(all, ["Referee forms due: tomorrow", "Follow up with Meridian Care Group", "Harbourside Clinics: closes in 3 days. Finish the cover letter", "Follow up with Long Wait Ltd", "Ward Nurse closes in 5 days", "Northwind Health: Prepare your interview answers", "Far Away Ltd: closes in 10 days. Ask for a referee"]);
  const short = (await T.reminders("u", T.pushPrefs({ lead: 7, follow: false, steps: false }))).map((x) => x.t);
  assert.deepEqual(short, ["Referee forms due: tomorrow", "Harbourside Clinics: closes in 3 days. Finish the cover letter", "Ward Nurse closes in 5 days"]);
  assert.deepEqual(await T.reminders("u", T.pushPrefs({ dates: false, follow: false, steps: false })), []);
});

test("only real push services are accepted as a device", () => {
  for (const h of ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com", "wns2-sg2p.notify.windows.com"]) assert.ok(T.PUSH_HOSTS.test(h), h);
  for (const h of ["evil.example", "web.push.apple.com.evil.example", "169.254.169.254"]) assert.ok(!T.PUSH_HOSTS.test(h), h);
});
