// SMART START: Stuart, the assistant (app side). Loaded on demand by index.html.
// Everything Stuart says comes from the Cloud Functions in functions/index.js; this file
// only collects input, shows results and keeps the user's records under users/{uid}/.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const V = "11.10.0";
let ctx = null;          // { mode, app, auth, db, FS, user, container, rerender }
let FN = null, callables = {};
let logState = { text: "", proposal: null, busy: "", err: "" }; // "Tell Stuart an update"
let state = { profile: null, plan: null, jobs: [], budget: null, step: null, busy: "", err: "", openJob: null, chat: [], unsub: [], tab: "home", cv: null, cvDraft: null, cvDirty: false, cvSec: "experience", cvItem: 0, sugg: null, builds: [], buildJob: null, review: null, pvOpen: false, linkApp: "", pending: false, iv: null, ivOpen: false };

const INTENTIONS = [
  ["pivot", "Career pivot", "A new sector or profession."],
  ["accelerate", "Accelerate", "Same track, next level."],
  ["growth", "Growth", "Same role, build the skills."],
  ["unsure", "Not sure yet", "Stuart asks three questions and suggests one."]];

export async function mount(c) {
  ctx = c; state.err = ""; state.busy = "";
  if (IOS) loadJsPdf().catch(() => {}); // 2.45.0: ready before the first Download PDF, so the tap can open the share sheet
  if (ctx.mode === "local") { creditsLoad(); renderDemo(); return; }
  if (!FN) {
    const F = await import("https://www.gstatic.com/firebasejs/" + V + "/firebase-functions.js");
    FN = F.getFunctions(ctx.app, "asia-southeast1");
    for (const n of ["stuartPlan", "stuartChat", "stuartLog", "stuartImprove", "stuartDocx", "stuartInterview", "stuartRules", "stuartEmail", "stuartCredits", "stuartCvCheck"]) callables[n] = F.httpsCallable(FN, n, { timeout: 120000 });
    for (const n of ["stuartTailor", "stuartQuick", "stuartProfile", "stuartAnalyse", "stuartCoach", "stuartInspect", "stuartPractise"]) callables[n] = F.httpsCallable(FN, n, { timeout: 300000 }); // long reads: the server allows 300 s too
  }
  subscribe(); if (state.openJob) watchChat(state.openJob); render(); creditsLoad();
}
export function unmount() { document.body.classList.remove("ss-jobchat"); state.unsub.forEach((u) => u()); state.unsub = []; if (state.chatUnsub) { state.chatUnsub(); state.chatUnsub = null; } }
export function openAdd(o) { state.wantAdd = o && o.appId ? { appId: String(o.appId), org: String(o.org || "") } : true; }
// 2.40.0 the jobs list loads 50 at a time; "Show older jobs" adds 50 more, and the heading counts them all
function subJobs(onErr) {
  const FS = ctx.FS, col = FS.collection(ctx.db, "users", ctx.user.uid, "jobs");
  if (state.jobsUnsub) state.jobsUnsub();
  state.jobsUnsub = FS.onSnapshot(FS.query(col, FS.orderBy("createdAt", "desc"), FS.limit(state.jobLimit + 1)), (q) => {
    state.jobsLoaded = true; state.moreJobs = q.docs.length > state.jobLimit;
    state.allJobs = q.docs.slice(0, state.jobLimit).map((d) => ({ id: d.id, ...d.data() })); state.jobs = visible(state.allJobs);
    const ck = state.jobLimit + ":" + q.docs.length;
    if (state.moreJobs && FS.getCountFromServer && state.countKey !== ck) (state.countKey = ck, FS.getCountFromServer(col)).then((c) => { state.jobTotal = c.data().count; softRender(); }).catch(() => {}); else state.jobTotal = 0;
    softRender(); }, onErr || (() => {}));
}
export function openCV() { state.tab = "cv"; state.openJob = null; state.sheet = null; render(); }
// Jobs being deleted stay hidden until the delete is final (index.html keeps the set and the Undo).
const visible = (L) => { const H = ctx && ctx.hiddenJobs ? ctx.hiddenJobs() : null; return H && H.size ? L.filter((j) => !H.has(j.id)) : L; };
export function refreshHidden() { if (!ctx) return; if (state.allJobs) state.jobs = visible(state.allJobs); else if (ctx.mode === "local") { state.demoAll = state.demoAll || state.jobs; state.jobs = visible(state.demoAll); } if (state.openJob && !state.jobs.some((j) => j.id === state.openJob)) state.openJob = null; render(); }
const building = new Set(), BUILD_LABEL = "Stuart is building your CV, resume and cover letter (about a minute)…";
export function openJobPage(id) { state.sheet = null; state.openJob = id; state.buildJob = id; state.optOpen = null; state.chat = []; state.chatOpen = false; state.review = null; state.email = null; state.cxEdit = null; state.coachBusy = building.has(id) ? BUILD_LABEL : ""; }
export function reset() { unmount(); logState = { text: "", proposal: null, busy: "", err: "" }; state = { profile: null, plan: null, jobs: [], budget: null, step: null, busy: "", err: "", openJob: null, chat: [], unsub: [], tab: "home", cv: null, cvDraft: null, cvDirty: false, cvSec: "experience", cvItem: 0, sugg: null, builds: [], buildJob: null, review: null, pvOpen: false, linkApp: "", pending: false, iv: null, ivOpen: false }; }

function subscribe() {
  unmount(); const { db, FS, user } = ctx; const uid = user.uid;
  const onErr = (e) => { state.err = "Could not read your records (" + (e.code || e.message) + ")."; render(); };
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "profile", "current"), (s) => { state.profile = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "plan", "current"), (s) => { state.plan = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.jobLimit = 50; subJobs(onErr); state.unsub.push(() => { if (state.jobsUnsub) state.jobsUnsub(); state.jobsUnsub = null; });
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "master"), (s) => { state.cv = s.exists() ? s.data() : null; if (!state.cvDirty) state.cvDraft = null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "rules"), (s) => { state.rules = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "profile", "facts"), (s) => { state.facts = s.exists() ? s.data() : null; softRender(); }, onErr)); // 2.43.0
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "looks"), (s) => { state.looks = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "quick"), (s) => { state.quick = s.exists() ? s.data() : null; softRender(); }, onErr)); // 2.46.0
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "interview"), (s) => { state.iv = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.collection(db, "users", uid, "builds"), (q) => { state.builds = q.docs.map((d) => ({ id: d.id, ...d.data() })); softRender(); }, onErr));
}
function watchChat(jobId) {
  const { db, FS, user } = ctx;
  if (state.chatUnsub) { state.chatUnsub(); state.chatUnsub = null; }
  if (!jobId) return;
  state.chatUnsub = FS.onSnapshot(FS.query(FS.collection(db, "users", user.uid, "jobs", jobId, "chat"), FS.orderBy("at", "asc"), FS.limitToLast(150)), (q) => { const n = state.chat.filter((m) => !m.temp).length; state.chat = q.docs.map((d) => ({ id: d.id, ...d.data() })); render(); if (state.chat.length > n && n) scrollEnd(); }, () => {});
}
function errMsg(e) {
  const c = String((e && e.code) || "");
  if (/functions\/not-found/.test(c)) return "Stuart is not switched on yet. Its backend is being set up; the tracker works as usual.";
  if (/permission-denied/.test(c)) return "Stuart could not read this account. Sign out and in again; if it keeps happening, send feedback from Settings.";
  if (/deadline-exceeded/.test(c)) return "Stuart took too long to answer. Try again; a shorter document is quicker.";
  if (/unavailable|internal/.test(c) && /^(internal|INTERNAL)$/.test(String(e.message || ""))) return "Stuart could not be reached. Check your connection and try again.";
  return (e && e.message) || String(e);
}
// While Stuart works, the app's idle sign-out waits (index.html reads window.ssBusy).
// 2.24.1: every call shows: a ring on Stuart's icon and a toast with what he is doing, until the last call in flight returns
async function busyWhile(p, label) { window.ssBusy = (window.ssBusy || 0) + 1; const t = document.getElementById("busytoast"), x = document.getElementById("busytxt");
  if (x) x.textContent = label || "Stuart is working…"; if (t) t.hidden = false; document.body.classList.add("ss-busy");
  try { return await p; } finally { window.ssBusy = Math.max(0, (window.ssBusy || 1) - 1); if (!window.ssBusy) { document.body.classList.remove("ss-busy"); if (t) t.hidden = true; } if (ctx && ctx.touch) ctx.touch(); } }
async function call(name, data, busyLabel) {
  state.busy = busyLabel; state.err = ""; render();
  try { const r = await busyWhile(callables[name](data), busyLabel); state.busy = ""; return r.data; }
  catch (e) { state.busy = ""; state.err = errMsg(e); render(); throw e; }
}
const MAX_BYTES = 8 * 1024 * 1024;
const readFile = (f) => new Promise((res, rej) => { if (f.size > MAX_BYTES) { rej(new Error("File is larger than 8 MB.")); return; } const r = new FileReader(); r.onload = () => res({ name: f.name, mime: f.type, data: String(r.result).split(",")[1] }); r.onerror = rej; r.readAsDataURL(f); });

/* ---------- views ---------- */
const head = () => `<div class="stu-head"><img src="icons/stuart.svg" alt=""><div><div class="stu-name">Stuart</div><div class="stu-dis">An AI assistant. It drafts and suggests; you decide and send. It works only from what you upload or type.</div></div></div>`;
const errLine = () => state.err ? `<p class="lock__err" role="alert">${esc(state.err)}</p>` : "";
const busyLine = () => state.busy ? `<p class="stu-busy"><span class="spin"></span>${esc(state.busy)}</p>` : "";

// Records arriving from Firestore must not wipe a field the user is typing in: wait until it loses focus.
function softRender() {
  const a = document.activeElement;
  if (ctx && a && a.matches && a.matches("input,textarea,select") && !a.matches("#cx-msg") && ctx.container && ctx.container.contains(a)) { state.pending = true; return; }
  render();
}
function render() {
  if (!ctx || !ctx.container) return;
  state.pending = false;
  const p = state.profile, local = ctx.mode === "local";
  if (state.wantAdd && (local || (p && p.consentAI))) { const w = state.wantAdd; state.wantAdd = false; state.openJob = null; state.tab = "home"; if (local || state.cv || (p && p.profile)) { state.sheet = newSheet(); if (w && w.appId) Object.assign(state.sheet, { appId: w.appId, appOrg: w.org, track: false }); } else state.needCV = true; }
  let body;
  if (local) body = state.openJob ? viewJobPage() : viewHub(); // demo: sample content only
  else if (!p || !p.consentAI) body = viewConsent();
  else body = state.openJob ? viewJobPage() : viewHub();
  const note = state.needCV && !state.openJob ? `<p class="sx-note" role="status">Add your CV first. Stuart checks every job against it.</p>` : state.prNote && !state.openJob ? `<p class="sx-note" role="status">${esc(state.prNote)}</p>` : "";
  const keep = ["cx-msg", "cx-ed", "pr-msg"].map((id) => { const el = document.getElementById(id); return el ? { id, v: el.value, f: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd } : null; }).filter(Boolean);
  const t0 = thread(), had = !!t0, atEnd = !t0 || t0.scrollHeight - t0.scrollTop - t0.clientHeight < 60, top0 = t0 ? t0.scrollTop : 0, n0 = t0 ? t0.children.length : 0;
  ctx.container.innerHTML = (local || (p && p.consentAI) ? "" : head()) + note + body + sheetHTML() + soonHTML();
  const t1 = thread(); document.body.classList.toggle("ss-jobchat", !!t1);
  if (t1) { fitViewport(); t1.scrollTop = atEnd || !had ? t1.scrollHeight : top0;
    const nb = ctx.container.querySelector(".cx-new"); if (nb) { nb.hidden = atEnd || !had || !(state.cxNew || t1.children.length > n0); state.cxNew = !nb.hidden; }
    t1.addEventListener("scroll", () => { const b = ctx.container.querySelector(".cx-new"); if (b && !b.hidden && t1.scrollHeight - t1.scrollTop - t1.clientHeight < 60) { b.hidden = true; state.cxNew = false; } }, { passive: true }); }
  keep.forEach((k) => { const el = document.getElementById(k.id); if (!el) return; el.value = k.v; grow(el); if (k.f) { el.focus({ preventScroll: true }); try { el.setSelectionRange(k.s, k.e); } catch (e) {} } });
  if (state.sheet && state.sheet.focus) { state.sheet.focus = false; const t = document.getElementById("stu-text") || document.getElementById("stu-url"); if (t) t.focus({ preventScroll: true }); }
}
function viewConsent() {
  return `<div class="set"><h3>Before Stuart starts</h3>
  <p>Stuart reads the documents and advertisements you give it and sends them to the Claude AI service (Anthropic, outside Singapore) to analyse. Nothing is sent to employers. Settings → Close account deletes your sign-in, records and files.</p>
  <label class="stu-check"><input type="checkbox" id="c1"> I have read the <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a> and the <a href="terms.html" target="_blank" rel="noopener">terms of use</a>.</label>
  <label class="stu-check"><input type="checkbox" id="c2"> I agree to my documents and job advertisements being sent to the AI service for analysis.</label>
  <div class="btnrow" style="margin-top:12px"><button class="btn" data-stu="consent">Continue</button></div>${errLine()}</div>`;
}
function viewIntention() {
  const pr = state.profile.profile || {};
  return `<div class="set"><h3>Your profile, extracted</h3><div class="kv"><div class="k">Headline</div><div class="v">${esc(pr.headline || "")}</div><div class="k">Roles</div><div class="v">${(pr.roles || []).slice(0, 6).map((r) => esc((r.title || "") + ", " + (r.organisation || "") + " (" + (r.start || "") + " to " + (r.end || "") + ")")).join("<br>")}</div><div class="k">Skills</div><div class="v">${esc((pr.skills || []).slice(0, 12).join(", "))}</div></div>
  <p>${state.profile.unscreened ? "This file had no text layer, so it was sent as uploaded and could not be screened for identification numbers. " : state.profile.idsRemoved ? state.profile.idsRemoved + " identification number(s) were removed before analysis. " : ""}Wrong or missing? Upload a corrected CV from Settings later; Stuart works from this one for now.</p></div>
  <div class="set"><h3>Why are you here?</h3><div class="stu-grid">${INTENTIONS.map(([k, t, s]) => `<button class="stu-opt" data-stu="intent" data-k="${k}"><b>${t}</b><span>${s}</span></button>`).join("")}</div></div>
  <div class="set" id="stu-target" hidden><h3>Where to, and by when?</h3><div class="field" style="margin-bottom:8px"><input id="stu-tgt" placeholder="Target role or sector" style="padding-left:12px"></div><div class="field"><input id="stu-date" type="date" style="padding-left:12px" aria-label="Start by"></div><div class="btnrow"><button class="btn" data-stu="plan">Draft my plan</button></div>${busyLine()}${errLine()}</div>`;
}
// 2.40.0 Your plan stays yours to change: edit any part, change direction and redraft, review it against your progress
// with Stuart, and go back to an earlier version. Each change keeps the version before it (up to six).
const PLAN_F = [["headline", "Headline"], ["smart.specific", "Specific"], ["smart.measurable", "Measurable"], ["smart.achievable", "Achievable"], ["smart.relevant", "Relevant"], ["smart.timeBound", "Time-bound"], ["grow.goal", "Goal"], ["grow.reality", "Reality"], ["grow.options", "Options"], ["grow.will", "Will"]];
const pget = (pl, k) => k.split(".").reduce((o, x) => (o || {})[x], pl);
const ptxt = (v) => (Array.isArray(v) ? v.filter(Boolean).join("; ") : String(v || ""));
const pms = (t) => (t && t.toMillis ? t.toMillis() : typeof t === "number" ? t : 0);
const pday = (ms) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
function planClone(pl) { return JSON.parse(JSON.stringify(pl || {})); }
function planSet(pl, k, v) { const [a, b] = k.split("."); if (!b) pl[a] = v; else { pl[a] = pl[a] || {}; pl[a][b] = v; } }
async function planWrite(next, label, edited, keepOnly) {
  const cur = state.plan || {}, hist = [{ at: pms(cur.updatedAt) || Date.now(), label: cur.label || (cur.confirmed ? "Confirmed draft" : "Draft"), plan: cur.plan || {}, edited: cur.edited || {} }].concat(Array.isArray(cur.history) ? cur.history : []).slice(0, 6);
  const doc = { plan: next, label, history: hist.filter((h) => JSON.stringify(h).length < 20000), edited: keepOnly ? Object.assign({}, edited || {}) : Object.assign({}, cur.edited || {}, edited || {}), updatedAt: ctx.mode === "local" ? Date.now() : ctx.FS.serverTimestamp() };
  if (ctx.mode === "local") { state.plan = Object.assign({}, cur, doc); render(); return; }
  // whole fields replace: a merge would keep old marks inside "edited"
  try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "plan", "current"), doc); } catch (e) { state.err = "Could not save your plan (" + (e.code || e.message) + ")."; render(); }
}
function viewPlan(first) {
  const P = state.plan, U = state.planUI || {};
  if (!P) return `<div class="set"><h3>The route: your plan</h3>${busyLine()}${errLine()}<p>Stuart drafts your SMART goal and GROW frame from your intention, target and CV.</p>${state.busy ? "" : `<div class="btnrow"><button class="btn" data-stu="redraft">Draft my plan</button></div>`}</div>`;
  const pl = P.plan || {}, ed = P.edited || {}, hist = Array.isArray(P.history) ? P.history : [];
  if (U.mode === "edit") {
    const f = (k, l) => { const v = pget(U.draft, k), many = k === "grow.options" || k === "grow.will"; return `<label class="sx-f wide"><span>${l}${many ? " <small>(one per line)</small>" : ""}</span><textarea class="sx-ta" rows="${many ? 3 : 2}" data-pf="${k}">${esc(Array.isArray(v) ? v.join("\n") : v || "")}</textarea></label>`; };
    return `<div class="set"><h3>Edit your plan</h3>${f("headline", "Headline")}<div class="group">SMART goal</div>${PLAN_F.slice(1, 6).map(([k, l]) => f(k, l)).join("")}<div class="group">GROW</div>${PLAN_F.slice(6).map(([k, l]) => f(k, l)).join("")}
      <div class="btnrow"><button class="btn" data-stu="pl-save">Save plan</button><button class="btn btn--ghost" data-stu="pl-cancel">Cancel</button></div><p class="sx-sp sm">Saved as you wrote it and marked Edited by you. No AI is used.</p>${errLine()}</div>`;
  }
  if (U.mode === "dir") {
    const pr = state.profile || {};
    return `<div class="set"><h3>Change direction</h3><div class="group">Why you are here</div><div class="stu-grid">${INTENTIONS.filter(([k]) => k !== "unsure").map(([k, t, sub]) => `<button type="button" class="stu-opt${U.intent === k ? " on" : ""}" data-stu="pl-intent" data-k="${k}" aria-pressed="${U.intent === k}"><b>${t}</b><span>${sub}</span></button>`).join("")}</div>
      <div class="group">Target role or sector</div><input id="pl-tgt" class="sx-inp" value="${esc(U.target != null ? U.target : pr.target || "")}"><div class="group">Start by</div><input id="pl-date" class="sx-inp" type="date" value="${esc(U.startBy != null ? U.startBy : pr.startBy || "")}">
      <div class="btnrow"><button class="btn" data-stu="pl-redraft">Redraft with Stuart</button><button class="btn btn--ghost" data-stu="pl-cancel">Cancel</button></div><p class="sx-sp sm">Your current plan is kept under Earlier versions.</p>${busyLine()}${errLine()}</div>`;
  }
  if (U.mode === "review") {
    const S = U.sug || [];
    return `<div class="set"><h3>Stuart's suggested updates</h3><p class="sx-sp">From your plan and a summary of your applications: counts, stages, replies, interviews and sectors. No documents, notes or organisation names.</p>${busyLine()}${errLine()}
      ${S.length ? S.map((x, i) => `<div class="pl-sug"><div class="group">${esc(x.label)}</div><p class="pl-was">${esc(ptxt(pget(pl, x.k)))}</p><p>${esc(ptxt(x.v))}</p>${x.why ? `<p class="sx-sp sm">${esc(x.why)}</p>` : ""}${x.done ? `<p class="sx-sp sm"><b>${x.done === "use" ? "Used" : "Kept yours"}</b></p>` : `<div class="btnrow"><button class="btn" data-stu="pl-use" data-i="${i}">Use this</button><button class="btn btn--ghost" data-stu="pl-keep" data-i="${i}">Keep mine</button></div>`}</div>`).join("") : state.busy ? "" : `<p>Stuart suggests no changes: your plan matches your progress.</p>`}
      <div class="btnrow"><button class="btn btn--ghost" data-stu="pl-cancel">Done</button></div></div>`;
  }
  if (U.mode === "hist") {
    const H = hist[U.i];
    if (H) return `<div class="set"><h3>${esc(H.label || "Earlier version")} · ${esc(pday(H.at))}</h3><p><b>${esc(H.plan.headline || "")}</b></p><div class="kv">${PLAN_F.slice(1).map(([k, l]) => `<div class="k">${l}</div><div class="v">${esc(ptxt(pget(H.plan, k)))}</div>`).join("")}</div>
      <div class="btnrow"><button class="btn" data-stu="pl-restore" data-i="${U.i}">Restore this version</button><button class="btn btn--ghost" data-stu="pl-hist">Back</button></div><p class="sx-sp sm">Restoring keeps your current plan under Earlier versions.</p></div>`;
    return `<div class="set"><h3>Earlier versions</h3>${hist.length ? `<div class="pl-hist">${hist.map((h, i) => `<button type="button" data-stu="pl-open" data-i="${i}"><b>${esc(pday(h.at))}</b><span>${esc(h.label || "")}</span></button>`).join("")}</div>` : "<p>None yet. Each change keeps the version before it.</p>"}<div class="btnrow"><button class="btn btn--ghost" data-stu="pl-cancel">Back</button></div></div>`;
  }
  const row = (k, l) => `<div class="k">${l}</div><div class="v">${esc(ptxt(pget(pl, k)))}${ed[k] ? ' <span class="pl-ed">Edited</span>' : ""}</div>`;
  const when = [P.confirmed ? "Confirmed" + (P.confirmedAt ? " " + pday(pms(P.confirmedAt)) : "") : "Draft", pms(P.updatedAt) ? "updated " + pday(pms(P.updatedAt)) : "", P.label || ""].filter(Boolean).join(" · ");
  return `<div class="set"><h3>Your plan</h3><p><b>${esc(pl.headline || "")}</b>${ed.headline ? ' <span class="pl-ed">Edited</span>' : ""}</p><p class="sx-sp sm">${esc(when)}</p>
  <div class="group">SMART goal</div><div class="kv">${PLAN_F.slice(1, 6).map(([k, l]) => row(k, l)).join("")}</div>
  <div class="group">GROW</div><div class="kv">${PLAN_F.slice(6).map(([k, l]) => row(k, l)).join("")}</div>
  ${P.confirmed ? "" : `<p>Drafted by Stuart from what you gave it. Confirm it, edit it, or redraft.</p><div class="btnrow"><button class="btn" data-stu="confirm-plan">Looks right</button><button class="btn btn--ghost" data-stu="redraft">Redraft</button></div>`}
  <div class="pl-acts"><button class="btn btn--ghost" data-stu="pl-edit">Edit</button><button class="btn btn--ghost" data-stu="pl-review">Review my plan with Stuart</button><button class="btn btn--ghost" data-stu="pl-dir">Change direction</button><button type="button" class="sx-lk" data-stu="pl-hist">Earlier versions (${hist.length})</button></div>
  ${busyLine()}${errLine()}<div class="btnrow"><button class="btn btn--ghost" data-stu="home">Back</button></div></div>`;
}
function bandPill(b) { const l = (b && b.level) || ""; const cls = l === "high" ? "ok" : l === "medium" ? "warn" : "crit"; return `<span class="pill ${cls}"><span>${esc(l ? l[0].toUpperCase() + l.slice(1) + " likelihood" : "")}</span></span>`; }
/* ---------- Tell Stuart an update: Stuart proposes, the user confirms each change ---------- */
const STAGE_FROM = (s) => s ? esc(s) : "no stage yet";
function viewLog() {
  const L = logState, P = L.proposal;
  const cards = P ? P.matches.map((m, i) => m.status === "skipped" ? "" : `<div class="set stu-lg" style="margin:8px 0 0">
    <p style="margin:0 0 6px"><b>${esc(m.org)}</b>${m.role ? " · " + esc(m.role) : ""}</p>
    <p style="margin:0 0 8px">${STAGE_FROM(m.fromStage)} → <b>${esc(m.toStage)}</b> <span class="pill ${m.confidence === "high" ? "ok" : m.confidence === "medium" ? "warn" : "crit"}"><span>${esc(m.confidence)} confidence match</span></span></p>
    ${m.status === "saved" ? `<p style="margin:0"><b>Saved</b> · ${esc(m.date)}${m.note ? " · " + esc(m.note) : ""}</p>` : `
    <div class="field" style="margin-bottom:8px"><input type="date" class="stu-lg-in" data-i="${i}" data-f="date" value="${esc(m.date)}" aria-label="Date" style="padding-left:12px"></div>
    <div class="field" style="margin-bottom:8px"><input class="stu-lg-in" data-i="${i}" data-f="note" value="${esc(m.note)}" maxlength="300" placeholder="Note" aria-label="Note" style="padding-left:12px"></div>
    ${m.reason ? `<p class="stu-dis" style="margin:0 0 8px">Why Stuart matched it: ${esc(m.reason)}</p>` : ""}
    <div class="btnrow"><button class="btn" data-stu="log-ok" data-i="${i}"${m.status === "saving" ? " disabled" : ""}>${m.status === "saving" ? "Saving…" : "Confirm"}</button><button class="btn btn--ghost" data-stu="log-skip" data-i="${i}">Skip</button></div>
    ${m.err ? `<p class="lock__err" role="alert">${esc(m.err)}</p>` : ""}`}</div>`).join("") : "";
  const none = P && !P.matches.length ? `<p>Stuart could not match this update to an application on record.</p>` : "";
  return `<div class="set"><h3>Tell Stuart an update</h3>
  <textarea id="stu-log" rows="3" maxlength="2000" placeholder="For example: Example Logistics Group called me for an interview next Tuesday; Example Retail Company said no." style="width:100%;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:var(--r-s);padding:8px 10px">${esc(L.text)}</textarea>
  <div class="btnrow" style="margin-top:8px"><button class="btn" data-stu="log-send"${L.busy ? " disabled" : ""}>Send</button></div>
  ${L.busy ? `<p class="stu-busy"><span class="spin"></span>${esc(L.busy)}</p>` : ""}${L.err ? `<p class="lock__err" role="alert">${esc(L.err)}</p>` : ""}
  ${P && P.question ? `<p><b>Stuart asks:</b> ${esc(P.question)}</p>` : ""}${none}${cards}
  ${P && P.unmatched ? `<p class="stu-dis">Not placed: ${esc(P.unmatched)}</p>` : ""}
  <p class="stu-dis">Stuart proposes; nothing changes until you confirm each card.</p></div>`;
}
function demoProposal() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); const today = d.toISOString().slice(0, 10);
  const tue = new Date(d); tue.setUTCDate(d.getUTCDate() + (((2 - d.getUTCDay()) + 7) % 7 || 7));
  return { today, unmatched: "", question: "Is the interview with Example Logistics Group the first one, or a later round?", matches: [
    { appId: "demo-1", org: "Example Logistics Group", role: "Operations Manager", fromStage: "Applied", toStage: "1st interview", date: tue.toISOString().slice(0, 10), note: "Called with an interview invitation", confidence: "high", reason: "The update names the company and an interview invitation." },
    { appId: "demo-2", org: "Example Retail Company", role: "Store Manager", fromStage: "Acknowledged", toStage: "Rejected", date: today, note: "Said no", confidence: "medium", reason: "\"Said no\" read as a rejection." }] };
}
async function logSend() {
  const el = document.getElementById("stu-log"); const text = ((el && el.value) || "").trim(); logState.text = el ? el.value : logState.text;
  if (!text) { logState.err = "Type the update first."; render(); return; }
  if (text.length > 2000) { logState.err = "Keep the update under 2,000 characters."; render(); return; }
  logState.err = ""; logState.proposal = null;
  if (ctx.mode === "local") { logState.proposal = demoProposal(); render(); return; }
  logState.busy = "Stuart is matching your update to your applications…"; render();
  try { const r = await busyWhile(callables.stuartLog({ text }), "Reading your update…"); logState.proposal = r.data; logState.text = ""; }
  catch (e) { const c = e.code || ""; logState.err = /not-found/.test(c) ? "Stuart's update logging is not switched on yet." : /permission-denied/.test(c) ? "Stuart could not read this account. Sign out and in again." : (e.message || String(e)); }
  logState.busy = ""; render();
}
async function logConfirm(i) {
  const m = logState.proposal && logState.proposal.matches[i]; if (!m || m.status === "saved" || m.status === "saving") return;
  m.err = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || "")) { m.err = "Choose a date."; render(); return; }
  if (ctx.mode === "local") { m.status = "saved"; render(); return; }
  m.status = "saving"; render();
  const { db, FS, user } = ctx; const note = String(m.note || "").trim().slice(0, 300);
  try {
    const ref = FS.doc(db, "users", user.uid, "applications", m.appId);
    const cur = (await FS.getDoc(ref)).data() || {};
    // keep the history in date order; the current stage only moves when this entry is the latest
    const stages = (Array.isArray(cur.stages) ? cur.stages.slice() : []).concat([{ stage: m.toStage, date: m.date, note, source: "stuart" }])
      .map((x, i) => [x, i]).sort((a, b) => String(a[0].date || "").localeCompare(String(b[0].date || "")) || a[1] - b[1]).map((x) => x[0]);
    const last = stages[stages.length - 1];
    await FS.updateDoc(ref, { stages, stage: last.stage, stageAt: last.date, updatedAt: FS.serverTimestamp() });
    m.status = "saved";
  } catch (e) { m.status = ""; m.err = "Could not save (" + (e.code || e.message) + ")."; }
  render();
}


