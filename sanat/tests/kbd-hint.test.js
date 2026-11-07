/* Klavye ipucu testleri: oturum ekranındaki tek satırlık ipucu moda göre
   ve cevap durumuna göre doğru değişiyor mu?

   Bağımlılıksız:  cd sanat && node tests/kbd-hint.test.js
   Gerçek tarayıcı yok; data.js + app.js küçük bir DOM taklidiyle yüklenir ve
   üretilen HTML'deki <p class="kbd-hint"> metni denetlenir. */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "data.js"), "utf8") + "\n" +
            fs.readFileSync(path.join(root, "app.js"), "utf8");

/* Sabit "bugün": tarihe bağlı ekranlar testte kaymasın. */
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

  /* Aynı id her çağrıda aynı düğümü döndürür: typeInput değeri korunur. */
  const nodes = { app: el("app"), toast: el("toast"), streakDays: el("streakDays"), tabs: el("tabs") };
  global.document = {
    getElementById: id => nodes[id] || (nodes[id] = el(id)),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el("tmp"), body: el("body"), hidden: false,
    addEventListener() {}
  };

  function FakeSR() {}
  FakeSR.prototype.start = function () {
    this.onresult({ results: [[{ transcript: "" }]] });
  };
  FakeSR.prototype.abort = function () {};
  global.window = { scrollTo() {}, SpeechRecognition: FakeSR, addEventListener() {} };
  global.confirm = () => true;

  new Function(src)();

  const target = (sels, val) => ({
    closest: s => (sels.indexOf(s) !== -1 ? { getAttribute: () => val } : null)
  });

  return {
    app: nodes.app,
    fire(sels, val, which) {
      if (typeof sels === "string") sels = [sels];
      (which ? handlers[which] : handlers["app:click"])({ target: target(sels, val) });
    },
    input: id => nodes[id] || (nodes[id] = el(id))
  };
}

const hint = html => (html.match(/<p class="kbd-hint">([\s\S]*?)<\/p>/) || [])[1] || "";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const good = actual === expected;
  if (good) pass++; else fail++;
  console.log((good ? "  [OK]  " : "  [FAIL] ") + label + " -> " + (actual || "(ipucu yok)"));
  if (!good) console.log("          beklenen -> " + expected);
}

const KART_KAPALI = '<kbd>Tab</kbd> Cevabı göster · <kbd>Enter</kbd> düğmeyi açar';
const PUANLA = '<kbd>Tab</kbd> puanla · <kbd>Enter</kbd> onayla';
const TEST = '<kbd>Tab</kbd> seçenekler · <kbd>Enter</kbd> seç';
const SONRAKI = '<kbd>Enter</kbd> sonraki kart';
const YAZ = '<kbd>Enter</kbd> cevabı kontrol et · <kbd>Tab</kbd> ile gezin';

console.log("1) kart: kapalı → açık → puanlandı");
let s = boot();
s.fire(["[data-mode]"], "kart");
check("kart kapalı", hint(s.app.innerHTML), KART_KAPALI);
s.fire(["[data-action]"], "reveal");
check("kart açık", hint(s.app.innerHTML), PUANLA);
s.fire(["[data-grade]"], "2");
check("yeni kart", hint(s.app.innerHTML), KART_KAPALI);

console.log("2) test: cevap bekliyor → cevaplandı");
s = boot();
s.fire(["[data-mode]"], "test");
check("test cevap bekliyor", hint(s.app.innerHTML), TEST);
const opt = (s.app.innerHTML.match(/data-opt="([^"]+)"/) || [])[1];
s.fire(["[data-opt]"], opt || "");
check("test cevaplandı", hint(s.app.innerHTML), SONRAKI);

console.log("3) yazma: boş → cevaplandı");
s = boot();
s.fire(["[data-mode]"], "yaz");
check("yazma boş", hint(s.app.innerHTML), YAZ);
s.input("typeInput").value = "zzz";
s.fire(["[data-action]"], "check");
check("yazma cevaplandı", hint(s.app.innerHTML), SONRAKI);

console.log("4) telaffuz: puanlama açık → dinlendi");
s = boot();
s.fire(["[data-mode]"], "telaffuz");
check("telaffuz puanlama", hint(s.app.innerHTML), PUANLA);
s.fire(["[data-action]"], "listen");
check("telaffuz dinlendi", hint(s.app.innerHTML), SONRAKI);

console.log("\nSONUC: " + pass + " gecti, " + fail + " basarisiz");
process.exit(fail ? 1 : 0);
