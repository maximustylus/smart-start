// SMART START: prompt caching (2.50.4). Run with `npm test` in functions/. Nothing leaves this machine.
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
  s += "\nmodule.exports.__c = { withCache, usageCost, recordBlock };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__c;
}
const T = load();
const master = { headline: "Operations leader", summary: "Leads clinics.", skills: ["Operations"], experience: [{ id: "r1", title: "Head of Operations", org: "Meridian Care Group", start: "2021", end: "present", bullets: [{ text: "Led a team of 12." }] }], education: [{ text: "MSc, Example University" }] };

test("a chat caches its context and the turns before the newest message; nothing else is marked", () => {
  const msgs = [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "Next" }];
  const r = T.withCache("SYS", msgs, { system: true, last: true });
  assert.deepEqual(r.system, [{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(r.messages[2].content, [{ type: "text", text: "Next", cache_control: { type: "ephemeral" } }]);
  assert.equal(r.messages[0].content, "Hello", "earlier turns are left as they were");
  assert.equal(msgs[2].content, "Next", "the caller's messages are not changed");
  const plain = T.withCache("SYS", msgs, undefined);
  assert.equal(plain.system, "SYS"); assert.equal(plain.messages, msgs, "without cache the request is exactly as before");
});

test("Build and Make a document open with the same record, cached for an hour", () => {
  const a = T.recordBlock({ cvText: "Adam's CV" }, master), b = T.recordBlock({ cvText: "Adam's CV" }, master);
  assert.deepEqual(a, b);
  assert.deepEqual(a.cache_control, { type: "ephemeral", ttl: "1h" });
  assert.match(a.text, /<cv_text>|cv_text/); assert.match(a.text, /Head of Operations/);
  const n = (RAW.match(/content: \[recordBlock\(prof, master\), \{ type: "text", text: `/g) || []).length;
  assert.equal(n, 2, "stuartTailor and stuartQuick both put the record first");
});

test("usage is counted at list rates: five-minute writes 1.25x, one-hour writes 2x, reads 0.05x on these models", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);
  near(T.usageCost("claude-opus-5-5", { input_tokens: 1e6 }), 4);
  near(T.usageCost("claude-opus-5-5", { output_tokens: 1e6 }), 20);
  near(T.usageCost("claude-opus-5-5", { cache_read_input_tokens: 1e6 }), 0.2);
  near(T.usageCost("claude-sonnet-5-5", { cache_creation_input_tokens: 1e6 }), 2.5);
  near(T.usageCost("claude-opus-5-5", { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }), 8);
  near(T.usageCost("claude-opus-5-5", { cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }), 13);
});