/* ---------- demo (local preview, no Firebase) ---------- */
function renderDemo() {
  state.profile = { consentAI: true, profile: { headline: "Demo profile", roles: [], skills: [] }, intention: "pivot" };
  state.plan = { plan: { headline: "Move from operations into a product role by next summer.", smart: { specific: "A product manager post", measurable: "Three shortlists", achievable: "Eight years of delivery evidence", relevant: "Sector change", timeBound: "By June 2027" }, grow: { goal: "Product manager role", reality: "Strong delivery record, no product title yet", options: ["Start-ups", "Agencies", "In-house teams"], will: ["Two applications a week", "Refresh the CV monthly"] } }, confirmed: true };
  state.jobs = [{ id: "demo", status: "Considering", facts: { organisation: "Example Logistics Group", role: "Operations Manager", closingDate: "2026-11-30", location: "Singapore" }, analysis: { roleFit: { score: 78, met: 6, partly: 3, notMet: 1 }, careerAspiration: { score: 70, reasons: "Larger team, wider remit" }, coverage: { present: 9, total: 11 }, band: { level: "medium", reasons: ["Hard screens met", "Two keywords missing", "Competitive post"] }, recommendation: "apply", why: "Strong fit on delivery and teamwork.", hardScreens: [{ requirement: "Degree", status: "Met", evidence: "BSc, MSc" }], transferable: [{ requirement: "Experience with outsourcing partners", evidence: "Opened two new clinics on time and within budget.", difference: "Clinic contractors and suppliers, not an outsourced service partner.", say: "Lead with delivering through suppliers to a deadline, then name the clinic setting." }], ats: { must: [{ term: "stakeholder", evidence: "Skills line" }], nice: [], gap: [{ term: "Agile certification", why: "Not on the sample CV" }] }, nextSteps: ["Tailor the CV", "Ask about the team size"], openQuestions: [] } }];
  state.chat = [{ role: "assistant", text: "This is a preview with sample content. Sign in on the hosted app to use Stuart." }];
  if (!state.cv) state.cv = { version: "3.2", name: "Adam", contact: { email: "adam@mail.example", phone: "", location: "Singapore", links: "" }, headline: "Operations leader in community health", summary: "Leads clinic operations and service improvement across three sites, with a record of better access and lower no-show rates.",
    experience: [{ id: "r1", title: "Head of Operations", org: "Meridian Care Group", location: "Singapore", start: "Jan 2021", end: "present", bullets: [{ text: "Led a team of 12 across three clinics; cut appointment no-shows from 18% to 11% in 2024.", src: "cv" }, { text: "Built the referral dashboard used by 40 clinicians each week.", src: "cv" }, { text: "Responsible for budgeting and planning for the department.", src: "cv" }] },
      { id: "r2", title: "Operations Manager", org: "Harbourside Clinics", location: "Singapore", start: "2017", end: "2020", bullets: [{ text: "Opened two new clinics on time and within budget.", src: "cv" }] }],
    education: [{ text: "MSc Health Services Management, Example University, 2016" }], skills: ["Operations", "Service design", "Data dashboards", "Stakeholder management"], certifications: [{ text: "Lean Six Sigma Green Belt" }], awards: [], publications: [], referees: [] };
  if (!state.facts) state.facts = { items: [{ id: "f1", q: "Can you start before 1 January 2027?", a: "Yes, from 1 December 2026.", at: "2026-11-10", org: "Example Logistics Group" }] };
  if (!state.rules) state.rules = { list: [{ id: "d1", type: "leave", term: "Volunteer coaching", unless: true, text: "Leave out the volunteer coaching from every CV, resume and letter" }, { id: "d2", type: "word", use: "organised", avoid: "organized", text: "Write \"organised\", never \"organized\"" }, { id: "d4", type: "date", date: "2027-01-20", text: "I sit the Japanese language exam on 20 Jan 2027. Until then, call it in progress" }, { id: "d3", type: "ask", term: "Lean Six Sigma", text: "Lean Six Sigma Green Belt: ask before claiming it" }] };
  state.jobs[0].facts.organisation = "Northwind Health"; state.jobs[0].facts.role = "Director, Strategy and Transformation"; state.jobs[0].facts.apply = { method: "email", email: "careers@northwind.example" };
  render();
}
/* ---------- Stuart hub: Home and My CV; the plan opens from its card; each job has its own page ---------- */
// The master CV lives at users/{uid}/cv/master; builds for a job at users/{uid}/builds/{jobId} (written by
// stuartTailor). Edits stay in a draft until Save; Stuart's suggestions change nothing until accepted.
const TAB_ICO = { home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', cv: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 20h7"/>', loadout: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M10 9v12"/>' };
const TABS = [["home", "Home"], ["cv", "Writer"], ["loadout", "Loadout"]];
const SECS = [["contact", "Contact"], ["summary", "Headline and summary"], ["experience", "Experience"], ["education", "Education"], ["skills", "Skills"], ["certifications", "Certifications"], ["awards", "Awards"], ["publications", "Publications"], ["referees", "Referees"]];
const LISTS = ["education", "certifications", "awards", "publications", "referees"];
const rid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o || null));
const ICO = {
  more: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  pen: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  spark: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  up: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  dl: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  doc: '<svg class="ic" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  target: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  chev: '<svg class="ic" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  down: '<svg class="ic dn" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  eye: '<svg class="ic" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  send: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 12h14M13 6l6 6-6 6"/></svg>' };
const hasText = (v) => !!String(v || "").trim();
function masterFromProfile() {
  const pr = (state.profile && state.profile.profile) || {};
  return { version: "1.0", name: pr.name || "", contact: { email: (ctx.user && ctx.user.email) || "", phone: "", location: "", links: "" }, headline: pr.headline || "", summary: pr.summary || "",
    experience: (pr.roles || []).map((r) => ({ id: rid(), title: r.title || "", org: r.organisation || "", location: "", start: r.start || "", end: r.end || "", bullets: (r.bullets || []).map((t) => ({ text: String(t), src: "cv" })) })),
    education: (pr.education || []).map((e) => ({ text: [e.qualification, e.institution, e.year].filter(Boolean).join(", ") })),
    skills: (pr.skills || []).map(String), certifications: (pr.certifications || []).map((c) => ({ text: String(c) })), awards: (pr.awards || []).map((c) => ({ text: String(c) })), publications: (pr.publications || []).map((c) => ({ text: String(c) })), referees: [] };
}
const draft = () => state.cvDraft || state.cv;
function secDone(c, k) {
  if (!c) return false;
  if (k === "contact") return hasText(c.name) && (hasText((c.contact || {}).email) || hasText((c.contact || {}).phone));
  if (k === "summary") return hasText(c.headline) || hasText(c.summary);
  if (k === "skills") return (c.skills || []).length > 0;
  return (c[k] || []).some((x) => hasText(x.text) || hasText(x.title));
}
function cvStats(c) {
  if (!c) return { pct: 0, noFig: 0, pages: 0 };
  const keys = ["contact", "summary", "experience", "education", "skills", "certifications"], pct = Math.round(keys.filter((k) => secDone(c, k)).length / keys.length * 100);
  const noFig = (c.experience || []).reduce((n, r) => n + (r.bullets || []).filter((b) => hasText(b.text) && !/\d/.test(b.text)).length, 0);
  return { pct, noFig, pages: estPages(c, "cv") };
}
// about 46 lines of Arial 11 on an A4 page with 2 cm margins, about 95 characters a line
function estPages(d, kind, signed) {
  if (!d) return 0; const ln = (t) => Math.max(1, Math.ceil(String(t || "").length / 95));
  if (kind === "letter") return Math.max(1, Math.ceil(((signed ? 11 : 10) + (d.paragraphs || []).reduce((n, p) => n + ln(p) + 1, 0)) / 46));
  let n = 4 + (d.headline ? 2 : 0) + (d.summary ? ln(d.summary) + 2 : 0);
  (d.experience || []).forEach((r) => { n += 2 + (r.location ? 1 : 0); (r.bullets || []).forEach((b) => { n += ln(b.text); }); });
  ["education", "certifications", "awards", "publications"].concat(kind === "cv" ? ["referees"] : []).forEach((k) => { if ((d[k] || []).length) n += 2 + d[k].reduce((m, x) => m + ln(x.text), 0); });
  if ((d.skills || []).length) n += 2 + ln(d.skills.join(", "));
  return Math.max(1, Math.ceil(n / 46));
}
/* a running page header from an imported CV must never print inside an entry */
const noRunning = (t) => String(t == null ? "" : t).replace(/\s*(?:[A-Z][\w'’-]*\s+){0,7}[A-Z][\w'’-]*,\s*(?:Curriculum Vitae|CV|Resume)\b[^.]{0,40}\.?\s*Page \d+ of \d+\.?/g, "");
/* CV_Name_Company_November2026: the name a saved PDF or Word file takes */
const fileTag = (s, n = 4) => String(s || "").replace(/['’]/g, "").replace(/[^\p{L}\p{N}-]+/gu, " ").trim().split(" ").slice(0, n).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const fileName = (kind, name, org, designed) => [{ cv: "CV", resume: "Resume", letter: "CoverLetter", master: "CV" }[kind], fileTag(String(name || "").split(/\s+(?:bin|binte|binti|bte|bt|s\/o|d\/o)\s+/i)[0], 6), org ? fileTag(org) : "Master", designed ? "Designed" : "", new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Singapore" }).replace(" ", "")].filter(Boolean).join("_");
const photoFor = (b, k) => (b && b.photo && b.photo[k] && k !== "letter" && ctx && ctx.photo ? ctx.photo() : null);
/* Loadout: a look changes how a document appears, not its words. Sidebar moves sections and can scramble in hiring systems, so it stays for people only. */
// 2.45.0 Executive (replaces Timeline): eight tested pairs, a main colour and an accent; white on the main colour is at least 9:1,
// the accent on the main colour at least 4.5:1. A look stores the main colour; the accent comes from this list.
const EXEC_PAIRS = [["Navy", "#12283F", "#2BB3A6"], ["Forest", "#06432C", "#3FD08A"], ["Burgundy", "#5E1F2B", "#E7A65A"], ["Charcoal", "#26292E", "#F2B134"], ["Royal", "#1F3A93", "#7FB2FF"], ["Plum", "#3E2352", "#C9A0DC"], ["Petrol", "#0B4F57", "#F4C95D"], ["Slate", "#2F3E46", "#84D2C5"]];
const execAccent = (c) => (EXEC_PAIRS.find((p) => p[1] === c) || EXEC_PAIRS[0])[2];
const LOOK_COLOURS = ["#111111", "#06432C", "#8A5A2B", "#1F3350", "#7A2E3A", "#4A4FA3"], LOOK_FONTS = [["Arial", "Arial"], ["Georgia", "Georgia"], ["Verdana", "Verdana"], ["Trebuchet MS", "Trebuchet"]];
const STOCK = { classic: { name: "Classic", sub: "Today's plain style", base: "classic", accent: "#111111", font: "Arial", heading: "plain", spacing: "standard", photo: false }, clean: { name: "Clean", sub: "Colour headings", base: "clean", accent: "#06432C", font: "Arial", heading: "bar", spacing: "standard", photo: false }, executive: { name: "Executive", sub: "Masthead and banners", base: "executive", accent: "#12283F", font: "Arial", heading: "bar", spacing: "standard", photo: false }, sidebar: { name: "Sidebar", sub: "Two columns", base: "sidebar", accent: "#8A5A2B", font: "Arial", heading: "plain", spacing: "standard", photo: true } };
const cleanLook = (o) => { const x = o || {}, b0 = x.base === "timeline" ? "executive" : x.base, base = STOCK[b0] ? b0 : "classic", S0 = STOCK[base], cols = base === "executive" ? EXEC_PAIRS.map((p) => p[1]) : LOOK_COLOURS; return { base, accent: cols.includes(x.accent) ? x.accent : S0.accent, font: LOOK_FONTS.some((f) => f[0] === x.font) ? x.font : S0.font, heading: ["plain", "bar"].includes(x.heading) ? x.heading : S0.heading, spacing: ["tight", "standard", "airy"].includes(x.spacing) ? x.spacing : S0.spacing, photo: x.photo === undefined ? S0.photo : !!x.photo }; };
const looksSafe = (l) => l.base !== "sidebar";
const lookBadge = (l) => (looksSafe(l) ? `<span class="lo-bd ok">✓ Passed our text check</span>` : `<span class="lo-bd wn">! For people only</span>`);
const savedLooks = () => (state.looks && Array.isArray(state.looks.list) ? state.looks.list : []);
function lookById(id) { if (STOCK[id]) return Object.assign({ id, name: STOCK[id].name }, cleanLook(STOCK[id])); const x = savedLooks().find((l) => l.id === id); return x ? Object.assign({ id: x.id, name: x.name }, cleanLook(x)) : null; }
/* 2.45.0 Executive: masthead (name, headline, contact), banner headings, tinted cards for skills and roles, and one line per
   entry for education, certifications, awards and publications with the year first. The words are the same as every other
   design; the only rearrangement is the year moving to the front. The text keeps reading order: each heading comes before
   its content, list markers are the browser's own, and there are no tables or positioned layers. */
function yearFirst(t) { const m = String(t || "").match(/^(.*?)[,(\s]+((?:19|20)\d\d(?:\s*(?:-|–|to)\s*(?:(?:19|20)\d\d|present))?)\)?\.?$/i); return m && m[1].trim() ? [m[2], m[1].trim()] : ["", String(t || "")]; }
function execDoc(d, kind, photo) {
  const c = d.contact || {}, L = [];
  L.push(`<div class="cvh${photo ? " wp" : ""}">${photo ? `<img class="cvp" src="${esc(photo)}" alt="">` : ""}<div class="nm">${esc(d.name || "Your name")}</div>${d.headline ? `<div class="tg">${esc(d.headline)}</div>` : ""}<div class="cl">${esc([c.location, c.email, c.phone, c.links].filter(Boolean).join(" | "))}</div></div><div class="bd">`);
  if (d.summary) L.push(`<div class="h">Profile</div><p${d.summaryUnsourced ? ' class="uns"' : ""}>${esc(d.summary)}</p>`);
  if ((d.skills || []).length) L.push(`<div class="h">Skills</div>${d.skills.join(", ").split(/,\s+(?=[\p{L}][\p{L}\p{N} &\/-]*:\s)/u).map((g) => { const i = g.indexOf(": "); return i > 0 && i < 60 ? `<div class="cp"><b>${esc(g.slice(0, i))}</b> ${esc(g.slice(i + 2))}</div>` : `<div class="cp">${esc(g)}</div>`; }).join("")}`);
  if ((d.experience || []).length) L.push(`<div class="h">Experience</div>` + d.experience.map((r) => `<div class="ro"><div class="rl"><b>${esc(r.title || "")}${r.org ? ", " + esc(r.org) : ""}</b> <span>${esc([r.start, r.end].filter(Boolean).join(" to "))}</span></div>${r.location ? `<div class="lc">${esc(r.location)}</div>` : ""}<ul>${(r.bullets || []).filter((b) => hasText(b.text)).map((b) => `<li${b.unsourced ? ' class="uns" title="Figure not found in your CV: confirm it"' : ""}>${esc(b.text)}</li>`).join("")}</ul></div>`).join(""));
  for (const [k, lab] of [["education", "Education"], ["certifications", "Certifications"], ["awards", "Awards"], ["publications", "Publications"]]) if ((d[k] || []).some((x) => hasText(x.text))) L.push(`<div class="h">${lab}</div>${d[k].filter((x) => hasText(x.text)).map((x) => { const [y, rest] = yearFirst(noRunning(x.text)); return `<div class="yl"><span class="y">${esc(y)}</span> ${esc(rest)}</div>`; }).join("")}`);
  if (kind === "cv" && (d.referees || []).some((x) => hasText(x.text))) L.push(`<div class="h">Referees</div>${d.referees.filter((x) => hasText(x.text)).map((x) => `<p>${esc(x.text)}</p>`).join("")}`);
  return L.join("") + "</div>";
}
function docHTML(d, kind, photo, look) {
  if (!d) return '<div class="sx-a4"><p class="sx-ph">Nothing to preview yet.</p></div>';
  const c = d.contact || {}, L = [];
  L.push(`<div class="cvh${photo ? " wp" : ""}">${photo ? `<img class="cvp" src="${esc(photo)}" alt="">` : ""}<div class="nm">${esc(d.name || "Your name")}</div><div class="cl">${esc([c.location, c.email, c.phone, c.links].filter(Boolean).join(" | "))}</div></div>`);
  if (d.headline || d.summary) L.push(`<div class="h">Profile</div>${d.headline ? `<p><b>${esc(d.headline)}</b></p>` : ""}${d.summary ? `<p${d.summaryUnsourced ? ' class="uns"' : ""}>${esc(d.summary)}</p>` : ""}`);
  if ((d.experience || []).length) L.push(`<div class="h">Experience</div>` + d.experience.map((r) => `<div class="ro"><div class="rl"><b>${esc(r.title || "")}${r.org ? ", " + esc(r.org) : ""}</b><span>${esc([r.start, r.end].filter(Boolean).join(" to "))}</span></div>${r.location ? `<div class="lc">${esc(r.location)}</div>` : ""}<ul>${(r.bullets || []).filter((b) => hasText(b.text)).map((b) => `<li${b.unsourced ? ' class="uns" title="Figure not found in your CV: confirm it"' : ""}>${esc(b.text)}</li>`).join("")}</ul></div>`).join(""));
  for (const [k, lab] of [["education", "Education"], ["certifications", "Certifications"], ["awards", "Awards"], ["publications", "Publications"]]) if ((d[k] || []).some((x) => hasText(x.text))) L.push(`<div class="h">${lab}</div>${d[k].filter((x) => hasText(x.text)).map((x) => `<p>${esc(noRunning(x.text))}</p>`).join("")}`);
  if ((d.skills || []).length) L.push(`<div class="h">Skills</div>${d.skills.join(", ").split(/,\s+(?=[\p{L}][\p{L}\p{N} &\/-]*:\s)/u).map((s) => `<p>${esc(s)}</p>`).join("")}`);
  if (kind === "cv" && (d.referees || []).some((x) => hasText(x.text))) L.push(`<div class="h">Referees</div>${d.referees.filter((x) => hasText(x.text)).map((x) => `<p>${esc(x.text)}</p>`).join("")}`);
  if (look && look.base !== "classic") {
    const st = `--lk:${look.accent};--lkf:'${look.font}',Arial,sans-serif`, cls = `sx-a4 lk lk-${look.base} hd-${look.heading} sp-${look.spacing}`;
    // 2.35.0 the side panel holds the facts (contact, skills one per line, education, certifications); the main column holds the name, profile and experience
    if (look.base === "sidebar") { const hit = (t) => L.find((x) => x.includes(`<div class="h">${t}</div>`)) || "", side = ["Education", "Certifications"].map(hit), keep = L.slice(1).filter((x) => x !== hit("Skills") && !side.includes(x)); return `<div class="${cls}" style="${st}"><div class="lk-s">${photo ? `<img class="lkp" src="${esc(photo)}" alt="">` : ""}<div class="h">Contact</div>${[c.location, c.email, c.phone, c.links].filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}${(d.skills || []).length ? `<div class="h">Skills</div><ul class="lk-sk">${d.skills.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${side.join("")}</div><div class="lk-m"><div class="nm">${esc(d.name || "Your name")}</div>${keep.join("")}</div></div>`; }
    if (look.base === "executive") return `<div class="${cls}" style="${st};--lk2:${execAccent(look.accent)}">${execDoc(d, kind, photo)}</div>`;
    return `<div class="${cls}" style="${st}">${L.join("")}</div>`;
  }
  return `<div class="sx-a4${look ? ` lk lk-classic sp-${look.spacing}` : ""}"${look ? ` style="--lk:#000;--lkf:'${look.font}',Arial,sans-serif"` : ""}>${L.join("")}</div>`;
}
// 2.38.0: the signature, when switched on for this letter, sits above the typed name (the name stays as text)
const signFor = (b) => (b && b.sign && b.sign.letter && ctx && ctx.sign ? ctx.sign() : null);
function letterHTML(l, d, sig) {
  if (!l) return '<div class="sx-a4"><p class="sx-ph">Nothing to preview yet.</p></div>';
  const c = (d && d.contact) || {};
  return `<div class="sx-a4 lt"><div class="nm sm">${esc((d && d.name) || "")}</div><div class="cl">${esc([c.email, c.phone].filter(Boolean).join(" | "))}</div>
  <p>${esc(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</p><p>${esc(l.to || "")}</p><p>${esc(l.greeting || "")}</p>
  ${(l.paragraphs || []).map((x, i) => `<p${(l.unsourced || [])[i] ? ' class="uns" title="Figure not found in your CV: confirm it"' : ""}>${esc(x)}</p>`).join("")}<p>${esc(l.closing || "Yours sincerely")},</p>${sig ? `<img class="sgi" src="${esc(sig)}" alt="Signature">` : ""}<p class="sg">${esc((d && d.name) || "")}</p></div>`;
}
function hubHead() {
  return `<div class="sx-bar"><img class="sx-av" src="icons/stuart.svg" alt=""><div class="sx-t"><h1>Stuart</h1><p>Your career assistant. Stuart drafts, you decide and send.</p></div></div>`
    + `<div class="sx-tabs sx-tabs--ic" role="tablist" aria-label="Stuart">${TABS.filter(([k]) => k !== "loadout" || crLive()).map(([k, l]) => `<button type="button" role="tab" data-stu="tab" data-k="${k}" aria-selected="${state.tab === k}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${TAB_ICO[k]}</svg>${l}</button>`).join("")}</div>`;
}
const buildOf = (id) => state.builds.find((b) => b.jobId === id || b.id === id);
function buildStatus(j) {
  const b = buildOf(j.id); if (!b) return ["Not started", ""];
  if (b.saved) return ["Saved", "ok"];
  return (b.questions || []).length ? ["Ready · " + b.questions.length + " questions", "warn"] : ["Ready for review", "ok"];
}
const loS = () => (state.lo = state.lo || { screen: "home", pick: "classic", tab: "colour", draft: null, id: "", name: "", makeDefault: false });
const hasPhoto = () => !!(ctx && ctx.photo && ctx.photo());
const lookDoc = (l) => docHTML(state.cv, "cv", l.photo && hasPhoto() ? ctx.photo() : null, l);
function viewLoadout() {
  if (!state.cv) return `<section class="card sx-c"><h2 class="sx-k">Loadout</h2><p class="sx-sp">Set up your CV in Writer first. Your looks are shown with your own CV.</p><div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="tab" data-k="cv">Open Writer</button></div></section>`;
  const S = loS();
  if (S.screen === "edit" && S.draft) return loEdit(S);
  if (S.screen === "save" && S.draft) return loSave(S);
  const card = (k) => { const l = cleanLook(STOCK[k]); return `<button type="button" class="lo-c${S.pick === k ? " on" : ""}" data-stu="lo-pick" data-k="${k}" aria-pressed="${S.pick === k}"><span class="lo-th" aria-hidden="true"><span class="lo-sc">${lookDoc(l)}</span></span><span class="lo-t"><b>${STOCK[k].name}</b><small>${STOCK[k].sub}</small>${lookBadge(l)}</span></button>`; };
  const mine = savedLooks(), defId = (state.looks || {}).defaultId;
  return `<div class="lo"><div class="lo-l">Stock looks</div><div class="lo-g">${Object.keys(STOCK).map(card).join("")}</div>
    <div class="lo-foot"><button type="button" class="btn sx-b" data-stu="lo-edit">Customise this look</button></div>
    <p class="lo-n">Your words stay in Writer; only the look changes. Passed our text check means that, in our own test of this layout, the text came out in the right order. Real hiring systems can still differ, so every job keeps a plain copy.</p>
    <div class="lo-l">My loadouts</div>${mine.length ? `<div class="lo-gr">${mine.map((x) => `<button type="button" class="lo-r" data-stu="lo-open" data-id="${esc(x.id)}"><span><b>${esc(x.name)}</b><small>${esc(STOCK[cleanLook(x).base].name)}${x.id === defId ? " · Used by default" : ""}</small></span><span aria-hidden="true">›</span></button>`).join("")}</div>` : `<p class="lo-n">None yet. Customise a look and save it.</p>`}</div>`;
}
function loEdit(S) {
  const l = cleanLook(S.draft), safe = looksSafe(l), tab = (k, t) => `<button type="button" role="tab" class="${S.tab === k ? "on" : ""}" aria-selected="${S.tab === k}" data-stu="lo-tab" data-k="${k}">${t}</button>`;
  const sel = (id, lab, cur, opts) => `<label class="lo-rr"><span>${lab}</span><select id="${id}" class="pv-sel" aria-label="${lab}">${opts.map((o) => `<option value="${o[0]}"${cur === o[0] ? " selected" : ""}>${o[1]}</option>`).join("")}</select></label>`;
  const panel = S.tab === "colour" && l.base === "executive" ? `<div class="lo-sw lo-pr" role="group" aria-label="Colours">${EXEC_PAIRS.map(([n, a, b]) => `<button type="button" class="${l.accent === a ? "on" : ""}" style="--a:${a};--b:${b}" data-stu="lo-col" data-c="${a}" aria-label="${n}" aria-pressed="${l.accent === a}"><span><i></i></span><small>${n}</small></button>`).join("")}</div>`
    : S.tab === "colour" ? `<div class="lo-sw" role="group" aria-label="Colour">${LOOK_COLOURS.map((c) => `<button type="button" class="${l.accent === c ? "on" : ""}" style="background:${c}" data-stu="lo-col" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${l.accent === c}"></button>`).join("")}</div>`
    : S.tab === "font" ? sel("lo-font", "Font", l.font, LOOK_FONTS)
    : S.tab === "layout" ? sel("lo-base", "Layout", l.base, Object.keys(STOCK).map((k) => [k, STOCK[k].name])) + (l.base === "sidebar" || l.base === "classic" || l.base === "executive" ? "" : sel("lo-head", "Headings", l.heading, [["plain", "Plain"], ["bar", "Bar under"]])) + sel("lo-space", "Spacing", l.spacing, [["tight", "Tight"], ["standard", "Standard"], ["airy", "Roomy"]])
    : hasPhoto() ? `<label class="lo-rr"><span>Include my photo</span><input type="checkbox" class="pv-sw" id="lo-photo"${l.photo ? " checked" : ""}></label>` : `<p class="lo-n">Add a photo in Settings, under Account, to use it here.</p>`;
  return `<div class="lo"><button type="button" class="sx-back lo-bk" data-stu="lo-home">${ICO.back}Loadout</button><div class="lo-hd"><div><b>${S.id ? esc(S.name) : "Customise"}</b><small>Based on ${STOCK[l.base].name}</small></div></div>
    <div class="lo-pv"><div class="lo-pvi">${lookDoc(l)}</div></div>
    <div class="lo-mt"><div class="lo-mh">${lookBadge(l)}<small>${safe ? "Hiring systems can still differ" : "Two columns can scramble in hiring systems"}</small></div></div>
    ${safe ? "" : `<div class="lo-warn"><b>Good for a person, risky for a portal.</b><span>Each job keeps a plain copy, ready for any portal.</span></div>`}
    <div class="lo-tabs" role="tablist" aria-label="Customise">${tab("colour", "Colour")}${tab("font", "Font")}${tab("layout", "Layout")}${tab("photo", "Photo")}</div><div class="lo-pn">${panel}</div>
    <div class="lo-foot"><button type="button" class="btn sx-b" data-stu="lo-save0">${safe ? "Save loadout" : "Save for people only"}</button>${safe ? "" : `<button type="button" class="btn btn--ghost sx-b" data-stu="lo-switch">Switch to Executive</button>`}${S.id ? `<button type="button" class="btn btn--ghost sx-b" data-stu="lo-del">Delete this loadout</button>` : ""}</div></div>`;
}
function loSave(S) {
  const l = cleanLook(S.draft);
  return `<div class="lo"><button type="button" class="sx-back lo-bk" data-stu="lo-edit-back">${ICO.back}Customise</button><div class="lo-hd"><div><b>Save loadout</b></div></div>
    <label class="sx-f"><span>Name</span><input id="lo-name" maxlength="40" value="${esc(S.name)}" placeholder="For example, Networking build"></label>
    <div class="lo-sum"><span class="lo-th" aria-hidden="true"><span class="lo-sc">${lookDoc(l)}</span></span><div><b>${STOCK[l.base].name}</b><small>${esc(LOOK_FONTS.find((f) => f[0] === l.font)[1])}, ${l.spacing === "airy" ? "roomy" : l.spacing} spacing${l.photo ? ", photo on" : ""}</small>${lookBadge(l)}</div></div>
    <label class="lo-rr"><span>Use by default for every job</span><input type="checkbox" class="pv-sw" id="lo-def"${S.makeDefault ? " checked" : ""}></label>
    <p class="lo-n" id="lo-msg" role="status"></p><div class="lo-foot"><button type="button" class="btn sx-b" data-stu="lo-save">Save</button>${S.id ? `<button type="button" class="btn btn--ghost sx-b" data-stu="lo-del">Delete this loadout</button>` : ""}</div></div>`;
}
async function looksWrite(next) { state.looks = next; if (ctx.mode === "local") return; await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "looks"), next); }
/* ---------- 2.33.0 Credits and what's coming. The balance is held and spent only on the server (stuartCredits) ---------- */
const crLive = () => !!(state.cr && state.cr.live);
const crOwner = () => !!(state.cr && state.cr.owner);
const crOpen = (jobId, id) => crOwner() || !!((state.cr && state.cr.unlocks) || {})[jobId + "_" + id];
async function creditsLoad() {
  if (ctx.mode === "local") { state.cr = state.cr || { live: true, balance: 20, unlocks: {}, log: [], cost: { design: 2 }, gift: true }; return; }
  try { state.cr = (await callables.stuartCredits({ action: "status" })).data; render(); } catch (e) { state.cr = state.cr || { live: false }; }
}
function crLocked(l, jobId, portal) {
  const c = state.cr, n = c.balance || 0, cost = (c.cost || {}).design || 2;
  return `<div class="cx-lob">${lookBadge(l)}</div>${state.cv ? `<div class="lo-pv cr-pv"><div class="lo-pvi">${lookDoc(l)}</div><span class="cr-wm" aria-hidden="true">PREVIEW</span></div>` : ""}<button type="button" class="btn sx-b sx-full cr-go" ${n >= cost ? `data-stu="cr-unlock"` : "disabled"}>${n >= cost ? `Unlock this design · ${cost} credits` : "Get credits: coming soon"}</button><p class="sx-sp sm cr-c">You have ${n} ${n === 1 ? "credit" : "credits"}. ${portal ? "This advertisement goes through a portal, so send the plain copy above. It stays free." : "Your plain copies above stay free and ready for any portal."}</p>`;
}
const SOON = { voice: ["Talk to Stuart", "Practise out loud and hear feedback", "Practise out loud and hear Stuart’s feedback. We’ll tell you as soon as it’s ready.", ""], video: ["Video coach", "Practise face to face with Stuart", "Practise face to face with Stuart and see how you come across. We’ll tell you as soon as it’s ready.", "icons/stuart-coach.jpg"] , search: ["Search", "Find jobs and bring them in", "Open the job portals with your roles filled in, then save a job or hand it to Stuart in one tap. We’ll tell you as soon as it’s ready.", ""] };
const soonTag = `<span class="cr-soon">Coming soon</span>`;
const notified = (k) => !!(((state.profile || {}).notify || {})[k] || (state.demoNotify || {})[k]);
// 2.35.2 What's coming: one row of round icons, name underneath; each opens its Coming soon sheet
const SOON_ICO = { voice: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>' };
function comingCard() {
  if (!crLive() || (state.profile || {}).comingHidden || state.demoComing) return "";
  return `<section class="card cr-coming"><div class="cr-cmh"><b>What’s coming</b><button type="button" class="sx-pvx" data-stu="cr-coming-x" aria-label="Dismiss">${ICO.x}</button></div><div class="cr-cmg">${Object.keys(SOON).map((k) => `<button type="button" class="cr-cmi" data-stu="cr-soon" data-k="${k}"><span class="cr-ci" aria-hidden="true"><svg viewBox="0 0 24 24">${SOON_ICO[k]}</svg><span class="cr-cb">Soon</span></span><span class="cr-cl">${SOON[k][0]}</span></button>`).join("")}</div></section>`;
}
function prChoices() {
  if (!crLive()) return "";
  return `<div class="cr-opts"><div class="card cr-opt on"><span class="cr-ot"><b>Type</b><small>Answer in writing and get feedback</small></span></div>${["voice", "video"].map((k) => `<button type="button" class="card cr-opt" data-stu="cr-soon" data-k="${k}"><span class="cr-ot"><b>${SOON[k][0]}</b><small>${SOON[k][1]}</small></span>${soonTag}</button>`).join("")}</div>`;
}
function soonHTML() {
  const k = state.soon, x = k && SOON[k]; if (!x) return "";
  const on = notified(k);
  return `<div class="cr-scrim" data-stu="cr-soon-x"></div><div class="cr-sheet" role="dialog" aria-modal="true" aria-label="${x[0]}">${x[3] ? `<img class="cr-coach" src="${x[3]}" alt="">` : ""}${soonTag}<b>${x[0]}</b><p>${x[2]}</p><button type="button" class="btn sx-b sx-full" data-stu="cr-notify" data-k="${k}"${on ? " disabled" : ""}>${on ? "We’ll tell you" : "Notify me"}</button><button type="button" class="sx-lk cx-skip" data-stu="cr-soon-x">${on ? "Close" : "Not now"}</button></div>`;
}
function lookCard(b) {
  if (!crLive()) return "";
  const j = state.jobs.find((x) => x.id === b.jobId), f = (j && j.facts) || {}, id = b.lookId !== undefined ? b.lookId : (state.looks || {}).defaultId || "", l = id ? lookById(id) : null;
  const opts = [["", "None"]].concat(Object.keys(STOCK).filter((k) => k !== "classic").map((k) => [k, STOCK[k].name]), savedLooks().map((x) => [x.id, x.name]));
  const portal = /portal|workday|successfactors|careers@gov/i.test([(f.apply || {}).method, f.channel].join(" "));
  return `<section class="card cx-loc"><label class="cx-pht"><span><b>Designed copy</b><small>A second look, with the same words</small></span><select id="lo-job" class="pv-sel" aria-label="Designed copy">${opts.map((o) => `<option value="${esc(o[0])}"${id === o[0] ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>${l && !crOpen(b.jobId, id) ? crLocked(l, b.jobId, portal) : l ? `<div class="cx-lob">${lookBadge(l)}<div class="cx-lob2"><button type="button" class="btn btn--ghost sx-b sm" data-stu="print-look" data-kind="cv">CV PDF</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="print-look" data-kind="resume">Resume PDF</button></div></div><p class="sx-sp sm">${crOwner() ? "" : "Unlocked for this job. "}${portal ? "This advertisement goes through a portal, so send the plain copy above." : "Our text check is our own test, and hiring systems can differ, so the plain copies above stay ready for any portal."} Designed copies can run longer than the page limits, so check the length.</p>` : ""}</section>`;
}
function viewHub() {
  const t = state.tab;
  const P = state.profile || {};
  const plan = `<button type="button" class="sx-back" data-stu="tab" data-k="home">${ICO.back}Stuart</button>` + (!P.profile ? `<section class="card sx-c"><h2 class="sx-k">Your plan</h2><p class="sx-sp">Add your CV first (Writer); Stuart drafts the plan from it.</p></section>`
    : !P.intention ? viewIntention() : viewPlan(!state.plan).replace('data-stu="home"', 'data-stu="tab" data-k="home"'));
  const body = t === "cv" ? viewBuilder() : t === "loadout" && crLive() ? viewLoadout() : t === "plan" ? plan : comingCard() + viewHome();
  return hubHead() + body;
}
/* CV builder */
function secItems(c, k) { return k === "skills" ? null : (c[k] || []); }
function viewBuilder() {
  const c = draft();
  if (state.ivOpen) return viewInterview();
  if (state.qk && state.cv) return viewQuick();
  if (!c) return `<section class="card sx-c"><h2 class="sx-k">${ICO.doc} CV builder</h2><p class="sx-sp">Choose how to start your master CV. Nothing is saved until you press Save.</p>${startChoices()}${busyLine()}${errLine()}</section>`;
  const k = state.cvSec, st = cvStats(c);
  const secs = `<nav class="card sx-secs" aria-label="CV sections"><h2 class="sx-k">Sections</h2>${SECS.map(([key, lab]) => `<button type="button" class="sx-sec" data-stu="sec" data-k="${key}" aria-pressed="${k === key}"><span>${lab}</span><i class="sx-sd ${secDone(c, key) ? "done" : key === "referees" ? "off" : "todo"}" aria-label="${secDone(c, key) ? "Done" : "Empty"}"></i></button>`).join("")}</nav>`;
  // 2.46.1 one card: the documents you can make now, with the master CV's status (version in a pill) and its tools.
  // 2.46.2 on a computer the status and tools run along the top and the documents sit below as rows; on a phone the documents come first
  const tools = `<div class="wr-rows"><button type="button" class="wr-row" data-stu="cvchk">${ICO.check}<span>Check for repeats</span>${ICO.chev}</button><button type="button" class="wr-row" data-stu="iv-open">${ICO.spark}<span>Build from scratch</span>${ICO.chev}</button><label class="wr-row" title="Stuart reads a PDF, Word or text file and replaces this master CV; you review before saving">${ICO.up}<span>Replace from a file</span>${ICO.chev}<input type="file" id="stu-cv" accept=".pdf,.docx,.txt,.md,application/pdf" hidden></label></div>`;
  const save = `<section class="card wr${state.cv ? " two" : ""}${state.cvDirty ? " dirty" : ""}" aria-label="Writer">${state.cv ? quickCard() : ""}<div class="wr-s"><div class="sx-st0">${state.cvDirty ? cvDirtyHTML(c) : `<div class="wr-st"><i></i><b>Master CV</b><span>Saved</span><em class="wr-v">Version ${esc(c.version || "1.0")}</em></div>`}</div>${tools}</div></section>`;
  const pv = `<section class="sx-pv${state.pvOpen ? " open" : ""}" aria-label="Preview"><div class="sx-pvh"><span>Preview · Clean template</span><span class="sx-pc ${st.pages > 6 ? "warn" : "ok"}" id="sx-pages">about ${st.pages} of 6 pages</span><button type="button" class="sx-pvx" data-stu="pv" aria-label="Close preview">${ICO.x}</button></div><div id="sx-pvb">${docHTML(c, "cv")}</div>
    <div class="sx-pva"><button type="button" class="btn btn--ghost sx-b sm" data-stu="print" data-kind="master">${ICO.dl}PDF</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="word" data-kind="master">${ICO.dl}Word</button></div></section>`;
  return `${save}${chkCard()}${rulesCard()}${factsCard()}${rulesSheet()}<div class="sx-bld">${secs}<section class="card sx-ed cved">${editorHTML(c, k)}${busyLine()}${errLine()}<button type="button" class="btn sx-b sx-pvbtn" data-stu="pv">Preview · about ${st.pages} of 6 pages</button></section>${pv}</div>`;
}
/* ---------- 2.46.0 Make a document: a CV, resume or cover letter with no job behind it. The general resume is written once per
   master CV version and kept ready (users/{uid}/cv/quick, written by stuartQuick); "Make it fit" takes one line about the reader.
   Sharing reuses the PDF and Word paths the job documents use, with the chosen loadout. ---------- */
const QK = { cv: ["CV", "Up to six pages, from your master CV."], resume: ["Resume", "Two pages, from your master CV."], letter: ["Cover letter", "One page. A letter needs a reader, so tell Stuart who."] };
const QK_ICO = { cv: ICO.doc, resume: '<svg class="ic" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h4"/></svg>', letter: '<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3 8 9 6 9-6"/></svg>', share: '<svg class="ic" viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>' };
// designs follow the credit rules: until quick sends have their own, only an account that already holds every design sees them here
const qkLooks = () => (crLive() ? [["", "Classic"]].concat(Object.keys(STOCK).filter((k) => k !== "classic").map((k) => [k, STOCK[k].name]), savedLooks().map((x) => [x.id, x.name])).filter(([id]) => !id || crOpen("_quick", id)) : []);
function qkLook() { const S = state.qk, id = S.lookId !== undefined ? S.lookId : (state.looks || {}).defaultId || ""; return id && crLive() && crOpen("_quick", id) ? lookById(id) : null; }
function qkDoc(k) { // what would be shared now
  const Q = state.quick || {}, S = state.qk, m = state.cv;
  if (k === "letter") return Q.lt && Q.lt.letter ? { d: Q.lt.letter, part: "lt", ver: Q.lt.masterVersion, forWho: Q.lt.context || "" } : null;
  if (S.src === "fit" && Q.fit && Q.fit[k]) return { d: Q.fit[k], part: "fit", ver: Q.fit.masterVersion, forWho: Q.fit.context || "" };
  if (k === "cv") return m ? { d: m, part: "", ver: m.version || "1.0", forWho: "" } : null;
  return Q.general && Q.general.resume ? { d: Q.general.resume, part: "general", ver: Q.general.masterVersion, forWho: "" } : null;
}
const qkHTML = (k, X, look) => (k === "letter" ? letterHTML(X.d, state.cv, null) : docHTML(X.d, k, look && look.photo && hasPhoto() ? ctx.photo() : null, look || undefined));
function quickCard() {
  return `<div class="wr-m"><h2 class="sx-k">Make a document</h2><p class="sx-sp sm">From your master CV${qkLooks().length > 1 ? ", in your loadout" : ""}. No job needed.</p><div class="qk-t">${["cv", "resume", "letter"].map((k) => `<button type="button" data-stu="qk-open" data-kind="${k}">${QK_ICO[k]}<b>${QK[k][0]}</b><span class="qk-cv" aria-hidden="true">${ICO.chev}</span></button>`).join("")}</div></div>`;
}
function viewQuick() {
  const S = state.qk, k = S.kind, Q = state.quick || {}, X = qkDoc(k), look = k === "letter" ? null : qkLook(), mv = String((state.cv || {}).version || "1.0"), L = k === "letter" ? [] : qkLooks();
  const stale = X && X.part && String(X.ver) !== mv;
  const flags = !X || !X.part ? 0 : k === "letter" ? (X.d.unsourced || []).filter(Boolean).length : (X.d.experience || []).reduce((n, r) => n + (r.bullets || []).filter((b) => b.unsourced).length, 0) + (X.d.summaryUnsourced ? 1 : 0);
  const chips = L.length > 1 ? `<section class="card sx-c"><h2 class="sx-k">Loadout</h2><div class="qk-ch">${L.map(([id, n]) => `<button type="button" class="chip" data-stu="qk-look" data-id="${esc(id)}" aria-pressed="${(look ? look.id : "") === id}">${esc(n)}</button>`).join("")}</div>${look ? `<div class="cx-lob">${lookBadge(look)}</div>` : ""}</section>` : "";
  const title = !X ? "" : X.forWho ? "For " + esc(X.forWho) : k === "cv" ? "Your full CV" : "General resume";
  const pv = X ? `<section class="card sx-c"><div class="qk-ph"><h2 class="sx-k">${title}</h2><button type="button" class="btn btn--ghost sx-b sm" data-stu="qk-review">${ICO.eye}${k === "letter" ? "Check and edit" : "Review"}</button></div><div class="lo-pv"><div class="lo-pvi">${qkHTML(k, X, look)}</div></div>
      ${stale ? `<p class="sx-sp sm qk-w">Made from CV version ${esc(X.ver)}. Your master CV is now version ${esc(mv)}. <button type="button" class="qk-lnk" data-stu="qk-make" data-again="1">Update it</button></p>` : ""}${flags ? `<p class="sx-sp sm qk-w">${flags} ${flags === 1 ? "figure" : "figures"} to confirm. Open ${k === "letter" ? "Check and edit" : "Review"} to see ${flags === 1 ? "it" : "them"} in amber.</p>` : ""}</section>`
    : k === "resume" ? `<section class="card sx-c"><h2 class="sx-k">General resume</h2><p class="sx-sp">Stuart writes it once from your master CV and keeps it ready for the next time someone asks. About a minute.</p><button type="button" class="btn sx-b sx-full" data-stu="qk-make">${ICO.spark}Make my resume</button></section>` : "";
  const src = k !== "letter" && Q.fit && Q.fit[k] ? `<div class="qk-ch"><button type="button" class="chip" data-stu="qk-src" data-v="general" aria-pressed="${S.src !== "fit"}">General</button><button type="button" class="chip" data-stu="qk-src" data-v="fit" aria-pressed="${S.src === "fit"}">For ${esc(String(Q.fit.context || "").slice(0, 40))}</button></div>` : "";
  const fit = k === "letter" ? "" : `<section class="card sx-c"><h2 class="sx-k">Make it fit (optional)</h2>${src}<input class="qk-in" id="qk-ctx" maxlength="300" value="${esc(S.ctx || "")}" placeholder="Who is it for? Role, organisation" aria-label="Who is it for"><button type="button" class="btn btn--ghost sx-b" data-stu="qk-make" data-fit="1">${ICO.spark}Fit it</button><p class="sx-sp sm">Leave empty for your general ${k === "cv" ? "CV" : "resume"}. Fitting takes about a minute and keeps to what your CV says.</p></section>`;
  const who = k !== "letter" ? "" : `<section class="card sx-c"><h2 class="sx-k">Who is it for</h2><input class="qk-in" id="qk-ctx" maxlength="300" value="${esc(S.ctx || "")}" placeholder="Role and organisation" aria-label="Who is it for"><textarea class="qk-in" id="qk-paste" rows="4" maxlength="6000" placeholder="Paste their message or the advertisement (optional)" aria-label="Their message or the advertisement">${esc(S.paste || "")}</textarea><button type="button" class="btn sx-b sx-full" data-stu="qk-make">${ICO.pen}${X ? "Write it again" : "Write the letter"}</button><p class="sx-sp sm">Stuart drafts, you check it, then share. About a minute.</p></section>`;
  const foot = X ? `<div class="qk-f"><button type="button" class="btn sx-b" data-stu="qk-pdf">${QK_ICO.share}${IOS ? "Share PDF" : "Download PDF"}</button><button type="button" class="btn btn--ghost sx-b" data-stu="qk-word">Word</button></div>${look ? `<p class="sx-sp sm">The loadout is in the PDF. Word copies are plain.</p>` : ""}<p class="sx-sp sm">After sharing: <button type="button" class="qk-lnk" data-stu="qk-app">Add as an application</button></p>` : "";
  const rv = S.review && X ? `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="${QK[k][0]}"><div class="sx-rvb card"><div class="sx-rvh"><b>${QK[k][0]}${X.forWho ? " · " + esc(X.forWho) : ""}</b><button type="button" class="sx-pvx" data-stu="qk-review-x" aria-label="Close">${ICO.x}</button></div>${k === "letter" ? `<div class="sx-lted">${(X.d.paragraphs || []).map((x, i) => `<label class="sx-f wide"><span>Paragraph ${i + 1}</span><textarea data-qlt="${i}" rows="4">${esc(x)}</textarea></label>`).join("")}<div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="qk-lt-save">Save letter</button></div></div>` : `<p class="sx-sp sm">To change the content, edit your master CV${X.part ? " and update this document" : ""}. Lines marked in amber hold a figure Stuart could not find in your CV.</p>`}${qkHTML(k, X, look)}</div></div>` : "";
  return `<div class="qk"><button type="button" class="sx-back lo-bk" data-stu="qk-back">${ICO.back}Writer</button><div class="lo-hd"><div><b>${QK[k][0]}</b><small>${QK[k][1]}</small></div></div>${who}${chips}${pv}${fit}${busyLine()}${errLine()}${foot}${rv}</div>`;
}
function demoQuick(k, context) { // local preview: no server, so the documents are cut from the sample CV
  const m = state.cv || {}, Q = (state.quick = state.quick || {}), ver = m.version || "1.0";
  const rs = () => ({ ...clone(m), referees: [], experience: (m.experience || []).slice(0, 3).map((r) => ({ ...r, bullets: (r.bullets || []).slice(0, 3) })) });
  if (k === "letter") Q.lt = { context, masterVersion: ver, letter: { to: "Hiring Manager", greeting: "Dear Hiring Manager,", closing: "Yours sincerely", unsourced: [false, false, false], paragraphs: ["Thank you for asking about my background. This is a sample letter in the preview.", "In my current role I lead a team across three clinics and have improved access for patients.", "I would welcome a conversation about how I could contribute."] } };
  else if (context) Q.fit = { context, masterVersion: ver, cv: clone(m), resume: rs() };
  else Q.general = { masterVersion: ver, resume: rs() };
}
const nextVer = (v) => { const m = String(v || "1.0").match(/^(\d+)\.(\d+)$/); return m ? m[1] + "." + (Number(m[2]) + 1) : "1.1"; };
const fld = (path, label, val, o = {}) => `<label class="sx-f${o.wide ? " wide" : ""}"><span>${label}</span>${o.area ? `<textarea data-cv="${path}" rows="${o.rows || 3}">${esc(val)}</textarea>` : `<input data-cv="${path}" value="${esc(val)}"${o.type ? ` type="${o.type}"` : ""} autocomplete="off">`}</label>`;
function editorHTML(c, k) {
  const lab = (SECS.find((x) => x[0] === k) || [])[1] || "";
  if (k === "contact") { const t = c.contact || {}; return `<h2 class="sx-k">${lab}</h2><div class="sx-fg">${fld("name", "Full name", c.name)}${fld("contact.email", "Email", t.email, { type: "email" })}${fld("contact.phone", "Phone", t.phone, { type: "tel" })}${fld("contact.location", "Location", t.location)}${fld("contact.links", "Links (for example LinkedIn)", t.links, { wide: true })}</div><p class="sx-sp sm">Only what you type here goes on the CV. Leave out identification numbers and your home address.</p>`; }
  if (k === "summary") return `<h2 class="sx-k">${lab}</h2><div class="sx-fg">${fld("headline", "Headline", c.headline, { wide: true })}${fld("summary", "Summary", c.summary, { area: true, rows: 5, wide: true })}</div>${c.headlineUnsourced || c.summaryUnsourced ? `<span class="sx-unsf">The ${c.headlineUnsourced && c.summaryUnsourced ? "headline and summary contain" : c.headlineUnsourced ? "headline contains" : "summary contains"} a figure that is not in your answers or CV. Check it; editing clears this warning.</span>` : ""}${suggHTML("summary", null)}<button type="button" class="btn btn--ghost sx-b sm" data-stu="improve" data-sec="summary">${ICO.spark}Improve with Stuart</button>`;
  if (k === "skills") return `<h2 class="sx-k">${lab}</h2><div class="sx-fg">${fld("skills", "Skills, separated by commas", (c.skills || []).join(", "), { area: true, rows: 4, wide: true })}</div>`;
  if (k === "experience") {
    const ex = c.experience || [], i = Math.min(state.cvItem, Math.max(0, ex.length - 1)), r = ex[i];
    const chips = `<div class="sx-roles" role="group" aria-label="Roles">${ex.map((x, n) => `<button type="button" data-stu="role" data-i="${n}" aria-pressed="${n === i}">${esc(x.title || "Untitled role")}${x.org ? `<span>${esc(x.org)}</span>` : ""}</button>`).join("")}<button type="button" class="sx-add" data-stu="role-add">${ICO.plus}Add a role</button></div>`;
    if (!r) return `<h2 class="sx-k">${lab}</h2>${chips}`;
    return `<h2 class="sx-k">${lab} · ${i + 1} of ${ex.length}</h2>${chips}
    <div class="sx-fg">${fld(`experience.${i}.title`, "Job title", r.title)}${fld(`experience.${i}.org`, "Organisation", r.org)}${fld(`experience.${i}.start`, "Start", r.start)}${fld(`experience.${i}.end`, "End (or present)", r.end)}${fld(`experience.${i}.location`, "Location", r.location, { wide: true })}</div>
    <h3 class="sx-k sm">Achievements and duties</h3><ul class="sx-bul">${(r.bullets || []).map((b, j) => `<li><textarea data-cv="experience.${i}.bullets.${j}.text" rows="2" aria-label="Bullet ${j + 1}">${esc(b.text)}</textarea>${b.unsourced ? `<span class="sx-unsf">Contains a figure that is not in your answers or CV. Check it; editing the line clears this warning.</span>` : ""}${b.src === "stuart" ? `<span class="sx-src">Reworded with Stuart${b.confirmed ? " · figure confirmed by you" : ""}</span>` : b.src === "cv" ? `<span class="sx-src">From your uploaded CV</span>` : b.src === "interview" ? `<span class="sx-src">From your interview answers</span>` : ""}<button type="button" class="sx-del" data-stu="bul-del" data-i="${i}" data-j="${j}" aria-label="Remove bullet ${j + 1}">${ICO.x}</button></li>`).join("")}</ul>
    <div class="sx-btns"><button type="button" class="sx-add" data-stu="bul-add" data-i="${i}">${ICO.plus}Add a bullet</button></div>
    ${suggHTML("experience", i)}
    <div class="sx-btns"><button type="button" class="btn btn--ghost sx-b sm" data-stu="improve" data-sec="experience" data-i="${i}">${ICO.spark}Improve this role with Stuart</button><button type="button" class="sx-lk" data-stu="role-del" data-i="${i}">Remove this role</button></div>`;
  }
  const items = c[k] || [];
  return `<h2 class="sx-k">${lab}</h2><ul class="sx-bul">${items.map((x, j) => `<li><input data-cv="${k}.${j}.text" value="${esc(x.text)}" aria-label="${lab} ${j + 1}" autocomplete="off"><button type="button" class="sx-del" data-stu="li-del" data-k="${k}" data-j="${j}" aria-label="Remove">${ICO.x}</button></li>`).join("")}</ul><div class="sx-btns"><button type="button" class="sx-add" data-stu="li-add" data-k="${k}">${ICO.plus}Add</button></div>${k === "referees" ? `<p class="sx-sp sm">Referees appear on the CV only, never on the resume. Ask each referee before you name them.</p>` : ""}`;
}
function suggHTML(sec, i) {
  const S = state.sugg; if (!S || S.sec !== sec || (sec === "experience" && S.i !== i)) return "";
  const live = S.items.filter((x) => !x.done); if (!live.length) return `<p class="sx-sp sm">No more suggestions for this part.</p>`;
  return `<div class="sx-sugs">${S.items.map((x, n) => x.done ? "" : `<div class="sx-sug"><div class="sx-sgh">${ICO.spark}Stuart suggests${sec === "summary" ? " · " + (x.field === "headline" ? "headline" : "summary") : x.index === -1 ? " · a new bullet" : ""}</div>${x.old ? `<s>${esc(x.old)}</s>` : ""}<div class="sx-nw">${esc(x.new)}</div>${x.why ? `<div class="sx-why">${esc(x.why)}</div>` : ""}${x.unsourced ? `<div class="sx-uns">Contains a figure that is not in your CV. Accept it only if it is true.</div>` : ""}
    <div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="sg-ok" data-n="${n}">Accept</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="sg-edit" data-n="${n}">Edit</button><button type="button" class="sx-lk" data-stu="sg-no" data-n="${n}">Keep mine</button></div></div>`).join("")}</div>`;
}
/* Your rules (2.20.0): users/{uid}/cv/rules { list, scan, decided }. Stuart reads a rule back before it is saved; the
   build follows the rules and the inspection checks every claim against them. Only the user changes them. */
const RT = { leave: ["Leave out", "x"], word: ["Word it as", "w"], opening: ["Opening", "w"], date: ["Date", "d"], ask: ["Ask first", "a"], note: ["Note", "n"] };
const RG = [["Leave out", ["leave"]], ["Wording", ["word", "opening", "note"]], ["Dates", ["date"]], ["Ask me first", ["ask"]]];
const rulesList = () => ((state.rules && state.rules.list) || []).filter((r) => r && RT[r.type]);
const ruleText = (r) => r.text || (r.type === "word" ? `"${r.use}", never "${r.avoid}"` : r.term || "");
const ruleTag = (type) => `<span class="ru-t ${RT[type][1]}">${RT[type][0]}</span>`;
function rulesCard() {
  const L = rulesList();
  const grp = RG.map(([h, ts]) => { const xs = L.filter((r) => ts.includes(r.type)); return xs.length ? `<h3 class="ru-g">${h}</h3>` + xs.map((r) => `<div class="ru-r">${ruleTag(r.type)}<p>${esc(ruleText(r))}${r.unless ? `<span>Unless you turn it on for one job</span>` : ""}</p><button type="button" class="ru-x" data-stu="ru-del" data-id="${esc(r.id)}" aria-label="Remove this rule">${ICO.x}</button></div>`).join("") : ""; }).join("");
  return `<section class="card sx-c ru"><h2 class="sx-k">Your rules${L.length ? " · " + L.length : ""}</h2><p class="sx-sp sm">Stuart follows these in every CV, resume and letter, and checks every document against them. Only you can change them.</p>
    ${grp || `<p class="sx-sp">No rules yet. Say one in your own words, such as "Leave out my volunteer coaching unless I ask".</p>`}<button type="button" class="btn sx-b sx-full" data-stu="ru-open">Add a rule</button></section>`;
}
/* 2.44.0 Check for repeats: Stuart lists lines that tell the same thing twice and lines that disagree. The user picks
   what goes; the changes land in the draft, so nothing is saved until Save. */
const cvKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9%$.]+/g, " ").trim();
function nearLineC(a, b) { // the same test the server uses (functions/index.js nearLine)
  const x = cvKey(a), y = cvKey(b); if (!x || !y) return false; if (x === y) return true;
  const A0 = new Set(x.split(" ")), B0 = new Set(y.split(" ")); let n0 = 0; A0.forEach((w) => { if (B0.has(w)) n0++; }); if (n0 / (A0.size + B0.size - n0) >= 0.8) return true;
  const A = new Set(x.split(" ").filter((w) => w.length > 2)), B = new Set(y.split(" ").filter((w) => w.length > 2)), [sm, lg] = A.size <= B.size ? [A, B] : [B, A];
  if (sm.size < 6) return false; let n = 0; sm.forEach((w) => { if (lg.has(w)) n++; }); return n / sm.size >= 0.8;
}
function chkCard() {
  const C = state.cvChk; if (!C) return "";
  const line = (l, tag, cls) => `<div class="ck-l ${cls || ""}"><span class="ck-t">${tag}</span><p>${esc(l.text)}<span>${esc(l.where)}</span></p></div>`;
  const reps = C.repeats.map((g, i) => `<div class="ck-g"><label class="sx-chk"><input type="checkbox" data-stu="ck-rep" data-i="${i}"${C.off[i] ? "" : " checked"}><span><b>Same thing ${g.ids.length === 2 ? "twice" : g.ids.length + " times"}</b>${g.why ? " · " + esc(g.why) : ""}</span></label>
      ${g.merged ? `<div class="ck-l keep"><span class="ck-t">Use</span><p>${esc(g.merged)}<span>Joined from the lines below</span></p></div>` + g.lines.map((l) => line(l, "Remove", "drop")).join("") : g.lines.map((l) => line(l, l.id === g.keep ? "Keep" : "Remove", l.id === g.keep ? "keep" : "drop")).join("")}</div>`).join("");
  const cons = C.conflicts.map((c, i) => { const pick = C.pick[i] || "both", rm = (l) => /^r/.test(l.id);
    return `<div class="ck-g"><p class="ck-q"><b>These disagree.</b> ${esc(c.issue)}</p>${c.lines.map((l) => line(l, l.id === "S" ? "Summary" : l.id === "H" ? "Headline" : pick === l.id ? "Remove" : "Line", pick === l.id ? "drop" : "")).join("")}
      <div class="sx-chips" role="radiogroup" aria-label="Which line goes">${c.lines.filter(rm).map((l, k) => `<button type="button" role="radio" data-stu="ck-pick" data-i="${i}" data-id="${esc(l.id)}" aria-checked="${pick === l.id}"${pick === l.id ? ' class="on"' : ""}>Remove ${c.lines.filter(rm).length > 1 ? (k ? "second" : "first") : "this"} line</button>`).join("")}<button type="button" role="radio" data-stu="ck-pick" data-i="${i}" data-id="both" aria-checked="${pick === "both"}"${pick === "both" ? ' class="on"' : ""}>Keep both</button></div>
      ${c.lines.some((l) => !rm(l)) ? `<p class="sx-sp sm">Change your ${c.lines.some((l) => l.id === "S") ? "summary" : "headline"} yourself under Headline and summary, so it matches.</p>` : ""}</div>`; }).join("");
  const none = !C.repeats.length && !C.conflicts.length;
  return `<section class="card sx-c ck" aria-label="Check for repeats"><h2 class="sx-k">Check for repeats</h2>
    ${none ? `<p class="sx-sp">No repeats and nothing that disagrees. Your master CV is clean.</p>` : `<p class="sx-sp sm">Stuart found ${C.repeats.length} ${C.repeats.length === 1 ? "repeat" : "repeats"} and ${C.conflicts.length} ${C.conflicts.length === 1 ? "pair" : "pairs"} of lines that disagree. Untick anything you want to keep as it is. Changes go into your draft; press Save to keep them.</p>
    ${reps ? `<h3 class="ru-g">Repeats</h3>${reps}` : ""}${cons ? `<h3 class="ru-g">Lines that disagree</h3>${cons}` : ""}`}
    <div class="cx-acts">${none ? "" : `<button type="button" class="btn sx-b sm" data-stu="ck-apply">${ICO.check}Apply to my draft</button>`}<button type="button" class="btn btn--ghost sx-b sm" data-stu="ck-x">Close</button></div></section>`;
}
function chkApply() {
  const C = state.cvChk; if (!C) return 0;
  const c = ensureDraft(); if (JSON.stringify(c.experience || []) !== C.sig) { state.err = "Your CV changed after the check. Run Check for repeats again."; render(); return -1; }
  const drop = new Set(), set = new Map();
  C.repeats.forEach((g, i) => { if (C.off[i]) return; if (g.merged) { set.set(g.keep, g.merged); } g.ids.forEach((k) => { if (k !== g.keep) drop.add(k); }); });
  C.conflicts.forEach((x, i) => { const p = C.pick[i]; if (p && p !== "both" && /^r\d+b\d+$/.test(p)) drop.add(p); });
  (c.experience || []).forEach((r, ri) => { r.bullets = (r.bullets || []).map((b, bi) => { const k = `r${ri}b${bi}`; return set.has(k) ? { text: set.get(k), src: "stuart" } : b; }).filter((b, bi) => !drop.has(`r${ri}b${bi}`)); });
  state.cvDirty = true; state.cvChk = null; render(); return drop.size;
}
/* 2.43.0 What you've told Stuart: answers to Stuart's questions, kept across jobs (users/{uid}/profile/facts) so
   Stuart does not ask again. The user corrects or removes each one here; Stuart reads them for every job. */
const factsList = () => ((state.facts || {}).items || []).filter((x) => x && x.q && x.a);
function factsCard() {
  const L = factsList(), dt = (d) => { const x = new Date(String(d || "") + "T00:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const row = (x) => state.faEdit === x.id
    ? `<div class="ru-r fa-r"><div class="fa-b"><b>${esc(x.q)}</b><textarea class="sx-inp fa-ta" id="fa-ta" rows="3" maxlength="1000" aria-label="Your answer">${esc(x.a)}</textarea><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="fa-save" data-id="${esc(x.id)}">${ICO.check}Save</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="fa-cancel">Cancel</button></div></div></div>`
    : `<div class="ru-r fa-r"><p><b>${esc(x.q)}</b>${esc(x.a)}<span>${esc(["Answered " + dt(x.at), x.org ? "for " + x.org : ""].filter(Boolean).join(" "))}</span></p><button type="button" class="ru-x" data-stu="fa-edit" data-id="${esc(x.id)}" aria-label="Change this answer">${ICO.pen}</button><button type="button" class="ru-x" data-stu="fa-del" data-id="${esc(x.id)}" aria-label="Remove this answer">${ICO.x}</button></div>`;
  return `<section class="card sx-c ru fa"><h2 class="sx-k">What you've told Stuart${L.length ? " · " + L.length : ""}</h2><p class="sx-sp sm">Your answers to Stuart's questions, kept so Stuart does not ask them again on your next job. Stuart reads them for every fit check and document. Change one when it is out of date.</p>
    ${L.length ? L.map(row).join("") : `<p class="sx-sp">Nothing yet. When you answer Stuart's questions before a build, your answers appear here.</p>`}</section>`;
}
async function factsWrite(items) {
  state.facts = Object.assign({}, state.facts, { items }); render();
  if (ctx.mode === "local") return true;
  try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "profile", "facts"), { items, updatedAt: ctx.FS.serverTimestamp() }); return true; }
  catch (e) { state.err = "Could not save your answers (" + (e.code || e.message) + ")."; render(); return false; }
}
function rulesSheet() {
  const S = state.ruSheet; if (!S) return "";
  const c = state.cv || {}, R = state.rules || {}, scan = R.scan, dec = R.decided || {};
  const rd = S.read, busy = S.busy ? `<p class="stu-busy"><span class="spin"></span>${esc(S.busy)}</p>` : "", err = S.err ? `<p class="lock__err" role="alert">${esc(S.err)}</p>` : "";
  const back = rd ? sayS(`<p>I'll read this as:</p>`) + `<div class="ru-rb"><div class="ru-r">${ruleTag(rd.type)}<p>${esc(ruleText(rd))}</p></div>${rd.unless ? `<div class="ru-r"><span class="ru-t n">Unless</span><p>${esc(rd.unlessShow || "You turn it on for one job, on that job's page")}</p></div>` : ""}${rd.term || rd.avoid ? `<div class="ru-r"><span class="ru-t n">Found in</span><p>${S.found && S.found.length ? "Your master CV: " + esc(S.found.join("; ")) : "Not in your master CV as written"}</p></div>` : ""}</div>
      <button type="button" class="btn sx-b sx-full" data-stu="ru-save">Save the rule</button><button type="button" class="sx-lk cx-ilk" data-stu="ru-edit">Change the wording</button>`
    : `<button type="button" class="btn sx-b sx-full" data-stu="ru-read"${S.busy ? " disabled" : ""}>Read it back</button>`;
  let conf;
  if (scan && String(scan.version) === String(c.version || "")) {
    const k = (scan.conflicts || []).find((x) => !dec[x.id]);
    conf = k ? sayS(`<p>${esc(k.question)}</p>`) + `<div class="ru-cf"><span>${esc(k.a.where)}</span>"${esc(k.a.text)}"</div><div class="ru-cf"><span>${esc(k.b.where)}</span>"${esc(k.b.text)}"</div>
      <div class="ru-two">${k.options.map((o, i) => `<button type="button" class="btn ${i ? "btn--ghost " : ""}sx-b" data-stu="ru-pick" data-k="${esc(k.id)}" data-o="${i}">${esc(o.label)}</button>`).join("")}</div><p class="sx-sp sm sx-c2">Your answer becomes a rule and corrects your master CV.</p>`
      : `<p class="sx-sp">Nothing else in your master CV (v${esc(c.version || "1.0")}) disagrees with itself.</p>`;
  } else conf = (c.experience || []).length ? `<p class="sx-sp sm">Stuart can read your CV for places that say two different things, such as 2019 in one place and 2018 in another.</p><button type="button" class="btn btn--ghost sx-b sx-full" data-stu="ru-scan"${S.busy ? " disabled" : ""}>Check my CV for things that disagree</button>` : "";
  return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Add a rule"><div class="sx-rvb card"><div class="sx-rvh"><b>Add a rule</b><button type="button" class="sx-pvx" data-stu="ru-x" aria-label="Close">${ICO.x}</button></div>
    <p class="sx-sp">Say it in your own words. Stuart reads it back before saving.</p>
    <textarea id="ru-text" class="ru-ta" rows="3" maxlength="500" placeholder="For example: never call me a generalist"${rd ? " readonly" : ""}>${esc(S.text || "")}</textarea>${back}${busy}${err}
    ${conf ? `<section class="ru-sec">${conf}</section>` : ""}</div></div>`;
}
// A wording rule corrects the master CV the same way the build does: whole words, case kept at the start.
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (p) => new RegExp("(^|[^A-Za-z0-9])(" + reEsc(String(p).trim()).replace(/\s+/g, "\\s+") + ")(?=$|[^A-Za-z0-9])", "gi");
const caseLike = (x, use) => /^[A-Z]/.test(x) ? use.charAt(0).toUpperCase() + use.slice(1) : /^[a-z]/.test(x) ? use.charAt(0).toLowerCase() + use.slice(1) : use;
function rewordCV(c, use, avoid) {
  let n = 0; const fx = (t) => { const s = String(t || ""), o = s.replace(phraseRe(avoid), (m, pre, x) => pre + caseLike(x, use)); if (o !== s) n++; return o; };
  c.headline = fx(c.headline); c.summary = fx(c.summary);
  (c.experience || []).forEach((r) => (r.bullets || []).forEach((b) => { b.text = fx(b.text); }));
  LISTS.forEach((k) => (c[k] || []).forEach((x) => { x.text = fx(x.text); }));
  c.skills = (c.skills || []).map(fx);
  return n;
}
async function rulesWrite(upd) {
  state.rules = Object.assign({}, state.rules, upd);
  if (ctx.mode === "local") { render(); return true; }
  try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "rules"), Object.assign({}, upd, { updatedAt: ctx.FS.serverTimestamp() }), { merge: true }); return true; }
  catch (e) { state.err = "Could not save your rules (" + (e.code || e.message) + ")."; render(); return false; }
}
// preview only: a rough reading of the rule, with no AI call
function demoRuleRead(t) {
  const m = /(?:[Ll]eave out|[Dd]on'?t (?:put|mention|include)|[Nn]ever (?:mention|include))\s+["“]?([A-Z][\w-]*(?:\s(?!on\b|in\b|from\b|unless\b)[a-z][\w-]*)?)/.exec(t), w = /["“]([^"”]+)["”][^"“]*never\s+["“]([^"”]+)["”]/i.exec(t);
  if (w) return { rule: { type: "word", use: w[1], avoid: w[2], text: `Always write "${w[1]}", never "${w[2]}"` }, found: [] };
  if (m) return { rule: { type: "leave", term: m[1], unless: /unless|except/i.test(t), text: `Leave out ${m[1]} from every CV, resume and cover letter`, unlessShow: "You turn it on for one job, on that job's page" }, found: [] };
  return { rule: { type: "note", text: t }, found: [] };
}
function jobRulesHTML(j) {
  const L = rulesList().filter((r) => r.type === "leave" && r.unless); if (!L.length) return "";
  const C = j.ruleChoices || {};
  return `<section class="card sx-c ru-job"><h2 class="sx-k">Your rules for this job</h2>${L.map((r) => `<label class="ru-jr"><input type="checkbox" data-stu="ru-job" data-id="${esc(r.id)}"${C[r.id] === "on" ? " checked" : ""}><span>Include <b>${esc(r.term)}</b> for this job</span></label>`).join("")}<p class="sx-sp sm">Left out everywhere else. A change applies when you rebuild the documents.</p></section>`;
}
/* Build from scratch: Stuart's interview (users/{uid}/cv/interview, written by stuartInterview) */
const IVS = [["contact", "Contact"], ["current", "Current role"], ["past", "Past roles"], ["results", "Results"], ["education", "Education"], ["skills", "Skills"], ["review", "Review"]];
function startChoices() {
  const P = state.profile || {}, iv = state.iv, going = iv && iv.step && !iv.used;
  return `<div class="sx-two"><div class="sx-opt"><span class="sx-oi">${ICO.up}</span><b>${P.profile ? "Use the CV Stuart has read" : "Upload my CV"}</b><span class="sx-sp">${P.profile ? "Stuart has already read a CV from you. Start the master CV from it, or upload a newer file." : "Stuart reads your current CV or resume (PDF or Word) and sets up the master CV for you to check."}</span>
    <div class="sx-btns">${P.profile ? `<button type="button" class="btn sx-b sm" data-stu="cv-seed">Start from it</button>` : ""}<label class="btn ${P.profile ? "btn--ghost " : ""}sx-b sm" style="cursor:pointer">${P.profile ? "Upload a newer file" : "Choose a file"}<input type="file" id="stu-cv" accept=".pdf,.docx,.txt,.md,application/pdf" hidden></label></div></div>
    <div class="sx-opt on"><span class="sx-oi">${ICO.spark}</span><b>Build from scratch</b><span class="sx-sp">Stuart asks you short questions, one at a time, and drafts each section from your answers. About 15 minutes; you can stop and come back.</span><div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="iv-open">${going ? "Continue the interview" : "Start the interview"}</button></div></div></div>`;
}
const ivStep = () => { const iv = state.iv; return iv && iv.step ? iv.step : "contact"; };
function ivPreviewDoc() { const iv = state.iv || {}, d = iv.draft || {}; return Object.assign({ referees: [], awards: [], publications: [] }, d); }
function viewInterview() {
  const st = ivStep(), idx = IVS.findIndex((x) => x[0] === st), iv = state.iv || {}, d = iv.draft || {}, ct = d.contact || {};
  const strip = `<ol class="sx-ivs" aria-label="Interview steps">${IVS.map(([k, l], i) => `<li><button type="button" ${i < idx && k !== "contact" ? `data-stu="iv-goto" data-k="${k}"` : "disabled"} class="${i < idx ? "sx-dn" : i === idx ? "sx-cur" : ""}"${i === idx ? ' aria-current="step"' : ""}>${i < idx ? ICO.check : ""}${l}</button></li>`).join("")}</ol>`;
  let main;
  if (st === "contact") main = `<h2 class="sx-k">Contact</h2><p class="sx-sp">These go at the top of your CV. Leave out identification numbers and your home address.</p>
    <div class="sx-fg">${ivf("name", "Full name", d.name)}${ivf("email", "Email", ct.email || (ctx.user && ctx.user.email) || "", "email")}${ivf("phone", "Phone", ct.phone, "tel")}${ivf("location", "Location (city or country)", ct.location)}${ivf("links", "Links (for example LinkedIn)", ct.links, "", true)}</div>
    <div class="sx-btns"><button type="button" class="btn sx-b" data-stu="iv-contact">Continue</button></div>`;
  else {
    const T = ((iv.turns || {})[st] || []);
    main = `<h2 class="sx-k">${esc(IVS[idx][1])}</h2><div class="sx-chat" aria-live="polite">${T.map((m) => m.role === "assistant" ? `<div class="sx-bub sx-bs"><img src="icons/stuart.svg" alt=""><div>${esc(m.text)}</div></div>` : `<div class="sx-bub sx-bm"><div>${esc(m.text)}</div></div>`).join("")}</div>`
      + (st === "review" ? `<div class="sx-btns"><button type="button" class="btn btn--ghost sx-b sm" data-stu="iv-send">${ICO.spark}${d.summary ? "Redraft my headline and summary" : "Draft my headline and summary"}</button><button type="button" class="btn sx-b" data-stu="iv-use">Use as my master CV</button></div>`
        : `<div class="sx-ans"><textarea id="sx-iv-ans" rows="3" maxlength="2000" placeholder="Type your answer" aria-label="Your answer"></textarea><div class="sx-btns sx-ansb"><button type="button" class="sx-lk" data-stu="iv-skip">Skip this part</button><button type="button" class="btn sx-b sm" data-stu="iv-send">Send</button></div></div>`)
      + `<p class="sx-sp sm">Stuart writes only what you tell it. Nothing is invented; a figure you have not given is never added.</p>`;
  }
  const pv = `<section class="sx-pv${state.pvOpen ? " open" : ""}" aria-label="Your CV so far"><div class="sx-pvh"><span>Your CV so far</span><span class="sx-pc ok">about ${estPages(ivPreviewDoc(), "cv")} ${estPages(ivPreviewDoc(), "cv") === 1 ? "page" : "pages"}</span><button type="button" class="sx-pvx" data-stu="pv" aria-label="Close preview">${ICO.x}</button></div>${docHTML(ivPreviewDoc(), "cv")}</section>`;
  return `<div class="sx-ivbar"><button type="button" class="sx-lk" data-stu="iv-close">Back to the CV builder</button>${state.iv ? `<button type="button" class="sx-lk" data-stu="iv-reset">Start again</button>` : ""}</div>${strip}<div class="sx-ivg"><section class="card sx-ed ivc">${main}${busyLine()}${errLine()}<button type="button" class="btn btn--ghost sx-b sm sx-pvbtn" data-stu="pv">Preview your CV so far</button></section>${pv}</div>`;
}
const ivf = (k, label, v, type, wide) => `<label class="sx-f${wide ? " wide" : ""}"><span>${label}</span><input data-ivc="${k}" value="${esc(v || "")}"${type ? ` type="${type}"` : ""} autocomplete="off"></label>`;
function demoIvTurn(text) {
  const iv = state.iv, st = iv.step, T = iv.turns[st] = iv.turns[st] || [];
  if (st === "review") { iv.draft.headline = "Operations leader in community health"; iv.draft.summary = "Leads clinic operations across three sites, with a record of better access and on-time openings."; return; }
  T.push({ role: "user", text });
  if (st === "current" && !iv.draft.experience.length) iv.draft.experience.push({ id: "d1", title: "Head of Operations", org: "Meridian Care Group", location: "Singapore", start: "2021", end: "present", bullets: [] });
  if (st === "past" && iv.draft.experience.length < 2) iv.draft.experience.push({ id: "d2", title: "Operations Manager", org: "Harbourside Clinics", location: "", start: "2017", end: "2020", bullets: [{ text: "Opened two new clinics on time, staffed by about 20 people." }] });
  const next = IVS[IVS.findIndex((x) => x[0] === st) + 1][0];
  T.push({ role: "assistant", text: "Thank you. That is in your draft." }); iv.step = next; iv.turns[next] = iv.turns[next] || [{ role: "assistant", text: "Next part. In the preview, Stuart asks the real questions on the hosted app." }];
}
/* ---------- 2.17.0 coach: the job page is a conversation with Stuart ---------- */
// Stuart sorts the gaps (hidden, weak, real), asks about one at a time, proposes a CV line from the answer, and the user
// adds it to the master CV with a tap; each added line is re-scored (functions/index.js, stuartCoach).
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
const sayS = (inner) => `<div class="cx-s"><span class="cx-av" aria-hidden="true"><img src="icons/stuart.svg" alt=""></span><div class="cx-b">${inner}</div></div>`;
const grow = (el) => { if (el && el.tagName === "TEXTAREA") { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 160) + "px"; } };
const thread = () => (ctx && ctx.container ? ctx.container.querySelector(".cx-thread") : null);
const scrollEnd = () => requestAnimationFrame(() => { const t = thread(); if (t) t.scrollTo({ top: t.scrollHeight, behavior: "smooth" }); });
// 2.27.0: on a phone the keyboard shrinks the visual viewport, not the fixed page, so the page follows it and the reply box stays above the keyboard
function fitViewport() { const p = ctx && ctx.container ? ctx.container.querySelector(".cx-page") : null, v = window.visualViewport; if (!p || !v || window.innerWidth >= 900) { if (p) { p.style.height = ""; p.style.top = ""; } return; } const t = thread(), end = t && t.scrollHeight - t.scrollTop - t.clientHeight < 120; p.style.height = v.height + "px"; p.style.top = v.offsetTop + "px"; if (end) t.scrollTop = t.scrollHeight; } // the latest message stays in view when the keyboard opens
// 2.28.12: while typing on a touch screen, only the reply box stays above the keyboard.
function setTyping(on) { const t = thread(), end = t && t.scrollHeight - t.scrollTop - t.clientHeight < 120; document.body.classList.toggle("ss-typing", on); if (end) t.scrollTop = t.scrollHeight; }
document.addEventListener("focusin", (e) => { if (e.target && e.target.id === "cx-msg" && window.matchMedia("(pointer:coarse)").matches) setTyping(true); });
document.addEventListener("focusout", (e) => { if (e.target && e.target.id === "cx-msg") setTyping(false); });
// 2.34.1 one tap sends: pressing send would first take focus from the box, close the keyboard and move the button before the tap lands, so the box keeps focus
document.addEventListener("mousedown", (e) => { const a = document.activeElement; if (a && a.id === "cx-msg" && e.target && e.target.closest && e.target.closest('[data-stu="cx-send"]')) e.preventDefault(); });
if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitViewport); window.visualViewport.addEventListener("scroll", fitViewport); }
const GAP_LAB = { hidden: "Hidden", weak: "Weak", real: "Real gap" };
function gapsCard(gaps) {
  const st = (g) => g.status === "done" ? `${ICO.check}Added` : g.status === "skipped" ? "Skipped" : g.status === "decided" ? esc(g.decision || "Decided") : g.kind === "real" ? "wording cannot fix" : "about +" + esc(g.gain);
  return `<div class="cx-card"><span class="cx-k">What would lift this application</span><ul class="cx-gaps">${gaps.map((g) => `<li class="${g.status !== "open" ? "cx-x" : ""}"><span class="cx-t k-${esc(g.kind)}">${GAP_LAB[g.kind] || "Gap"}</span><span>${esc(g.title)}</span><span class="cx-gain${g.kind === "real" || g.status !== "open" ? " no" : ""}">${st(g)}</span></li>`).join("")}</ul></div>`;
}
function propHTML(m, d) {
  const where = d.role ? `<span class="cx-where">For your master CV, under ${esc(d.role)}</span>` : "";
  const repl = d.replaces && d.status === "open" ? `<p class="cx-warn">This replaces: ${esc(d.replaces)}</p>` : "";
  if (d.status !== "open") return `${where}<div class="cx-line">${esc(d.text)}</div>`;
  if (state.cxEdit === m.id) return `${where}<textarea class="cx-ed" id="cx-ed" rows="3" aria-label="Edit the line">${esc(d.text)}</textarea><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-add" data-id="${esc(m.id)}">${ICO.check}Save to my CV</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="cx-cancel">Cancel</button></div>`;
  return `${where}${repl}<div class="cx-line${d.unsourced ? " warn" : ""}">${esc(d.text)}</div>${d.unsourced ? `<p class="cx-warn">This line holds a figure Stuart could not find in what you said. Add it only if it is true.</p>` : ""}<div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-add" data-id="${esc(m.id)}">${ICO.check}Add to my CV</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="cx-edit" data-id="${esc(m.id)}">${ICO.pen}Edit</button></div>`;
}
function deltaHTML(d) {
  const mv = d.from != null && d.to != null ? `<div class="cx-delta">Role fit <b>${esc(d.from)}</b> → <b>${esc(d.to)}</b>${d.note ? " · " + esc(d.note) : ""}</div>` : "";
  if (d.replaced) return `<div class="cx-done">${ICO.check}Updated a line in your master CV${d.version ? " (v" + esc(d.version) + ")" : ""}, instead of adding a second one</div>${mv}`;
  if (d.dup) return `<div class="cx-done">${ICO.check}Already in your master CV${d.role ? ", under " + esc(d.role) : ""}, so it was not added again</div>`; // 2.43.0
  return `<div class="cx-done">${ICO.check}Added to your master CV${d.version ? " (v" + esc(d.version) + ")" : ""}</div>${mv}`;
}
/* ---------- 2.27.0 one timeline: messages, builds and the inspection in the order they happened, newest last ---------- */
const tms = (x) => (x && x.toMillis ? x.toMillis() : typeof x === "number" ? x : 0);
const Q_TAG = /^\[Question: ([\s\S]*?)\]\n/; // an answer carries its question, so the chat, Stuart and the rebuild all know what it answers
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function whenLabel(ms, first, prev) {
  const d = new Date(ms), now = new Date(), day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  if (!first && prev && day(new Date(prev)) === day(d)) return hhmm(ms);
  const diff = Math.round((day(now) - day(d)) / 864e5);
  return (diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + " " + hhmm(ms);
}
const sinceBuild = (b) => { const t = tms(b && b.createdAt); return state.chat.filter((m) => m.role === "user" && (m.temp || tms(m.at) > t)); };
// The next question from the last build, unless a coaching step or an unanswered proposal is waiting first
function openQuestion(b, applied) {
  if (!b || applied) return null;
  const last = state.chat[state.chat.length - 1], d = (last && last.data) || {};
  if (last && last.role === "assistant" && tms(last.at) > tms(b.createdAt) && ((d.choices || []).length || (last.kind === "proposal" && (d.status || "open") === "open"))) return null;
  const qs = (b.questions || []).filter(Boolean), done = new Set(sinceBuild(b).map((m) => (Q_TAG.exec(m.text || "") || [])[1]).filter(Boolean)), skip = new Set(b.qSkip || []);
  const i = qs.findIndex((q) => !done.has(q) && !skip.has(q));
  return i < 0 ? null : { i, n: qs.length, q: qs[i] };
}
function threadHTML(j, b, applied) {
  const L = state.chat, gaps = (j.coach && j.coach.gaps) || [], now = Date.now();
  L.forEach((m) => { if (!m.at && !m.temp && ctx.mode === "local") m.at = now; });
  const lastI = L.length && L[L.length - 1].role === "assistant" ? L.length - 1 : -1, bt = b ? tms(b.createdAt) || now : 0;
  const items = L.map((m, i) => ({ t: m.temp ? Infinity : tms(m.at) || now, k: "m", m, i }));
  if (b) { (b.prior || []).forEach((p) => items.push({ t: tms(p.createdAt), k: "old", p })); const I = b.inspection; // 2.41.0: the current documents are not placed in time; they are drawn last (docsCard below)
    if (!applied && (state.inspBusy || (I && I.summary))) items.push({ t: state.inspBusy ? Infinity : tms(I.at) || bt + 1, k: "insp" }); }
  items.sort((x, y) => x.t - y.t);
  let prev = 0, first = true;
  const body = items.map((it) => {
    const mark = it.t !== Infinity && it.t && (first || it.t - prev >= 3e5 || new Date(prev).getDate() !== new Date(it.t).getDate()) ? `<div class="cx-time">${esc(whenLabel(it.t, first, prev))}</div>` : "";
    if (it.t !== Infinity && it.t) { prev = it.t; first = false; }
    if (it.k === "old") return mark + `<div class="cx-old"><b>Documents built from CV v${esc(it.p.masterVersion)}</b><span>Replaced by the rebuild below</span></div>`;
    if (it.k === "insp") return mark + inspCard(b);
    const m = it.m;
    if (m.role === "user") { const q = Q_TAG.exec(m.text || ""); return mark + (q ? sayS(`<span class="cx-k">Before you send</span><p>${esc(q[1])}</p>`) : "") + `<div class="cx-u">${esc(q ? m.text.slice(q[0].length) : m.text)}</div>`; }
    const d = m.data || {}, live = it.i === lastI && !state.coachBusy && (!b || it.t > bt);
    let x = m.kind === "gaps" ? md(m.text) + (gaps.length ? gapsCard(gaps) : "") : m.kind === "proposal" ? md(m.text) + propHTML(m, d) : m.kind === "delta" ? deltaHTML(d) : md(m.text);
    if (live && (d.choices || []).length) x += `<div class="cx-chips">${d.choices.map((c) => `<button type="button" class="cx-chip" data-stu="cx-say" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (it.i === lastI && !state.coachBusy && d.ready && !b) x += `<div class="cx-acts"><button type="button" class="btn sx-b" data-stu="tailor">Build CV, resume and cover letter</button></div>${crLive() ? `<p class="sx-sp sm">Uses 2 credits, free during beta</p>` : ""}`;
    return mark + sayS(x);
  }).join("");
  const Q = !state.coachBusy ? openQuestion(b, applied) : null;
  const ask = Q ? sayS(`<span class="cx-k">Before you send · question ${Q.i + 1} of ${Q.n}</span><p>${esc(Q.q)}</p><div class="cx-chips"><button type="button" class="cx-chip" data-stu="cx-q-say" data-t="I am not sure">I am not sure</button><button type="button" class="cx-chip" data-stu="cx-q-skip" data-q="${esc(Q.q)}">Skip this one</button></div>`) : "";
  const allIn = b && !applied && !Q && !state.coachBusy && (b.questions || []).length && sinceBuild(b).some((m) => Q_TAG.test(m.text || "")) && !(state.chat[state.chat.length - 1] || { data: {} }).data?.choices?.length;
  // 2.41.0: the documents are always the last thing on the page, whatever was said after they were built
  return body + (b ? docsCard(b, applied, ask + (allIn ? sayS(`<p>That is all of them. Rebuild when you are ready and I will use your answers.</p>`) : "")) : ask);
}
/* ---------- 2.19.0 inspection: a second check of the built documents, run separately from the writing ---------- */
const DOCN = { cv: "CV", resume: "Resume", letter: "Letter" };
const inspOpen = (I) => I ? I.open || 0 : 0;
function inspChip(I, k) {
  const d = I && I.docs && I.docs[k]; if (!d) return "";
  const issues = d.parse.filter((p) => !p.ok).length + d.keywords.filter((x) => !x.found).length + d.strengths.filter((x) => x.status !== "visible").length + d.figures.flagged + d.gapsClaimed.length + (d.claims || []).filter((c) => c.status !== "holds").length;
  const fx = I.status === "fixes" ? (I.fixes || []).filter((f) => f.doc === k).length + (I.questions || []).filter((q) => q.doc === k).length : 0;
  return fx ? `<span class="cx-ic w">${fx} ${fx === 1 ? "fix" : "fixes"}</span>` : issues ? `<span class="cx-ic w">Check</span>` : `<span class="cx-ic ok">Passed</span>`;
}
const iRow = (ok, label, val) => `<div class="cx-ir"><span class="cx-ii ${ok ? "ok" : "w"}" aria-hidden="true">${ok ? ICO.check : "!"}</span><span>${label}</span><b>${val}</b><span class="sr-only">${ok ? "passed" : "needs a look"}</span></div>`;
function inspCard(b) {
  const I = b.inspection;
  if (state.inspBusy) return `<section class="card sx-c cx-insp"><h2 class="sx-k">Inspection</h2><p class="stu-busy"><span class="spin"></span>${esc(state.inspBusy)}</p></section>`;
  if (!I || !I.summary) return `<section class="card sx-c cx-insp"><h2 class="sx-k">Inspection</h2><p class="sx-sp">${I === null && b.inspectedOnce ? "The letter changed since the last check." : "A second check, separate from the writing, that reads the Word files the way screening software does."}</p><button type="button" class="btn sx-b sx-full" data-stu="insp-run">Check the documents</button></section>`;
  const s = I.summary, n = (I.fixes || []).length, nq = (I.questions || []).length, word = (x) => ["One", "Two", "Three", "Four", "Five", "Six"][x - 1] || String(x);
  const what = (n ? (n === 1 ? "One fix" : word(n) + " fixes") : "") + (n && nq ? " and " + (nq === 1 ? "one question" : word(nq).toLowerCase() + " questions") : nq ? (nq === 1 ? "One question" : word(nq) + " questions") : "");
  const verdict = I.status === "pass" ? `<div class="cx-vd ok"><span class="cx-vn">${ICO.check}</span><div><b>Passed · ready for you to send</b><span>Reads cleanly · keywords ${s.kw.present} of ${s.kw.total} · strengths ${s.str.visible} of ${s.str.total}</span></div></div>`
    : I.status === "fixes" ? `<div class="cx-vd"><span class="cx-vn">${n + nq}</span><div><b>${what} before you send</b><span>${n ? "Each fix comes from your CV or your rules. No new facts." : "Stuart needs your answer."}</span></div></div>`
    : `<div class="cx-vd"><span class="cx-vn">${I.open}</span><div><b>${I.open === 1 ? "One item" : I.open + " items"} for you to decide</b><span>Stuart cannot fix ${I.open === 1 ? "it" : "these"} from your CV. See the report; you can still send.</span></div></div>`;
  return `<section class="card sx-c cx-insp"><h2 class="sx-k">Inspection · round ${I.round || 1} of 2</h2><p class="sx-sp sm">A second check, separate from the writing, that reads the Word files the way screening software does.</p>
    <div class="cx-irs">${iRow(s.read.ok === s.read.n, "Reads cleanly as text", s.read.ok + " of " + s.read.n + " files")}${iRow(s.kw.present === s.kw.total, "Must-have keywords in the CV and resume", s.kw.present + " of " + s.kw.total)}${iRow(s.str.visible === s.str.total, "Your strengths easy to find", s.str.visible + " of " + s.str.total)}${iRow(s.fig.traced === s.fig.total, "Every figure traced to your CV", s.fig.traced + " of " + s.fig.total)}${iRow(!s.gaps, "No gap claimed as a skill", s.gaps ? s.gaps + " found" : "0 found")}${s.cl && s.cl.total ? iRow(s.cl.hold === s.cl.total, "Claims match your CV and your rules", s.cl.hold + " of " + s.cl.total) : ""}</div>
    ${verdict}${I.status === "fixes" ? `<button type="button" class="btn sx-b sx-full" data-stu="insp-fixes">${n ? "See the fixes" : "Answer Stuart"}</button>` : ""}<button type="button" class="sx-lk cx-ilk" data-stu="insp-report">Open the full report</button></section>`;
}
function inspHTML(b) {
  const v = state.insp; if (!v || !b || !b.inspection || !b.inspection.docs) return "";
  const I = b.inspection, close = `<button type="button" class="sx-pvx" data-stu="insp-x" aria-label="Close">${ICO.x}</button>`;
  if (v.view === "fixes") {
    const F = I.fixes || [], Q = I.questions || [], pick = v.pick || new Set(F.map((f) => f.id)), ans = v.ans || {}, rem = v.rem || new Set(), na = Q.filter((q) => ans[q.id]).length;
    const body = (f) => f.op === "move" ? `<span class="cx-fw">Bullet ${f.from}: ${esc(f.text)}</span><span class="cx-fn">Moves to bullet ${f.to}</span>`
      : f.op === "reword" || f.op === "word" ? `<s class="cx-fw">${esc(f.from)}</s><span class="cx-fn">${esc(f.text)}</span>` : f.op === "drop" ? `<span class="cx-fn">Removes the lines that mention ${esc(f.text)}</span>` : `<span class="cx-fn">${esc(f.text)}</span>`;
    const item = (f, i) => `<label class="cx-fx"><input type="checkbox" data-stu="insp-pick" data-id="${esc(f.id)}"${pick.has(f.id) ? " checked" : ""}><span><b>${i + 1}. ${DOCN[f.doc]} · ${esc(f.where)}:</b> ${esc(f.why)}
      ${body(f)}<span class="cx-fs">${esc(f.source)}</span></span></label>`;
    const ques = Q.map((q) => `<div class="cx-q">${sayS(`<p><b>${esc(q.term)}:</b> include it for this job? Your ${DOCN[q.doc] === "Letter" ? "letter" : DOCN[q.doc]} says "${esc(q.quote)}". You asked me to check first.</p>`)}
      <div class="ru-two" role="group" aria-label="${esc(q.term)}">${["include", "leave"].map((a) => `<button type="button" class="btn btn--ghost sx-b" data-stu="insp-ans" data-q="${esc(q.id)}" data-a="${a}" aria-pressed="${ans[q.id] === a}">${a === "include" ? "Include" : "Leave out"}</button>`).join("")}</div>
      <label class="cx-rem"><input type="checkbox" data-stu="insp-rem" data-q="${esc(q.id)}"${rem.has(q.id) ? " checked" : ""}>Remember my answer as a rule</label></div>`).join("");
    const head = [F.length ? (F.length === 1 ? "One fix" : F.length + " fixes") : "", Q.length ? (Q.length === 1 ? "one question" : Q.length + " questions") : ""].filter(Boolean).join(" and ");
    const go = pick.size ? `Apply ${pick.size === 1 ? "1 fix" : pick.size + " fixes"}${na ? " and your answer" : ""} and check again` : na ? "Save my answer and check again" : "Choose a fix or answer";
    return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Fixes to approve"><div class="sx-rvb card"><div class="sx-rvh"><b>${head.charAt(0).toUpperCase() + head.slice(1)}</b>${close}</div>
      ${F.length ? `<p class="sx-sp">Stuart changes only what you tick, then checks again. Each fix comes from your CV or your rules.</p><div class="cx-fxs">${F.map(item).join("")}</div>` : ""}${ques}
      <button type="button" class="btn sx-b sx-full" data-stu="insp-apply"${pick.size || na ? "" : " disabled"}>${go}</button><button type="button" class="btn btn--ghost sx-b sx-full" data-stu="insp-x">Leave the documents as they are</button>
      <p class="sx-sp sm sx-c2">After two rounds, anything left open comes to you to decide. Nothing is sent to anyone.</p></div></div>`;
  }
  const tab = v.tab || "cv", d = I.docs[tab] || { parse: [], keywords: [], strengths: [], gapsClaimed: [], figures: {} };
  const chip = (cls, t) => `<span class="cx-ic ${cls}">${t}</span>`;
  const kw = (d.keywords || []).map((x) => `<div class="cx-kw"><b>${esc(x.term)}</b><span>${x.found ? esc(x.where) : "Not found as written; screening software matches words"}</span>${x.found ? chip("ok", "Found") : chip("w", "Missing")}</div>`).join("");
  const st = (d.strengths || []).map((x) => `<div class="cx-kw"><b>${esc(x.item)}</b><span>${esc(x.where || "")}</span>${chip(x.status === "visible" ? "ok" : "w", x.status === "visible" ? "Visible" : x.status === "buried" ? "Buried" : "Absent")}</div>`).join("");
  const gp = (d.gapsClaimed || []).map((x) => `<div class="cx-kw"><b>${esc(x.term)}</b><span>${esc(x.where || "")}</span>${chip("w", "Claimed")}</div>`).join("");
  const CS = { holds: ["ok", "Holds"], overclaim: ["x", "Overclaim"], rule: ["w", "Breaks a rule"], ask: ["a", "Ask you"] }, cls = d.claims || [];
  const cl = [...cls].sort((x, y) => (x.status === "holds") - (y.status === "holds")).map((c) => `<div class="cx-cl"><p>"${esc(c.quote)}"</p>${chip(CS[c.status][0], CS[c.status][1])}<small>${esc(c.status === "holds" ? [c.where, c.source].filter(Boolean).join(" · ") : c.reason || "")}</small></div>`).join("");
  const sec = (t, body) => body ? `<section class="cx-rs"><h3 class="sx-k">${t}</h3>${body}</section>` : "";
  return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Inspection report"><div class="sx-rvb card"><div class="sx-rvh"><b>Inspection report · ${esc(b.org || "")}</b>${close}</div>
    <p class="sx-sp sm">Round ${I.round || 1} of 2${I.at && I.at.toDate ? " · checked " + I.at.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}. A judgement to help you, not a guarantee of how any employer's software scores it.</p>
    <div class="sx-tabs cx-it" role="tablist">${["cv", "resume", "letter"].filter((k) => I.docs[k]).map((k) => `<button type="button" role="tab" data-stu="insp-tab" data-k="${k}" aria-selected="${tab === k}">${DOCN[k]}</button>`).join("")}</div>
    ${cls.length ? sec("Claims checked · " + cls.filter((c) => c.status === "holds").length + " of " + cls.length + " hold", `<p class="sx-sp sm">Each claim is matched to your master CV and your rules.</p>` + cl) : ""}
    ${sec("Reads as text", (d.parse || []).map((p) => iRow(p.ok, esc(p.label) + (p.detail ? ` <i>${esc(p.detail)}</i>` : ""), "")).join(""))}
    ${sec("Must-have keywords · " + (d.keywords || []).filter((x) => x.found).length + " of " + (d.keywords || []).length, kw)}
    ${sec("Strengths the reader can find · " + (d.strengths || []).filter((x) => x.status === "visible").length + " of " + (d.strengths || []).length, st)}
    ${sec("Gaps claimed as skills", gp)}
    ${sec("Figures", iRow(!d.figures.flagged, d.figures.total ? d.figures.total - d.figures.flagged + " of " + d.figures.total + " lines with figures traced to your CV" : "No figures in this document", ""))}
    ${tab === "letter" ? `<p class="sx-sp sm">Keywords are counted in the CV and resume; a letter does not need every term.</p>` : ""}</div></div>`;
}
async function runInspect(jobId, data, label) {
  state.inspBusy = label; state.err = ""; render();
  try { await busyWhile(callables.stuartInspect(Object.assign({ jobId }, data || {})), "Inspecting the document…"); }
  catch (e) { state.err = errMsg(e); }
  state.inspBusy = ""; render();
}
// preview only: a scripted inspection on the sample build, two fixes in round 1, a pass in round 2
const demoClaims = (ok) => ok ? [{ quote: "I have led clinic operations since 2017", where: "Paragraph 1", status: "holds", source: "Harbourside Clinics, 2017 to 2020" }, { quote: "I organised the opening of two new clinics", where: "Paragraph 2", status: "holds", source: "Your rule" }, { quote: "cut appointment no-shows from 18% to 11% in 2024", where: "Paragraph 2", status: "holds", source: "Head of Operations, bullet 1" }]
  : [{ quote: "I have led operations for over ten years", where: "Paragraph 1", status: "overclaim", reason: "Your CV shows operations roles from 2017, not ten years." }, { quote: "I organized the opening of two new clinics", where: "Paragraph 2", status: "rule", reason: "Your rule: write \"organised\", never \"organized\"." },
    { quote: "I hold a Lean Six Sigma Green Belt", where: "Paragraph 3", status: "ask", reason: "You asked to be asked first." }, { quote: "cut appointment no-shows from 18% to 11% in 2024", where: "Paragraph 2", status: "holds", source: "Head of Operations, bullet 1" }];
function demoInspect(b, apply) {
  const r1 = (b.cv.experience || [])[0] || {}, rr = (b.resume.experience || [])[0] || {};
  const docs = (kw, str, fix) => ({ parse: [{ label: "Name and contact in the body, not the header", ok: true }, { label: "Standard headings: Profile, Experience, Education, Skills", ok: true }, { label: "Title, employer and dates on every role", ok: true }, { label: "No tables, text boxes or text in images", ok: true }], keywords: kw, strengths: str, gapsClaimed: [], figures: { total: 3, flagged: 0 }, fixes: fix });
  const K = (miss) => [{ term: "stakeholder", found: true, where: "Profile" }, { term: "operations", found: true, where: "Headline" }, { term: "dashboard", found: true, where: "Role 1, bullet 2" }, { term: "budget", found: !miss, where: miss ? "" : "Role 2, bullet 1" }];
  if (!apply) {
    b.inspection = { round: 1, status: "fixes", open: 2, docs: { cv: docs(K(false), [{ item: "Led a team of 12", status: "visible", where: "Role 1, bullet 1" }, { item: "Board reporting", status: "buried", where: "Role 1, bullet 5" }], 1), resume: docs(K(true), [{ item: "Led a team of 12", status: "visible", where: "Role 1, bullet 1" }], 1), letter: Object.assign(docs([], [], 0), { parse: [{ label: "Name and contact in the body, not the header", ok: true }, { label: "Greeting, body and sign-off", ok: true }, { label: "No tables, text boxes or text in images", ok: true }, { label: "1 page, within the 1-page limit", ok: true }] }) },
      fixes: [{ id: "f1", doc: "resume", op: "add", roleId: rr.id, to: 3, text: "Opened two new clinics on time and within budget.", why: "Gives the must-have \"budget\" its evidence.", where: "Role 2 (Operations Manager, Harbourside Clinics)", source: "From your master CV: Harbourside Clinics, role 2" },
        { id: "f2", doc: "cv", op: "move", roleId: r1.id, from: 5, to: 2, text: "Reported to the executive committee every quarter on clinic performance.", why: "Puts board reporting in the first lines a reader sees.", where: "Role 1 (Head of Operations, Meridian Care Group)", source: "Same wording, new position" }],
      summary: { read: { ok: 3, n: 3 }, kw: { present: 7, total: 8 }, str: { visible: 2, total: 3 }, fig: { traced: 9, total: 9 }, gaps: 0, cl: { hold: 1, total: 4 } } };
    b.inspection.open = 5; b.inspection.docs.letter.claims = demoClaims(false);
    b.inspection.fixes.push({ id: "r1", doc: "letter", op: "reword", from: "I have led operations for over ten years", text: "I have led clinic operations since 2017", why: "Your CV shows operations roles from 2017, not ten years.", where: "Paragraph 1", source: "From your CV: Harbourside Clinics, 2017 to 2020" });
    b.inspection.questions = [{ id: "q1", ruleId: "d3", term: "Lean Six Sigma", quote: "I hold a Lean Six Sigma Green Belt", doc: "letter", where: "Paragraph 3" }];
  } else {
    b.inspection = { round: 2, status: "pass", open: 0, fixes: [], docs: { cv: docs(K(false), [{ item: "Led a team of 12", status: "visible", where: "Role 1, bullet 1" }, { item: "Board reporting", status: "visible", where: "Role 1, bullet 2" }], 0), resume: docs(K(false), [{ item: "Led a team of 12", status: "visible", where: "Role 1, bullet 1" }], 0), letter: b.inspection.docs.letter },
      summary: { read: { ok: 3, n: 3 }, kw: { present: 8, total: 8 }, str: { visible: 3, total: 3 }, fig: { traced: 9, total: 9 }, gaps: 0, cl: { hold: 3, total: 3 } } };
    b.inspection.docs.letter = Object.assign({}, b.inspection.docs.letter, { claims: demoClaims(true) });
  }
  b.inspectedOnce = true;
}
/* application email (2.28.2): Stuart drafts, the user checks and sends from their own email app */
const EMAIL_OK = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
function applyOf(j) { const f = (j && j.facts) || {}, a = f.apply || {}, g = Object.assign({}, f); delete g.notes; const flat = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v).map(flat).join(" ") : ""), m = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i.exec(String(a.email || "") || flat(g)); const email = m ? m[0] : ""; return { email, byEmail: a.method === "email" || (!a.method && !!email), asked: a.subject || a.instructions ? 1 : 0 }; }
function emailCard(b) {
  const e = b.email, j = state.jobs.find((x) => x.id === b.jobId), to = (e && e.to) || applyOf(j).email;
  return `<section class="card cx-doc"><div class="sx-mini on" aria-hidden="true"><i></i><i></i><i class="s"></i></div><div class="cx-dt"><b>Application email</b><span>${to ? "To " + esc(to) : e ? "Add the address" : "For applying by email"}</span></div><button type="button" class="btn sx-b sm" data-stu="em-open">Open</button></section>`;
}
function emailSay(b, applied) {
  const j = state.jobs.find((x) => x.id === b.jobId), A = applyOf(j); if (applied || !A.byEmail || b.email) return "";
  return sayS(`<p>This advertisement asks for applications by email${A.email ? ", to " + esc(A.email) : ""}, not a portal. I can draft the email for you to check and send.</p><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="em-open">Open my email</button></div>`);
}
function emailHTML(b) {
  const E = state.email; if (!E || !b) return "";
  const who = (state.cv || {}).name, head = (t) => `<div class="sx-rvh"><b>${t} · ${esc(b.org || "")}</b><button type="button" class="sx-pvx" data-stu="em-x" aria-label="Close">${ICO.x}</button></div>`;
  if (E.step === "after") return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Before you send"><div class="sx-rvb card">${head("Before you send")}<p>Your email should be open with the message ready. Before you press send, check:</p>
    <div class="em-ticks"><label><input type="checkbox"> CV attached</label><label><input type="checkbox"> Cover letter attached</label><label><input type="checkbox"> Name and reference are right</label></div>
    <p class="sx-sp sm">Smart Start did not send anything. Tell me once you have, and I will move this to Applied with today's date.</p>
    <div class="em-acts"><button type="button" class="btn sx-b" data-stu="applied">I sent it, mark as applied</button><button type="button" class="btn btn--ghost sx-b" data-stu="em-x">Not yet</button><button type="button" class="sx-lk" data-stu="em-back">Back to the email</button></div></div></div>`;
  const ok = EMAIL_OK.test(E.to.trim()), row = (k, lab) => `<div class="em-file"><div><b>${lab}</b><span>${esc(fileName(k, who, b.org))}</span></div><button type="button" class="btn btn--ghost sx-b sm" data-stu="print" data-kind="${k}">PDF</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="word" data-kind="${k}">Word</button></div>`;
  return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Application email"><div class="sx-rvb card">${head("Application email")}
    ${!E.to.trim() ? `<p class="sx-sp sm">The advertisement gives no email address that I can see. Add one if you have it, or copy the email. I will not guess one.</p>` : ""}
    ${E.unsourced ? `<p class="sx-st warn">This draft holds a figure I could not find in your CV: confirm it before sending.</p>` : ""}
    <label class="sx-f"><span>To</span><input id="em-to" type="email" autocomplete="off" value="${esc(E.to)}" placeholder="Add the email address"></label>
    <label class="sx-f"><span>Subject</span><input id="em-sub" value="${esc(E.subject)}"></label>
    <label class="sx-f"><span>Message</span><textarea id="em-body" rows="11">${esc(E.body)}</textarea></label>
    <div class="em-k">Attach these yourself</div>${row("cv", "Tailored CV")}${row("letter", "Cover letter")}
    <p class="sx-sp sm">Email links cannot carry files, so download these and add them to your email.</p>
    <p class="em-warn" id="em-warn"${ok ? " hidden" : ""}>Add the address to open your email app</p>
    <div class="em-acts"><button type="button" class="btn sx-b" data-stu="em-send" data-via="mail"${ok ? "" : " disabled"}>Open in my email app</button>
    <div class="em-3"><button type="button" class="btn btn--ghost sx-b sm" data-stu="em-send" data-via="gmail"${ok ? "" : " disabled"}>Gmail</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="em-send" data-via="outlook"${ok ? "" : " disabled"}>Outlook</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="em-copy">Copy all</button></div>
    <button type="button" class="sx-lk" data-stu="em-redo">Ask Stuart to write it again</button></div></div></div>`;
}
function emailDemo(b, j) {
  const f = j.facts || {}, c = (state.cv || {}).contact || {}, n = (state.cv || {}).name || "", A = applyOf(j);
  return { to: A.email, subject: "Application: " + (f.role || "the role") + ", " + n, unsourced: false, body: "Dear Hiring Manager,\n\nI am applying for the " + (f.role || "role") + ". " + (((b.letter || {}).paragraphs || [])[1] || "") + "\n\nMy CV and cover letter are attached. I would welcome the chance to discuss the role.\n\nYours sincerely,\n" + [n, c.phone, c.email].filter(Boolean).join("\n") };
}
async function emailSave() {
  const E = state.email, b = buildOf(state.buildJob); if (!E || !b || !E.dirty) return; E.dirty = false;
  const v = { to: E.to.trim(), subject: E.subject.trim(), body: E.body };
  if (ctx.mode === "local") { b.email = Object.assign({}, b.email, v); return; }
  try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId), { "email.to": v.to, "email.subject": v.subject, "email.body": v.body }); }
  catch (e) { state.err = "Could not save the email (" + (e.code || e.message) + ")."; render(); }
}
async function emailDraft(b) {
  const j = state.jobs.find((x) => x.id === b.jobId);
  if (ctx.mode === "local") { b.email = Object.assign(emailDemo(b, j), b.email && b.email.to ? { to: b.email.to } : {}); return b.email; }
  const r = await call("stuartEmail", { jobId: b.jobId }, "Stuart is drafting the email…"); return r.email;
}
const emailOpenState = (e) => ({ step: "edit", to: e.to || "", subject: e.subject || "", body: e.body || "", unsourced: !!e.unsourced, dirty: false });
function adWantsNoPhoto(j) { const f = (j && j.facts) || {}; return f.photo === "not wanted" || /\b(no|without|do not (?:include|send)|don't (?:include|send))\s+(?:a\s+)?(?:photo|photograph|picture)s?\b/i.test([f.notes, f.channel].concat(f.mustHaves || [], f.hardScreens || []).join(" ")); }
function photoCard(b) {
  const has = ctx && ctx.photo && ctx.photo(), j = state.jobs.find((x) => x.id === b.jobId), f = (j && j.facts) || {}, no = adWantsNoPhoto(j);
  if (!has) return f.photo === "wanted" ? sayS(`<p>This advertisement asks for a photo. You can add one in Settings, under Account.</p>`) : "";
  const P = b.photo || {}, tg = (k, lab) => `<label class="cx-pht"><span><b>Include my photo</b><small>${lab}</small></span><input type="checkbox" class="pv-sw" data-stu="ph-tg" data-kind="${k}"${P[k] ? " checked" : ""} aria-label="Include my photo on the ${lab}"></label>`;
  return `<section class="card cx-phc">${tg("cv", "Tailored CV")}${tg("resume", "Resume")}<p class="sx-sp sm">On the first page, top right. Some employers and countries prefer no photo, so check the advertisement.</p></section>${no && !P.cv && !P.resume ? sayS(`<p>This advertisement asks for no photographs, so I left yours off. You can still switch it on.</p>`) : ""}`;
}
function signCard(b) {
  if (!b.letter) return "";
  const has = !!(ctx && ctx.sign && ctx.sign()), on = !!(b.sign && b.sign.letter);
  if (!has) return on ? sayS(`<p>Your signature was deleted, so the cover letter goes unsigned. You can add one again in Settings, under Account.</p>`) : `<p class="sx-sp sm cx-sgn">To sign your cover letter, add a signature in Settings, under Account.</p>`;
  const over = on && estPages(b.letter, "letter", true) > 1 && estPages(b.letter, "letter") <= 1;
  return `<section class="card cx-phc"><label class="cx-pht"><span><b>Sign my cover letter</b><small>Above your typed name</small></span><input type="checkbox" class="pv-sw" data-stu="sg-tg"${on ? " checked" : ""} aria-label="Sign my cover letter"></label><p class="sx-sp sm">Your typed name stays, so screening software still reads it.</p></section>${over ? sayS(`<p>With your signature, the letter may run past one page. Shorten a paragraph, or switch the signature off.</p>`) : ""}`;
}
export function rerender() { if (ctx) render(); }
function docsCard(b, applied, asks = "") {
  const pc = { cv: estPages(b.cv, "cv"), resume: estPages(b.resume, "resume"), letter: estPages(b.letter, "letter", !!signFor(b)) }, lim = { cv: 6, resume: 2, letter: 1 };
  const flags = (d) => (d && d.experience ? d.experience.reduce((n, r) => n + (r.bullets || []).filter((x) => x.unsourced).length, 0) + (d.summaryUnsourced ? 1 : 0) : 0);
  const fl = { cv: flags(b.cv), resume: flags(b.resume), letter: ((b.letter || {}).unsourced || []).filter(Boolean).length };
  const card = (k, lab) => `<section class="card cx-doc"><div class="sx-mini" aria-hidden="true"><i></i><i></i><i class="s"></i><i></i></div><div class="cx-dt"><b>${lab}</b><span>${pc[k]} of ${lim[k]} ${lim[k] === 1 ? "page" : "pages"}</span>${b.inspection && b.inspection.docs ? inspChip(b.inspection, k) : pc[k] > lim[k] || fl[k] ? `<span class="sx-st warn">${pc[k] > lim[k] ? "Over the page limit" : fl[k] + (fl[k] === 1 ? " figure" : " figures") + " to confirm"}</span>` : ""}</div>
    <details class="sx-dd"><summary class="btn sx-b sm" aria-label="Open ${lab}"><span>Open</span>${ICO.down}</summary><div class="sx-menu"><button type="button" data-stu="review" data-kind="${k}">${ICO.eye}Review</button><button type="button" data-stu="word" data-kind="${k}">${ICO.dl}Download Word</button><button type="button" data-stu="print" data-kind="${k}">${ICO.dl}Download PDF</button></div></details></section>`;
  // 2.41.0 order: Stuart's note, any question, "your documents are ready", then the documents themselves, then their settings
  const later = !applied && sinceBuild(b).length > 0, opts = lookCard(b) + photoCard(b) + signCard(b);
  const P = b.photo || {}, set = !!(P.cv || P.resume || signFor(b) || b.lookId), tell = /asks for a photo|asks for no photographs|may run past one page/.test(opts);
  const open = state.optOpen != null ? state.optOpen : set || tell;
  return `${b.notes ? sayS(`<span class="cx-k">Stuart's note</span>${md(b.notes)}`) : ""}${emailSay(b, applied)}${asks}${docsNext(applied)}
    <div class="cx-div">Documents built · from CV v${esc(b.masterVersion)}${b.saved ? " · saved to Documents" : ""}${later ? " · before your last reply" : ""}</div><div class="cx-docs">${card("cv", "Tailored CV")}${card("resume", "Resume")}${card("letter", "Cover letter")}${emailCard(b)}</div>
    ${opts ? `<details class="cx-opt"${open ? " open" : ""}><summary data-stu="opt-tg"><span><b>Options</b><small>Designed copy, photo and signature</small></span>${ICO.down}</summary><div class="cx-optb">${opts}</div></details>` : ""}`;
}
function docsNext(applied) {
  if (state.coachBusy || state.inspBusy) return "";
  const j = state.jobs.find((x) => x.id === state.openJob), fit = !!(j && j.analysis && j.analysis.roleFit), pr = fit ? `<button type="button" class="cx-chip go" data-stu="pr-open">Practise for the interview</button>` : "";
  if (applied) return pr ? sayS(`<p>You can practise for the interview whenever you like.</p><div class="cx-chips">${pr}</div>`) : "";
  return sayS(`<p>Your documents are ready. Review them, then mark this job as applied when you have sent them. Nothing is sent for you.</p><div class="cx-chips"><button type="button" class="cx-chip go" data-stu="applied">Mark as applied</button>${pr}</div>`);
}
async function coachCall(data, label) {
  state.coachBusy = label; state.err = ""; render(); scrollEnd();
  try { await busyWhile(callables.stuartCoach(data), "Stuart is thinking…"); state.coachBusy = ""; render(); return true; }
  catch (e) { state.coachBusy = ""; state.err = errMsg(e); render(); return false; }
}
function maybeStartCoach(j) {
  if (j.coach || !j.analysis || isApplied(j) || !state.cv || !(state.cv.experience || []).length || (state.cxTried || {})[j.id]) return;
  state.cxTried = Object.assign(state.cxTried || {}, { [j.id]: true });
  if (ctx.mode === "local") { setTimeout(() => { demoCoachStart(j); render(); }, 0); return; }
  setTimeout(() => coachCall({ action: "start", jobId: j.id }, "Stuart is reading your CV against this role…"), 0);
}
/* ---------- 2.14.0 flow: Home (set-up checklist, then your jobs), Add sheet with live stages, one page per job ---------- */
const appOf = (j) => { const L = (ctx.apps && ctx.apps()) || []; return (j.appId && L.find((a) => a.id === j.appId)) || L.find((a) => a.jobId === j.id) || null; };
const isApplied = (j) => { const a = appOf(j); return j.status === "Applied" || !!(a && a.stage && !["Saved", "Preparing"].includes(a.stage)); };
const checking = (j) => j.stage === "reading" || j.stage === "fit";
const fmtD = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""; };
function jobState(j) {
  if (checking(j)) return ["Checking…", ""];
  const a = appOf(j);
  if (isApplied(j)) return [a && a.stage && !["Applied", "Saved", "Preparing"].includes(a.stage) ? a.stage : "Applied" + (a && a.dateSubmitted ? " " + fmtD(a.dateSubmitted) : ""), ""];
  const b = buildOf(j.id);
  if (b) return (b.questions || []).length ? ["Answer " + b.questions.length + (b.questions.length === 1 ? " question" : " questions"), "a"] : ["Ready to apply", "g"];
  return ["Build documents", "a"];
}
function ring(v, big) {
  const n = Number(v), ok = v != null && v !== "" && isFinite(n);
  return `<span class="sx-rg${big ? " big" : ""}${ok && n < 65 ? " lo" : ""}" style="--v:${ok ? Math.max(0, Math.min(100, n)) : 0}" role="img" aria-label="${ok ? "Fit " + n + " of 100" : "Not scored yet"}"><i>${ok ? n : "–"}</i></span>`;
}
function jobRow(j) {
  const f = j.facts || {}, [s, k] = jobState(j);
  return `<button type="button" class="sx-jb" data-stu="open" data-id="${esc(j.id)}">${checking(j) ? '<span class="sx-rg"><i><span class="spin"></span></i></span>' : ring(((j.analysis || {}).roleFit || {}).score)}<span class="sx-tx"><b>${esc(f.organisation || "Reading the advertisement…")}</b><span>${esc([f.role, f.closingDate ? "closes " + fmtD(f.closingDate) : ""].filter(Boolean).join(" · "))}</span></span><span class="sx-js ${k}">${esc(s)}</span></button>`;
}
const stepRow = (n, cls, title, sub, extra) => `<div class="sx-st1 ${cls}"><span class="sx-dot">${cls === "ok" ? ICO.check : cls === "run" ? '<span class="spin"></span>' : n}</span><div class="sx-tx"><b>${title}</b><span>${sub}</span></div>${extra || ""}</div>`;
function viewHome() {
  const P = state.profile || {}, c = state.cv, jobs = state.jobs;
  const hasCV = !!c || !!P.profile, hasJob = jobs.length > 0, applied = jobs.some(isApplied);
  if (hasCV) state.needCV = false;
  const cur = !hasCV ? 1 : !hasJob ? 2 : !applied ? 3 : 0;
  const cls = (n, ok) => ok ? "ok" : n === cur ? "cur" : "";
  const cvLine = c ? `${c.name || "Your CV"} · ${(c.experience || []).length} ${(c.experience || []).length === 1 ? "role" : "roles"} · v${c.version || "1.0"}` : P.profile ? "Read by Stuart · open Writer to check it" : "Upload it, or build it with Stuart";
  const setup = cur ? `<section class="card sx-c"><h2 class="sx-k">Get started</h2>
    ${stepRow(1, cls(1, hasCV), "Your CV", esc(cvLine), hasCV ? `<button type="button" class="sx-lk" data-stu="tab" data-k="cv">Edit</button>` : "")}
    ${hasCV ? "" : `<div class="sx-in">${startChoices()}${busyLine()}${errLine()}</div>`}
    ${stepRow(2, cls(2, hasJob), "Add a job", "Paste the advertisement, a link or a file")}
    ${stepRow(3, cls(3, applied), "Build and apply", "Tailored CV, resume and cover letter")}
    ${hasCV ? `<button type="button" class="btn sx-b sx-full" data-stu="add">${ICO.plus}Add new job</button>` : ""}</section>` : "";
  const others = ((ctx.apps && ctx.apps()) || []).filter((a) => !a.jobId).length, total = state.moreJobs && state.jobTotal ? state.jobTotal : jobs.length;
  const list = hasJob ? `<section class="card sx-c"><div class="sx-hd"><h2 class="sx-k">Jobs with Stuart · ${total}</h2>${cur ? "" : `<button type="button" class="btn sx-b sm" data-stu="add">${ICO.plus}Add new</button>`}</div><div class="sx-jl2">${jobs.map(jobRow).join("")}</div>${state.moreJobs ? `<button type="button" class="sx-lk sx-more" data-stu="jobs-more">Show older jobs${state.jobTotal ? " (" + (state.jobTotal - state.jobLimit) + ")" : ""}</button>` : ""}<p class="sx-sp sm">Jobs Stuart has read the advertisement for.${others ? ` Your other ${others} ${others === 1 ? "application is" : "applications are"} in Applications; open one and choose Check with Stuart to add it here.` : ""}</p></section>` : "";
  const pl = state.plan && state.plan.plan;
  const plan = `<button type="button" class="card sx-plan" data-stu="tab" data-k="plan"><span class="sx-tx"><b>Your plan</b><span>Optional · ${esc(pl ? pl.headline || "Open your plan" : P.profile ? "Set a goal and a route" : "Available once Stuart has your CV")}</span></span>${ICO.chev}</button>`;
  return `<div class="sx-home">${setup}${list}${plan}<div class="sx-log">${viewLog()}</div></div>`;
}
/* Add a job: a sheet over the page; the job record shows each stage as the server reaches it */
const newSheet = () => ({ mode: "text", phase: "form", track: true, text: "", url: "", focus: true });
function sheetHTML() {
  const S = state.sheet; if (!S) return "";
  let body;
  if (S.phase === "form") {
    const chip = (k, l) => `<button type="button" class="${S.mode === k ? "on" : ""}" data-stu="sh-mode" data-k="${k}" aria-pressed="${S.mode === k}">${l}</button>`;
    const inp = S.mode === "text" ? `<textarea id="stu-text" rows="7" class="sx-ta" placeholder="Paste the whole advertisement: role, duties and requirements">${esc(S.text)}</textarea><input id="stu-url" class="sx-inp" placeholder="Link (optional), kept as the source" value="${esc(S.url)}" autocomplete="off" inputmode="url">`
      : S.mode === "link" ? `<input id="stu-url" class="sx-inp" placeholder="https:// link to the advertisement" value="${esc(S.url)}" autocomplete="off" inputmode="url"><p class="sx-sp sm">Some job sites block Stuart. If the link fails, paste the text instead.</p>`
      : `<label class="sx-drop"><input type="file" id="stu-ad" accept=".pdf,image/*,.docx"><b>${esc(S.fileName || "Choose a PDF, Word file, photo or screenshot")}</b><span>Up to 8 MB</span></label>`;
    body = `<h2 class="sx-sh">${S.appId ? "Check " + esc(S.appOrg || "this application") + " with Stuart" : "Add a job"}</h2>${S.appId ? `<p class="sx-sp sm">Stuart's fit check, chat and documents go on a page linked to this application. No second application is made.</p>` : ""}<div class="sx-chips" role="group" aria-label="How to add the advertisement">${chip("text", "Paste text")}${chip("link", "Link")}${chip("file", "File")}</div>${inp}
      ${S.mode === "text" ? `<p class="sx-sp sm">Stuart reads the pasted text and keeps the link as the source.</p>` : ""}
      ${S.appId ? "" : `<label class="sx-chk"><input type="checkbox" id="stu-track"${S.track ? " checked" : ""}><span>Add it to my applications (stage: Saved)</span></label>`}
      ${S.err ? `<p class="lock__err" role="alert">${esc(S.err)}</p>` : ""}
      <button type="button" class="btn sx-b sx-full" data-stu="analyse">Check the fit</button><p class="sx-sp sm sx-c2">About a minute. You can close this; Stuart keeps going.</p>`;
  } else if (S.phase === "err") {
    body = `<h2 class="sx-sh">Stuart could not finish</h2><div class="sx-errc" role="alert"><p>${esc(S.err)}</p></div><div class="sx-acts"><button type="button" class="btn sx-b sx-full" data-stu="sh-retry">Try again</button><button type="button" class="btn btn--ghost sx-b sx-full" data-stu="sh-edit">Change what I gave Stuart</button></div>`;
  } else {
    const j = state.jobs.find((x) => x.id === S.jobId) || {}, f = j.facts || {}, a = j.analysis || {};
    const st = j.stage === "done" ? 3 : j.stage === "fit" ? 1 : 0, c = (i) => st > i ? "ok" : st === i ? "run" : "";
    body = `<h2 class="sx-sh">Checking ${esc(f.organisation || "the advertisement")}</h2><div class="sx-prog">
      ${stepRow(1, c(0), "Read the advertisement", st > 0 ? esc([f.role, f.closingDate ? "closes " + fmtD(f.closingDate) : ""].filter(Boolean).join(" · ") || "Done") : "Organisation, role and requirements")}
      ${stepRow(2, c(1), "Hard screens, keywords and fit", st > 1 && (a.roleFit || {}).score != null ? "Fit " + esc(a.roleFit.score) + " of 100" : "Comparing with your CV")}
      ${stepRow(3, c(2), "Likelihood band", st > 2 && a.band && a.band.level ? esc(a.band.level) + " likelihood, with reasons" : "With reasons")}</div>
      <p class="sx-sp sm sx-c2">You can close this; Stuart keeps going and the job appears in your list.</p>`;
  }
  return `<div class="sx-scrim" data-stu="sh-x"></div><div class="sx-sheet" role="dialog" aria-modal="true" aria-label="Add a job"><div class="sx-grab" aria-hidden="true"></div><button type="button" class="sx-shx" data-stu="sh-x" aria-label="Close">${ICO.x}</button>${body}</div>`;
}
async function runAnalyse(data) {
  const S = state.sheet; if (!S) return; S.last = data; S.err = "";
  if (ctx.mode === "local") { demoAnalyse(S); return; }
  const jobId = ctx.FS.doc(ctx.FS.collection(ctx.db, "users", ctx.user.uid, "jobs")).id;
  S.jobId = jobId; S.phase = "run"; render();
  try {
    const r = (await busyWhile(callables.stuartAnalyse(Object.assign({}, data, { jobId })), "Checking the advertisement against your CV…")).data;
    if (state.sheet && state.sheet.jobId === jobId) { state.sheet = null; openJob(r.id); }
    else if (ctx.toast) ctx.toast(((r.facts || {}).organisation || "The job") + " is checked. It is in Stuart's list.");
  } catch (e) {
    const msg = errMsg(e);
    if (state.sheet && state.sheet.jobId === jobId) { state.sheet.phase = "err"; state.sheet.err = msg; render(); }
    else if (ctx.toast) ctx.toast("Stuart could not check the job: " + msg, true);
  }
}
function demoAnalyse(S) {
  const id = "demo" + Date.now(), base = state.jobs.find((x) => x.analysis) || {}, j = { id, stage: "reading", status: "Considering", facts: {}, analysis: null };
  state.jobs = [j].concat(state.jobs); S.jobId = id; S.phase = "run"; render();
  setTimeout(() => { j.stage = "fit"; j.facts = { organisation: "Northwind Health", role: "Director, Strategy and Transformation", closingDate: "2026-11-30", location: "Singapore" }; render(); }, 1400);
  setTimeout(() => { j.stage = "done"; j.analysis = clone(base.analysis) || {}; if (state.sheet && state.sheet.jobId === id) { state.sheet = null; openJob(id); } else render(); }, 3000);
}
function openJob(id) {
  state.openJob = id; state.buildJob = id; state.optOpen = null; state.review = null; state.email = null; state.chat = []; state.chatOpen = false; state.err = ""; state.cxEdit = null; state.fitOpen = false; state.cxNew = false; state.coachBusy = building.has(id) ? BUILD_LABEL : "";
  if (ctx.mode === "local") { const j = state.jobs.find((x) => x.id === id); state.chat = (j && j.demoChat) || []; }
  if (ctx.mode !== "local") watchChat(id);
  render(); window.scrollTo({ top: 0 });
}
async function makeApp(j) { // the user did not tick "Add it to my applications" when adding the job
  const f = j.facts || {}, a = j.analysis || {}, cov = a.coverage || {}, today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), FS = ctx.FS;
  const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null), L = (ctx.apps && ctx.apps()) || [];
  const ref = await FS.addDoc(FS.collection(ctx.db, "users", ctx.user.uid, "applications"), { org: String(f.organisation || "Untitled").slice(0, 200), role: String(f.role || "").slice(0, 200), channel: String(f.channel || "").slice(0, 120), salary: String(f.salary || "").slice(0, 120),
    closingDate: /^\d{4}-\d{2}-\d{2}$/.test(String(f.closingDate || "")) ? f.closingDate : "", stage: "Saved", stageAt: today, stages: [{ stage: "Saved", date: today, note: "Added through Stuart", source: "stuart" }],
    scores: { roleFit: num((a.roleFit || {}).score), careerAspiration: num((a.careerAspiration || {}).score), atsMust: num(cov.present), atsTotal: num(cov.total), fitCheck: "Stuart fit check, " + today },
    jobId: j.id, order: L.length + 1, notes: "", nextAction: "", updatedAt: FS.serverTimestamp() });
  return ref.id;
}
function fitDetail(a) {
  const li = (arr, fn) => (arr || []).map(fn).join(""), ats = a.ats || {};
  return `<div class="sx-fd"><h3>Hard screens</h3><div class="kv">${li(a.hardScreens, (h) => `<div class="k">${esc(h.status)}</div><div class="v"><b>${esc(h.requirement)}</b>${h.evidence ? "<br>" + esc(h.evidence) : ""}${h.gap ? "<br><i>Gap: " + esc(h.gap) + "</i>" : ""}</div>`) || '<div class="v">None listed</div>'}</div>
  ${(a.transferable || []).filter((t) => t && t.requirement && t.evidence).length ? `<h3>Transferable skills</h3><p class="sx-sp sm">You have shown these in a different setting. Lead with the skill, then name the setting honestly.</p><div class="kv">${li(a.transferable.filter((t) => t && t.requirement && t.evidence), (t) => `<div class="k">Transferable</div><div class="v"><b>${esc(t.requirement)}</b><br>${esc(t.evidence)}${t.difference ? "<br><i>Different setting: " + esc(t.difference) + "</i>" : ""}${t.say ? "<br>How to say it: " + esc(t.say) : ""}</div>`)}</div>` : ""}
  <h3>Keywords</h3><div class="kv"><div class="k">In your CV</div><div class="v">${li(ats.must, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.evidence)}</div>`) || "None"}</div><div class="k">Nice to have</div><div class="v">${li(ats.nice, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.evidence)}</div>`) || "None"}</div><div class="k">Missing</div><div class="v">${li(ats.gap, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.why)}</div>`) || "None"}</div></div>
  ${(a.nextSteps || []).filter(Boolean).length ? `<h3>Next steps</h3><ol>${li(a.nextSteps.filter(Boolean), (s) => `<li>${esc(s)}</li>`)}</ol>` : ""}</div>`;
}
/* ---------- 2.28.0 Practise with Stuart: one question at a time; your view first, then feedback ---------- */
const PR_SRC = { advertisement: "from the advertisement", gap: "on a gap in your fit check", cv: "from your CV" };
function watchPractice(jobId) {
  if (state.pr && state.pr.unsub) { state.pr.unsub(); state.pr.unsub = null; }
  if (!state.pr || ctx.mode === "local") return;
  const { db, FS, user } = ctx;
  state.pr.unsub = FS.onSnapshot(FS.query(FS.collection(db, "users", user.uid, "jobs", jobId, "practice"), FS.orderBy("createdAt", "desc"), FS.limit(100)), (q) => { if (!state.pr) return; const L = q.docs.map((d) => ({ sid: d.id, ...d.data() })); state.pr.doc = L[0] || null; state.pr.past = L.slice(1); state.pr.loaded = true; render(); scrollEnd(); }, () => { if (state.pr) { state.pr.loaded = true; render(); } });
}
function openPractice(id) { state.openJob = id; state.buildJob = id; state.optOpen = null; state.pr = { jobId: id, doc: null, loaded: ctx.mode === "local", busy: "" }; state.err = ""; watchPractice(id); render(); window.scrollTo({ top: 0 }); }
function closePractice() { if (state.pr && state.pr.unsub) state.pr.unsub(); state.pr = null; state.err = ""; render(); }
export function openPracticeApp(appId) {
  if (!ctx) return false; const L = state.jobs || [], apps = (ctx.apps && ctx.apps()) || [], a = apps.find((x) => x.id === appId), j = L.find((x) => x.appId === appId) || (a && a.jobId && L.find((x) => x.id === a.jobId));
  state.sheet = null;
  if (j && j.analysis) { state.prNote = ""; openPractice(j.id); return true; }
  state.openJob = null; state.prNote = "To practise, first add this job's advertisement to Stuart. The questions come from it."; return false;
}
function demoPractice(action, text) {
  const P = state.pr, Q = (t, source) => ({ id: t.slice(0, 8), text: t, source, answer: "", view: "", feedback: null, skipped: false, tries: [] });
  if (action === "start") { if (P.doc) { P.past = [P.doc].concat(P.past || []); } P.doc = { sid: "demo", kind: "coached", status: "open", cur: 0, thin: false, questions: [Q("Why do you want this role, and why now?", "advertisement"), Q("Tell me about a time you led change across teams who did not report to you.", "advertisement"), Q("The role asks for a recognised change-management certification. How would you handle not having one?", "gap")] }; return; }
  const d = P.doc, q = d.questions[d.cur];
  if (action === "answer") { q.answer = text; q.view = ""; q.feedback = null; }
  else if (action === "feedback") { q.view = text; q.feedback = { ack: "Thanks for saying how that felt.", strong: "You gave a clear reason in your own words.", missing: "What result would show this was the right move?", change: "End with the result, then why it mattered.", star: { situation: true, task: true, action: true, result: false }, unsourced: false }; }
  else if (action === "retry") { q.tries = q.tries.concat({ answer: q.answer, view: q.view, feedback: q.feedback }); q.answer = ""; q.view = ""; q.feedback = null; }
  else { if (action === "skip") q.skipped = true; d.cur += 1; if (d.cur >= d.questions.length) d.status = "done"; }
}
async function practiceCall(action, text, label) {
  const P = state.pr; if (!P || P.busy) return false;
  state.err = "";
  if (ctx.mode === "local") { demoPractice(action, text); render(); scrollEnd(); return true; }
  P.busy = label; render(); scrollEnd();
  try { await busyWhile(callables.stuartPractise({ action, jobId: P.jobId, sid: P.doc && P.doc.sid, text }), label); if (state.pr) state.pr.busy = ""; render(); scrollEnd(); return true; }
  catch (e) { if (state.pr) state.pr.busy = ""; state.err = errMsg(e); render(); return false; }
}
function prFeedback(f) {
  const st = f.star || {}, chip = (k, l) => `<span class="pr-c ${st[k] ? "ok" : "no"}">${l}${st[k] ? "" : " missing"}</span>`;
  return `<p>${esc(f.ack)}</p><div class="pr-st" aria-label="Your answer against situation, task, action and result">${chip("situation", "Situation")}${chip("task", "Task")}${chip("action", "Action")}${chip("result", "Result")}</div>
  <div class="cx-card"><b class="pr-h ok">Strong</b><p>${esc(f.strong)}</p></div><div class="cx-card"><b class="pr-h warn">Missing</b><p>${esc(f.missing)}</p></div><div class="cx-card"><b class="pr-h">One change to try</b><p>${esc(f.change)}</p></div>${f.unsourced ? `<p class="cx-warn">This feedback mentions a figure Stuart could not find in your answer or CV. Check it before you rely on it.</p>` : ""}`;
}
// Every earlier session stays readable here until the job is deleted, with each attempt and its feedback.
function prPast(x) {
  const qs = x.questions || [], ans = qs.filter((q) => q.answer || (q.tries || []).length), when = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "This session";
  const one = (q, t) => `<div class="cx-u">${esc(t.answer)}</div>${t.view ? `<div class="cx-u">${esc(t.view)}</div>` : ""}${t.feedback ? prFeedback(t.feedback) : ""}`;
  return `<details class="cx-card pr-past"><summary>${esc(when)} · ${ans.length} ${ans.length === 1 ? "answer" : "answers"}</summary>${qs.map((q) => `<p><b>${esc(q.text)}</b></p>${(q.tries || []).map((t) => one(q, t)).join("")}${q.answer ? one(q, q) : `<p class="pr-sk">${q.skipped ? "Skipped" : "Not answered"}</p>`}`).join("")}</details>`;
}
function viewPractice(j) {
  const P = state.pr, f = j.facts || {}, d = P.doc, qs = d ? d.questions || [] : [], open = d && d.status !== "done", n = qs.length, score = Number((j.analysis.roleFit || {}).score);
  const top = `<header class="cx-top"><button type="button" class="cx-ib" data-stu="pr-x" aria-label="Back to the job">${ICO.back}</button><div class="cx-tt"><b>Practise with Stuart</b><span>${esc([f.organisation, f.role].filter(Boolean).join(" · "))}</span></div>${isFinite(score) ? `<span class="cx-sc0" style="display:grid;place-items:center" role="img" aria-label="Role fit ${Math.round(score)} of 100">${Math.round(score)}</span>` : ""}</header>`;
  let body = "", foot = "";
  const busy = P.busy ? sayS(`<p class="cx-typing"><span class="spin"></span>${esc(P.busy)}</p>`) : "";
  const input = (ph, label) => `<div class="cx-row cx-in"><textarea id="pr-msg" rows="2" maxlength="4000" placeholder="${ph}" aria-label="${label}"></textarea><button type="button" class="cx-send" data-stu="pr-send" aria-label="Send">${ICO.send || "→"}</button></div>`;
  if (!P.loaded) body = sayS(`<p class="cx-typing"><span class="spin"></span>Opening your practice…</p>`);
  else if (!open) {
    if (d) { const done = qs.filter((q) => q.feedback).length; body += sayS(`<span class="cx-k">Practice finished</span><p>You worked through ${done} of ${n} questions. Practise again whenever you like; new questions may differ.</p>`); }
    else body += sayS(`<p>I will prepare likely questions from this advertisement, your CV and your gaps, then ask them one at a time. After each answer I will ask how it felt, then say what was strong, what was missing and one change to try.</p><p>This is practice. It does not predict whether you will be hired, and I will not write answers for you.</p>`);
    body += prChoices();
    (d ? [d] : []).concat(P.past || []).forEach((x) => { body += prPast(x); });
    if (!P.busy) foot = `<button type="button" class="btn sx-b sx-full" data-stu="pr-start">${d ? "Practise again" : "Start practising"}</button>`;
  } else {
    (P.past || []).forEach((x) => { body += prPast(x); });
    if (d.thin) body += sayS(`<p class="cx-warn">The job details are thin, so these questions are more general. A fuller job description would make them sharper.</p>`);
    qs.slice(0, d.cur + 1).forEach((q, i) => {
      const lab = `<span class="cx-k">Question ${i + 1} of ${n} · ${esc(PR_SRC[q.source] || "")}</span>`;
      (q.tries || []).forEach((t) => { body += sayS(lab + `<p>${esc(q.text)}</p>`) + `<div class="cx-u">${esc(t.answer)}</div>` + (t.view ? `<div class="cx-u">${esc(t.view)}</div>` : "") + (t.feedback ? sayS(prFeedback(t.feedback)) : ""); });
      body += sayS(lab + `<p>${esc(q.text)}</p>`);
      if (q.skipped) { body += `<p class="pr-sk">Skipped</p>`; return; }
      if (q.answer) body += `<div class="cx-u">${esc(q.answer)}</div>`;
      if (q.answer && i === d.cur && !q.view) body += sayS(`<p>Before my view, how did that feel to you?</p>${P.busy ? "" : `<div class="cx-chips">${["Went well", "Unsure", "Rushed"].map((c) => `<button type="button" class="cx-chip" data-stu="pr-view" data-t="${c}">${c}</button>`).join("")}</div>`}`);
      if (q.view) body += `<div class="cx-u">${esc(q.view)}</div>`;
      if (q.feedback) body += sayS(prFeedback(q.feedback));
    });
    const q = qs[d.cur];
    if (!P.busy) {
      if (q.feedback) foot = `<div class="cx-next"><button type="button" class="cx-nx on" data-stu="pr-retry">Try this answer again</button><button type="button" class="cx-nx" data-stu="pr-next">${d.cur + 1 >= n ? "Finish" : "Next question"}</button></div>`;
      else if (q.answer) foot = input("Or say how it felt in your own words", "How did that feel?");
      else foot = input("Type your answer", "Your answer") + `<button type="button" class="sx-lk cx-skip" data-stu="pr-skip">Skip this question</button>`;
    }
  }
  return `<div class="cx-page">${top}<div class="cx-thread">${body}${busy}</div><div class="cx-foot">${errLine()}${foot}</div></div>`;
}
function viewJobPage() {
  const back = `<button type="button" class="sx-back" data-stu="home">${ICO.back}Stuart</button>`;
  const j = state.jobs.find((x) => x.id === state.openJob);
  if (!j) return back + `<section class="card sx-c">${state.jobsLoaded || ctx.mode === "local" ? `<p class="sx-sp">This job is no longer in Stuart's list.</p>` : `<p class="stu-busy"><span class="spin"></span>Opening the job…</p>`}</section>`;
  state.buildJob = j.id;
  if (state.pr && state.pr.jobId === j.id && j.analysis) return viewPractice(j);
  if (checking(j)) return back + `<section class="card sx-c"><h2 class="sx-k">Checking</h2><p class="stu-busy"><span class="spin"></span>Stuart is still checking this job. This page fills in when it is done.</p></section>`;
  const f = j.facts || {}, a = j.analysis || {}, b = buildOf(j.id), app = appOf(j), applied = isApplied(j);
  const lvl = a.band && a.band.level ? String(a.band.level).toLowerCase() : "";
  const band = lvl ? `<span class="sx-band ${esc(lvl)}">${esc(lvl[0].toUpperCase() + lvl.slice(1))} likelihood</span>` : "";
  const hs = a.hardScreens || [], met = hs.filter((h) => /^met$/i.test(h.status || "")), rest = hs.filter((h) => !/^met$/i.test(h.status || "")), gapT = ((a.ats || {}).gap || []).slice(0, 4), cov = a.coverage || {};
  const sc = Number((a.roleFit || {}).score), st = Number(j.coach && j.coach.startScore), up = isFinite(sc) && isFinite(st) && j.coach.startScore != null && sc > st ? Math.round(sc - st) : 0;
  const pills = (up ? `<span class="cx-pill up"><b>+${up}</b> since you started</span>` : "") + (hs.length ? `<span class="cx-pill">Hard screens <b>${met.length} of ${hs.length}</b></span>` : "") + (cov.total ? `<span class="cx-pill">Keywords <b>${esc(cov.present)} of ${esc(cov.total)}</b></span>` : "") + band;
  const whyList = `<ul class="sx-why2">${met.length ? `<li><b>Met:</b> ${esc(met.map((h) => h.requirement).join("; "))}</li>` : ""}${(a.transferable || []).filter((t) => t && t.requirement).length ? `<li><b>Transferable:</b> ${esc(a.transferable.filter((t) => t && t.requirement).map((t) => t.requirement).join("; "))}</li>` : ""}${rest.length ? `<li><b>Gaps and checks:</b> ${esc(rest.map((h) => h.requirement + (h.status ? " (" + String(h.status).toLowerCase() + ")" : "")).join("; "))}</li>` : ""}${cov.total ? `<li><b>Keywords:</b> ${esc(cov.present)} of ${esc(cov.total)} in your CV${gapT.length ? "; missing " + esc(gapT.map((g) => g.term).join(", ")) : ""}</li>` : ""}${a.recommendation ? `<li><b>Stuart's view:</b> ${esc(a.recommendation)}${a.why ? ". " + esc(a.why) : ""}</li>` : ""}</ul>
    <p class="sx-sp sm">The band is Stuart's judgement, not a probability${a.band && (a.band.reasons || []).length ? ": " + esc(a.band.reasons.map((r) => String(r).replace(/[.\s]+$/, "")).join(". ")) : ""}.</p>`;
  const done = applied ? `<section class="card sx-c sx-done"><div class="sx-tx"><b>${esc(app && app.stage && !["Applied", "Saved", "Preparing"].includes(app.stage) ? "Stage: " + app.stage : "Applied" + (app && app.dateSubmitted ? " on " + fmtD(app.dateSubmitted) : ""))}</b><span>${b && b.saved ? "The three files are in Documents." : "Tell Stuart an update on the home page when you hear back."}</span></div>${app ? `<button type="button" class="btn btn--ghost sx-b sm" data-stu="app-open" data-id="${esc(app.id)}">Open in Applications</button>` : ""}</section>` : "";
  maybeStartCoach(j);
  let lead = "";
  if (!state.cv || !(state.cv.experience || []).length) lead = sayS(`<p>I work from your master CV. Set it up once and I can show you what would lift this application, one thing at a time.</p><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="tab" data-k="cv">Open Writer</button></div>`);
  else if (!state.chat.length && !state.coachBusy && !j.coach && !applied) lead = sayS(`<p>I can go through what would lift this application, one thing at a time.</p><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-start">Start</button></div>`);
  const typing = state.coachBusy || state.busy ? sayS(`<p class="cx-typing"><span class="spin"></span>${esc(state.coachBusy || state.busy)}</p>`) : "";
  const ready = state.chat.some((m) => m.data && m.data.ready);
  const skip = !b && !applied && state.cv && !ready && !state.coachBusy && state.chat.length ? `<button type="button" class="sx-lk cx-skip" data-stu="tailor">Build the documents now</button>` : "";
  const I = b && b.inspection, answered = b ? sinceBuild(b).length : 0;
  // 2.28.12: one action above the reply box; bright only once Stuart has nothing left to ask. The rest live in the menu and in the chat.
  const last = state.chat[state.chat.length - 1], lastD = (last && last.data) || {}, waiting = openQuestion(b, applied) || (last && last.role === "assistant" && ((lastD.choices || []).length || (last.kind === "proposal" && (lastD.status || "open") === "open")));
  const next = b && !applied && answered && !state.coachBusy && !state.inspBusy ? (waiting ? `<button type="button" class="cx-nxq" data-stu="tailor">Rebuild with your answers</button>` : `<div class="cx-next"><button type="button" class="cx-nx on" data-stu="tailor">Rebuild with your answers</button></div>`) : "";
  const score = Number((a.roleFit || {}).score);
  const top = `<header class="cx-top"><button type="button" class="cx-ib" data-stu="home" aria-label="Back to Stuart">${ICO.back}</button><div class="cx-tt"><b>${esc(f.organisation || "Untitled")}</b><span>${esc([f.role, f.closingDate ? "closes " + fmtD(f.closingDate) : ""].filter(Boolean).join(" · "))}</span></div>${isFinite(score) && a.roleFit ? `<button type="button" class="cx-sc0" data-stu="fit-open" aria-label="Role fit ${Math.round(score)} of 100. Open the full fit check">${Math.round(score)}</button>` : ""}<details class="sx-dd cx-more"><summary class="cx-ib" aria-label="More">${ICO.more}</summary><div class="sx-menu"><button type="button" data-stu="fit-open">Full fit check</button>${b && !applied && !(I && I.summary) && !state.coachBusy && !state.inspBusy ? `<button type="button" data-stu="insp-run">Check the documents</button>` : ""}${b && !applied && !state.coachBusy && !state.inspBusy ? `<button type="button" data-stu="applied">Mark as applied</button>` : ""}${a.roleFit ? `<button type="button" data-stu="pr-open">Practise for the interview</button>` : ""}${b && !applied ? `<button type="button" data-stu="tailor">Rebuild the documents</button>` : ""}<button type="button" class="cx-mdel" data-stu="del-job">Delete this job</button></div></details></header>`;
  const fit = state.fitOpen ? `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Full fit check"><div class="sx-rvb card"><div class="sx-rvh"><b>Full fit check · ${esc(f.organisation || "")}</b><button type="button" class="sx-pvx" data-stu="fit-x" aria-label="Close">${ICO.x}</button></div>${pills ? `<div class="cx-sc">${pills}</div>` : ""}${whyList}${fitDetail(a)}</div></div>` : "";
  return `<div class="cx-page">${top}<div class="cx-thread">${done}${applied ? "" : jobRulesHTML(j)}${lead}${threadHTML(j, b, applied)}${typing}</div><button type="button" class="cx-new" data-stu="cx-down" hidden>New message ↓</button><div class="cx-foot">${errLine()}${skip}${next}<div class="cx-row cx-in"><textarea id="cx-msg" rows="1" maxlength="4000" placeholder="Reply to Stuart" aria-label="Reply to Stuart"></textarea><button type="button" class="cx-send" data-stu="cx-send" aria-label="Send">${ICO.send}</button></div></div></div>` + fit + reviewHTML(b) + inspHTML(b) + emailHTML(b);
}

function reviewHTML(b) {
  const k = state.review; if (!k || !b) return "";
  const lab = { cv: "Tailored CV", resume: "Resume", letter: "Cover letter" }[k];
  const body = k === "letter" ? `<div class="sx-lted">${(b.letter.paragraphs || []).map((x, i) => `<label class="sx-f wide"><span>Paragraph ${i + 1}</span><textarea data-lt="${i}" rows="4">${esc(x)}</textarea></label>`).join("")}<div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="lt-save">Save letter</button></div></div>${letterHTML(b.letter, state.cv, signFor(b))}`
    : `<p class="sx-sp sm">To change the content, edit your master CV in the CV builder and rebuild. Lines marked in amber hold a figure Stuart could not find in your CV.</p>${docHTML(b[k], k, photoFor(b, k))}`;
  return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="${lab}"><div class="sx-rvb card"><div class="sx-rvh"><b>${lab} · ${esc(b.org || "")}</b><button type="button" class="sx-pvx" data-stu="review-x" aria-label="Close">${ICO.x}</button></div>${body}</div></div>`;
}
/* output: print to PDF, Word download */
/* 2.45.0 PDFs on iPhone and iPad. iOS ignores window.print() unless it runs inside the tap itself, and in a home-screen app
   it often does nothing at all. So on iOS the document is laid out off screen with the same print styles, then drawn into a
   real PDF (jsPDF, vendored, loaded ahead of the tap): real text in reading order, the design's colours, page breaks between
   lines. The file goes to the share sheet (Save to Files, Print, Mail), or downloads where sharing files is not offered.
   Computers keep the browser's print dialog, now called inside the tap. */
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) || /[?&]iospdf=1\b/.test(location.search); // the last: to test this path on a computer
let jsPdfP = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return (jsPdfP = jsPdfP || new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "vendor/jspdf-4.2.1.umd.min.js"; sc.onload = () => (window.jspdf ? ok(window.jspdf.jsPDF) : no(new Error("The PDF tool did not start."))); sc.onerror = () => { jsPdfP = null; sc.remove(); no(new Error("Could not load the PDF tool. Check the connection and try again.")); }; document.head.appendChild(sc); }));
}
let pdfCss = false;
function pdfStyles() { // the @media print rules for #sx-print, copied once for an off-screen #sx-pdf, so the PDF uses the print sizes
  if (pdfCss) return; pdfCss = true; const out = [];
  for (const sh of [...document.styleSheets]) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of [...rules]) if (r.media && [...r.media].includes("print")) for (const x of [...r.cssRules]) if (x.selectorText && x.selectorText.includes("#sx-print")) out.push(x.cssText.replace(/#sx-print/g, "#sx-pdf")); }
  const st = document.createElement("style"); st.textContent = out.join("\n") + "\n#sx-pdf,#sx-pdf *{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}#sx-pdf{position:fixed;left:-20000px;top:0;width:170mm;background:#fff}#sx-pdf .sx-a4{box-shadow:none;border-radius:0;max-height:none;overflow:visible}"; document.head.appendChild(st);
}
function pdfColour(c) { // computed colour -> [r, g, b, alpha]; Safari reports color-mix() results as color(srgb ...)
  let m = String(c || "").match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = String(c || "").match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
  return [0, 0, 0, 0];
}
function pdfBuild(J, html, name) {
  pdfStyles();
  const host = document.createElement("div"); host.id = "sx-pdf"; host.innerHTML = html; document.body.appendChild(host);
  try {
    const PX = 25.4 / 96, M = 20, PH = 257, o = host.getBoundingClientRect(), mm = (v) => v * PX;
    const doc = new J({ unit: "mm", format: "a4" }), lines = [], boxes = [], imgs = [], dots = [];
    // backgrounds and borders, in document order
    host.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(); if (!r.width || !r.height || cs.display === "none" || cs.visibility === "hidden") return;
      const bg = pdfColour(cs.backgroundColor); if (bg[3] > 0.05 && !(bg[0] > 250 && bg[1] > 250 && bg[2] > 250)) boxes.push({ y: mm(r.top - o.top), h: mm(r.height), x: mm(r.left - o.left), w: mm(r.width), c: bg });
      for (const [side, f] of [["Left", (w) => [r.left, r.top, w, r.height]], ["Bottom", (w) => [r.left, r.bottom - w, r.width, w]], ["Top", (w) => [r.left, r.top, r.width, w]]]) {
        const w = parseFloat(cs["border" + side + "Width"]), c = pdfColour(cs["border" + side + "Color"]); if (w > 0 && cs["border" + side + "Style"] !== "none" && c[3] > 0.05) { const [x, y, ww, hh] = f(w); boxes.push({ x: mm(x - o.left), y: mm(y - o.top), w: mm(ww), h: mm(hh), c }); }
      }
      if (el.tagName === "IMG" && el.complete && el.naturalWidth) imgs.push({ el, x: mm(r.left - o.left), y: mm(r.top - o.top), w: mm(r.width), h: mm(r.height), round: parseFloat(cs.borderTopLeftRadius) >= r.width * 0.4 });
      if (el.tagName === "LI" && cs.listStyleType !== "none" && el.closest("ul")) { const f = parseFloat(cs.fontSize); dots.push({ x: mm(r.left - o.left) - mm(f * 0.75), y: mm(r.top - o.top) + mm(f * 0.62), r: mm(f * 0.16), c: pdfColour(cs.color) }); }
    });
    // text, line by line, in reading order
    const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) {
      const t = n.nodeValue; if (!t.trim()) continue; const el = n.parentElement, cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
      const fs = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 600, it = cs.fontStyle === "italic", up = cs.textTransform === "uppercase", col = pdfColour(cs.color);
      const fam = /georgia|times/i.test(cs.fontFamily.split(",")[0]) ? "times" : "helvetica", keep = !!el.closest(".h,.rl,.lc,.nm,.tg"), blk = el.closest("li,p,.yl,.cp,.h");
      const re = /\S+\s*/g; let m, cur = null; const rg = document.createRange();
      const add = (str, rr) => { if (cur && Math.abs(rr.top - cur.top) < fs * 0.5) cur.text += str; else { cur = { top: rr.top, left: rr.left, h: rr.height, text: str, fs, bold, it, up, col, fam, keep, blk }; lines.push(cur); } };
      while ((m = re.exec(t))) { rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const rs = [...rg.getClientRects()].filter((q) => q.width > 0); if (!rs.length) continue;
        if (rs.every((q) => Math.abs(q.top - rs[0].top) < fs * 0.5)) { add(m[0], rs[0]); continue; }
        for (let k = 0; k < m[0].length; k++) { rg.setStart(n, m.index + k); rg.setEnd(n, m.index + k + 1); const q = [...rg.getClientRects()].find((x) => x.width > 0) || (cur && { top: cur.top, left: cur.left, height: cur.h }); if (q) add(m[0][k], q); } } // a word the browser broke across lines (at a hyphen)
    }
    lines.forEach((l) => { l.y = mm(l.top - o.top); l.x = mm(l.left - o.left); l.hh = mm(l.h); });
    lines.sort((a, b) => a.y - b.y || a.x - b.x);
    // page breaks between lines: a line that would cross the bottom moves to the next page, with any heading just above it,
    // and the rest of its bullet or paragraph, so each stays whole
    const brk = []; let shift = 0;
    for (let i = 0; i < lines.length; i++) { const l = lines[i], top = l.y + shift, bot = top + l.hh, pg = Math.floor(top / PH);
      if (bot > (pg + 1) * PH + 0.01) { let j = i; while (j > 0 && (lines[j - 1].keep || (lines[j].blk && lines[j - 1].blk === lines[j].blk)) && Math.floor((lines[j - 1].y + shift) / PH) === pg && i - j < 6) j--; let at = lines[j].y; const pb = j > 0 ? lines[j - 1].y + lines[j - 1].hh : -1; boxes.forEach((b) => { if (b.y > pb + 0.01 && b.y < at) at = b.y; }); const d = (pg + 1) * PH - (at + shift) + 1.5; brk.push({ at, d }); shift += d; } } // a card or banner that starts between the two lines moves with them
    const map = (y) => y + brk.filter((b) => b.at <= y + 0.001).reduce((a, b) => a + b.d, 0);
    const pages = Math.max(1, Math.ceil((lines.length ? map(lines[lines.length - 1].y) + lines[lines.length - 1].hh : 1) / PH));
    for (let p = 1; p < pages; p++) doc.addPage();
    const put = (y0, h, fn) => { const a = map(y0), b = map(y0 + h); const p0 = Math.floor(a / PH), p1 = Math.floor(Math.max(a, b - 0.01) / PH); for (let p = p0; p <= p1 && p < pages; p++) { const t = Math.max(a, p * PH), u = Math.min(b, (p + 1) * PH); if (u > t) { doc.setPage(p + 1); fn(M + t - p * PH, u - t); } } };
    boxes.forEach((b) => put(b.y, b.h, (y, h) => { doc.setFillColor(b.c[0], b.c[1], b.c[2]); doc.rect(M + b.x, y, b.w, h, "F"); }));
    imgs.forEach((im) => put(im.y, im.h, (y, h) => { try { const src = im.el.currentSrc || im.el.src; if (im.round && doc.saveGraphicsState) { doc.saveGraphicsState(); doc.circle(M + im.x + im.w / 2, y + im.h / 2, im.w / 2, null); doc.clip(); doc.discardPath(); doc.addImage(src, M + im.x, y, im.w, im.h); doc.restoreGraphicsState(); } else doc.addImage(src, M + im.x, y, im.w, im.h); } catch (e) {} }));
    dots.forEach((d) => put(d.y - d.r, d.r * 2, (y) => { doc.setFillColor(d.c[0], d.c[1], d.c[2]); doc.circle(M + d.x, y + d.r, d.r, "F"); }));
    lines.forEach((l) => { const y = map(l.y), p = Math.floor(y / PH); doc.setPage(Math.min(p, pages - 1) + 1); doc.setFont(l.fam, l.bold && l.it ? "bolditalic" : l.bold ? "bold" : l.it ? "italic" : "normal"); doc.setFontSize(l.fs * 0.75); doc.setTextColor(l.col[0], l.col[1], l.col[2]);
      doc.text((l.up ? l.text.toUpperCase() : l.text).replace(/\s+$/, ""), M + l.x, M + y - p * PH + mm(l.fs) * 0.905, { baseline: "alphabetic" }); });
    doc.setProperties({ title: name });
    return doc.output("blob");
  } finally { host.remove(); }
}
async function pdfSave(blob, name) {
  const file = new File([blob], name + ".pdf", { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name + ".pdf"; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
function printDoc(kind, look) {
  const b = buildOf(state.buildJob), html = kind === "master" ? docHTML(draft(), "cv") : kind === "letter" ? letterHTML(b && b.letter, state.cv, signFor(b)) : look ? docHTML(b && b[kind], kind, look.photo && hasPhoto() ? ctx.photo() : null, look) : docHTML(b && b[kind], kind, photoFor(b, kind));
  const who = kind === "master" ? draft() : state.cv, name = fileName(kind, who && who.name, kind === "master" ? "" : b && b.org, !!look);
  printOut(html, name);
}
function printOut(html, name) {
  if (IOS) {
    if (!window.jspdf) { loadJsPdf().then(() => { if (ctx.toast) ctx.toast("The PDF tool is ready. Tap Download PDF again."); }, (e) => { if (ctx.toast) ctx.toast(e.message, true); }); if (ctx.toast) ctx.toast("Getting the PDF tool ready…"); return; }
    let blob; try { blob = pdfBuild(window.jspdf.jsPDF, html, name); } catch (e) { if (ctx.toast) ctx.toast("Could not make the PDF. Try again, or use Download Word.", true); return; }
    pdfSave(blob, name); return; // inside the tap, so iOS allows the share sheet
  }
  let el = document.getElementById("sx-print"); if (!el) { el = document.createElement("div"); el.id = "sx-print"; document.body.appendChild(el); }
  el.innerHTML = `<div class="sx-pgb">${html}</div>`; document.body.classList.add("sx-printing");
  /* the browser offers the page title as the PDF's file name */
  const title = document.title; document.title = name;
  const done = () => { document.title = title; document.body.classList.remove("sx-printing"); el.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  const imgs = [...el.querySelectorAll("img")].filter((i) => !i.complete);
  if (!imgs.length) { window.print(); return; } // 2.45.0: inside the tap; Safari ignores a print that comes later
  Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null))).then(() => window.print());
}
function saveB64(name, b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}
/* draft editing */
function setPath(o, path, v) { const p = path.split("."); let x = o; for (let i = 0; i < p.length - 1; i++) { const k = /^\d+$/.test(p[i]) ? Number(p[i]) : p[i]; if (x[k] == null) x[k] = {}; x = x[k]; } x[p[p.length - 1]] = v; }
function ensureDraft() { if (!state.cvDraft) state.cvDraft = clone(state.cv); return state.cvDraft; }
let pvT = null;
function refreshPreview() { clearTimeout(pvT); pvT = setTimeout(() => { const c = draft(), b = document.getElementById("sx-pvb"), pg = document.getElementById("sx-pages"); if (b) b.innerHTML = docHTML(c, "cv"); if (pg) { const n = estPages(c, "cv"); pg.textContent = "about " + n + " of 6 pages"; pg.className = "sx-pc " + (n > 6 ? "warn" : "ok"); } }, 150); }
function cvDirtyHTML(c) { return `<div class="wr-st"><i class="w"></i><b>Unsaved changes</b></div><div class="sx-sv2"><button type="button" class="btn btn--ghost sx-b sm" data-stu="cv-discard">Discard</button><button type="button" class="btn sx-b sm" data-stu="cv-save">Save as version ${esc(nextVer(c.version))}</button></div>`; }
function markDirty() { if (!state.cvDirty) { state.cvDirty = true; const s = document.querySelector(".wr"), st = s && s.querySelector(".sx-st0"); if (st) { s.classList.add("dirty"); st.innerHTML = cvDirtyHTML(draft()); } } }
async function cvSave(quiet) {
  const c = ensureDraft(); c.version = nextVer(state.cv ? c.version : "0.9"); if (!state.cv) c.version = "1.0";
  c.experience = (c.experience || []).map((r) => ({ ...r, bullets: (r.bullets || []).filter((b) => hasText(b.text)) }));
  LISTS.forEach((k) => { c[k] = (c[k] || []).filter((x) => hasText(x.text)); });
  if (ctx.mode === "local") { state.cv = clone(c); state.cvDraft = null; state.cvDirty = false; render(); if (ctx.toast) ctx.toast("Master CV saved as v" + c.version); return; }
  try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "master"), { ...c, updatedAt: ctx.FS.serverTimestamp() }); state.cvDraft = null; state.cvDirty = false; if (ctx.toast && !quiet) ctx.toast("Master CV saved as v" + c.version); }
  catch (e) { state.err = "Could not save the CV (" + (e.code || e.message) + ")."; render(); }
}
function demoSuggestions(sec, item) {
  if (sec === "summary") return [{ field: "headline", old: item.headline, new: "Operations leader who turns clinic data into faster, fairer patient access", why: "Leads with the outcome the advertisement cares about.", unsourced: false }];
  return [{ index: (item.bullets || []).length ? 0 : -1, old: (item.bullets || [])[0] ? item.bullets[0].text : "", new: "Led a team of 12 across three clinics and cut appointment no-shows from 18% to 11% in 2024.", why: "Joins the team size to the result.", unsourced: false },
    { index: -1, old: "", new: "Planned the department's S$1.2M operating budget with finance each year.", why: "A budget figure would strengthen this; confirm the amount.", unsourced: true }];
}
function demoBuild(j) {
  const m = state.cv || {}, f = j.facts || {};
  const pick = (cap) => (m.experience || []).map((r) => ({ ...r, bullets: (r.bullets || []).slice(0, cap).map((b) => ({ text: b.text })) }));
  return { id: j.id, jobId: j.id, org: f.organisation || "", role: f.role || "", masterVersion: m.version || "1.0",
    // the preview shows the figure check: one tailored bullet carries a figure the sample CV never gave
    cv: { ...clone(m), headline: m.headline, summary: m.summary, experience: pick(12).map((r, i) => i ? r : { ...r, bullets: r.bullets.concat([{ text: "Cut clinic waiting times by 30% across three sites.", unsourced: true }]) }) }, resume: { ...clone(m), referees: [], experience: pick(3).slice(0, 3) },
    letter: { to: "Hiring Manager", greeting: "Dear Hiring Manager,", closing: "Yours sincerely", unsourced: [false, false, false, false], paragraphs: ["I am applying for the " + (f.role || "role") + " at " + (f.organisation || "your organisation") + ". This is a sample letter in the preview.", "In my current role I lead a team of 12 across three clinics and cut appointment no-shows from 18% to 11% in 2024.", "I built the referral dashboard that 40 clinicians use each week, which matches your focus on data-led service design.", "I would welcome the chance to discuss the role."] },
    questions: ["Who should the cover letter be addressed to? The advertisement names no hiring manager.", "Can you start before 1 January 2027?"], notes: "", answers: "", saved: null };
}

/* preview only: a scripted coach on the sample CV, so the conversation can be tried without signing in */
function demoCoachStart(j) {
  const sc = Number((j.analysis && j.analysis.roleFit || {}).score) || 70;
  j.coach = { startScore: sc, gaps: [
    { id: "g1", kind: "hidden", title: "Board reporting is not in your CV", gain: 6, status: "open", ask: "**First, board reporting.** The advertisement asks for experience reporting to a board or executive committee. Have you presented to senior leaders? Tell me who, how often, and on what.", line: "Reported to the executive committee on clinic performance and service changes." },
    { id: "g2", kind: "weak", title: "Transformation work has no scale", gain: 4, status: "open", ask: "**Next, your service changes.** Your CV says you improved services, but not how big the change was. How many sites, staff or patients did the biggest change touch?", line: "Led a service redesign across three clinics." },
    { id: "g3", kind: "real", title: "A recognised change-management certification", gain: 0, status: "open", choices: ["Apply anyway", "Plan the certificate", "Skip this role"], ask: "**The last one is a real gap.** The advertisement asks for a recognised change-management certification, and none is on record. No wording changes that. Your options:" }] };
  j.coach.phase = "reaction";
  j.demoChat = state.chat = [{ id: "d0", role: "assistant", text: "I have read Northwind Health's advertisement against your CV. Your fit comes out at **" + sc + " of 100**, with a medium callback likelihood; that is my judgement, not a prediction. Before I go through why: how does that land with you?", data: { choices: ["About what I expected", "Lower than I hoped", "Higher than I thought"] } }];
}
function demoNext(j) {
  const g = j.coach.gaps.find((x) => x.status === "open"); if (g) return { id: "d" + Date.now() + "n", role: "assistant", text: g.ask, data: { choices: g.kind === "real" ? g.choices : ["Skip this one", "I am not sure"] } };
  j.coach.phase = "will"; const n = j.coach.gaps.filter((x) => x.status === "done").length;
  return { id: "d" + Date.now() + "w", role: "assistant", text: "**Your way forward.** " + (n ? "So far you added " + (n === 1 ? "one line" : n + " lines") + " to your master CV. " : "") + "What will you do next, and by when?", data: { choices: ["Apply this week", "Build first, decide later", "Work on the gap first"] } };
}
function demoCoachReply(text) {
  const j = state.jobs.find((x) => x.id === state.openJob); if (!j) return;
  if (!j.coach) demoCoachStart(j);
  const cur = j.coach.gaps.find((x) => x.status === "open"), L = state.chat.map((m) => (m.temp ? { ...m, temp: false, id: "d" + Date.now() + "u" } : m)), id = "d" + Date.now();
  if (j.coach.phase === "reaction") { j.coach.phase = "goal"; L.push({ id: id + "a", role: "assistant", text: "That is a fair reaction. The score comes mostly from one screen: board-level reporting is asked for and your CV does not show it, and the scale of your service changes is not stated." }, { id: id + "b", role: "assistant", kind: "gaps", text: "Three things decide this application. Two you can fix in a few minutes; one needs more than wording." }, { id: id + "c", role: "assistant", text: "**Goal first.** This role leads strategy and transformation across a health group. Is it the job you want, or a step towards something else?", data: { choices: ["This is the job I want", "A step towards something else", "Not sure yet"] } }); }
  else if (j.coach.phase === "goal") { j.coach.phase = "gaps"; j.coach.goal = text; L.push({ id: id + "a", role: "assistant", text: "Understood. I will frame your operations record as strategy work at group level." }, demoNext(j)); }
  else if (j.coach.phase === "will") { j.coach.phase = "done"; L.push({ id: id + "a", role: "assistant", text: "Noted: " + text.toLowerCase() + "." }, { id: id + "r", role: "assistant", text: "Ready to build your CV, resume and cover letter.", data: { ready: true } }); }
  else if (!cur) L.push({ id: "d" + Date.now(), role: "assistant", text: "In the preview I follow a script. On the hosted app I answer your question here." });
  else if (/skip|not sure/i.test(text)) { cur.status = "skipped"; L.push({ id: "d" + Date.now(), role: "assistant", text: "No problem, we will leave that one." }, demoNext(j)); }
  else if (cur.kind === "real") { cur.status = "decided"; cur.decision = text; L.push({ id: "d" + Date.now(), role: "assistant", text: /skip/i.test(text) ? "Understood." : "Then I will lead with your strongest evidence and name the gap once, briefly, in the cover letter." }, demoNext(j)); }
  else { const r = (state.cv.experience || [])[0] || {}; L.push({ id: "d" + Date.now() + "p", role: "assistant", kind: "proposal", text: "That counts. Here is a line from what you said:", data: { roleId: r.id, role: [r.title, r.org].filter(Boolean).join(", "), text: cur.line, gapId: cur.id, status: "open", unsourced: false } }); }
  j.demoChat = state.chat = L;
}
function demoCheck(c) { // local preview: code-only repeats, no conflicts
  const L = []; (c.experience || []).forEach((r, ri) => (r.bullets || []).forEach((b, bi) => L.push({ id: `r${ri}b${bi}`, text: b.text, where: [r.title, r.org].filter(Boolean).join(", ") })));
  const used = new Set(), repeats = [];
  L.forEach((a, i) => L.slice(i + 1).forEach((b) => { if (used.has(a.id) || used.has(b.id) || !nearLineC(a.text, b.text)) return; used.add(a.id); used.add(b.id); const keep = String(b.text).length > String(a.text).length ? b : a; repeats.push({ ids: [a.id, b.id], keep: keep.id, merged: "", why: "Nearly the same words", lines: [a, b] }); }));
  return { repeats, conflicts: [] };
}
function demoCoachAccept(m, text) {
  const j = state.jobs.find((x) => x.id === state.openJob); if (!j) return;
  const d = m.data, line = text || d.text, r = (state.cv.experience || []).find((x) => x.id === d.roleId);
  if (r) r.bullets = (r.bullets || []).concat([{ text: line, src: "stuart" }]);
  state.cv.version = nextVer(state.cv.version); d.status = "added"; d.text = line;
  const g = j.coach.gaps.find((x) => x.id === d.gapId), a = j.analysis = j.analysis || {}; a.roleFit = a.roleFit || {};
  const from = Number(a.roleFit.score) || 0, to = Math.min(100, from + ((g && g.gain) || 3)); a.roleFit.score = to; if (g) g.status = "done";
  state.chat = state.chat.concat([{ id: "d" + Date.now() + "x", role: "assistant", kind: "delta", data: { version: state.cv.version, from, to, note: g && g.kind === "hidden" ? "a hard screen is now Met" : "keyword coverage up" } }, demoNext(j)]);
  j.demoChat = state.chat;
}


/* ---------- events ---------- */
document.addEventListener("input", (e) => { if (e.target && (e.target.id === "cx-msg" || e.target.id === "cx-ed")) grow(e.target); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target && e.target.id === "cx-msg" && matchMedia("(pointer:fine)").matches) { e.preventDefault(); const b = document.querySelector("[data-stu=cx-send]"); if (b) b.click(); }
});
document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; const d = document.querySelector(".sx-dd[open]"); if (d) { d.open = false; d.querySelector("summary").focus(); } });
document.addEventListener("click", async (e) => {
  document.querySelectorAll(".sx-dd[open]").forEach((d) => { if (!d.contains(e.target) || e.target.closest(".sx-menu")) d.open = false; });
  const t = e.target.closest("[data-stu]"); if (!t || !ctx) return; const act = t.dataset.stu;
  if (act === "open") { state.sheet = null; openJob(t.dataset.id); return; }
  if (act === "home") { if (state.pr) closePractice(); state.prNote = ""; state.openJob = null; if (ctx.mode !== "local") watchChat(null); state.showPlan = false; render(); return; }
  if (await hubClick(act, t)) return;
  if (await planClick(act, t)) return;
  if (act === "show-plan") { state.openJob = null; state.tab = "plan"; render(); return; }
  if (act === "add") { state.sheet = newSheet(); state.needCV = false; render(); return; }
  if (act === "log-send") { await logSend(); return; }
  if (act === "log-ok") { await logConfirm(Number(t.dataset.i)); return; }
  if (act === "log-skip") { const m = logState.proposal && logState.proposal.matches[Number(t.dataset.i)]; if (m) { m.status = "skipped"; render(); } return; }
  if (act === "sh-x") { state.sheet = null; render(); return; }
  if (act === "sh-mode") { const S = state.sheet; if (S) { S.mode = t.dataset.k; S.err = ""; S.focus = true; render(); } return; }
  if (act === "sh-edit") { const S = state.sheet; if (S) { S.phase = "form"; S.err = ""; render(); } return; }
  if (act === "sh-retry") { const S = state.sheet; if (S && S.last) await runAnalyse(S.last); return; }
  if (act === "analyse") {
    const S = state.sheet; if (!S) return;
    const text = S.mode === "text" ? String(S.text || "") : "", url = S.mode === "file" ? "" : String(S.url || "").trim();
    if (S.mode === "text" && text.trim().length <= 40) { S.err = "Paste the whole advertisement: the role, duties and requirements."; render(); return; }
    if (S.mode === "link" && !/^https?:\/\/\S+\.\S+/i.test(url)) { S.err = "Paste a full link that starts with https://."; render(); return; }
    if (S.mode === "file" && !S.file) { S.err = "Choose a file first."; render(); return; }
    const data = S.appId ? { appId: S.appId } : { track: !!S.track };
    try { if (S.mode === "file") data.file = await readFile(S.file); else if (S.mode === "text") { data.text = text; if (url) data.link = url; } else data.url = url; }
    catch (err) { S.err = err.message || String(err); render(); return; }
    await runAnalyse(data); return; }
  if (act === "jobs-more") { if (ctx.mode === "local") return; state.jobLimit += 50; subJobs(); return; }
  if (act === "del-job") { if (ctx.deleteJob && state.openJob) { const id = state.openJob; if (await ctx.deleteJob(id)) { state.openJob = null; render(); window.scrollTo({ top: 0 }); } } return; }
  if (act === "app-open") { if (ctx.openApp) ctx.openApp(t.dataset.id); return; }
  if (ctx.mode === "local") { state.err = "Preview only. Sign in on the hosted app to use Stuart."; render(); return; }
  if (act === "consent") { if (!document.getElementById("c1").checked || !document.getElementById("c2").checked) { state.err = "Both boxes are needed to continue."; render(); return; }
    await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "profile", "current"), { consentAI: true, consentAt: ctx.FS.serverTimestamp(), consentVersion: "2026-10-31" }, { merge: true }); return; }
  if (act === "intent") { state.intention = t.dataset.k; document.querySelectorAll(".stu-opt").forEach((o) => o.classList.toggle("on", o === t)); const tg = document.getElementById("stu-target"); tg.hidden = false; tg.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (act === "plan") { const target = (document.getElementById("stu-tgt").value || "").trim(), startBy = document.getElementById("stu-date").value; if (!state.intention || !target) { state.err = "Choose why you are here and type a target."; render(); return; }
    try { await call("stuartPlan", { intention: state.intention, target, startBy }, "Stuart is drafting your plan…"); } catch (e) {} return; }
  if (act === "confirm-plan") { if (ctx.mode === "local") { state.plan.confirmed = true; state.plan.confirmedAt = Date.now(); render(); return; } await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "plan", "current"), { confirmed: true, confirmedAt: ctx.FS.serverTimestamp() }, { merge: true }); return; }
  if (act === "redraft") { const p = state.profile; try { await call("stuartPlan", { intention: p.intention, target: p.target, startBy: p.startBy }, "Stuart is redrafting…"); } catch (e) {} return; }
});
async function planClick(act, t) {
  const U = state.planUI || (state.planUI = {}), i = Number(t.dataset.i);
  if (act === "pl-cancel") { state.planUI = null; state.err = ""; render(); return true; }
  if (act === "pl-edit") { state.planUI = { mode: "edit", draft: planClone(state.plan && state.plan.plan) }; render(); return true; }
  if (act === "pl-save") {
    const d = U.draft || {}, old = (state.plan && state.plan.plan) || {}, ed = {};
    document.querySelectorAll("[data-pf]").forEach((x) => { const k = x.dataset.pf, many = k === "grow.options" || k === "grow.will"; const v = many ? x.value.split("\n").map((y) => y.trim()).filter(Boolean).slice(0, 8) : x.value.trim().slice(0, 600); planSet(d, k, v); if (ptxt(v) !== ptxt(pget(old, k))) ed[k] = true; });
    if (!Object.keys(ed).length) { state.planUI = null; render(); return true; }
    state.planUI = null; await planWrite(d, "Edited by you", ed); if (ctx.toast) ctx.toast("Plan saved"); return true; }
  if (act === "pl-dir") { state.planUI = { mode: "dir", intent: (state.profile || {}).intention || "" }; render(); return true; }
  if (act === "pl-intent") { const tg = document.getElementById("pl-tgt"), dt = document.getElementById("pl-date"); state.planUI = Object.assign(U, { intent: t.dataset.k, target: tg ? tg.value : U.target, startBy: dt ? dt.value : U.startBy }); render(); return true; }
  if (act === "pl-redraft") {
    const target = (document.getElementById("pl-tgt").value || "").trim(), startBy = document.getElementById("pl-date").value;
    if (!U.intent || !target) { state.err = "Choose why you are here and type a target role or sector."; render(); return true; }
    if (ctx.confirm && !(await ctx.confirm("Stuart drafts a new plan from these answers and your CV. Your current plan is kept under Earlier versions.", { title: "Replace your plan?", ok: "Redraft" }))) return true;
    if (ctx.mode === "local") { state.err = "Preview only. Sign in on the hosted app to use Stuart."; render(); return true; }
    try { await call("stuartPlan", { intention: U.intent, target, startBy }, "Stuart is redrafting your plan…"); state.planUI = null; render(); } catch (e) {} return true; }
  if (act === "pl-review") {
    if (ctx.mode === "local") { state.planUI = { mode: "review", sug: [{ k: "grow.reality", label: "Reality", v: "Eight years in operations; 6 applications sent, 2 interviews, replies mostly from health technology", why: "Preview: a sample suggestion." }] }; render(); return true; }
    state.planUI = { mode: "review", sug: [] }; render();
    try { const r = await call("stuartPlan", { action: "review" }, "Stuart is reviewing your plan against your progress…"); state.planUI = { mode: "review", sug: (r.suggestions || []).map((x) => Object.assign({}, x, { label: (PLAN_F.find((f) => f[0] === x.k) || [0, x.k])[1] })) }; render(); } catch (e) {} return true; }
  if (act === "pl-use" || act === "pl-keep") { const x = (U.sug || [])[i]; if (!x) return true; x.done = act === "pl-use" ? "use" : "keep";
    if (act === "pl-use") { const d = planClone(state.plan && state.plan.plan); planSet(d, x.k, x.v); const ed = Object.assign({}, (state.plan || {}).edited || {}); delete ed[x.k]; await planWrite(d, "Reviewed with Stuart", ed, true); } render(); return true; }
  if (act === "pl-hist") { state.planUI = { mode: "hist" }; render(); return true; }
  if (act === "pl-open") { state.planUI = { mode: "hist", i }; render(); return true; }
  if (act === "pl-restore") { const H = ((state.plan || {}).history || [])[i]; if (!H) return true; state.planUI = null; await planWrite(planClone(H.plan), "Restored from " + pday(H.at), H.edited || {}, true); if (ctx.toast) ctx.toast("Earlier version restored"); return true; }
  return false;
}
async function hubClick(act, t) {
  const n = (k) => Number(t.dataset[k]);
  switch (act) {
    case "tab": state.tab = t.dataset.k; state.qk = null; state.openJob = null; state.review = null; state.email = null; state.pvOpen = false; render(); window.scrollTo({ top: 0 }); return true;
    case "sec": state.cvSec = t.dataset.k; render(); return true;
    case "role": state.cvItem = n("i"); render(); return true;
    case "role-add": { const c = ensureDraft(); c.experience = c.experience || []; c.experience.unshift({ id: rid(), title: "", org: "", location: "", start: "", end: "", bullets: [{ text: "" }] }); state.cvItem = 0; state.cvDirty = true; render(); return true; }
    case "role-del": { const c = ensureDraft(), r = c.experience[n("i")]; if (!r) return true; if (ctx.confirm && !(await ctx.confirm("Remove " + (r.title || "this role") + " from your master CV? Nothing is saved until you press Save.", { ok: "Remove", danger: true }))) return true; c.experience.splice(n("i"), 1); state.cvItem = 0; state.cvDirty = true; render(); return true; }
    case "bul-add": { const c = ensureDraft(); c.experience[n("i")].bullets.push({ text: "" }); state.cvDirty = true; render(); const L = ctx.container.querySelectorAll(".sx-bul textarea"); if (L.length) L[L.length - 1].focus(); return true; }
    case "bul-del": { const c = ensureDraft(); c.experience[n("i")].bullets.splice(n("j"), 1); state.cvDirty = true; render(); return true; }
    case "li-add": { const c = ensureDraft(), k = t.dataset.k; c[k] = c[k] || []; c[k].push({ text: "" }); state.cvDirty = true; render(); const L = ctx.container.querySelectorAll(".sx-bul input"); if (L.length) L[L.length - 1].focus(); return true; }
    case "li-del": { const c = ensureDraft(); c[t.dataset.k].splice(n("j"), 1); state.cvDirty = true; render(); return true; }
    case "iv-open": state.ivOpen = true; state.tab = "cv"; state.pvOpen = false; if (ctx.mode === "local" && !state.iv) state.iv = null; render(); window.scrollTo({ top: 0 }); return true;
    case "iv-close": state.ivOpen = false; render(); return true;
    case "iv-reset": { if (ctx.confirm && !(await ctx.confirm("Start the interview again? Your answers and the draft so far are cleared. Your master CV is not affected.", { ok: "Start again", danger: true }))) return true;
      if (ctx.mode === "local") { state.iv = null; render(); return true; }
      try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "interview"), { step: "", turns: {}, draft: {}, used: false }); } catch (e) { state.err = "Could not clear the interview (" + (e.code || e.message) + ")."; render(); } return true; }
    case "iv-contact": {
      const v = (k) => ((ctx.container.querySelector(`[data-ivc="${k}"]`) || {}).value || "").trim();
      if (!v("name")) { state.err = "Type your full name."; render(); return true; }
      const draft = { name: v("name"), contact: { email: v("email"), phone: v("phone"), location: v("location"), links: v("links") } };
      state.err = "";
      if (ctx.mode === "local") { const cur = (state.iv && state.iv.draft) || {}; state.iv = { step: "current", turns: { current: [{ role: "assistant", text: "Let's start with your current or most recent job. What is your job title, where do you work, and since when?" }] }, draft: Object.assign({ experience: [], education: [], certifications: [], skills: [] }, cur, draft) }; render(); return true; }
      try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "interview"), { draft, used: false }, { merge: true }); await call("stuartInterview", { action: "start" }, "Starting the interview…"); } catch (e) {} return true; }
    case "iv-send": {
      const el = document.getElementById("sx-iv-ans"), text = el ? el.value.trim() : "";
      if (ivStep() !== "review" && !text) { state.err = "Type your answer, or press Skip this part."; render(); return true; }
      state.err = "";
      if (ctx.mode === "local") { demoIvTurn(text); render(); return true; }
      try { await call("stuartInterview", { action: "answer", text }, ivStep() === "review" ? "Stuart is drafting your headline and summary…" : "Stuart is reading your answer…"); } catch (e) { if (el) { const n = document.getElementById("sx-iv-ans"); if (n) n.value = text; } } return true; }
    case "iv-skip": if (ctx.mode === "local") { const i = IVS.findIndex((x) => x[0] === state.iv.step); state.iv.step = IVS[i + 1][0]; state.iv.turns[state.iv.step] = state.iv.turns[state.iv.step] || [{ role: "assistant", text: "Next part." }]; render(); return true; }
      try { await call("stuartInterview", { action: "skip" }, "Moving on…"); } catch (e) {} return true;
    case "iv-goto": if (ctx.mode === "local") { state.iv.step = t.dataset.k; render(); return true; } try { await call("stuartInterview", { action: "goto", step: t.dataset.k }, "Opening that part…"); } catch (e) {} return true;
    case "iv-use": {
      const d = clone(ivPreviewDoc()); if (!(d.experience || []).length && !d.name) { state.err = "There is nothing in the draft yet."; render(); return true; }
      if (state.cv && ctx.confirm && !(await ctx.confirm("Replace your master CV (v" + (state.cv.version || "1.0") + ") with the interview draft? Nothing is saved until you press Save in the CV builder.", { ok: "Use the draft" }))) return true;
      (d.experience || []).forEach((r) => (r.bullets || []).forEach((b) => { b.src = "interview"; })); // unsourced flags stay until the user edits the line
      state.cvDraft = Object.assign({ version: (state.cv && state.cv.version) || "1.0", contact: {}, headline: "", summary: "", experience: [], education: [], skills: [], certifications: [], awards: [], publications: [], referees: [] }, d);
      state.cvDirty = true; state.ivOpen = false; state.cvSec = "summary"; render();
      if (ctx.mode !== "local") ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "interview"), { used: true }, { merge: true }).catch(() => {});
      if (ctx.toast) ctx.toast("Draft moved to the CV builder. Check it, then press Save."); return true; }
    case "cv-seed": state.cvDraft = masterFromProfile(); if (ctx.mode === "local") state.cvDraft = clone(state.cv); state.cvDirty = true; state.tab = "cv"; state.cvSec = "contact"; render(); return true;
    case "cv-save": await cvSave(); return true;
    case "cv-discard": state.cvDraft = null; state.cvDirty = false; state.sugg = null; render(); return true;
    case "pv": state.pvOpen = !state.pvOpen; render(); return true;
    case "improve": {
      const sec = t.dataset.sec, c = draft(), item = sec === "summary" ? { headline: c.headline, summary: c.summary } : c.experience[n("i")];
      if (!item) return true;
      let items;
      if (ctx.mode === "local") items = demoSuggestions(sec, item);
      else { try { items = (await call("stuartImprove", { sec, item }, "Stuart is reading this part of your CV…")).suggestions; } catch (e) { return true; } }
      state.sugg = { sec, i: sec === "experience" ? n("i") : null, items: items || [] }; render(); return true; }
    case "sg-ok": case "sg-edit": {
      const S = state.sugg, x = S && S.items[n("n")]; if (!x) return true;
      if (act === "sg-ok" && x.unsourced && ctx.confirm && !(await ctx.confirm("This suggestion contains a figure that is not in your CV: \"" + x.new + "\". Accept it only if it is true.", { ok: "It is true, accept" }))) return true;
      const c = ensureDraft();
      if (S.sec === "summary") c[x.field] = x.new;
      else { const r = c.experience[S.i], b = { text: x.new, src: "stuart", confirmed: !!x.unsourced && act === "sg-ok" }; let ix = x.index; if (!(ix >= 0 && r.bullets[ix])) ix = r.bullets.findIndex((y) => nearLineC(y.text, x.new)); if (ix >= 0 && r.bullets[ix]) r.bullets[ix] = b; else r.bullets.push(b); } // 2.44.0: never a second telling
      x.done = true; state.cvDirty = true; render();
      if (act === "sg-edit") { const f = S.sec === "summary" ? ctx.container.querySelector(`[data-cv="${x.field}"]`) : [...ctx.container.querySelectorAll(".sx-bul textarea")].find((el) => el.value === x.new); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
      return true; }
    case "sg-no": { const x = state.sugg && state.sugg.items[n("n")]; if (x) { x.done = true; render(); } return true; }
    case "pick-job": state.sheet = null; openJob(t.dataset.id); return true;
    case "tailor": {
      const j = state.jobs.find((x) => x.id === state.buildJob); if (!j) return true;
      // what the user told Stuart since the last build (answers to "Before you send"); gap decisions travel on the job
      const b0 = buildOf(j.id), since = b0 ? tms(b0.createdAt) : 0;
      // 2.27.2: every answer to a "Before you send" question in this chat, plus anything else said since the last build
      const said = b0 ? state.chat.filter((m) => m.role === "user" && !m.temp && (tms(m.at) > since || Q_TAG.test(m.text || ""))) : [];
      // 2.43.0: other messages first and answers last, so each answer ends where the next begins and is remembered on its own
      const answers = said.filter((m) => !Q_TAG.test(m.text || "")).concat(said.filter((m) => Q_TAG.test(m.text || ""))).map((m) => m.text).join("\n\n").slice(-8000);
      if (ctx.mode === "local") { const nb = Object.assign(demoBuild(j), { createdAt: Date.now() }, b0 ? { prior: (b0.prior || []).concat({ masterVersion: b0.masterVersion, createdAt: b0.createdAt }) } : {}, answers ? { questions: [], answers } : {}); demoInspect(nb); state.builds = state.builds.filter((b) => b.jobId !== j.id).concat([nb]); render(); scrollEnd(); return true; }
      if (building.has(j.id)) return true; // 2.25.2: already building; leaving and reopening the page must not start and pay for a second one
      building.add(j.id); state.coachBusy = BUILD_LABEL; state.err = ""; render(); scrollEnd();
      let built = false; try { await busyWhile(callables.stuartTailor({ jobId: j.id, answers }), "Building your documents…"); built = true; } catch (e) { state.err = errMsg(e); }
      building.delete(j.id); state.coachBusy = ""; render(); scrollEnd();
      if (built) await runInspect(j.id, null, "Stuart is inspecting the documents (about half a minute)…");
      return true; }
    case "cx-start": { const j = state.jobs.find((x) => x.id === state.openJob); if (!j) return true;
      if (ctx.mode === "local") { demoCoachStart(j); render(); return true; }
      await coachCall({ action: "start", jobId: j.id }, "Stuart is reading your CV against this role…"); return true; }
    case "pr-open": state.prNote = ""; { const d = t.closest("details"); if (d) d.open = false; } openPractice(state.openJob); return true;
    case "pr-x": closePractice(); return true;
    case "pr-start": await practiceCall("start", "", "Stuart is preparing your questions…"); return true;
    case "pr-next": await practiceCall("next"); return true;
    case "pr-skip": await practiceCall("skip"); return true;
    case "pr-retry": await practiceCall("retry"); return true;
    case "pr-view": await practiceCall("feedback", t.dataset.t, "Stuart is reading your answer…"); return true;
    case "pr-send": { const el = document.getElementById("pr-msg"), x = el ? el.value.trim() : "", P = state.pr, q = P && P.doc && (P.doc.questions || [])[P.doc.cur]; if (!x) { if (el) el.focus(); return true; } if (el) el.value = "";
      const ok = q && q.answer ? await practiceCall("feedback", x, "Stuart is reading your answer…") : await practiceCall("answer", x, "Saving your answer…");
      if (!ok) { const n = document.getElementById("pr-msg"); if (n && !n.value) n.value = x; } return true; }
    case "fit-open": state.fitOpen = true; { const d = t.closest("details"); if (d) d.open = false; } render(); return true;
    case "fit-x": state.fitOpen = false; render(); return true;
    case "cx-down": state.cxNew = false; t.hidden = true; scrollEnd(); return true;
    case "cx-q-skip": { const b = buildOf(state.openJob); if (!b) return true; const q = t.dataset.q, L = (b.qSkip || []).concat(q); b.qSkip = L; render(); scrollEnd(); if (ctx.mode !== "local") { try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId || state.openJob), { qSkip: L }, { merge: true }); } catch (e) { state.err = errMsg(e); render(); } } return true; }
    case "cx-send": case "cx-say": case "cx-q-say": {
      if (state.coachBusy) return true;
      const el = document.getElementById("cx-msg"), typed = (act === "cx-send" ? (el ? el.value : "") : t.dataset.t).trim();
      if (!typed) { if (el) el.focus(); return true; }
      if (el && act === "cx-send") { el.value = ""; grow(el); }
      const Q0 = act === "cx-say" ? null : openQuestion(buildOf(state.openJob), isApplied(state.jobs.find((x) => x.id === state.openJob) || {}));
      const text = Q0 ? `[Question: ${Q0.q}]\n${typed}` : typed;
      state.chat = state.chat.concat([{ role: "user", text, temp: true }]); state.cxEdit = null;
      if (ctx.mode === "local") { demoCoachReply(text); render(); scrollEnd(); return true; }
      if (!(await coachCall({ action: "reply", jobId: state.openJob, text }, "Stuart is thinking…"))) {
        state.chat = state.chat.filter((m) => !m.temp); render(); const n = document.getElementById("cx-msg"); if (n && !n.value) { n.value = typed; grow(n); } }
      return true; }
    case "cx-edit": state.cxEdit = t.dataset.id; render(); { const e = document.getElementById("cx-ed"); if (e) { grow(e); e.focus(); e.setSelectionRange(e.value.length, e.value.length); } } return true;
    case "cx-cancel": state.cxEdit = null; render(); return true;
    case "opt-tg": { const d = t.closest("details"); state.optOpen = !(d && d.open); return true; } // the fold opens and closes by itself; this only remembers it across redraws
    case "cx-add": {
      if (state.coachBusy) return true;
      const m = state.chat.find((x) => x.id === t.dataset.id), ed = document.getElementById("cx-ed"), text = state.cxEdit === t.dataset.id && ed ? ed.value.trim() : "";
      if (!m) return true;
      if (state.cxEdit === t.dataset.id && !text) { state.err = "The line is empty."; render(); return true; }
      if (!text && m.data && m.data.unsourced && ctx.confirm && !(await ctx.confirm("This line holds a figure Stuart could not find in what you said: \"" + m.data.text + "\". Add it only if it is true.", { ok: "It is true, add it" }))) return true;
      state.cxEdit = null;
      if (ctx.mode === "local") { demoCoachAccept(m, text); render(); scrollEnd(); return true; }
      await coachCall({ action: "accept", jobId: state.openJob, msgId: m.id, text }, "Adding the line and re-scoring…"); return true; }
    case "review": state.review = t.dataset.kind; render(); { const c = ctx.container.querySelector(".sx-rv [data-stu=review-x]"); if (c) c.focus(); } return true;
    case "review-x": state.review = null; render(); return true;
    case "ru-open": state.ruSheet = { text: "" }; render(); { const el = document.getElementById("ru-text"); if (el) el.focus(); } return true;
    case "ru-x": state.ruSheet = null; render(); return true;
    case "ru-edit": if (state.ruSheet) { state.ruSheet.read = null; state.ruSheet.found = null; render(); const el = document.getElementById("ru-text"); if (el) el.focus(); } return true;
    case "ru-read": { const S = state.ruSheet; if (!S || S.busy) return true; const el = document.getElementById("ru-text"); S.text = el ? el.value.trim() : S.text; S.err = "";
      if (!S.text) { S.err = "Type the rule in your own words."; render(); return true; }
      if (ctx.mode === "local") { const r = demoRuleRead(S.text); S.read = r.rule; S.found = r.found; render(); return true; }
      S.busy = "Stuart is reading your rule…"; render();
      try { const r = (await busyWhile(callables.stuartRules({ action: "read", text: S.text }), "Reading the rule…")).data; S.read = r.rule; S.found = r.found || []; } catch (e) { S.err = errMsg(e); }
      S.busy = ""; render(); return true; }
    case "ru-save": { const S = state.ruSheet; if (!S || !S.read) return true; const r = Object.assign({}, S.read, { id: rid() }); delete r.unlessShow;
      if (await rulesWrite({ list: rulesList().concat([r]) })) { state.ruSheet = null; render(); if (ctx.toast) ctx.toast("Rule saved. Stuart follows it from the next build."); } return true; }
    case "cvchk": {
      const c = draft(); if (!c) return true;
      let out;
      if (ctx.mode === "local") out = demoCheck(c);
      else { try { out = await call("stuartCvCheck", state.cvDirty ? { cv: c } : {}, "Stuart is reading your whole CV for repeats (about half a minute)…"); } catch (e) { return true; } }
      state.cvChk = { repeats: out.repeats || [], conflicts: out.conflicts || [], off: {}, pick: {}, sig: JSON.stringify(c.experience || []) }; render();
      setTimeout(() => { const el = ctx.container.querySelector(".ck"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30); return true; }
    case "ck-rep": { const C = state.cvChk; if (C) { C.off[n("i")] = !t.checked; } return true; }
    case "ck-pick": { const C = state.cvChk; if (C) { C.pick[n("i")] = t.dataset.id; render(); } return true; }
    case "ck-x": state.cvChk = null; render(); return true;
    case "ck-apply": { const k = chkApply(); if (k >= 0 && ctx.toast) ctx.toast(k ? `${k} ${k === 1 ? "line" : "lines"} removed from your draft. Check it, then press Save.` : "Nothing removed. Press Save if you changed anything."); return true; }
    case "fa-edit": state.faEdit = t.dataset.id; render(); setTimeout(() => { const f = ctx.container.querySelector("#fa-ta"); if (f) f.focus(); }, 30); return true;
    case "fa-cancel": state.faEdit = null; render(); return true;
    case "fa-save": { const f = ctx.container.querySelector("#fa-ta"), v = String((f && f.value) || "").trim().slice(0, 1000); if (!v) return true;
      const d = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      state.faEdit = null; await factsWrite(factsList().map((x) => (x.id === t.dataset.id ? Object.assign({}, x, { a: v, at: d }) : x))); return true; }
    case "fa-del": { const x = factsList().find((y) => y.id === t.dataset.id); if (!x) return true;
      if (ctx.confirm && !(await ctx.confirm("Remove this answer? Stuart may ask the question again on your next job.", { ok: "Remove", danger: true }))) return true;
      await factsWrite(factsList().filter((y) => y.id !== x.id)); return true; }
    case "ru-del": { const r = rulesList().find((x) => x.id === t.dataset.id); if (!r) return true;
      if (ctx.confirm && !(await ctx.confirm("Remove this rule? " + ruleText(r), { ok: "Remove", danger: true }))) return true;
      await rulesWrite({ list: rulesList().filter((x) => x.id !== r.id) }); render(); return true; }
    case "ru-scan": { const S = state.ruSheet; if (!S || S.busy) return true; S.err = "";
      if (ctx.mode === "local") { state.rules = Object.assign({}, state.rules, { scan: { version: (state.cv || {}).version, conflicts: [{ id: "k1", question: "Your CV describes your budget role two ways. Which is right?", a: { where: "Profile", text: "Owns the clinic budget" }, b: { where: "Head of Operations", text: "Responsible for budgeting and planning" }, options: [{ label: "Owns it", use: "Owns the clinic budget", avoid: "Responsible for budgeting" }, { label: "Responsible for it", use: "Responsible for budgeting", avoid: "Owns the clinic budget" }] }] } }); render(); return true; }
      S.busy = "Stuart is reading your CV for things that disagree (about 20 seconds)…"; render();
      try { await busyWhile(callables.stuartRules({ action: "scan" }), "Checking your documents…"); } catch (e) { S.err = errMsg(e); }
      S.busy = ""; render(); return true; }
    case "ru-pick": { const S = state.ruSheet, sc = (state.rules || {}).scan, k = sc && (sc.conflicts || []).find((x) => x.id === t.dataset.k), o = k && k.options[n("o")]; if (!o || !S) return true;
      if (state.cvDirty) { S.err = "Save or discard your CV changes first."; render(); return true; }
      const rule = { id: rid(), type: "word", use: o.use, avoid: o.avoid, text: `"${o.use}", never "${o.avoid}"` };
      const c = clone(state.cv), nn = rewordCV(c, o.use, o.avoid);
      if (nn) { state.cvDraft = c; state.cvDirty = true; await cvSave(true); if (state.cvDirty) return true; } // the save failed; the error is shown
      if (!(await rulesWrite({ list: rulesList().concat([rule]), decided: Object.assign({}, (state.rules || {}).decided, { [k.id]: o.label }), scan: Object.assign({}, sc, { version: String(c.version || "") }) }))) return true;
      render(); if (ctx.toast) ctx.toast(nn ? `Rule saved. Your master CV is corrected in ${nn} ${nn === 1 ? "place" : "places"} (v${c.version}).` : "Rule saved."); return true; }
    case "ru-job": { const j = state.jobs.find((x) => x.id === state.openJob); if (!j) return true; const v = t.checked ? "on" : "";
      j.ruleChoices = Object.assign({}, j.ruleChoices, { [t.dataset.id]: v });
      if (ctx.mode !== "local") { try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "jobs", j.id), { ["ruleChoices." + t.dataset.id]: v }); } catch (e) { state.err = "Could not save that (" + (e.code || e.message) + ")."; } }
      render(); return true; }
    case "insp-run": { const b = buildOf(state.buildJob); if (!b) return true;
      if (ctx.mode === "local") { demoInspect(b); render(); return true; }
      await runInspect(b.jobId || state.buildJob, null, "Stuart is inspecting the documents (about half a minute)…"); return true; }
    case "insp-report": state.insp = { view: "report", tab: "cv" }; render(); { const c = ctx.container.querySelector(".sx-rv [data-stu=insp-x]"); if (c) c.focus(); } return true;
    case "insp-fixes": { const b = buildOf(state.buildJob); state.insp = { view: "fixes", pick: new Set(((b && b.inspection && b.inspection.fixes) || []).map((f) => f.id)), ans: {}, rem: new Set() }; render(); const c = ctx.container.querySelector(".sx-rv [data-stu=insp-x]"); if (c) c.focus(); return true; }
    case "insp-tab": if (state.insp) { state.insp.tab = t.dataset.k; render(); } return true;
    case "insp-pick": if (state.insp && state.insp.pick) { const id = t.dataset.id; if (t.checked) state.insp.pick.add(id); else state.insp.pick.delete(id); render(); } return true;
    case "insp-ans": if (state.insp) { state.insp.ans = Object.assign({}, state.insp.ans, { [t.dataset.q]: t.dataset.a }); render(); } return true;
    case "insp-rem": if (state.insp && state.insp.rem) { if (t.checked) state.insp.rem.add(t.dataset.q); else state.insp.rem.delete(t.dataset.q); } return true;
    case "insp-x": state.insp = null; render(); return true;
    case "insp-apply": { const b = buildOf(state.buildJob), v = state.insp || {}, ids = [...(v.pick || [])], answers = v.ans || {}, remember = [...(v.rem || [])].filter((q) => answers[q]);
      if (!b || (!ids.length && !Object.keys(answers).length)) return true; state.insp = null;
      if (ctx.mode === "local") { demoInspect(b, true); render(); if (ctx.toast) ctx.toast("Preview: fixes applied and checked again"); return true; }
      await runInspect(b.jobId || state.buildJob, { action: "apply", fixIds: ids, answers, remember }, ids.length ? "Applying the fixes and checking again…" : "Saving your answer and checking again…"); return true; }
    case "lt-save": {
      const b = buildOf(state.buildJob); if (!b) return true;
      const paras = [...ctx.container.querySelectorAll("[data-lt]")].map((el) => el.value.trim()).filter(Boolean);
      if (ctx.mode === "local") { b.letter.paragraphs = paras; if (b.inspection) b.inspection = null; render(); if (ctx.toast) ctx.toast("Letter saved"); return true; }
      try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId), { "letter.paragraphs": paras, "letter.unsourced": paras.map((p, i) => !!((b.letter.unsourced || [])[i]) && p === (b.letter.paragraphs || [])[i]), inspection: null, inspectedOnce: true }); if (ctx.toast) ctx.toast("Letter saved"); }
      catch (e) { state.err = "Could not save the letter (" + (e.code || e.message) + ")."; render(); } return true; }
    case "qk-open": {
      if (state.cvDirty) { if (ctx.toast) ctx.toast("Save your changes first. Documents are made from your saved CV.", true); return true; }
      state.qk = { kind: t.dataset.kind, ctx: "", paste: "", src: "general", review: false }; state.err = ""; state.pvOpen = false; if (IOS) loadJsPdf().catch(() => {}); render(); window.scrollTo({ top: 0 }); return true; }
    case "qk-back": state.qk = null; state.err = ""; render(); window.scrollTo({ top: 0 }); return true;
    case "qk-look": if (state.qk) { state.qk.lookId = t.dataset.id; render(); } return true;
    case "qk-src": if (state.qk) { state.qk.src = t.dataset.v; render(); } return true;
    case "qk-review": if (state.qk) { state.qk.review = true; render(); const c = ctx.container.querySelector(".sx-rv [data-stu=qk-review-x]"); if (c) c.focus(); } return true;
    case "qk-review-x": if (state.qk) { state.qk.review = false; render(); } return true;
    case "qk-make": {
      const S = state.qk; if (!S) return true; const k = S.kind, text = String(S.ctx || "").trim(), X = qkDoc(k);
      let context = "";
      if (t.dataset.again) context = (X && X.forWho) || "";
      else if (k === "letter" || t.dataset.fit) { if (!text) { state.err = k === "letter" ? "Say who the letter is for first." : "Say who it is for first, such as the role and the kind of organisation."; render(); return true; } context = text; }
      if (ctx.mode === "local") { demoQuick(k, context); if (context && k !== "letter") S.src = "fit"; state.err = ""; render(); if (ctx.toast) ctx.toast("Preview: a sample document"); return true; }
      try { await call("stuartQuick", { kind: k, context, paste: k === "letter" && !t.dataset.again ? String(S.paste || "") : "" }, k === "letter" ? "Stuart is writing your letter…" : context ? "Stuart is fitting your " + (k === "cv" ? "CV" : "resume") + "…" : "Stuart is writing your resume…"); if (context && k !== "letter") S.src = "fit"; render(); } catch (e) {} return true; }
    case "qk-pdf": {
      const S = state.qk, k = S && S.kind, X = S && qkDoc(k); if (!X) return true; const look = k === "letter" ? null : qkLook();
      printOut(qkHTML(k, X, look), fileName(k, (state.cv || {}).name, "", !!look).replace("_Master", "")); return true; }
    case "qk-word": {
      const S = state.qk, k = S && S.kind, X = S && qkDoc(k); if (!X) return true;
      if (ctx.mode === "local") { if (ctx.toast) ctx.toast("Word files are made on the server. Sign in on the hosted app."); return true; }
      try { const r = await call("stuartDocx", X.part ? { quick: X.part, kinds: [k] } : { kinds: ["cv"] }, "Making the Word file…"); (r.files || []).forEach((f) => saveB64(f.name, f.data)); render(); } catch (e) {} return true; }
    case "qk-lt-save": {
      const Q = state.quick, l = Q && Q.lt && Q.lt.letter; if (!l) return true;
      const paras = [...ctx.container.querySelectorAll("[data-qlt]")].map((el) => el.value.trim()).filter(Boolean), uns = paras.map((p, i) => !!((l.unsourced || [])[i]) && p === (l.paragraphs || [])[i]);
      if (ctx.mode === "local") { l.paragraphs = paras; l.unsourced = uns; state.qk.review = false; render(); if (ctx.toast) ctx.toast("Letter saved"); return true; }
      try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "cv", "quick"), { "lt.letter.paragraphs": paras, "lt.letter.unsourced": uns }); state.qk.review = false; render(); if (ctx.toast) ctx.toast("Letter saved"); }
      catch (e) { state.err = "Could not save the letter (" + (e.code || e.message) + ")."; render(); } return true; }
    case "qk-app": {
      const S = state.qk, k = S && S.kind, X = S && qkDoc(k); if (!X) return true;
      if (ctx.mode === "local") { if (ctx.toast) ctx.toast("Preview: added to Applications"); return true; }
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), FS = ctx.FS, L = (ctx.apps && ctx.apps()) || [];
      try {
        const ref = await FS.addDoc(FS.collection(ctx.db, "users", ctx.user.uid, "applications"), { org: String(X.forWho || "New contact").slice(0, 200), role: "", channel: "Direct contact", salary: "", closingDate: "", stage: "Saved", stageAt: today,
          stages: [{ stage: "Saved", date: today, note: QK[k][0] + " shared through Stuart", source: "stuart" }], order: L.length + 1, notes: "", nextAction: "", updatedAt: FS.serverTimestamp() });
        if (ctx.toast) ctx.toast("Added to Applications. Set the organisation and role there."); if (ctx.openApp) ctx.openApp(ref.id);
      } catch (e) { state.err = "Could not add the application (" + (e.code || e.message) + ")."; render(); } return true; }
    case "print": printDoc(t.dataset.kind); return true;
    case "print-look": { const b = buildOf(state.buildJob), id = b && (b.lookId !== undefined ? b.lookId : (state.looks || {}).defaultId), l = id ? lookById(id) : null; if (l && crOpen(b.jobId, id)) printDoc(t.dataset.kind, l); return true; }
    case "cr-unlock": {
      const b = buildOf(state.buildJob), id = b && (b.lookId !== undefined ? b.lookId : (state.looks || {}).defaultId), l = id ? lookById(id) : null, j = state.jobs.find((x) => x.id === state.openJob), c = state.cr; if (!l || !c) return true;
      const cost = (c.cost || {}).design || 2, left = (c.balance || 0) - cost;
      if (ctx.confirm && !(await ctx.confirm("The " + (l.name || "chosen") + " design for " + ((j && j.facts && j.facts.organisation) || "this job") + " uses " + cost + " credits. You can download its CV and resume PDFs as often as you need for this job. You will have " + left + (left === 1 ? " credit" : " credits") + " left.", { ok: "Unlock for " + cost + " credits" }))) return true;
      if (ctx.mode === "local") { c.balance = left; c.unlocks[b.jobId + "_" + id] = Date.now(); render(); return true; }
      state.err = ""; try { state.cr = (await callables.stuartCredits({ action: "unlock", jobId: b.jobId, look: id })).data; } catch (e) { state.err = errMsg(e); } render(); return true; }
    case "cr-soon": state.soon = t.dataset.k; render(); return true;
    case "cr-soon-x": state.soon = ""; render(); return true;
    case "cr-notify": { const k = t.dataset.k; if (ctx.mode === "local") { state.demoNotify = Object.assign({}, state.demoNotify, { [k]: true }); render(); return true; } try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "profile", "current"), { notify: { [k]: true } }, { merge: true }); state.profile = Object.assign({}, state.profile, { notify: Object.assign({}, (state.profile || {}).notify, { [k]: true }) }); } catch (e) { state.err = errMsg(e); } render(); return true; }
    case "cr-coming-x": if (ctx.mode === "local") { state.demoComing = true; render(); return true; } try { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "profile", "current"), { comingHidden: true }, { merge: true }); state.profile = Object.assign({}, state.profile, { comingHidden: true }); } catch (e) { state.err = errMsg(e); } render(); return true;
    case "lo-pick": loS().pick = t.dataset.k; render(); return true;
    case "lo-edit": { const S = loS(); S.draft = cleanLook(STOCK[S.pick]); S.id = ""; S.name = ""; S.makeDefault = false; S.tab = "colour"; S.screen = "edit"; render(); window.scrollTo({ top: 0 }); return true; }
    case "lo-open": { const S = loS(), x = savedLooks().find((y) => y.id === t.dataset.id); if (!x) return true; S.draft = cleanLook(x); S.id = x.id; S.name = x.name; S.makeDefault = (state.looks || {}).defaultId === x.id; S.tab = "colour"; S.screen = "edit"; render(); window.scrollTo({ top: 0 }); return true; }
    case "lo-home": loS().screen = "home"; render(); return true;
    case "lo-edit-back": loS().screen = "edit"; render(); return true;
    case "lo-tab": loS().tab = t.dataset.k; render(); return true;
    case "lo-col": loS().draft.accent = t.dataset.c; render(); return true;
    case "lo-switch": { const S = loS(); S.draft = cleanLook(Object.assign({}, S.draft, { base: "executive", heading: "bar" })); render(); return true; }
    case "lo-save0": loS().screen = "save"; render(); return true;
    case "lo-save": { const S = loS(), name = S.name.trim().slice(0, 40); if (!name) { const m = document.getElementById("lo-msg"); if (m) m.textContent = "Give it a name first."; return true; }
      const cur = savedLooks(); if (!S.id && cur.length >= 12) { const m = document.getElementById("lo-msg"); if (m) m.textContent = "You can keep up to 12 loadouts. Delete one first."; return true; }
      const id = S.id || "l" + Date.now().toString(36), item = Object.assign({ id, name }, cleanLook(S.draft)), prev = (state.looks || {}).defaultId || "";
      try { await looksWrite({ list: S.id ? cur.map((x) => (x.id === id ? item : x)) : cur.concat(item), defaultId: S.makeDefault ? id : prev === id ? "" : prev }); S.screen = "home"; render(); if (ctx.toast) ctx.toast("Loadout saved"); } catch (e) { const m = document.getElementById("lo-msg"); if (m) m.textContent = "Could not save (" + (e.code || e.message) + ")."; } return true; }
    case "lo-del": { const S = loS(); if (ctx.confirm && !(await ctx.confirm("Delete " + S.name + "? Your documents are not changed.", { ok: "Delete", danger: true }))) return true; const prev = (state.looks || {}).defaultId || ""; try { await looksWrite({ list: savedLooks().filter((x) => x.id !== S.id), defaultId: prev === S.id ? "" : prev }); S.screen = "home"; render(); } catch (e) { state.err = "Could not delete (" + (e.code || e.message) + ")."; render(); } return true; }
    case "sg-tg": {
      const b = buildOf(state.buildJob); if (!b) return true; const on = !!t.checked;
      b.sign = Object.assign({}, b.sign, { letter: on }); render();
      if (ctx.mode !== "local") { try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId), { "sign.letter": on }); } catch (e) { state.err = "Could not save that (" + (e.code || e.message) + ")."; render(); } }
      return true; }
    case "ph-tg": {
      const b = buildOf(state.buildJob), k = t.dataset.kind; if (!b || !["cv", "resume"].includes(k)) return true; const on = !!t.checked;
      b.photo = Object.assign({}, b.photo, { [k]: on }); render();
      if (ctx.mode !== "local") { try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId), { ["photo." + k]: on }); } catch (e) { state.err = "Could not save that (" + (e.code || e.message) + ")."; render(); } }
      return true; }
    case "em-open": {
      const b = buildOf(state.buildJob); if (!b) return true;
      if (b.email && b.email.body) { state.email = emailOpenState(b.email); render(); return true; }
      try { state.email = emailOpenState(await emailDraft(b)); render(); } catch (e) {} return true; }
    case "em-x": await emailSave(); state.email = null; render(); return true;
    case "em-back": state.email.step = "edit"; render(); return true;
    case "em-send": {
      const E = state.email; if (!E) return true; const to = E.to.trim(); if (!EMAIL_OK.test(to)) return true;
      const q = encodeURIComponent, su = q(E.subject.trim()), bd = q(E.body.replace(/\r?\n/g, "\r\n")), via = t.dataset.via;
      // opened straight from the tap, before anything is awaited, so the browser does not block it
      if (via === "gmail") window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${su}&body=${bd}`, "_blank", "noopener");
      else if (via === "outlook") window.open(`https://outlook.live.com/mail/0/deeplink/compose?to=${q(to)}&subject=${su}&body=${bd}`, "_blank", "noopener");
      else { const a = document.createElement("a"); a.href = `mailto:${to}?subject=${su}&body=${bd}`; if (a.href.length > 1900 && ctx.toast) ctx.toast("A long message can be cut off by some email apps. Use Copy all if it is."); a.click(); }
      E.step = "after"; render(); await emailSave(); return true; }
    case "em-copy": {
      const E = state.email; if (!E) return true;
      try { await navigator.clipboard.writeText((E.to.trim() ? "To: " + E.to.trim() + "\n" : "") + "Subject: " + E.subject.trim() + "\n\n" + E.body); if (ctx.toast) ctx.toast("Email copied"); }
      catch (e) { if (ctx.toast) ctx.toast("Could not copy. Select the text and copy it."); }
      await emailSave(); return true; }
    case "em-redo": {
      const b = buildOf(state.buildJob), E = state.email; if (!b || !E) return true;
      if (ctx.confirm && !(await ctx.confirm("Ask Stuart to write this email again? Your edits to the subject and message are replaced.", { ok: "Write it again" }))) return true;
      E.dirty = true; await emailSave();
      try { state.email = emailOpenState(await emailDraft(b)); render(); } catch (e) {} return true; }
    case "word": {
      if (ctx.mode === "local") { if (ctx.toast) ctx.toast("Word files are made on the server. Sign in on the hosted app."); return true; }
      if (t.dataset.kind === "master" && state.cvDirty) { state.err = "Save your changes first; the Word file is made from the saved CV."; render(); return true; }
      const data = t.dataset.kind === "master" ? { kinds: ["cv"] } : { jobId: state.buildJob, kinds: [t.dataset.kind] };
      try { const r = await call("stuartDocx", data, "Making the Word file…"); (r.files || []).forEach((f) => saveB64(f.name, f.data)); render(); } catch (e) {} return true; }
    case "applied": {
      await emailSave(); state.email = null;
      const j = state.jobs.find((x) => x.id === state.openJob); if (!j) return true; const f = j.facts || {};
      const I0 = (buildOf(j.id) || {}).inspection, open0 = I0 && I0.status && I0.status !== "pass" ? inspOpen(I0) : 0;
      if (ctx.confirm && !(await ctx.confirm("Mark " + (f.organisation || "this job") + " as applied today? The tailored CV, resume and cover letter are saved to Documents, linked to the application." + (open0 ? " The inspection still has " + (open0 === 1 ? "one open item" : open0 + " open items") + "; that is noted on the application." : "") + " Nothing is sent to anyone.", { ok: "Mark as applied" }))) return true;
      if (ctx.mode === "local") { j.status = "Applied"; const b = buildOf(j.id); if (b) b.saved = {}; render(); if (ctx.toast) ctx.toast("Preview: marked as applied"); return true; }
      try {
        const appId = (appOf(j) || {}).id || await makeApp(j);
        await call("stuartDocx", { jobId: j.id, kinds: ["cv", "resume", "letter"], save: true, appId }, "Saving the three Word files to Documents…");
        await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "jobs", j.id), { status: "Applied", appId, updatedAt: ctx.FS.serverTimestamp() });
        if (ctx.setStage) await ctx.setStage(appId, "Applied", open0 ? "Through Stuart; inspection: " + (open0 === 1 ? "1 open item" : open0 + " open items") : I0 && I0.status === "pass" ? "Through Stuart; inspection passed" : "");
        render(); if (ctx.toast) ctx.toast((f.organisation || "The job") + ": applied. Three files saved to Documents.");
      } catch (e) { if (!state.err) { state.err = "Could not finish (" + (e.code || e.message) + "). Nothing was sent."; render(); } }
      return true; }
    case "save-all": {
      const jj = state.jobs.find((x) => x.id === state.buildJob), appId = (jj && (appOf(jj) || {}).id) || "";
      if (ctx.mode === "local") { const b = buildOf(state.buildJob); if (b) b.saved = { appId }; render(); if (ctx.toast) ctx.toast("Preview: saving is on the hosted app"); return true; }
      try { const r = await call("stuartDocx", { jobId: state.buildJob, kinds: ["cv", "resume", "letter"], save: true, appId }, "Saving three Word files to Documents…"); render(); if (ctx.toast) ctx.toast("Saved " + (r.files || []).length + " files to Documents"); } catch (e) {} return true; }
  }
  return false;
}
document.addEventListener("focusout", () => { setTimeout(() => { if (ctx && state.pending) softRender(); }, 0); });
document.addEventListener("input", (e) => {
  if (!ctx) return; const el = e.target;
  if (el.id === "lo-name" && state.lo) { state.lo.name = el.value; return; }
  if (state.qk && (el.id === "qk-ctx" || el.id === "qk-paste")) { state.qk[el.id === "qk-ctx" ? "ctx" : "paste"] = el.value; return; }
  if (state.email && (el.id === "em-to" || el.id === "em-sub" || el.id === "em-body")) {
    state.email[{ "em-to": "to", "em-sub": "subject", "em-body": "body" }[el.id]] = el.value; state.email.dirty = true;
    if (el.id === "em-to") { const ok = EMAIL_OK.test(el.value.trim()); ctx.container.querySelectorAll('[data-stu="em-send"]').forEach((x) => { x.disabled = !ok; }); const w = document.getElementById("em-warn"); if (w) w.hidden = ok; }
    return; }
  if (el.dataset && el.dataset.cv) { const c = ensureDraft(), path = el.dataset.cv; if (path === "skills") c.skills = el.value.split(",").map((x) => x.trim()).filter(Boolean); else setPath(c, path, el.value);
    // editing a flagged line is the user's own check of it
    if (/\.bullets\.\d+\.text$/.test(path)) setPath(c, path.replace(/\.text$/, ".unsourced"), false);
    if (path === "summary") c.summaryUnsourced = false; if (path === "headline") c.headlineUnsourced = false; markDirty(); refreshPreview(); return; }
  if (el.id === "stu-log") { logState.text = el.value; return; }
  if (state.sheet && el.id === "stu-text") { state.sheet.text = el.value; return; }
  if (state.sheet && el.id === "stu-url") { state.sheet.url = el.value; return; }
  if (el.classList && el.classList.contains("stu-lg-in")) { const m = logState.proposal && logState.proposal.matches[Number(el.dataset.i)]; if (m) m[el.dataset.f] = el.value; }
});
document.addEventListener("change", async (e) => {
  if (!ctx) return;
  { const id = e.target.id, S = state.lo; if (S && S.draft && ["lo-font", "lo-base", "lo-head", "lo-space", "lo-photo"].includes(id)) { if (id === "lo-base") S.draft = Object.assign({}, cleanLook(STOCK[e.target.value]), { accent: cleanLook(S.draft).accent, font: cleanLook(S.draft).font, spacing: cleanLook(S.draft).spacing, photo: cleanLook(S.draft).photo }); else S.draft[{ "lo-font": "font", "lo-head": "heading", "lo-space": "spacing", "lo-photo": "photo" }[id]] = id === "lo-photo" ? e.target.checked : e.target.value; render(); return; }
    if (id === "lo-def" && S) { S.makeDefault = e.target.checked; return; }
    if (id === "lo-job") { const b = buildOf(state.buildJob); if (!b) return; b.lookId = e.target.value; render(); if (ctx.mode !== "local") { try { await ctx.FS.updateDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "builds", b.jobId), { lookId: b.lookId }); } catch (x) { state.err = "Could not save that (" + (x.code || x.message) + ")."; render(); } } return; } }
  if (e.target.id === "stu-track" && state.sheet) { state.sheet.track = e.target.checked; return; }
  if (e.target.id === "stu-ad" && state.sheet) { const f = e.target.files[0]; state.sheet.file = f || null; state.sheet.fileName = f ? f.name : ""; state.sheet.err = ""; render(); return; }
  if (ctx.mode === "local") return;
  if (e.target.id === "stu-cv") { const f = e.target.files[0]; if (!f) return; const had = !!state.cv;
    try { const file = await readFile(f); const r = await call("stuartProfile", { file }, "Stuart is reading your CV…");
      if (r && r.profile) state.profile = Object.assign({}, state.profile, { profile: r.profile });
      if (!had) { state.cvDraft = masterFromProfile(); state.cvDirty = true; await cvSave(true); state.tab = "cv"; state.cvSec = "experience"; render(); if (ctx.toast) ctx.toast("Stuart read your CV and saved it as your master CV (v1.0). Check each section."); }
      if (had && ctx.confirm && await ctx.confirm("Stuart has read the new file. Replace your master CV with it? You can review everything before you save.", { ok: "Review and replace" })) { const old = state.cv || {}; state.cvDraft = Object.assign(masterFromProfile(), { contact: old.contact || {}, version: old.version || "1.0", referees: old.referees || [] }); state.cvDirty = true; state.tab = "cv"; render(); }
    } catch (err) { state.err = err.message || String(err); render(); } e.target.value = ""; }
});
