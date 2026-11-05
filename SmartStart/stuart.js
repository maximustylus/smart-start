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
  if (ctx.mode === "local") { renderDemo(); return; }
  if (!FN) {
    const F = await import("https://www.gstatic.com/firebasejs/" + V + "/firebase-functions.js");
    FN = F.getFunctions(ctx.app, "asia-southeast1");
    for (const n of ["stuartPlan", "stuartChat", "stuartLog", "stuartImprove", "stuartDocx", "stuartInterview", "stuartRules"]) callables[n] = F.httpsCallable(FN, n, { timeout: 120000 });
    for (const n of ["stuartTailor", "stuartProfile", "stuartAnalyse", "stuartCoach", "stuartInspect"]) callables[n] = F.httpsCallable(FN, n, { timeout: 300000 }); // long reads: the server allows 300 s too
  }
  subscribe(); if (state.openJob) watchChat(state.openJob); render();
}
export function unmount() { document.body.classList.remove("ss-jobchat"); state.unsub.forEach((u) => u()); state.unsub = []; if (state.chatUnsub) { state.chatUnsub(); state.chatUnsub = null; } }
export function openAdd() { state.wantAdd = true; }
export function openCV() { state.tab = "cv"; state.openJob = null; state.sheet = null; render(); }
// Jobs being deleted stay hidden until the delete is final (index.html keeps the set and the Undo).
const visible = (L) => { const H = ctx && ctx.hiddenJobs ? ctx.hiddenJobs() : null; return H && H.size ? L.filter((j) => !H.has(j.id)) : L; };
export function refreshHidden() { if (!ctx) return; if (state.allJobs) state.jobs = visible(state.allJobs); else if (ctx.mode === "local") { state.demoAll = state.demoAll || state.jobs; state.jobs = visible(state.demoAll); } if (state.openJob && !state.jobs.some((j) => j.id === state.openJob)) state.openJob = null; render(); }
const building = new Set(), BUILD_LABEL = "Stuart is building your CV, resume and cover letter (about a minute)…";
export function openJobPage(id) { state.sheet = null; state.openJob = id; state.buildJob = id; state.chat = []; state.chatOpen = false; state.review = null; state.cxEdit = null; state.coachBusy = building.has(id) ? BUILD_LABEL : ""; }
export function reset() { unmount(); logState = { text: "", proposal: null, busy: "", err: "" }; state = { profile: null, plan: null, jobs: [], budget: null, step: null, busy: "", err: "", openJob: null, chat: [], unsub: [], tab: "home", cv: null, cvDraft: null, cvDirty: false, cvSec: "experience", cvItem: 0, sugg: null, builds: [], buildJob: null, review: null, pvOpen: false, linkApp: "", pending: false, iv: null, ivOpen: false }; }

