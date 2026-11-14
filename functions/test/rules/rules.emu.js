// SMART START: security rules, tested against the Firebase emulators (10 November 2026; no app change).
// Proves that one account cannot read, list, change or delete another account's records or files,
// and that the server-only paths stay closed to the app. No extra packages: plain HTTP to the emulators.
// Run: npm --prefix functions run test:rules   (starts the Firestore and Storage emulators, then this file)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const PROJECT = process.env.GCLOUD_PROJECT || "demo-smartstart";
const FS = "http://" + (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080");
const ST = "http://" + (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199");
const BUCKET = PROJECT + ".appspot.com";
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;

// An unsigned token, which the emulators accept in place of a real sign-in.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(uid, email, verified = true) {
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: "none", typ: "JWT" }) + "." + b64({ iss: "https://securetoken.google.com/" + PROJECT, aud: PROJECT, sub: uid, user_id: uid, email, email_verified: verified, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: "password", identities: { email: [email] } } }) + ".";
}
const A = token("userA", "a@example.test"), B = token("userB", "b@example.test"), ADMIN = "owner";
const hdr = (t) => (t ? { Authorization: "Bearer " + t } : {});
const body = (o) => JSON.stringify({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: String(v) }])) });

const get = (path, t) => fetch(`${DOCS}/${path}`, { headers: hdr(t) }).then((r) => r.status);
const put = (path, t, o = { v: "1" }) => fetch(`${DOCS}/${path}`, { method: "PATCH", headers: { ...hdr(t), "Content-Type": "application/json" }, body: body(o) }).then((r) => r.status);
const del = (path, t) => fetch(`${DOCS}/${path}`, { method: "DELETE", headers: hdr(t) }).then((r) => r.status);
const list = (path, t) => fetch(`${DOCS}/${path}`, { headers: hdr(t) }).then((r) => r.status);
const group = (id, t) => fetch(`${DOCS}:runQuery`, { method: "POST", headers: { ...hdr(t), "Content-Type": "application/json" }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: id, allDescendants: true }] } }) }).then((r) => r.status);

// Every place a user's records live (firestore.rules), and every shared, server-only place.
const OWN = ["profile/main", "plan/main", "jobs/j1", "jobs/j1/chat/m1", "jobs/j1/practice/p1", "meta/budget", "meta/credits", "meta/notes", "applications/a1", "documents/d1", "deadlines/x1", "tracker/state", "records/r1", "cv/master", "cv/rules", "builds/j1"];
const SERVER_ONLY = ["mail/m1", "spend/s1", "gifts/g1", "config/features", "inactive/i1", "statsDaily/d1", "statsJobs/j1", "feedback/f1", "smartstart/current", "other/x1"];

test.before(async () => {
  for (const u of ["userA", "userB"]) {
    assert.equal(await put(`users/${u}`, ADMIN), 200, "seed the account document");
    for (const p of OWN) assert.equal(await put(`users/${u}/${p}`, ADMIN), 200, "seed " + p);
  }
  for (const p of SERVER_ONLY) assert.equal(await put(p, ADMIN), 200, "seed " + p);
});

test("an account reads its own records", async () => {
  assert.equal(await get("users/userA", A), 200);
  for (const p of OWN) assert.equal(await get(`users/userA/${p}`, A), 200, p);
});

test("another account cannot read any of them, one by one", async () => {
  assert.equal(await get("users/userA", B), 403);
  for (const p of OWN) assert.equal(await get(`users/userA/${p}`, B), 403, p);
});

test("another account cannot list them, or sweep them up across accounts", async () => {
  assert.equal(await list("users", B), 403, "the list of accounts");
  for (const c of ["applications", "documents", "deadlines", "records", "jobs", "cv", "builds", "meta", "profile", "plan", "tracker", "jobs/j1/chat", "jobs/j1/practice"]) assert.equal(await list(`users/userA/${c}`, B), 403, c);
  for (const c of ["applications", "records", "cv", "chat", "builds", "meta"]) assert.equal(await group(c, B), 403, "across accounts: " + c);
  assert.equal(await group("applications", A), 403, "not even the account's owner may sweep across accounts");
});

test("another account cannot change or delete them", async () => {
  for (const p of OWN) {
    assert.equal(await put(`users/userA/${p}`, B, { v: "changed" }), 403, "write " + p);
    assert.equal(await del(`users/userA/${p}`, B), 403, "delete " + p);
  }
  assert.equal(await put("users/userA/applications/new", B), 403, "create");
  assert.equal(await get("users/userA/applications/a1", A), 200, "still there");
});

test("nobody signed out reads or writes anything", async () => {
  assert.equal(await get("users/userA", null), 403);
  for (const p of OWN) assert.equal(await get(`users/userA/${p}`, null), 403, p);
  assert.equal(await put("users/userA/applications/a1", null), 403);
  assert.equal(await list("users/userA/applications", null), 403);
});

