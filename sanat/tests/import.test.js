/* İçe aktarma testleri: Paketler sekmesinden tek paket ekleme yolu.

   fetch taklit edilir; ağ yok. Denetlenenler:
     - liste (imports/index.json) yüklenince paket satırları çiziliyor mu,
     - paket eklenince kelimeler sözlüğe ve state.custom'a giriyor, kategori
       eşlemesi uygulanıyor, state.packs kaydı yazılıyor mu,
     - aynı paket ikinci kez eklenince tekrar oluşmuyor mu (idempotent),
     - bozuk dosya (app alanı yanlış) ve HTTP 404 durumunda kayıt bozulmadan
       hata notu gösteriliyor mu.

   Bağımlılıksız:  cd sanat && node tests/import.test.js
   Hepsi birlikte: node tests/run.js */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "data.js"), "utf8") + "\n" +
            fs.readFileSync(path.join(root, "app.js"), "utf8");

const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now()); else super(...a); }
  static now() { return RealDate.now(); }
}
global.Date = FakeDate;

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: k => { delete store[k]; }
};
global.setTimeout = () => 1;
global.clearTimeout = () => {};
global.setInterval = () => 1;

/* --- fetch taklidi ------------------------------------------------- */
const PAKET1 = {
  app: "suomi-tr", pack: "Paket 1", exportedAt: "2026-11-01T00:00:00.000Z",
  state: { cards: {}, custom: [
    { fi: "uusi1", tr: "yeni bir", cat: "aile" },
    { fi: "hei", tr: "merhaba", cat: "aile" }
  ] }
};
const INDEX = [
  { file: "p1.json", pack: "Paket 1", count: 2, lvl: "A2" },
  { file: "p2.json", pack: "Paket 2", count: 1, lvl: "B1" },
  { file: "p3.json", pack: "Paket 3", count: 1, lvl: "B1" }
];
const YANIT = {
  "imports/index.json": INDEX,
  "imports/p1.json": PAKET1,
  "imports/p2.json": { app: "baska-uygulama", state: { custom: [] } },
  "imports/p3.json": 404
};
const cagrilar = [];
global.fetch = function (url) {
  const key = String(url);
  cagrilar.push(key);
  const v = YANIT[key];
  if (v === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  if (v === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(v) });
};

function boot() {
  const handlers = {};
  function el(id) {
    return {
      id, innerHTML: "", textContent: "", value: "", offsetWidth: 1,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { handlers[id + ":" + type] = fn; },
      appendChild() {}, removeChild() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      getAttribute() { return null; }, setAttribute() {},
      focus() {}, click() {}, style: {}
    };
  }
  const nodes = { app: el("app"), toast: el("toast"), streakDays: el("streakDays"), tabs: el("tabs") };
  global.document = {
    getElementById: id => nodes[id] || (nodes[id] = el(id)),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el("tmp"), body: el("body"), hidden: false,
    addEventListener() {}
  };
  function FakeSR() {}
  FakeSR.prototype.start = function () { this.onresult({ results: [[{ transcript: "" }]] }); };
  FakeSR.prototype.abort = function () {};
  global.window = { scrollTo() {}, SpeechRecognition: FakeSR, addEventListener() {} };
  global.confirm = () => true;

  new Function(src)();

  const target = (sels, val) => ({
    closest: s => (sels.indexOf(s) !== -1 ? { getAttribute: () => val } : null)
  });
  return {
    app: nodes.app,
    toast: nodes.toast,
    fire(sels, val, which) {
      if (typeof sels === "string") sels = [sels];
      (which ? handlers[which] : handlers["app:click"])({ target: target(sels, val) });
    },
    tab(name) { this.fire(["button[data-tab]"], name, "tabs:click"); }
  };
}

function seed(custom) {
  store["sanat.v1"] = JSON.stringify({
    settings: { direction: "fi-tr", goal: 20, pronGoal: 5 },
    cards: {}, history: {}, pron: {}, pronLog: [], pronBest: {}, pronRun: {},
    pronSessions: [], dayNote: null, lastSeen: null, streak: { last: null, days: 0 },
    answers: 0, correct: 0, custom: custom || [], packs: {}
  });
}

const flush = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 4); i++) await flush(); }

