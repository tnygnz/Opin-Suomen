/* Paket regresyon testleri: kayıtta paket kelimesi varken uygulama açılışta
   çökmeden çiziliyor mu, kategori eşlemesi (küçük harfli Fince ad → Türkçe ad)
   hem sözlüğe hem kayda uygulanıyor mu, çekirdekte olan kelime tekrarlanmıyor mu?

   Bu dosya, `hydrateCustom()` açılış sırasında `CAT_ALIAS` tanımlanmadan
   çağrıldığında uygulamanın boş sayfa verdiği hatayı yakalamak için eklendi:
   eski testler `state.custom` boş olduğu için o yolu hiç çalıştırmıyordu.

   Bağımlılıksız:  cd sanat && node tests/packs.test.js
   Hepsi birlikte: node tests/run.js
   Tarayıcı yok: data.js + app.js küçük bir DOM taklidiyle yüklenir. */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "data.js"), "utf8") + "\n" +
            fs.readFileSync(path.join(root, "app.js"), "utf8");

/* Sabit "bugün": gün notu ve seri hesapları testte kaymasın. */
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
    tab(name) { this.fire(["button[data-tab]"], name, "tabs:click"); },
    node: id => nodes[id] || (nodes[id] = el(id))
  };
}

/* Kayıt: paket kelimeleri state.custom içinde durur. */
function seed(custom) {
  store["sanat.v1"] = JSON.stringify({
    settings: { direction: "fi-tr", goal: 20, pronGoal: 5 },
    cards: {}, history: {}, pron: {}, pronLog: [], pronBest: {}, pronRun: {},
    pronSessions: [], dayNote: null, lastSeen: null, streak: { last: null, days: 0 },
    answers: 0, correct: 0, custom: custom, packs: {}
  });
}

let pass = 0, fail = 0;
function t(label, cond, extra) {
  if (cond) { pass++; console.log("  [OK]  " + label + (extra ? " -> " + extra : "")); }
  else { fail++; console.log("  [FAIL] " + label + (extra ? " -> " + extra : "")); }
}

console.log("1) kayıtta paket kelimesi varken açılış (boş sayfa regresyonu)");
seed([{ fi: "testisana", tr: "deneme", cat: "aile" }]);
let s = boot();
t("uygulama çizildi", s.app.innerHTML.length > 200, String(s.app.innerHTML.length) + " bayt");
t("çalışma ekranı", s.app.innerHTML.includes("Çalışma modu"));
t("sözlük 599 + 1", s.app.innerHTML.includes("/600"), (s.app.innerHTML.match(/Öğrenilen: \d+\/\d+/) || [])[0]);
t("kayıtlı kategori eşlendi", JSON.parse(store["sanat.v1"]).custom[0].cat === "Aile",
  JSON.parse(store["sanat.v1"]).custom[0].cat);

s.tab("list");
t("çip Türkçe adla", s.app.innerHTML.includes('data-cat="Aile"'));
t("küçük harfli çip yok", !s.app.innerHTML.includes('data-cat="aile"'));
t("kelime listede", s.node("rows").innerHTML.includes("testisana"));

console.log("2) çekirdekte olan kelime tekrarlanmıyor, kategori yine eşleniyor");
seed([{ fi: "hei", tr: "merhaba", cat: "yhteiskunta" }]);
s = boot();
t("sözlük 599", s.app.innerHTML.includes("/599"), (s.app.innerHTML.match(/Öğrenilen: \d+\/\d+/) || [])[0]);
t("kategori Toplum", JSON.parse(store["sanat.v1"]).custom[0].cat === "Toplum",
  JSON.parse(store["sanat.v1"]).custom[0].cat);
s.tab("list");
const rows = s.node("rows").innerHTML;
t("hei tek kez", (rows.match(/>hei</g) || []).length === 1, String((rows.match(/>hei</g) || []).length));

console.log("3) eşlenmeyen kategori olduğu gibi kalır");
seed([{ fi: "erikois", tr: "özel", cat: "ozel" }]);
s = boot();
s.tab("list");
t("çip özel adıyla", s.app.innerHTML.includes('data-cat="ozel"'));

console.log("4) bozuk kayıt çökertmiyor");
seed([{ fi: "", tr: "boş" }, { tr: "fince yok" }, null]);
s = boot();
t("uygulama yine çizildi", s.app.innerHTML.includes("Çalışma modu"));
t("bozuk kayıt eklenmedi", s.app.innerHTML.includes("/599"), (s.app.innerHTML.match(/Öğrenilen: \d+\/\d+/) || [])[0]);

console.log("\nSONUC: " + pass + " gecti, " + fail + " basarisiz");
process.exit(fail ? 1 : 0);
