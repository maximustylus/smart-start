// SMART START: cover letter signature tests (2.38.0). Run with `npm test` in functions/. Nothing leaves this machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module"), zlib = require("zlib");

const SRC = path.join(__dirname, "..", "index.js");
function load() {
  let s = fs.readFileSync(SRC, "utf8");
  const swap = (a, b) => { assert.ok(s.includes(a), "test loader: source changed near " + a.slice(0, 40)); s = s.replace(a, b); };
  swap("const db = admin.firestore();", "const db = {};");
  swap('const KEY = defineSecret("ANTHROPIC_API_KEY");', 'const KEY = { value: () => "test" };');
  swap('const MAIL = defineSecret("MAIL_SMTP");', 'const MAIL = { value: () => "unset" };');
  swap('const VAPID = defineSecret("VAPID_PRIVATE");', 'const VAPID = { value: () => "" };');
  s += "\nmodule.exports.__s = { pngSize, signCheck, letterParas, docxBuffer };";
  const m = new Module(SRC, module); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC)); m._compile(s, SRC);
  return m.exports.__s;
}
const T = load();
// a real, tiny RGBA PNG of w x h
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("only a real PNG of a sensible size is kept", () => {
  const ok = png(400, 120);
  assert.deepEqual(T.pngSize(ok), { w: 400, h: 120 });
  assert.ok(T.signCheck(ok.toString("base64")));
  assert.equal(T.signCheck(Buffer.from("<svg onload=alert(1)>").toString("base64")), null, "not a PNG");
  assert.equal(T.signCheck(Buffer.from("GIF89a").toString("base64")), null);
  assert.equal(T.signCheck(png(30, 10).toString("base64")), null, "too small to be a signature");
  assert.equal(T.signCheck(png(4000, 300).toString("base64")), null, "too large");
  assert.equal(T.signCheck("not base64!"), null);
  assert.equal(T.signCheck(Buffer.alloc(300 * 1024, 1).toString("base64")), null, "over 200 KB");
  assert.equal(T.pngSize(null), null);
});

test("a signed letter keeps the typed name below the signature", async () => {
  const l = { greeting: "Dear Hiring Manager,", paragraphs: ["One."], closing: "Yours sincerely" }, d = { name: "Adam", contact: {} };
  const plain = T.letterParas(l, d), signed = T.letterParas(l, d, png(400, 120));
  assert.equal(signed.length, plain.length + 1, "one extra paragraph: the signature");
  const xml = (await T.docxBuffer(signed)).toString("latin1");
  assert.match(xml, /word\/media\//, "the Word file carries the image");
  const plainXml = (await T.docxBuffer(plain)).toString("latin1");
  assert.doesNotMatch(plainXml, /word\/media\//, "unsigned letters carry no image");
});
