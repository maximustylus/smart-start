// SMART START admin dashboard (2.28.3; Export 2.40.2): the owner's own view of how the app is used. The adminMetrics function checks
// the account and returns counts, dates and costs only, never the content of anyone's records.
const FX = 1.35, C1 = "#23A566", C2 = "#8F7CEC"; // chart colours checked for colour-blind separation on both themes
const KINDS = { analyse: ["Fit check", "stuartAnalyse"], tailor: ["Build documents", "stuartTailor"], inspect: ["Inspection", "stuartInspect"], coach: ["Coaching", "stuartCoach"], practice: ["Interview practice", "stuartPractise"], email: ["Application email", "stuartEmail"], profile: ["Read a CV", "stuartProfile"], plan: ["Plan", "stuartPlan"], chat: ["Chat on a job", "stuartChat"], log: ["Update", "stuartLog"], improve: ["Improve a CV section", "stuartImprove"], cvcheck: ["Check my CV", "stuartCvCheck"], interview: ["CV from questions", "stuartInterview"], rules: ["Rules", "stuartRules"], scan: ["Rules scan", "stuartRules"], sectors: ["Sector suggestions", "stuartSectors"] };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S2 = (usd) => "S$" + (usd * FX).toFixed(2);
const toks = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const day = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
const longDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
let ctx = null, data = null, fetchedAt = 0, busy = false, err = "", shown = {};
const ui = { range: 30, leaveOut: true };