function subscribe() {
  unmount(); const { db, FS, user } = ctx; const uid = user.uid;
  const onErr = (e) => { state.err = "Could not read your records (" + (e.code || e.message) + ")."; render(); };
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "profile", "current"), (s) => { state.profile = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "plan", "current"), (s) => { state.plan = s.exists() ? s.data() : null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.query(FS.collection(db, "users", uid, "jobs"), FS.orderBy("createdAt", "desc"), FS.limit(50)), (q) => { state.jobsLoaded = true; state.allJobs = q.docs.map((d) => ({ id: d.id, ...d.data() })); state.jobs = visible(state.allJobs); softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "master"), (s) => { state.cv = s.exists() ? s.data() : null; if (!state.cvDirty) state.cvDraft = null; softRender(); }, onErr));
  state.unsub.push(FS.onSnapshot(FS.doc(db, "users", uid, "cv", "rules"), (s) => { state.rules = s.exists() ? s.data() : null; softRender(); }, onErr));
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
  if (state.wantAdd && (local || (p && p.consentAI))) { state.wantAdd = false; state.openJob = null; state.tab = "home"; if (local || state.cv || (p && p.profile)) state.sheet = newSheet(); else state.needCV = true; }
  let body;
  if (local) body = state.openJob ? viewJobPage() : viewHub(); // demo: sample content only
  else if (!p || !p.consentAI) body = viewConsent();
  else body = state.openJob ? viewJobPage() : viewHub();
  const note = state.needCV && !state.openJob ? `<p class="sx-note" role="status">Add your CV first. Stuart checks every job against it.</p>` : "";
  const keep = ["cx-msg", "cx-ed"].map((id) => { const el = document.getElementById(id); return el ? { id, v: el.value, f: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd } : null; }).filter(Boolean);
  const t0 = thread(), had = !!t0, atEnd = !t0 || t0.scrollHeight - t0.scrollTop - t0.clientHeight < 60, top0 = t0 ? t0.scrollTop : 0, n0 = t0 ? t0.children.length : 0;
  ctx.container.innerHTML = (local || (p && p.consentAI) ? "" : head()) + note + body + sheetHTML();
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
function viewPlan(first) {
  const pl = (state.plan && state.plan.plan) || {}; const s = pl.smart || {}, g = pl.grow || {};
  if (!state.plan) return `<div class="set"><h3>The route: your plan</h3>${busyLine()}${errLine()}<p>Stuart drafts your SMART goal and GROW frame from your intention, target and CV.</p>${state.busy ? "" : `<div class="btnrow"><button class="btn" data-stu="redraft">Draft my plan</button></div>`}</div>`;
  const row = (k, v) => `<div class="k">${k}</div><div class="v">${esc(Array.isArray(v) ? v.join("; ") : v || "")}</div>`;
  return `<div class="set"><h3>The route: your plan (draft)</h3><p><b>${esc(pl.headline || "")}</b></p>
  <div class="group">SMART goal</div><div class="kv">${row("Specific", s.specific)}${row("Measurable", s.measurable)}${row("Achievable", s.achievable)}${row("Relevant", s.relevant)}${row("Time-bound", s.timeBound)}</div>
  <div class="group">GROW</div><div class="kv">${row("Goal", g.goal)}${row("Reality", g.reality)}${row("Options", g.options)}${row("Will", g.will)}</div>
  <p>Drafted by Stuart from what you gave it. ${state.plan.confirmed ? "Confirmed." : "Edit it in a later release; for now, confirm to continue or redraft."}</p>
  <div class="btnrow">${state.plan.confirmed ? `<button class="btn btn--ghost" data-stu="home">Back</button>` : `<button class="btn" data-stu="confirm-plan">Looks right</button><button class="btn btn--ghost" data-stu="redraft">Redraft</button>`}</div>${busyLine()}${errLine()}</div>`;
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
  state.jobs = [{ id: "demo", status: "Considering", facts: { organisation: "Example Logistics Group", role: "Operations Manager", closingDate: "2026-11-30", location: "Singapore" }, analysis: { roleFit: { score: 78, met: 6, partly: 3, notMet: 1 }, careerAspiration: { score: 70, reasons: "Larger team, wider remit" }, coverage: { present: 9, total: 11 }, band: { level: "medium", reasons: ["Hard screens met", "Two keywords missing", "Competitive post"] }, recommendation: "apply", why: "Strong fit on delivery and teamwork.", hardScreens: [{ requirement: "Degree", status: "Met", evidence: "BSc, MSc" }], ats: { must: [{ term: "stakeholder", evidence: "Skills line" }], nice: [], gap: [{ term: "Agile certification", why: "Not on the sample CV" }] }, nextSteps: ["Tailor the CV", "Ask about the team size"], openQuestions: [] } }];
  state.chat = [{ role: "assistant", text: "This is a preview with sample content. Sign in on the hosted app to use Stuart." }];
  if (!state.cv) state.cv = { version: "3.2", name: "Daniel Lim", contact: { email: "daniel.lim@example.com", phone: "", location: "Singapore", links: "" }, headline: "Operations leader in community health", summary: "Leads clinic operations and service improvement across three sites, with a record of better access and lower no-show rates.",
    experience: [{ id: "r1", title: "Head of Operations", org: "Meridian Care Group", location: "Singapore", start: "Jan 2021", end: "present", bullets: [{ text: "Led a team of 12 across three clinics; cut appointment no-shows from 18% to 11% in 2024.", src: "cv" }, { text: "Built the referral dashboard used by 40 clinicians each week.", src: "cv" }, { text: "Responsible for budgeting and planning for the department.", src: "cv" }] },
      { id: "r2", title: "Operations Manager", org: "Harbourside Clinics", location: "Singapore", start: "2017", end: "2020", bullets: [{ text: "Opened two new clinics on time and within budget.", src: "cv" }] }],
    education: [{ text: "MSc Health Services Management, Example University, 2016" }], skills: ["Operations", "Service design", "Data dashboards", "Stakeholder management"], certifications: [{ text: "Lean Six Sigma Green Belt" }], awards: [], publications: [], referees: [] };
  if (!state.rules) state.rules = { list: [{ id: "d1", type: "leave", term: "Side project", unless: true, text: "Leave out the side project from every CV, resume and letter" }, { id: "d2", type: "word", use: "co-leads the referral programme", avoid: "leads the referral programme", text: "\"Co-leads\" the referral programme, never \"leads\"" }, { id: "d4", type: "date", date: "2026-12-31", text: "I leave Meridian Care Group on 31 Dec 2026. From 1 Jan 2027, write that role in the past tense" }, { id: "d3", type: "ask", term: "Lean Six Sigma", text: "Lean Six Sigma Green Belt: ask before claiming it" }] };
  state.jobs[0].facts.organisation = "Northwind Health"; state.jobs[0].facts.role = "Director, Strategy and Transformation";
  render();
}
/* ---------- Stuart hub: Home and My CV; the plan opens from its card; each job has its own page ---------- */
// The master CV lives at users/{uid}/cv/master; builds for a job at users/{uid}/builds/{jobId} (written by
// stuartTailor). Edits stay in a draft until Save; Stuart's suggestions change nothing until accepted.
const TABS = [["home", "Home"], ["cv", "My CV"]];
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
function estPages(d, kind) {
  if (!d) return 0; const ln = (t) => Math.max(1, Math.ceil(String(t || "").length / 95));
  if (kind === "letter") return Math.max(1, Math.ceil((10 + (d.paragraphs || []).reduce((n, p) => n + ln(p) + 1, 0)) / 46));
  let n = 4 + (d.headline ? 2 : 0) + (d.summary ? ln(d.summary) + 2 : 0);
  (d.experience || []).forEach((r) => { n += 2 + (r.location ? 1 : 0); (r.bullets || []).forEach((b) => { n += ln(b.text); }); });
  ["education", "certifications", "awards", "publications"].concat(kind === "cv" ? ["referees"] : []).forEach((k) => { if ((d[k] || []).length) n += 2 + d[k].reduce((m, x) => m + ln(x.text), 0); });
  if ((d.skills || []).length) n += 2 + ln(d.skills.join(", "));
  return Math.max(1, Math.ceil(n / 46));
}
function docHTML(d, kind) {
  if (!d) return '<div class="sx-a4"><p class="sx-ph">Nothing to preview yet.</p></div>';
  const c = d.contact || {}, L = [];
  L.push(`<div class="nm">${esc(d.name || "Your name")}</div><div class="cl">${esc([c.location, c.email, c.phone, c.links].filter(Boolean).join(" | "))}</div>`);
  if (d.headline || d.summary) L.push(`<div class="h">Profile</div>${d.headline ? `<p><b>${esc(d.headline)}</b></p>` : ""}${d.summary ? `<p${d.summaryUnsourced ? ' class="uns"' : ""}>${esc(d.summary)}</p>` : ""}`);
  if ((d.experience || []).length) L.push(`<div class="h">Experience</div>` + d.experience.map((r) => `<div class="rl"><b>${esc(r.title || "")}${r.org ? ", " + esc(r.org) : ""}</b><span>${esc([r.start, r.end].filter(Boolean).join(" to "))}</span></div>${r.location ? `<div class="lc">${esc(r.location)}</div>` : ""}<ul>${(r.bullets || []).filter((b) => hasText(b.text)).map((b) => `<li${b.unsourced ? ' class="uns" title="Figure not found in your CV: confirm it"' : ""}>${esc(b.text)}</li>`).join("")}</ul>`).join(""));
  for (const [k, lab] of [["education", "Education"], ["certifications", "Certifications"], ["awards", "Awards"], ["publications", "Publications"]]) if ((d[k] || []).some((x) => hasText(x.text))) L.push(`<div class="h">${lab}</div>${d[k].filter((x) => hasText(x.text)).map((x) => `<p>${esc(x.text)}</p>`).join("")}`);
  if ((d.skills || []).length) L.push(`<div class="h">Skills</div><p>${esc(d.skills.join(", "))}</p>`);
  if (kind === "cv" && (d.referees || []).some((x) => hasText(x.text))) L.push(`<div class="h">Referees</div>${d.referees.filter((x) => hasText(x.text)).map((x) => `<p>${esc(x.text)}</p>`).join("")}`);
  return `<div class="sx-a4">${L.join("")}</div>`;
}
function letterHTML(l, d) {
  if (!l) return '<div class="sx-a4"><p class="sx-ph">Nothing to preview yet.</p></div>';
  const c = (d && d.contact) || {};
  return `<div class="sx-a4 lt"><div class="nm sm">${esc((d && d.name) || "")}</div><div class="cl">${esc([c.email, c.phone].filter(Boolean).join(" | "))}</div>
  <p>${esc(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</p><p>${esc(l.to || "")}</p><p>${esc(l.greeting || "")}</p>
  ${(l.paragraphs || []).map((x, i) => `<p${(l.unsourced || [])[i] ? ' class="uns" title="Figure not found in your CV: confirm it"' : ""}>${esc(x)}</p>`).join("")}<p>${esc(l.closing || "Yours sincerely")},</p><p class="sg">${esc((d && d.name) || "")}</p></div>`;
}
function hubHead() {
  return `<div class="sx-bar"><img class="sx-av" src="icons/stuart.svg" alt=""><div class="sx-t"><h1>Stuart</h1><p>Your career assistant. Stuart drafts, you decide and send.</p></div></div>`
    + `<div class="sx-tabs" role="tablist" aria-label="Stuart">${TABS.map(([k, l]) => `<button type="button" role="tab" data-stu="tab" data-k="${k}" aria-selected="${state.tab === k}">${l}</button>`).join("")}</div>`;
}
const buildOf = (id) => state.builds.find((b) => b.jobId === id || b.id === id);
function buildStatus(j) {
  const b = buildOf(j.id); if (!b) return ["Not started", ""];
  if (b.saved) return ["Saved", "ok"];
  return (b.questions || []).length ? ["Ready · " + b.questions.length + " questions", "warn"] : ["Ready for review", "ok"];
}
function viewHub() {
  const t = state.tab;
  const P = state.profile || {};
  const plan = `<button type="button" class="sx-back" data-stu="tab" data-k="home">${ICO.back}Stuart</button>` + (!P.profile ? `<section class="card sx-c"><h2 class="sx-k">Your plan</h2><p class="sx-sp">Add your CV first (My CV); Stuart drafts the plan from it.</p></section>`
    : !P.intention ? viewIntention() : viewPlan(!state.plan).replace('data-stu="home"', 'data-stu="tab" data-k="home"'));
  const body = t === "cv" ? viewBuilder() : t === "plan" ? plan : viewHome();
  return hubHead() + body;
}
/* CV builder */
function secItems(c, k) { return k === "skills" ? null : (c[k] || []); }
function viewBuilder() {
  const c = draft();
  if (state.ivOpen) return viewInterview();
  if (!c) return `<section class="card sx-c"><h2 class="sx-k">${ICO.doc} CV builder</h2><p class="sx-sp">Choose how to start your master CV. Nothing is saved until you press Save.</p>${startChoices()}${busyLine()}${errLine()}</section>`;
  const k = state.cvSec, st = cvStats(c);
  const secs = `<nav class="card sx-secs" aria-label="CV sections"><h2 class="sx-k">Sections</h2>${SECS.map(([key, lab]) => `<button type="button" class="sx-sec" data-stu="sec" data-k="${key}" aria-pressed="${k === key}"><span>${lab}</span><i class="sx-sd ${secDone(c, key) ? "done" : key === "referees" ? "off" : "todo"}" aria-label="${secDone(c, key) ? "Done" : "Empty"}"></i></button>`).join("")}</nav>`;
  const save = `<div class="sx-save"><button type="button" class="sx-lk sx-ivl" data-stu="iv-open">${ICO.spark}Build from scratch with Stuart</button><label class="sx-lk sx-ivl sx-upl" style="cursor:pointer" title="Stuart reads a PDF, Word or text file and replaces this master CV; you review before saving">${ICO.up}Replace from a file<input type="file" id="stu-cv" accept=".pdf,.docx,.txt,.md,application/pdf" hidden></label>${state.cvDirty ? `<span class="sx-dirty">Unsaved changes</span><button type="button" class="btn btn--ghost sx-b sm" data-stu="cv-discard">Discard</button><button type="button" class="btn sx-b sm" data-stu="cv-save">Save as v${esc(nextVer(c.version))}</button>` : `<span class="sx-sp">Saved · v${esc(c.version || "1.0")}</span>`}</div>`;
  const pv = `<section class="sx-pv${state.pvOpen ? " open" : ""}" aria-label="Preview"><div class="sx-pvh"><span>Preview · Clean template</span><span class="sx-pc ${st.pages > 6 ? "warn" : "ok"}" id="sx-pages">about ${st.pages} of 6 pages</span><button type="button" class="sx-pvx" data-stu="pv" aria-label="Close preview">${ICO.x}</button></div><div id="sx-pvb">${docHTML(c, "cv")}</div>
    <div class="sx-pva"><button type="button" class="btn btn--ghost sx-b sm" data-stu="print" data-kind="master">${ICO.dl}PDF</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="word" data-kind="master">${ICO.dl}Word</button></div></section>`;
  return `${save}${rulesCard()}${rulesSheet()}<div class="sx-bld">${secs}<section class="card sx-ed cved">${editorHTML(c, k)}${busyLine()}${errLine()}<button type="button" class="btn sx-b sx-pvbtn" data-stu="pv">Preview · about ${st.pages} of 6 pages</button></section>${pv}</div>`;
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
    ${grp || `<p class="sx-sp">No rules yet. Say one in your own words, such as "Leave out my side project unless I ask".</p>`}<button type="button" class="btn sx-b sx-full" data-stu="ru-open">Add a rule</button></section>`;
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
  } else conf = (c.experience || []).length ? `<p class="sx-sp sm">Stuart can read your CV for places that say two different things, such as "leads" in one place and "co-leads" in another.</p><button type="button" class="btn btn--ghost sx-b sx-full" data-stu="ru-scan"${S.busy ? " disabled" : ""}>Check my CV for things that disagree</button>` : "";
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
  return `<div class="sx-save"><button type="button" class="sx-lk" data-stu="iv-close">Back to the CV builder</button>${state.iv ? `<button type="button" class="sx-lk" data-stu="iv-reset">Start again</button>` : ""}</div>${strip}<div class="sx-ivg"><section class="card sx-ed ivc">${main}${busyLine()}${errLine()}<button type="button" class="btn btn--ghost sx-b sm sx-pvbtn" data-stu="pv">Preview your CV so far</button></section>${pv}</div>`;
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
function fitViewport() { const p = ctx && ctx.container ? ctx.container.querySelector(".cx-page") : null, v = window.visualViewport; if (!p || !v || window.innerWidth >= 900) { if (p) { p.style.height = ""; p.style.top = ""; } return; } p.style.height = v.height + "px"; p.style.top = v.offsetTop + "px"; }
if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitViewport); window.visualViewport.addEventListener("scroll", fitViewport); }
const GAP_LAB = { hidden: "Hidden", weak: "Weak", real: "Real gap" };
function gapsCard(gaps) {
  const st = (g) => g.status === "done" ? `${ICO.check}Added` : g.status === "skipped" ? "Skipped" : g.status === "decided" ? esc(g.decision || "Decided") : g.kind === "real" ? "wording cannot fix" : "about +" + esc(g.gain);
  return `<div class="cx-card"><span class="cx-k">What would lift this application</span><ul class="cx-gaps">${gaps.map((g) => `<li class="${g.status !== "open" ? "cx-x" : ""}"><span class="cx-t k-${esc(g.kind)}">${GAP_LAB[g.kind] || "Gap"}</span><span>${esc(g.title)}</span><span class="cx-gain${g.kind === "real" || g.status !== "open" ? " no" : ""}">${st(g)}</span></li>`).join("")}</ul></div>`;
}
function propHTML(m, d) {
  const where = d.role ? `<span class="cx-where">For your master CV, under ${esc(d.role)}</span>` : "";
  if (d.status !== "open") return `${where}<div class="cx-line">${esc(d.text)}</div>`;
  if (state.cxEdit === m.id) return `${where}<textarea class="cx-ed" id="cx-ed" rows="3" aria-label="Edit the line">${esc(d.text)}</textarea><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-add" data-id="${esc(m.id)}">${ICO.check}Save to my CV</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="cx-cancel">Cancel</button></div>`;
  return `${where}<div class="cx-line${d.unsourced ? " warn" : ""}">${esc(d.text)}</div>${d.unsourced ? `<p class="cx-warn">This line holds a figure Stuart could not find in what you said. Add it only if it is true.</p>` : ""}<div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-add" data-id="${esc(m.id)}">${ICO.check}Add to my CV</button><button type="button" class="btn btn--ghost sx-b sm" data-stu="cx-edit" data-id="${esc(m.id)}">${ICO.pen}Edit</button></div>`;
}
function deltaHTML(d) {
  const mv = d.from != null && d.to != null ? `<div class="cx-delta">Role fit <b>${esc(d.from)}</b> → <b>${esc(d.to)}</b>${d.note ? " · " + esc(d.note) : ""}</div>` : "";
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
  if (b) { (b.prior || []).forEach((p) => items.push({ t: tms(p.createdAt), k: "old", p })); items.push({ t: bt, k: "build" }); const I = b.inspection;
    if (!applied && (state.inspBusy || (I && I.summary))) items.push({ t: state.inspBusy ? Infinity : tms(I.at) || bt + 1, k: "insp" }); }
  items.sort((x, y) => x.t - y.t);
  let prev = 0, first = true;
  const body = items.map((it) => {
    const mark = it.t !== Infinity && it.t && (first || it.t - prev >= 3e5 || new Date(prev).getDate() !== new Date(it.t).getDate()) ? `<div class="cx-time">${esc(whenLabel(it.t, first, prev))}</div>` : "";
    if (it.t !== Infinity && it.t) { prev = it.t; first = false; }
    if (it.k === "old") return mark + `<div class="cx-old"><b>Documents built from CV v${esc(it.p.masterVersion)}</b><span>Replaced by the rebuild below</span></div>`;
    if (it.k === "build") return mark + docsCard(b, applied);
    if (it.k === "insp") return mark + inspCard(b);
    const m = it.m;
    if (m.role === "user") { const q = Q_TAG.exec(m.text || ""); return mark + (q ? sayS(`<span class="cx-k">Before you send</span><p>${esc(q[1])}</p>`) : "") + `<div class="cx-u">${esc(q ? m.text.slice(q[0].length) : m.text)}</div>`; }
    const d = m.data || {}, live = it.i === lastI && !state.coachBusy && (!b || it.t > bt);
    let x = m.kind === "gaps" ? md(m.text) + (gaps.length ? gapsCard(gaps) : "") : m.kind === "proposal" ? md(m.text) + propHTML(m, d) : m.kind === "delta" ? deltaHTML(d) : md(m.text);
    if (live && (d.choices || []).length) x += `<div class="cx-chips">${d.choices.map((c) => `<button type="button" class="cx-chip" data-stu="cx-say" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (it.i === lastI && !state.coachBusy && d.ready && !b) x += `<div class="cx-acts"><button type="button" class="btn sx-b" data-stu="tailor">Build CV, resume and cover letter</button></div>`;
    return mark + sayS(x);
  }).join("");
  const Q = !state.coachBusy ? openQuestion(b, applied) : null;
  const ask = Q ? sayS(`<span class="cx-k">Before you send · question ${Q.i + 1} of ${Q.n}</span><p>${esc(Q.q)}</p><div class="cx-chips"><button type="button" class="cx-chip" data-stu="cx-q-say" data-t="I am not sure">I am not sure</button><button type="button" class="cx-chip" data-stu="cx-q-skip" data-q="${esc(Q.q)}">Skip this one</button></div>`) : "";
  const allIn = b && !applied && !Q && !state.coachBusy && (b.questions || []).length && sinceBuild(b).some((m) => Q_TAG.test(m.text || "")) && !(state.chat[state.chat.length - 1] || { data: {} }).data?.choices?.length;
  return body + ask + (allIn ? sayS(`<p>That is all of them. Rebuild when you are ready and I will use your answers.</p>`) : "");
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
const demoClaims = (ok) => ok ? [{ quote: "I have led clinic operations since 2017", where: "Paragraph 1", status: "holds", source: "Harbourside Clinics, 2017 to 2020" }, { quote: "I co-lead the referral programme", where: "Paragraph 2", status: "holds", source: "Your rule" }, { quote: "cut appointment no-shows from 18% to 11% in 2024", where: "Paragraph 2", status: "holds", source: "Head of Operations, bullet 1" }]
  : [{ quote: "I have led operations for over ten years", where: "Paragraph 1", status: "overclaim", reason: "Your CV shows operations roles from 2017, not ten years." }, { quote: "I lead the referral programme", where: "Paragraph 2", status: "rule", reason: "Your rule: \"co-leads\" the referral programme, never \"leads\"." },
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
function docsCard(b, applied) {
  const pc = { cv: estPages(b.cv, "cv"), resume: estPages(b.resume, "resume"), letter: estPages(b.letter, "letter") }, lim = { cv: 6, resume: 2, letter: 1 };
  const flags = (d) => (d && d.experience ? d.experience.reduce((n, r) => n + (r.bullets || []).filter((x) => x.unsourced).length, 0) + (d.summaryUnsourced ? 1 : 0) : 0);
  const fl = { cv: flags(b.cv), resume: flags(b.resume), letter: ((b.letter || {}).unsourced || []).filter(Boolean).length };
  const card = (k, lab) => `<section class="card cx-doc"><div class="sx-mini" aria-hidden="true"><i></i><i></i><i class="s"></i><i></i></div><div class="cx-dt"><b>${lab}</b><span>${pc[k]} of ${lim[k]} ${lim[k] === 1 ? "page" : "pages"}</span>${b.inspection && b.inspection.docs ? inspChip(b.inspection, k) : pc[k] > lim[k] || fl[k] ? `<span class="sx-st warn">${pc[k] > lim[k] ? "Over the page limit" : fl[k] + (fl[k] === 1 ? " figure" : " figures") + " to confirm"}</span>` : ""}</div>
    <details class="sx-dd"><summary class="btn sx-b sm" aria-label="Open ${lab}"><span>Open</span>${ICO.down}</summary><div class="sx-menu"><button type="button" data-stu="review" data-kind="${k}">${ICO.eye}Review</button><button type="button" data-stu="word" data-kind="${k}">${ICO.dl}Download Word</button><button type="button" data-stu="print" data-kind="${k}">${ICO.dl}Download PDF</button></div></details></section>`;
  return `<div class="cx-div">Documents built · from CV v${esc(b.masterVersion)}${b.saved ? " · saved to Documents" : ""}</div><div class="cx-docs">${card("cv", "Tailored CV")}${card("resume", "Resume")}${card("letter", "Cover letter")}</div>
    ${b.notes ? sayS(`<span class="cx-k">Stuart's note</span>${md(b.notes)}`) : ""}`;
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
  const cvLine = c ? `${c.name || "Your CV"} · ${(c.experience || []).length} ${(c.experience || []).length === 1 ? "role" : "roles"} · v${c.version || "1.0"}` : P.profile ? "Read by Stuart · open My CV to check it" : "Upload it, or build it with Stuart";
  const setup = cur ? `<section class="card sx-c"><h2 class="sx-k">Get started</h2>
    ${stepRow(1, cls(1, hasCV), "Your CV", esc(cvLine), hasCV ? `<button type="button" class="sx-lk" data-stu="tab" data-k="cv">Edit</button>` : "")}
    ${hasCV ? "" : `<div class="sx-in">${startChoices()}${busyLine()}${errLine()}</div>`}
    ${stepRow(2, cls(2, hasJob), "Add a job", "Paste the advertisement, a link or a file")}
    ${stepRow(3, cls(3, applied), "Build and apply", "Tailored CV, resume and cover letter")}
    ${hasCV ? `<button type="button" class="btn sx-b sx-full" data-stu="add">${ICO.plus}Add new job</button>` : ""}</section>` : "";
  const list = hasJob ? `<section class="card sx-c"><div class="sx-hd"><h2 class="sx-k">Your jobs · ${jobs.length}</h2>${cur ? "" : `<button type="button" class="btn sx-b sm" data-stu="add">${ICO.plus}Add new</button>`}</div><div class="sx-jl2">${jobs.map(jobRow).join("")}</div></section>` : "";
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
    body = `<h2 class="sx-sh">Add a job</h2><div class="sx-chips" role="group" aria-label="How to add the advertisement">${chip("text", "Paste text")}${chip("link", "Link")}${chip("file", "File")}</div>${inp}
      ${S.mode === "text" ? `<p class="sx-sp sm">Stuart reads the pasted text and keeps the link as the source.</p>` : ""}
      <label class="sx-chk"><input type="checkbox" id="stu-track"${S.track ? " checked" : ""}><span>Add it to my applications (stage: Saved)</span></label>
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
  state.openJob = id; state.buildJob = id; state.review = null; state.chat = []; state.chatOpen = false; state.err = ""; state.cxEdit = null; state.fitOpen = false; state.cxNew = false; state.coachBusy = building.has(id) ? BUILD_LABEL : "";
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
  <h3>Keywords</h3><div class="kv"><div class="k">In your CV</div><div class="v">${li(ats.must, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.evidence)}</div>`) || "None"}</div><div class="k">Nice to have</div><div class="v">${li(ats.nice, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.evidence)}</div>`) || "None"}</div><div class="k">Missing</div><div class="v">${li(ats.gap, (t) => `<div><b>${esc(t.term)}</b>: ${esc(t.why)}</div>`) || "None"}</div></div>
  ${(a.nextSteps || []).filter(Boolean).length ? `<h3>Next steps</h3><ol>${li(a.nextSteps.filter(Boolean), (s) => `<li>${esc(s)}</li>`)}</ol>` : ""}</div>`;
}
function viewJobPage() {
  const back = `<button type="button" class="sx-back" data-stu="home">${ICO.back}Stuart</button>`;
  const j = state.jobs.find((x) => x.id === state.openJob);
  if (!j) return back + `<section class="card sx-c">${state.jobsLoaded || ctx.mode === "local" ? `<p class="sx-sp">This job is no longer in Stuart's list.</p>` : `<p class="stu-busy"><span class="spin"></span>Opening the job…</p>`}</section>`;
  state.buildJob = j.id;
  if (checking(j)) return back + `<section class="card sx-c"><h2 class="sx-k">Checking</h2><p class="stu-busy"><span class="spin"></span>Stuart is still checking this job. This page fills in when it is done.</p></section>`;
  const f = j.facts || {}, a = j.analysis || {}, b = buildOf(j.id), app = appOf(j), applied = isApplied(j);
  const lvl = a.band && a.band.level ? String(a.band.level).toLowerCase() : "";
  const band = lvl ? `<span class="sx-band ${esc(lvl)}">${esc(lvl[0].toUpperCase() + lvl.slice(1))} likelihood</span>` : "";
  const hs = a.hardScreens || [], met = hs.filter((h) => /^met$/i.test(h.status || "")), rest = hs.filter((h) => !/^met$/i.test(h.status || "")), gapT = ((a.ats || {}).gap || []).slice(0, 4), cov = a.coverage || {};
  const sc = Number((a.roleFit || {}).score), st = Number(j.coach && j.coach.startScore), up = isFinite(sc) && isFinite(st) && j.coach.startScore != null && sc > st ? Math.round(sc - st) : 0;
  const pills = (up ? `<span class="cx-pill up"><b>+${up}</b> since you started</span>` : "") + (hs.length ? `<span class="cx-pill">Hard screens <b>${met.length} of ${hs.length}</b></span>` : "") + (cov.total ? `<span class="cx-pill">Keywords <b>${esc(cov.present)} of ${esc(cov.total)}</b></span>` : "") + band;
  const whyList = `<ul class="sx-why2">${met.length ? `<li><b>Met:</b> ${esc(met.map((h) => h.requirement).join("; "))}</li>` : ""}${rest.length ? `<li><b>Gaps and checks:</b> ${esc(rest.map((h) => h.requirement + (h.status ? " (" + String(h.status).toLowerCase() + ")" : "")).join("; "))}</li>` : ""}${cov.total ? `<li><b>Keywords:</b> ${esc(cov.present)} of ${esc(cov.total)} in your CV${gapT.length ? "; missing " + esc(gapT.map((g) => g.term).join(", ")) : ""}</li>` : ""}${a.recommendation ? `<li><b>Stuart's view:</b> ${esc(a.recommendation)}${a.why ? ". " + esc(a.why) : ""}</li>` : ""}</ul>
    <p class="sx-sp sm">The band is Stuart's judgement, not a probability${a.band && (a.band.reasons || []).length ? ": " + esc(a.band.reasons.map((r) => String(r).replace(/[.\s]+$/, "")).join(". ")) : ""}.</p>`;
  const done = applied ? `<section class="card sx-c sx-done"><div class="sx-tx"><b>${esc(app && app.stage && !["Applied", "Saved", "Preparing"].includes(app.stage) ? "Stage: " + app.stage : "Applied" + (app && app.dateSubmitted ? " on " + fmtD(app.dateSubmitted) : ""))}</b><span>${b && b.saved ? "The three files are in Documents." : "Tell Stuart an update on the home page when you hear back."}</span></div>${app ? `<button type="button" class="btn btn--ghost sx-b sm" data-stu="app-open" data-id="${esc(app.id)}">Open in Applications</button>` : ""}</section>` : "";
  maybeStartCoach(j);
  let lead = "";
  if (!state.cv || !(state.cv.experience || []).length) lead = sayS(`<p>I work from your master CV. Set it up once and I can show you what would lift this application, one thing at a time.</p><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="tab" data-k="cv">Set up My CV</button></div>`);
  else if (!state.chat.length && !state.coachBusy && !j.coach && !applied) lead = sayS(`<p>I can go through what would lift this application, one thing at a time.</p><div class="cx-acts"><button type="button" class="btn sx-b sm" data-stu="cx-start">Start</button></div>`);
  const typing = state.coachBusy || state.busy ? sayS(`<p class="cx-typing"><span class="spin"></span>${esc(state.coachBusy || state.busy)}</p>`) : "";
  const ready = state.chat.some((m) => m.data && m.data.ready);
  const skip = !b && !applied && state.cv && !ready && !state.coachBusy && state.chat.length ? `<button type="button" class="sx-lk cx-skip" data-stu="tailor">Build the documents now</button>` : "";
  const I = b && b.inspection, answered = b ? sinceBuild(b).length : 0;
  const next = b && !applied && !state.coachBusy && !state.inspBusy ? `<div class="cx-next">${answered && !state.coachBusy ? `<button type="button" class="cx-nx on" data-stu="tailor">Rebuild with your answers</button>` : ""}${!(I && I.summary) && !state.inspBusy ? `<button type="button" class="cx-nx" data-stu="insp-run">Check the documents</button>` : ""}<button type="button" class="cx-nx" data-stu="applied">Mark as applied</button></div><p class="cx-nxp">Mark as applied saves the three Word files and sets the stage. Nothing is sent to anyone.</p>` : "";
  const score = Number((a.roleFit || {}).score);
  const top = `<header class="cx-top"><button type="button" class="cx-ib" data-stu="home" aria-label="Back to Stuart">${ICO.back}</button><div class="cx-tt"><b>${esc(f.organisation || "Untitled")}</b><span>${esc([f.role, f.closingDate ? "closes " + fmtD(f.closingDate) : ""].filter(Boolean).join(" · "))}</span></div>${isFinite(score) && a.roleFit ? `<button type="button" class="cx-sc0" data-stu="fit-open" aria-label="Role fit ${Math.round(score)} of 100. Open the full fit check">${Math.round(score)}</button>` : ""}<details class="sx-dd cx-more"><summary class="cx-ib" aria-label="More">${ICO.more}</summary><div class="sx-menu"><button type="button" data-stu="fit-open">Full fit check</button>${b && !applied ? `<button type="button" data-stu="tailor">Rebuild the documents</button>` : ""}<button type="button" class="cx-mdel" data-stu="del-job">Delete this job</button></div></details></header>`;
  const fit = state.fitOpen ? `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="Full fit check"><div class="sx-rvb card"><div class="sx-rvh"><b>Full fit check · ${esc(f.organisation || "")}</b><button type="button" class="sx-pvx" data-stu="fit-x" aria-label="Close">${ICO.x}</button></div>${pills ? `<div class="cx-sc">${pills}</div>` : ""}${whyList}${fitDetail(a)}</div></div>` : "";
  return `<div class="cx-page">${top}<div class="cx-thread">${done}${applied ? "" : jobRulesHTML(j)}${lead}${threadHTML(j, b, applied)}${typing}</div><button type="button" class="cx-new" data-stu="cx-down" hidden>New message ↓</button><div class="cx-foot">${errLine()}${skip}${next}<div class="cx-row cx-in"><textarea id="cx-msg" rows="1" maxlength="4000" placeholder="Reply to Stuart" aria-label="Reply to Stuart"></textarea><button type="button" class="cx-send" data-stu="cx-send" aria-label="Send">${ICO.send}</button></div></div></div>` + fit + reviewHTML(b) + inspHTML(b);
}

