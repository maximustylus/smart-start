// Admin export (app 2.40.2): the CSV and PDF builders in SmartStart/admin.js, tested without a browser or jsPDF.
// The PDF painter takes its drawing surface as an argument, so a recorder stands in for jsPDF here.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../SmartStart/admin.js"), "utf8");
const load = () => import("data:text/javascript," + encodeURIComponent(SRC));

const NOW = Date.parse("2026-11-10T03:00:00Z"), D = 864e5;
const day = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
function sample(nAccounts = 4) {
  const days = [];
  for (let i = 10; i >= 0; i--) days.push({ date: day(NOW - i * D), others: { fns: { stuartAnalyse: { calls: 2, errors: i === 3 ? 1 : 0 }, sendAuthEmail: { calls: 1, errors: 0 } }, kinds: { analyse: { calls: 2, tokens: 40000, usd: 0.5 }, coach: { calls: 5, tokens: 10000, usd: 0.05 } }, models: { "claude-opus-5-5": { usd: 0.5 }, "claude-sonnet-5-5": { usd: 0.05 } } }, owner: { kinds: { analyse: { calls: 9, tokens: 1, usd: 9 } }, models: { "claude-opus-5-5": { usd: 9 } }, fns: {} } });
  const accounts = [];
  for (let i = 0; i < nAccounts; i++) accounts.push({ id: "u" + i, mask: (i === 1 ? "=cmd" : "a") + "•••@mail.example", owner: false, joined: NOW - (i + 1) * D, seen: NOW - D / 2, verified: true, consent: i !== 2, cv: true, jobs: 2, docs: 1, applied: 1, apps: 3, calls: 10, tokens: 5000, usd: 1, cap: 3.7 });
  accounts.push({ id: "me", mask: "m•••@mail.example", owner: true, joined: NOW - 30 * D, seen: NOW, verified: true, consent: true, cv: true, jobs: 9, docs: 9, applied: 9, apps: 9, calls: 200, tokens: 1, usd: 7, cap: 10 });
  return { accounts, days, feedback7: 1, retention: { at: NOW - D / 3 } };
}
function recorder() {
  const r = { pages: 1, cur: 1, texts: [], shapes: 0, size: 10, images: 0 };
  return Object.assign(r, {
    setFont() {}, setFontSize(s) { r.size = s; }, setTextColor() {}, setDrawColor() {}, setFillColor() {}, setLineWidth() {}, setProperties() {},
    getTextWidth(s) { return String(s).length * r.size * 0.18; },
    text(s, x, y) { r.texts.push({ s, x, y, page: r.cur }); },
    rect() { r.shapes++; }, roundedRect() { r.shapes++; }, line() { r.shapes++; }, addImage() { r.images++; },
    addPage() { r.pages++; r.cur = r.pages; }, getNumberOfPages() { return r.pages; }, setPage(i) { r.cur = i; },
  });
}

test("the page and the exports share one model, and leaving the owner out removes the owner everywhere", async () => {
  const m = await load();
  const out = m.model(sample(), { range: 30, leaveOut: true }, NOW), inc = m.model(sample(), { range: 30, leaveOut: false }, NOW);
  assert.strictEqual(out.A.length, 4); assert.strictEqual(inc.A.length, 5);
  const dailyCalls = out.daily.reduce((n, d) => n + d.calls, 0), featureCalls = out.features.reduce((n, f) => n + f.calls, 0);
  assert.strictEqual(dailyCalls, featureCalls, "daily rows add up to the feature table");
  assert.ok(inc.features.find((f) => f.key === "analyse").calls > out.features.find((f) => f.key === "analyse").calls);
  assert.strictEqual(out.daily.length, 30); assert.match(out.period, /^Last 30 days, /);
});

test("CSV files: a header row, one row per item, plain numbers, Excel marker, no formulas", async () => {
  const m = await load(), M = m.model(sample(), { range: 7, leaveOut: true }, NOW);
  const daily = m.buildCsv("daily", M).replace(/^﻿/, "").trim().split("\r\n");
  assert.strictEqual(daily[0], "date,sign_ups,ai_calls,tokens,cost_sonnet_sgd,cost_opus_sgd,errors");
  assert.strictEqual(daily.length, 1 + 7);
  assert.match(daily[daily.length - 1], /^2026-11-10,\d+,7,50000,0\.07,0\.68,0$/);
  assert.ok(m.buildCsv("daily", M).startsWith("﻿"));
  const acc = m.buildCsv("accounts", M);
  assert.ok(!acc.includes("me") || !/m•••@mail\.example/.test(acc), "owner left out");
  assert.ok(acc.includes("'=cmd•••@mail.example"), "a cell starting with = is neutralised");
  assert.ok(!/@(?!mail\.example)/.test(acc.replace(/@mail\.example/g, "")), "only masked addresses");
  const feat = m.buildCsv("features", M).trim().split("\r\n");
  assert.strictEqual(feat[0], "feature,function,calls,tokens,cost_sgd,cost_per_call_sgd,errors");
  assert.throws(() => m.buildCsv("nope", M));
});

test("PDF: two pages, every string inside the page and in the built-in font's characters", async () => {
  const m = await load(), M = m.model(sample(), { range: 30, leaveOut: true }, NOW), doc = recorder();
  m.paintReport(doc, M, { logo: "data:image/png;base64,AA", leaveOut: true, generated: "10 November 2026, 11:00 Singapore time" });
  assert.strictEqual(doc.pages, 2);
  assert.strictEqual(doc.images, 2, "logo on both page headers");
  const all = doc.texts.map((t) => t.s).join("\n");
  for (const want of ["SMART START usage report", "New sign-ups a day", "AI cost a day", "How far people get", "Health", "By feature", "By account", "Total", "Page 1 of 2", "Page 2 of 2", "a***@mail.example"]) assert.ok(all.includes(want), "missing: " + want);
  assert.ok(!/[^\x20-\x7e -ÿ\n]/.test(all), "only Latin-1 text reaches the PDF");
  doc.texts.forEach((t) => { assert.ok(t.x >= 0 && t.x <= 210 && t.y > 0 && t.y < 297, "off the page: " + t.s); });
});

test("PDF: a long account list carries on to further pages with page numbers on each", async () => {
  const m = await load(), M = m.model(sample(80), { range: 0, leaveOut: false }, NOW), doc = recorder();
  m.paintReport(doc, M, { leaveOut: false, generated: "x" });
  assert.ok(doc.pages >= 3);
  assert.ok(doc.texts.some((t) => t.s === "Page " + doc.pages + " of " + doc.pages));
  doc.texts.filter((t) => !/^Page \d/.test(t.s) && !/^SMART START owner/.test(t.s)).forEach((t) => assert.ok(t.y < 297 - 16, "text runs into the footer: " + t.s));
});

test("PDF text: the few non-Latin-1 characters are mapped, not dropped", async () => {
  const m = await load();
  assert.strictEqual(m.pdfText("a•••@x – y … ‘q’"), "a***@x - y ... 'q'");
});