let pass = 0, fail = 0;
function t(label, cond, extra) {
  if (cond) { pass++; console.log("  [OK]  " + label + (extra ? " -> " + extra : "")); }
  else { fail++; console.log("  [FAIL] " + label + (extra ? " -> " + extra : "")); }
}
const kayit = () => JSON.parse(store["sanat.v1"]);

(async function main() {
  console.log("1) liste yükleniyor");
  seed([]);
  const s = boot();
  s.tab("packs");
  t("başlangıçta liste istenmez", cagrilar.length === 0, "istek=" + cagrilar.length);
  t("düğme var", s.app.innerHTML.includes('data-action="packs-load"'));
  s.fire(["[data-action]"], "packs-load");
  await settle();
  t("index istendi", cagrilar.indexOf("imports/index.json") !== -1);
  t("üç satır", (s.app.innerHTML.match(/class="row-item pack-row"/g) || []).length === 3,
    String((s.app.innerHTML.match(/class="row-item pack-row"/g) || []).length));
  t("özet", s.app.innerHTML.includes("3 paket · toplam 4 kelime"));
  t("satır düğmesi Ekle", s.app.innerHTML.includes('data-pack="p1.json"') &&
    s.app.innerHTML.includes(">Ekle</button>"));

  console.log("2) tek paket ekleniyor");
  s.fire(["[data-pack]"], "p1.json");
  await settle(6);
  let k = kayit();
  t("kelime kaydedildi", k.custom.length === 1, String(k.custom.length));
  t("kategori eşlendi", k.custom[0].cat === "Aile", k.custom[0].cat);
  t("paket kaydı", !!(k.packs["p1.json"] && k.packs["p1.json"].n === 1),
    JSON.stringify(k.packs["p1.json"] || null));
  t("çekirdekteki kelime atlandı", !k.custom.some(w => w.fi === "hei"));
  t("sözlük 600", s.app.innerHTML.includes("sözlük toplamı: 600"));
  t("not: 1 eklendi, 1 zaten vardı", s.app.innerHTML.includes("· 1 kelime eklendi · 1 zaten vardı"),
    (s.app.innerHTML.match(/class="pack-note"[^>]*>([^<]*)/) || [])[1]);
  t("satır artık Yeniden", s.app.innerHTML.includes('data-pack="p1.json"') &&
    /data-pack="p1\.json"[^>]*>Yeniden<\/button>/.test(s.app.innerHTML));
  t("küçük harfli çip yok", !s.app.innerHTML.includes('data-cat="aile"'));

  console.log("3) aynı paket tekrar (idempotent)");
  s.fire(["[data-pack]"], "p1.json");
  await settle(6);
  k = kayit();
  t("kelime sayısı değişmedi", k.custom.length === 1, String(k.custom.length));
  t("not: yeni kelime yok", s.app.innerHTML.includes("yeni kelime yok (2 zaten vardı)"),
    (s.app.innerHTML.match(/class="pack-note"[^>]*>([^<]*)/) || [])[1]);

  console.log("4) bozuk dosya");
  s.fire(["[data-pack]"], "p2.json");
  await settle(6);
  k = kayit();
  t("kayıt bozulmadı", k.custom.length === 1, String(k.custom.length));
  t("hata notu", s.app.innerHTML.includes("p2.json eklenemedi: beklenmeyen dosya biçimi"),
    (s.app.innerHTML.match(/class="pack-note"[^>]*>([^<]*)/) || [])[1]);

  console.log("5) HTTP 404");
  s.fire(["[data-pack]"], "p3.json");
  await settle(6);
  k = kayit();
  t("kayıt bozulmadı", k.custom.length === 1, String(k.custom.length));
  t("404 notu", s.app.innerHTML.includes("p3.json eklenemedi: HTTP 404"),
    (s.app.innerHTML.match(/class="pack-note"[^>]*>([^<]*)/) || [])[1]);
  t("hata sonrası düğmeler açık", s.app.innerHTML.includes('data-pack="p1.json"') &&
    !/data-pack="p1\.json"[^>]*disabled/.test(s.app.innerHTML));

  console.log("\nSONUC: " + pass + " gecti, " + fail + " basarisiz");
  process.exit(fail ? 1 : 0);
})();