function demo() {
  const now = Date.now(), D = 864e5, days = [];
  for (let i = 12; i >= 0; i--) { const v = (i * 7) % 5 + 1; days.push({ date: day(now - i * D), others: { fns: { stuartCoach: { calls: v * 6, errors: i === 0 ? 1 : 0 }, stuartAnalyse: { calls: v, errors: 0 } }, kinds: { coach: { calls: v * 6, tokens: v * 50000, usd: v * 0.06 }, analyse: { calls: v, tokens: v * 20000, usd: v * 0.25 }, email: { calls: 1, tokens: 3000, usd: 0.01 } }, models: { "claude-sonnet-5-5": { usd: v * 0.07, cacheRead: v * 30000, cacheWrite: v * 6000, inFresh: v * 9000 }, "claude-opus-5-5": { usd: v * 0.25, cacheRead: v * 8000, cacheWrite: v * 7000, inFresh: v * 5000 } } } }); }
  const a = (id, mask, j, s, o) => Object.assign({ id, mask, joined: now - j * D, seen: now - s * D, verified: true, consent: true, cv: true, jobs: 2, docs: 1, applied: 1, apps: 3, calls: 12, usd: 1.2, tokens: 90000, cap: 3.7, owner: false }, o);
  return { accounts: [a("u1", "s•••@mail.example", 4, 0, { calls: 41, usd: 3.05, jobs: 6, docs: 4, applied: 3 }), a("u2", "n•••@mail.example", 2, 0), a("u3", "a•••@mail.example", 6, 3, { docs: 0, applied: 0, calls: 5, usd: 0.3 }), a("u4", "r•••@mail.example", 1, 1, { verified: false, consent: false, cv: false, jobs: 0, docs: 0, applied: 0, apps: 0, calls: 0, usd: 0, tokens: 0 }), a("me", "m•••@mail.example", 30, 0, { owner: true, calls: 200, usd: 7.2 })], days, feedback7: 2, retention: { at: now - D / 2 } };
}
function bars(vals, title) {
  const n = vals.length, m = Math.max(1, ...vals.map((v) => v.a + v.b)), H = 110, W = 520, bw = Math.max(2, (W - (n - 1) * 2) / n);
  return `<svg class="ad-ch" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">${vals.map((v, i) => { const x = i * (bw + 2), ha = (v.a / m) * H, hb = (v.b / m) * H; return `<g><title>${esc(v.tip)}</title><rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"/>${ha ? `<rect x="${x}" y="${H - ha}" width="${bw}" height="${ha}" rx="2" fill="${C1}"/>` : ""}${hb > 1 ? `<rect x="${x}" y="${H - ha - hb}" width="${bw}" height="${hb - 1}" rx="2" fill="${C2}"/>` : ""}</g>`; }).join("")}</svg>`;
}
function dates(n, now = Date.now()) { const o = []; for (let i = n - 1; i >= 0; i--) o.push(day(now - i * 864e5)); return o; }
// 2.40.2: every figure is computed once here, so the page and the exports cannot disagree
export function model(data, ui, now) {
  const A = data.accounts.filter((a) => !(ui.leaveOut && a.owner)), span = ui.range || 90, list = dates(span, now), from = list[0];
  const buckets = (d) => (ui.leaveOut ? [d.others] : [d.others, d.owner]).filter(Boolean);
  const inRange = data.days.filter((d) => !ui.range || d.date >= from);
  const kinds = {}, fns = {}, cache = { read: 0, write: 0, fresh: 0 }; let tokTotal = 0;
  inRange.forEach((d) => buckets(d).forEach((b) => {
    Object.values(b.models || {}).forEach((v) => { if (v.inFresh == null) return; cache.read += v.cacheRead || 0; cache.write += v.cacheWrite || 0; cache.fresh += v.inFresh || 0; }); // only days recorded since 2.50.5
    Object.entries(b.kinds || {}).forEach(([k, v]) => { const x = (kinds[k] = kinds[k] || { calls: 0, tokens: 0, usd: 0 }); x.calls += v.calls || 0; x.tokens += v.tokens || 0; x.usd += v.usd || 0; tokTotal += v.tokens || 0; });
    Object.entries(b.fns || {}).forEach(([k, v]) => { const x = (fns[k] = fns[k] || { calls: 0, errors: 0 }); x.calls += v.calls || 0; x.errors += v.errors || 0; });
  }));
  const sum = (k) => A.reduce((n, a) => n + (a[k] || 0), 0), active7 = A.filter((a) => a.seen && now - a.seen < 7 * 864e5).length, used = A.filter((a) => a.calls > 0).length;
  const new7 = A.filter((a) => a.joined && now - a.joined < 7 * 864e5).length;
  const joins = {}; A.forEach((a) => { if (a.joined) { const k = day(a.joined); joins[k] = (joins[k] || 0) + 1; } });
  const su = list.map((d) => ({ a: joins[d] || 0, b: 0, tip: dayLabel(d) + ": " + (joins[d] || 0) + " sign-ups" }));
  const byDay = {}; data.days.forEach((d) => { byDay[d.date] = d; });
  const daily = list.map((d) => { let so = 0, op = 0, calls = 0, tokens = 0, errors = 0; if (byDay[d]) buckets(byDay[d]).forEach((b) => { Object.entries(b.models || {}).forEach(([m, v]) => { if (/opus/.test(m)) op += v.usd || 0; else so += v.usd || 0; }); Object.values(b.kinds || {}).forEach((v) => { calls += v.calls || 0; tokens += v.tokens || 0; }); Object.values(b.fns || {}).forEach((v) => { errors += v.errors || 0; }); }); return { date: d, signups: joins[d] || 0, calls, tokens, sonnet: so, opus: op, errors }; });
  const co = daily.map((x) => ({ a: x.sonnet, b: x.opus, tip: dayLabel(x.date) + ": Sonnet " + S2(x.sonnet) + ", Opus " + S2(x.opus) }));
  const fun = [["Signed up", A.length], ["Email confirmed", A.filter((a) => a.verified).length], ["Agreed to AI use", A.filter((a) => a.consent).length], ["CV set up", A.filter((a) => a.cv).length], ["Job checked", A.filter((a) => a.jobs).length], ["Documents built", A.filter((a) => a.docs).length], ["Marked as applied", A.filter((a) => a.applied).length]];
  const today = byDay[day(now)]; let tCalls = 0, tErr = 0, mailErr = 0;
  if (today) buckets(today).forEach((b) => Object.entries(b.fns || {}).forEach(([k, v]) => { tCalls += v.calls || 0; tErr += v.errors || 0; if (k === "sendAuthEmail") mailErr += v.errors || 0; }));
  const near = A.filter((a) => a.cap && a.usd / a.cap >= 0.8).length;
  const features = Object.entries(kinds).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => { const L = KINDS[k] || [k, ""]; const f = fns[L[1]] || {}; return { key: k, name: L[0], fn: L[1], calls: v.calls, tokens: v.tokens, usd: v.usd, errors: f.errors || 0 }; });
  const accounts = A.slice().sort((a, b) => b.usd - a.usd || (b.joined || 0) - (a.joined || 0));
  const R = data.retention;
  const health = [["Errors today", tErr + " of " + tCalls + " calls", tErr > 0], ["Accounts over 80% of their limit", String(near), near > 0], ["Failed sign-up emails today", String(mailErr), mailErr > 0], ["Notify me: voice, video", data.accounts.filter((x) => x.notify && x.notify.voice).length + ", " + data.accounts.filter((x) => x.notify && x.notify.video).length, false], ["Feedback, last 7 days", data.feedback7 + (data.feedback7 === 1 ? " message" : " messages"), data.feedback7 > 0], ["Daily retention job", R && R.at ? "Ran " + dayLabel(day(Number(R.at))) : "No run recorded yet", !(R && R.at)], ["Input read from cache", cacheLine(cache), false], ["Applications tracked", String(sum("apps")), false], ["Jobs checked", String(sum("jobs")), false]];
  const period = ui.range ? "Last " + ui.range + " days, " + longDate(from) + " to " + longDate(list[list.length - 1]) : "All time, since recording began (charts show the last 90 days)";
  return { A, list, kinds, fns, tokTotal, sum, active7, used, new7, su, co, daily, fun, near, features, accounts, health, period, calls: sum("calls"), usd: sum("usd") };
}
function cacheLine(c) { const all = c.read + c.write + c.fresh; if (!all) return "Nothing recorded yet"; return Math.round((c.read / all) * 100) + "% (" + toks(c.read) + " of " + toks(all) + " tokens)"; }
function html() {
  const now = Date.now(), M = model(data, ui, now), A = M.A, list = M.list, sum = M.sum;
  const tile = (v, l, s) => `<div class="card ad-t"><b>${esc(v)}</b><span>${esc(l)}</span><i>${esc(s)}</i></div>`;
  const su = M.su, co = M.co, fun = M.fun, top = fun[0][1] || 1, active7 = M.active7, used = M.used, new7 = M.new7, tokTotal = M.tokTotal;
  const st = (lab, val, warn) => `<div><span>${esc(lab)}</span><b class="${warn ? "ad-w" : "ad-o"}">${esc(val)}</b></div>`;
  const rows = M.features.map((v) => `<tr><td><b>${esc(v.name)}</b><small>${esc(v.fn)}</small></td><td class="n">${v.calls}</td><td class="n">${toks(v.tokens)}</td><td class="n">${S2(v.usd)}</td><td class="n">${v.calls ? S2(v.usd / v.calls) : "–"}</td><td class="n">${v.errors || "–"}</td></tr>`).join("");
  const acc = M.accounts.map((a) => `<tr><td><button type="button" class="ad-m" data-ad="reveal" data-id="${esc(a.id)}">${esc(shown[a.id] || a.mask)}</button>${a.owner ? "<small>You</small>" : ""}</td><td>${a.joined ? dayLabel(day(a.joined)) : "–"}</td><td>${a.seen ? dayLabel(day(a.seen)) : "–"}</td><td>${a.consent ? "Yes" : "No"}</td><td class="n">${a.jobs}</td><td class="n">${a.calls}</td><td class="n">${toks(a.tokens || 0)}</td><td class="n">${S2(a.usd)}</td><td class="n">${a.cap ? Math.round((a.usd / a.cap) * 100) + "%" : "–"}</td></tr>`).join("");
  const R = data.retention, chip = (v, l) => `<button type="button" class="ad-c${ui.range === v ? " on" : ""}" data-ad="range" data-r="${v}">${l}</button>`;
  return `<div class="ad"><div class="ad-h"><button type="button" class="iconbtn" data-act="admin-x" aria-label="Back to Settings">‹</button><div><h1>Admin</h1><p>${ctx.mode === "local" ? "Sample figures. " : ""}Your account only. Counts and costs, never content.</p></div><button type="button" class="ad-c" data-ad="refresh">Refresh</button></div>
  ${err ? `<p class="ad-e" role="alert">${esc(err)}</p>` : ""}
  <div class="ad-f">${chip(7, "7 days")}${chip(30, "30 days")}${chip(0, "All time")}${exportMenu()}</div>
  ${exportErr ? `<p class="ad-e" role="alert">${esc(exportErr)}</p>` : ""}<label class="ad-sw"><input type="checkbox" class="pv-sw" data-ad="me"${ui.leaveOut ? " checked" : ""}> Leave out my account</label>
  <div class="ad-ts">${tile(A.length, "Accounts", "+" + new7 + " in 7 days")}${tile(active7, "Active, 7 days", A.length ? Math.round((active7 / A.length) * 100) + "% of accounts" : "")}${tile(sum("calls"), "AI calls", "this month")}${tile(toks(tokTotal), "Tokens", ui.range ? "last " + ui.range + " days, since recording began" : "since recording began")}${tile(S2(sum("usd")), "AI cost", "this month, about US$" + sum("usd").toFixed(2))}${tile(used ? S2(sum("usd") / used) : "–", "Per user of Stuart", "this month")}</div>
  <div class="ad-2"><section class="card ad-c1"><h3>New sign-ups a day</h3>${bars(su, "New sign-ups a day")}<div class="ad-ax"><span>${dayLabel(list[0])}</span><span>${dayLabel(list[list.length - 1])}</span></div></section>
  <section class="card ad-c1"><h3>AI cost a day</h3><div class="ad-lg"><span><i style="background:${C2}"></i>Opus 5.5</span><span><i style="background:${C1}"></i>Sonnet 5.5</span></div>${bars(co, "AI cost a day by model")}<div class="ad-ax"><span>${dayLabel(list[0])}</span><span>${dayLabel(list[list.length - 1])}</span></div></section></div>
  <div class="ad-2"><section class="card ad-c1"><h3>How far people get</h3>${fun.map(([l, n]) => `<div class="ad-fu"><span>${l}</span><div><i style="width:${Math.round((n / top) * 100)}%"></i></div><b>${n}</b></div>`).join("")}</section>
  <section class="card ad-c1"><h3>Health</h3><div class="ad-he">${M.health.map(([l, v, w]) => st(l, v, w)).join("")}</div></section></div>
  <section class="card ad-c1"><h3>By feature</h3>${rows ? `<div class="ad-tw"><table><thead><tr><th>Feature</th><th class="n">Calls</th><th class="n">Tokens</th><th class="n">Cost</th><th class="n">Per call</th><th class="n">Errors</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="ad-n">Nothing recorded in this period yet. Feature figures start from this version; earlier use is not broken down.</p>`}</section>
  <section class="card ad-c1"><h3>By account, this month</h3><div class="ad-tw"><table><thead><tr><th>Account</th><th>Joined</th><th>Last seen</th><th>AI consent</th><th class="n">Jobs</th><th class="n">Calls</th><th class="n">Tokens</th><th class="n">Cost</th><th class="n">Of limit</th></tr></thead><tbody>${acc}</tbody></table></div><p class="ad-n">Addresses are masked; tap one to see it in full when someone asks for help. Costs are estimated from tokens at list prices; your providers' bills stay in their own consoles.</p></section></div>`;
}
// 2.40.2 Export, after NEXUS's roster export: one button, a menu that says what each file is for, and builders kept apart
// from the menu so each can be tested alone. Files are made on this device; addresses are always the masked form.
const FORMATS = [["pdf", "PDF", "Report to keep", "A4: summary, charts, features and accounts. Addresses masked."], ["daily", "CSV", "Daily figures", "One row a day: sign-ups, AI calls, tokens, cost by model, errors."], ["features", "CSV", "By feature", "Calls, tokens, cost, per call and errors for each feature."], ["accounts", "CSV", "By account", "Masked address, dates, consent, jobs, calls, cost, share of limit."]];
let menuOpen = false, exporting = "", exportErr = "";
function exportMenu() {
  const scope = (ui.range ? ui.range + " days" : "all time") + (ui.leaveOut ? ", your account left out" : ", your account included");
  return `<div class="ad-x"><button type="button" class="ad-c ad-xb" data-ad="menu" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-controls="ad-xm"${exporting ? " disabled" : ""}><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${exporting ? "Making " + (exporting === "pdf" ? "PDF" : "CSV") + "…" : "Export"}</button>${menuOpen ? `<div class="ad-xm" id="ad-xm" role="menu">${FORMATS.map(([id, ext, label, hint]) => `<button type="button" role="menuitem" class="ad-xi" data-ad="export" data-f="${id}"><span class="ad-xic" aria-hidden="true">${ext}</span><span><b>${esc(label)} <em>${ext}</em></b><span>${esc(hint)}</span></span></button>`).join("")}<p>Uses the period and switch: ${esc(scope)}.</p></div>` : ""}</div>`;
}
const sgNow = (now) => { const d = new Date(now + 8 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; };
// A leading = + - @ is neutralised so a spreadsheet never runs a cell as a formula
const csvCell = (v) => { v = String(v == null ? "" : v); if (/^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const sgd = (usd) => (usd * FX).toFixed(2), isoDay = (ms) => (ms ? day(ms) : "");
export function buildCsv(kind, M) {
  if (kind === "daily") return csv([["date", "sign_ups", "ai_calls", "tokens", "cost_sonnet_sgd", "cost_opus_sgd", "errors"]].concat(M.daily.map((d) => [d.date, d.signups, d.calls, d.tokens, sgd(d.sonnet), sgd(d.opus), d.errors])));
  if (kind === "features") return csv([["feature", "function", "calls", "tokens", "cost_sgd", "cost_per_call_sgd", "errors"]].concat(M.features.map((f) => [f.name, f.fn, f.calls, f.tokens, sgd(f.usd), f.calls ? sgd(f.usd / f.calls) : "", f.errors])));
  if (kind === "accounts") return csv([["account_masked", "you", "joined", "last_seen", "email_confirmed", "ai_consent", "cv_set_up", "jobs", "documents", "applied", "applications", "ai_calls_this_month", "tokens_this_month", "cost_this_month_sgd", "limit_sgd", "share_of_limit_pct"]].concat(M.accounts.map((a) => [a.mask, a.owner ? "yes" : "no", isoDay(a.joined), isoDay(a.seen), a.verified ? "yes" : "no", a.consent ? "yes" : "no", a.cv ? "yes" : "no", a.jobs || 0, a.docs || 0, a.applied || 0, a.apps || 0, a.calls || 0, a.tokens || 0, sgd(a.usd || 0), a.cap ? sgd(a.cap) : "", a.cap ? Math.round(((a.usd || 0) / a.cap) * 100) : ""])));
  throw new Error("Unknown export: " + kind);
}
// The PDF is drawn with jsPDF's own text and shapes (real type: searchable, sharp, small), never a screenshot.
// paintReport takes the drawing surface as an argument, so a test can pass a recorder instead of jsPDF.
const P = { w: 210, h: 297, m: 16 }, INK = { title: [6, 67, 44], text: [17, 17, 17], muted: [90, 99, 94], rule: [210, 222, 214], tint: [234, 244, 238], green: [26, 138, 85], c1: [35, 165, 102], c2: [143, 124, 236], warn: [143, 84, 0] };
// The built-in PDF font covers Latin-1 only: map the few other characters the dashboard uses, never drop a figure silently
export const pdfText = (s) => String(s == null ? "" : s).replace(/•/g, "*").replace(/·/g, "-").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e -ÿ]/g, "?");
export function paintReport(doc, M, meta) {
  const W = P.w - 2 * P.m; let y = 0;
  const font = (size, bold, col) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...(col || INK.text)); };
  const text = (s, x, yy, o) => doc.text(pdfText(s), x, yy, o || {});
  const fit = (s, w) => { s = pdfText(s); if (doc.getTextWidth(s) <= w) return s; while (s.length > 1 && doc.getTextWidth(s + "...") > w) s = s.slice(0, -1); return s + "..."; };
  const header = (title, sub) => {
    if (meta.logo) doc.addImage(meta.logo, "PNG", P.w - P.m - 12, 13, 12, 12);
    font(17, true, INK.title); text(title, P.m, 20); font(8.5, false, INK.muted); text(fit(sub, W - 16), P.m, 26);
    doc.setDrawColor(...INK.green); doc.setLineWidth(0.6); doc.line(P.m, 29.5, P.w - P.m, 29.5); y = 38;
  };
  const heading = (s, note) => { font(10.5, true, INK.title); text(s, P.m, y); if (note) { const w = doc.getTextWidth(pdfText(s)); font(7.5, false, INK.muted); text(note, P.m + w + 3, y); } y += 4; };
  const chart = (vals, legend, unit) => {
    const h = 24, n = vals.length, gap = n > 60 ? 0.3 : 0.6, bw = (W - (n - 1) * gap) / n, max = Math.max(...vals.map((v) => v.a + v.b), 0);
    if (legend) { font(7.5, false, INK.muted); let lx = P.w - P.m; legend.slice().reverse().forEach(([lab, col]) => { const tw = doc.getTextWidth(lab); lx -= tw; text(lab, lx, y - 4); lx -= 4; doc.setFillColor(...col); doc.rect(lx, y - 6.3, 2.6, 2.6, "F"); lx -= 5; }); }
    if (max > 0) vals.forEach((v, i) => { const x = P.m + i * (bw + gap), ha = (v.a / max) * h, hb = (v.b / max) * h; if (ha > 0) { doc.setFillColor(...INK.c1); doc.rect(x, y + h - ha, bw, ha, "F"); } if (hb > 0) { doc.setFillColor(...INK.c2); doc.rect(x, y + h - ha - hb, bw, hb, "F"); } });
    doc.setDrawColor(...INK.rule); doc.setLineWidth(0.2); doc.line(P.m, y + h, P.w - P.m, y + h);
    font(7.5, false, INK.muted); text(dayLabel(M.list[0]), P.m, y + h + 4); text(dayLabel(M.list[M.list.length - 1]), P.w - P.m, y + h + 4, { align: "right" });
    text(max > 0 ? "Highest day: " + unit(max) : "None in this period", P.w / 2, y + h + 4, { align: "center" }); y += h + 11;
  };
  const table = (cols, rows, opts = {}) => { // cols: [label, width, align]
    const rowH = 5.6;
    const head = () => { font(7, true, INK.muted); let x = P.m; cols.forEach(([l, w, al]) => { text(l.toUpperCase(), al === "r" ? x + w - 1 : x + 1, y, al === "r" ? { align: "right" } : {}); x += w; }); doc.setDrawColor(...INK.rule); doc.setLineWidth(0.3); doc.line(P.m, y + 1.6, P.w - P.m, y + 1.6); y += rowH; };
    head();
    rows.forEach((r, ri) => {
      if (y > P.h - 24) { doc.addPage(); y = 22; head(); }
      const total = opts.totalRow && ri === rows.length - 1;
      if (total) { doc.setFillColor(...INK.tint); doc.rect(P.m, y - 3.9, W, rowH, "F"); }
      font(8, total, INK.text); let x = P.m; r.forEach((c, ci) => { const [, w, al] = cols[ci]; text(fit(c, w - 2), al === "r" ? x + w - 1 : x + 1, y, al === "r" ? { align: "right" } : {}); x += w; });
      doc.setDrawColor(...INK.rule); doc.setLineWidth(0.15); doc.line(P.m, y + 1.7, P.w - P.m, y + 1.7); y += rowH;
    });
    if (!rows.length) { font(8, false, INK.muted); text(opts.empty || "Nothing recorded in this period.", P.m + 1, y); y += rowH; }
    y += 5;
  };
  const scope = M.period + (meta.leaveOut ? " - your account left out" : " - your account included");
  // Page 1: summary, charts, funnel, health
  header("SMART START usage report", scope);
  const tiles = [[String(M.A.length), "Accounts (+" + M.new7 + " in 7 days)"], [String(M.active7), "Active in the last 7 days" + (M.A.length ? " (" + Math.round((M.active7 / M.A.length) * 100) + "%)" : "")], [String(M.calls), "AI calls this month"], [toks(M.tokTotal), "Tokens in the period"], [S2(M.usd), "AI cost this month (about US$" + M.usd.toFixed(2) + ")"], [M.used ? S2(M.usd / M.used) : "-", "Per user of Stuart, this month"]];
  const tw = (W - 8) / 3, th = 16;
  tiles.forEach(([v, l], i) => { const x = P.m + (i % 3) * (tw + 4), ty = y + Math.floor(i / 3) * (th + 4); doc.setDrawColor(...INK.rule); doc.setLineWidth(0.3); doc.roundedRect(x, ty, tw, th, 2, 2, "S"); font(14, true, INK.title); text(v, x + 3.5, ty + 7.5); font(7.5, false, INK.muted); text(fit(l, tw - 7), x + 3.5, ty + 12.5); });
  y += 2 * th + 4 + 11;
  heading("New sign-ups a day"); y += 3; chart(M.su, null, (v) => String(Math.round(v)));
  heading("AI cost a day", "S$"); y += 3; chart(M.co.map((v) => ({ a: v.a * FX, b: v.b * FX })), [["Sonnet 5.5", INK.c1], ["Opus 5.5", INK.c2]], (v) => "S$" + v.toFixed(2));
  heading("How far people get"); y += 1;
  const top = M.fun[0][1] || 1; M.fun.forEach(([l, n]) => { font(8.5, false, INK.text); text(l, P.m, y + 2.4); doc.setFillColor(...INK.tint); doc.roundedRect(P.m + 38, y, W - 50, 3.2, 1, 1, "F"); if (n) { doc.setFillColor(...INK.green); doc.roundedRect(P.m + 38, y, Math.max(1.5, ((W - 50) * n) / top), 3.2, 1, 1, "F"); } font(8.5, true, INK.text); text(String(n), P.w - P.m, y + 2.6, { align: "right" }); y += 5.4; });
  y += 6; heading("Health"); y += 1;
  const half = (W - 8) / 2; M.health.forEach(([l, v, warn], i) => { const x = P.m + (i % 2) * (half + 8), ry = y + Math.floor(i / 2) * 5.8; font(8.5, false, INK.text); text(fit(l, half - 30), x, ry); font(8.5, true, warn ? INK.warn : INK.text); text(fit(v, 30), x + half, ry, { align: "right" }); doc.setDrawColor(...INK.rule); doc.setLineWidth(0.15); doc.line(x, ry + 1.8, x + half, ry + 1.8); });
  // Page 2 onwards: tables, which carry on to further pages with their headings repeated
  doc.addPage(); header("By feature and by account", "Generated " + meta.generated);
  heading("By feature", M.period); y += 1;
  const fr = M.features.map((f) => [f.name, String(f.calls), toks(f.tokens), S2(f.usd), f.calls ? S2(f.usd / f.calls) : "-", f.errors ? String(f.errors) : "-"]);
  if (fr.length) { const c = M.features.reduce((n, f) => n + f.calls, 0), t = M.features.reduce((n, f) => n + f.tokens, 0), u = M.features.reduce((n, f) => n + f.usd, 0), e = M.features.reduce((n, f) => n + f.errors, 0); fr.push(["Total", String(c), toks(t), S2(u), c ? S2(u / c) : "-", e ? String(e) : "-"]); }
  table([["Feature", 58, "l"], ["Calls", 22, "r"], ["Tokens", 26, "r"], ["Cost", 26, "r"], ["Per call", 26, "r"], ["Errors", 20, "r"]], fr, { totalRow: fr.length > 0, empty: "Nothing recorded in this period yet." });
  heading("By account", "this calendar month"); y += 1;
  table([["Account", 50, "l"], ["Joined", 18, "l"], ["Last seen", 20, "l"], ["AI", 12, "l"], ["Jobs", 14, "r"], ["Calls", 16, "r"], ["Cost", 26, "r"], ["Of limit", 22, "r"]], M.accounts.map((a) => [a.mask + (a.owner ? " (you)" : ""), a.joined ? dayLabel(day(a.joined)) : "-", a.seen ? dayLabel(day(a.seen)) : "-", a.consent ? "Yes" : "No", String(a.jobs || 0), String(a.calls || 0), S2(a.usd || 0), a.cap ? Math.round(((a.usd || 0) / a.cap) * 100) + "%" : "-"]), { empty: "No accounts." });
  if (y > P.h - 30) { doc.addPage(); y = 22; }
  font(7.5, false, INK.muted); text("Addresses are always masked in exports; full addresses stay in the app, one tap at a time.", P.m, y); y += 4;
  text("AI calls, AI cost and the account table are this calendar month whatever the period; tokens, features and charts follow the period.", P.m, y);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setDrawColor(...INK.rule); doc.setLineWidth(0.2); doc.line(P.m, P.h - 13, P.w - P.m, P.h - 13); font(7, false, INK.muted); text("SMART START owner's report. Counts and costs only, never the content of anyone's records. Costs estimated from tokens at list prices.", P.m, P.h - 9); text("Page " + i + " of " + n, P.w - P.m, P.h - 9, { align: "right" }); }
  return doc;
}
function save(name, blob) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 4000); }
let jsPdfP = null;
function loadJsPdf() { // fetched only on the first PDF export, from this site (vendored, not a third-party script)
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return (jsPdfP = jsPdfP || new Promise((ok, no) => { const s = document.createElement("script"); s.src = "vendor/jspdf-4.2.1.umd.min.js"; s.onload = () => (window.jspdf ? ok(window.jspdf.jsPDF) : no(new Error("The PDF tool did not start."))); s.onerror = () => { jsPdfP = null; s.remove(); no(new Error("Could not load the PDF tool. Check the connection and try again.")); }; document.head.appendChild(s); }));
}
async function logoData() { try { const b = await (await fetch("icons/smartstart-icon-dark-180.png")).blob(); return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(b); }); } catch (e) { return null; } }
async function runExport(kind) {
  if (!data || exporting) return;
  const now = Date.now(), M = model(data, ui, now), t = sgNow(now), tag = (ui.range ? ui.range + "d" : "all") + (ui.leaveOut ? "" : "-with-me");
  exporting = kind; exportErr = ""; menuOpen = false; paint();
  try {
    if (kind === "pdf") {
      const [J, logo] = await Promise.all([loadJsPdf(), logoData()]);
      const doc = new J({ unit: "mm", format: "a4", orientation: "portrait" });
      doc.setProperties({ title: "SMART START usage report " + t.date, creator: "SMART START" });
      paintReport(doc, M, { logo, leaveOut: ui.leaveOut, generated: longDate(t.date) + ", " + t.time + " Singapore time" });
      save("smartstart-admin-report-" + t.date + "-" + tag + ".pdf", doc.output("blob"));
    } else save("smartstart-admin-" + kind + "-" + t.date + "-" + tag + ".csv", new Blob([buildCsv(kind, M)], { type: "text/csv;charset=utf-8" }));
  } catch (e) { exportErr = (e && e.message) || "Could not make the file."; }
  exporting = ""; paint();
}
function onDoc(e) { if (menuOpen && !(e.target.closest && e.target.closest(".ad-x"))) { menuOpen = false; paint(); } }
function onKey(e) { if (menuOpen && e.key === "Escape") { menuOpen = false; paint(); const b = ctx && ctx.el.querySelector(".ad-xb"); if (b) b.focus(); } }
function paint() { if (ctx && ctx.el) { const y = scrollY; ctx.el.innerHTML = data ? html() : `<div class="ad"><div class="ad-h"><button type="button" class="iconbtn" data-act="admin-x" aria-label="Back to Settings">‹</button><div><h1>Admin</h1><p>${err ? "" : "Loading…"}</p></div></div>${err ? `<p class="ad-e" role="alert">${esc(err)}</p>` : ""}</div>`; scrollTo(0, y); } }
async function call(payload) { const F = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js"); return (await F.httpsCallable(F.getFunctions(ctx.app, "asia-southeast1"), "adminMetrics", { timeout: 120000 })(payload)).data; }
async function load(force) {
  if (busy || (data && !force && Date.now() - fetchedAt < 60000)) return;
  if (ctx.mode === "local") { data = demo(); fetchedAt = Date.now(); paint(); return; }
  busy = true; err = "";
  try { data = await call({}); fetchedAt = Date.now(); } catch (e) { err = (e && e.message) || "Could not load the figures."; }
  busy = false; paint();
}
function onClick(e) {
  const t = e.target.closest("[data-ad]"); if (!t || !ctx) return; const a = t.dataset.ad;
  if (a === "menu") { menuOpen = !menuOpen; exportErr = ""; paint(); if (menuOpen) { const f = ctx.el.querySelector(".ad-xi"); if (f) f.focus(); } return; }
  if (a === "export") { runExport(t.dataset.f); return; }
  if (a === "range") { ui.range = Number(t.dataset.r); paint(); }
  else if (a === "refresh") { load(true); }
  else if (a === "reveal") { const id = t.dataset.id; if (shown[id]) { delete shown[id]; paint(); return; } if (ctx.mode === "local") { shown[id] = "person@mail.example"; paint(); return; } call({ reveal: id }).then((r) => { shown[id] = r.email || "No address"; paint(); }).catch((x) => { err = (x && x.message) || "Could not show the address."; paint(); }); }
}
function onChange(e) { const t = e.target; if (ctx && t.dataset && t.dataset.ad === "me") { ui.leaveOut = t.checked; paint(); } }
let wired = null;
export function mount(c) {
  ctx = c; if (wired !== c.el) { c.el.addEventListener("click", onClick); c.el.addEventListener("change", onChange); if (!wired) { document.addEventListener("pointerdown", onDoc); document.addEventListener("keydown", onKey); } wired = c.el; }
  paint(); load(false);
}