test("the app cannot write the server's ledgers, even for its own account", async () => {
  for (const p of ["meta/budget", "meta/credits", "meta/notes"]) { assert.equal(await put(`users/userA/${p}`, A, { capUsd: "999" }), 403, p); assert.equal(await del(`users/userA/${p}`, A), 403, p); }
  assert.equal(await put("users/userA/jobs/j1/chat/new", A), 403, "chat is written by the server");
  assert.equal(await put("users/userA/jobs/j1/practice/new", A), 403, "practice is written by the server");
  assert.equal(await put("users/userA", A), 403, "the account document itself");
});

test("the shared, server-only collections are closed to every account", async () => {
  for (const p of SERVER_ONLY) { assert.equal(await get(p, A), 403, "read " + p); assert.equal(await put(p, A), 403, "write " + p); assert.equal(await list(p.split("/")[0], A), 403, "list " + p); }
});

test("the owner's address alone, on another account id, opens nothing", async () => {
  const owner = /request\.auth\.token\.email in \[\s*'([^']+)'/.exec(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"))[1];
  const fake = token("someoneElse", owner);
  assert.equal(await get("smartstart/current", fake), 403);
  assert.equal(await get("users/userA/applications/a1", fake), 403);
  assert.equal(await get("feedback/f1", fake), 403);
});

// ---- files (storage.rules)
const obj = (path) => `${ST}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}`;
const sAuth = (t) => (t ? { Authorization: t === ADMIN ? "Bearer owner" : "Firebase " + t } : {});
const sGet = (path, t) => fetch(obj(path) + "?alt=media", { headers: sAuth(t) }).then((r) => r.status);
const sMeta = (path, t) => fetch(obj(path), { headers: sAuth(t) }).then((r) => r.status);
// Uploads go the way the app's own library sends them: one request carrying the file's details and its bytes.
const sPut = (path, t, type = "application/pdf") => {
  const bd = "ssrules", meta = JSON.stringify({ name: path, contentType: type });
  const payload = `--${bd}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n--${bd}\r\nContent-Type: ${type}\r\n\r\n%PDF-1.4 test\r\n--${bd}--`;
  return fetch(`${ST}/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, { method: "POST", headers: { ...sAuth(t), "Content-Type": `multipart/related; boundary=${bd}`, "X-Goog-Upload-Protocol": "multipart" }, body: payload }).then((r) => r.status);
};
const sDel = (path, t) => fetch(obj(path), { method: "DELETE", headers: sAuth(t) }).then((r) => r.status);
const sList = (prefix, t) => fetch(`${ST}/v0/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}`, { headers: sAuth(t) }).then((r) => r.status);

test("files: an account reaches its own uploads, and no one else's", async () => {
  assert.equal(await sPut("users/userA/cv/cv.pdf", A), 200, "the account uploads its own file");
  assert.equal(await sGet("users/userA/cv/cv.pdf", A), 200, "and reads it back");
  for (const [who, t] of [["another account", B], ["signed out", null]]) {
    assert.equal(await sGet("users/userA/cv/cv.pdf", t), 403, who + " reads");
    assert.equal(await sMeta("users/userA/cv/cv.pdf", t), 403, who + " reads the details");
    assert.equal(await sPut("users/userA/cv/planted.pdf", t), 403, who + " writes");
    assert.equal(await sDel("users/userA/cv/cv.pdf", t), 403, who + " deletes");
  }
  assert.equal(await sGet("users/userA/cv/cv.pdf", A), 200, "still there");
});

test("files: uploads need a confirmed email and a document type; nothing outside an account's folder", async () => {
  assert.equal(await sPut("users/userC/cv/cv.pdf", token("userC", "c@example.test", false)), 403, "unconfirmed email");
  assert.equal(await sPut("users/userA/cv/notes.txt", A, "text/plain"), 200, "a plain document type is accepted, so the refusals below are the rules at work");
  assert.equal(await sPut("users/userA/cv/page.html", A, "text/html"), 403, "a page that would open in a browser");
  assert.equal(await sPut("users/userA/cv/pic.svg", A, "image/svg+xml"), 403, "SVG");
  assert.equal(await sPut("shared/x.pdf", A), 403, "outside the account's folder");
  assert.equal(await sGet("shared/x.pdf", A), 403);
});

test("files: the signature is reached only through the server", async () => {
  assert.equal(await sPut("users/userA/sign/sign.png", A, "image/png"), 403, "the app cannot write it");
  assert.equal(await sPut("users/userA/sign/sign.png", ADMIN, "image/png"), 200, "the server can");
  assert.equal(await sGet("users/userA/sign/sign.png", A), 403, "the app cannot read it, even for its own account");
  assert.equal(await sGet("users/userA/sign/sign.png", B), 403);
  assert.equal(await sDel("users/userA/sign/sign.png", A), 403);
});