function reviewHTML(b) {
  const k = state.review; if (!k || !b) return "";
  const lab = { cv: "Tailored CV", resume: "Resume", letter: "Cover letter" }[k];
  const body = k === "letter" ? `<div class="sx-lted">${(b.letter.paragraphs || []).map((x, i) => `<label class="sx-f wide"><span>Paragraph ${i + 1}</span><textarea data-lt="${i}" rows="4">${esc(x)}</textarea></label>`).join("")}<div class="sx-btns"><button type="button" class="btn sx-b sm" data-stu="lt-save">Save letter</button></div></div>${letterHTML(b.letter, state.cv)}`
    : `<p class="sx-sp sm">To change the content, edit your master CV in the CV builder and rebuild. Lines marked in amber hold a figure Stuart could not find in your CV.</p>${docHTML(b[k], k)}`;
  return `<div class="sx-rv" role="dialog" aria-modal="true" aria-label="${lab}"><div class="sx-rvb card"><div class="sx-rvh"><b>${lab} · ${esc(b.org || "")}</b><button type="button" class="sx-pvx" data-stu="review-x" aria-label="Close">${ICO.x}</button></div>${body}</div></div>`;
}
/* output: print to PDF, Word download */
function printDoc(kind) {
  const b = buildOf(state.buildJob), html = kind === "master" ? docHTML(draft(), "cv") : kind === "letter" ? letterHTML(b && b.letter, state.cv) : docHTML(b && b[kind], kind);
  let el = document.getElementById("sx-print"); if (!el) { el = document.createElement("div"); el.id = "sx-print"; document.body.appendChild(el); }
  el.innerHTML = html; document.body.classList.add("sx-printing");
  const done = () => { document.body.classList.remove("sx-printing"); el.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done); setTimeout(() => window.print(), 50);
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
function markDirty() { if (!state.cvDirty) { state.cvDirty = true; const s = document.querySelector(".sx-save"); if (s) { const c = draft(); s.innerHTML = `<span class="sx-dirty">Unsaved changes</span><button type="button" class="btn btn--ghost sx-b sm" data-stu="cv-discard">Discard</button><button type="button" class="btn sx-b sm" data-stu="cv-save">Save as v${esc(nextVer(c.version))}</button>`; } } }
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
  if (act === "home") { state.openJob = null; if (ctx.mode !== "local") watchChat(null); state.showPlan = false; render(); return; }
  if (await hubClick(act, t)) return;
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
    const data = { track: !!S.track };
    try { if (S.mode === "file") data.file = await readFile(S.file); else if (S.mode === "text") { data.text = text; if (url) data.link = url; } else data.url = url; }
    catch (err) { S.err = err.message || String(err); render(); return; }
    await runAnalyse(data); return; }
  if (act === "del-job") { if (ctx.deleteJob && state.openJob) { const id = state.openJob; if (await ctx.deleteJob(id)) { state.openJob = null; render(); window.scrollTo({ top: 0 }); } } return; }
  if (act === "app-open") { if (ctx.openApp) ctx.openApp(t.dataset.id); return; }
  if (ctx.mode === "local") { state.err = "Preview only. Sign in on the hosted app to use Stuart."; render(); return; }
  if (act === "consent") { if (!document.getElementById("c1").checked || !document.getElementById("c2").checked) { state.err = "Both boxes are needed to continue."; render(); return; }
    await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "profile", "current"), { consentAI: true, consentAt: ctx.FS.serverTimestamp(), consentVersion: "2026-10-31" }, { merge: true }); return; }
  if (act === "intent") { state.intention = t.dataset.k; document.querySelectorAll(".stu-opt").forEach((o) => o.classList.toggle("on", o === t)); const tg = document.getElementById("stu-target"); tg.hidden = false; tg.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (act === "plan") { const target = (document.getElementById("stu-tgt").value || "").trim(), startBy = document.getElementById("stu-date").value; if (!state.intention || !target) { state.err = "Choose why you are here and type a target."; render(); return; }
    try { await call("stuartPlan", { intention: state.intention, target, startBy }, "Stuart is drafting your plan…"); } catch (e) {} return; }
  if (act === "confirm-plan") { await ctx.FS.setDoc(ctx.FS.doc(ctx.db, "users", ctx.user.uid, "plan", "current"), { confirmed: true }, { merge: true }); return; }
  if (act === "redraft") { const p = state.profile; try { await call("stuartPlan", { intention: p.intention, target: p.target, startBy: p.startBy }, "Stuart is redrafting…"); } catch (e) {} return; }
});
async function hubClick(act, t) {
  const n = (k) => Number(t.dataset[k]);
  switch (act) {
    case "tab": state.tab = t.dataset.k; state.openJob = null; state.review = null; state.pvOpen = false; render(); window.scrollTo({ top: 0 }); return true;
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
      else { const r = c.experience[S.i], b = { text: x.new, src: "stuart", confirmed: !!x.unsourced && act === "sg-ok" }; if (x.index >= 0 && r.bullets[x.index]) r.bullets[x.index] = b; else r.bullets.push(b); }
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
      const answers = b0 ? state.chat.filter((m) => m.role === "user" && !m.temp && (tms(m.at) > since || Q_TAG.test(m.text || ""))).map((m) => m.text).join("\n\n").slice(-8000) : "";
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
    case "print": printDoc(t.dataset.kind); return true;
    case "word": {
      if (ctx.mode === "local") { if (ctx.toast) ctx.toast("Word files are made on the server. Sign in on the hosted app."); return true; }
      if (t.dataset.kind === "master" && state.cvDirty) { state.err = "Save your changes first; the Word file is made from the saved CV."; render(); return true; }
      const data = t.dataset.kind === "master" ? { kinds: ["cv"] } : { jobId: state.buildJob, kinds: [t.dataset.kind] };
      try { const r = await call("stuartDocx", data, "Making the Word file…"); (r.files || []).forEach((f) => saveB64(f.name, f.data)); render(); } catch (e) {} return true; }
    case "applied": {
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
