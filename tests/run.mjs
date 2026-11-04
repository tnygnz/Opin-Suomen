/* Yazma modu ve ek tekrar mantığı için kalıcı testler (jsdom).
 * Çalıştırma: npm test
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "index.html");
const assetUrl = (name) => pathToFileURL(path.join(root, "assets", name)).href;

const store = await import(assetUrl("store.js"));
const { VOCAB, CASES, FORMS, PERSONS, VERB_TYPES, CONJ, CATEGORIES } = await import(assetUrl("data.js"));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
let checks = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function vocabByFi(fi) {
  const index = VOCAB.findIndex((v) => v.fi === fi);
  if (index < 0) throw new Error(`Sözlükte bulunamadı: ${fi}`);
  return { index, vocab: VOCAB[index] };
}

/** Tüm kartları ileri tarihe atıp yalnızca hedef kartı "yeni" bırakır. */
function seed({ newCard: target = null, settings = {}, byCard = {} } = {}) {
  const state = store.defaultState();
  store.ensureCards(state);
  for (const card of Object.values(state.cards)) {
    card.state = "review";
    card.due = Date.now() + 30 * 24 * 60 * 60 * 1000;
    card.interval = 30;
    card.retired = false;
  }
  Object.assign(state.settings, settings);
  state.typing.byCard = byCard;
  if (target) {
    const card = state.cards[`${target.fi}|${target.dir}`];
    if (!card) throw new Error(`Kart yok: ${target.fi}|${target.dir}`);
    card.state = "new";
    card.due = 0;
    card.interval = 0;
    card.step = 0;
  }
  return state;
}

let bootCount = 0;
async function boot(state) {
  const html = readFileSync(indexPath, "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;

  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  global.HTMLElement = w.HTMLElement;
  global.Node = w.Node;
  global.requestAnimationFrame = w.requestAnimationFrame.bind(w);
  global.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
  w.confirm = () => true;
  global.confirm = w.confirm;

  w.localStorage.setItem(store.STORAGE_KEY, JSON.stringify(state));
  // Her senaryo taze bir modül örneği kullanır (app.js'in modül düzeyi durumu).
  await import(`${assetUrl("app.js")}?boot=${++bootCount}`);
  await wait(80);
  return dom;
}

function $(w, sel) {
  return w.document.querySelector(sel);
}

function submitAnswer(w, text) {
  const input = $(w, "#clozeInput");
  input.value = text;
  $(w, "#clozeForm").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
}

function grade(w, value) {
  $(w, `[data-grade="${value}"]`).click();
}

async function savedState(w) {
  await wait(260); // saveState 120 ms gecikmeli yazıyor
  return JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
}

async function close(dom) {
  await wait(30);
  dom.window.close();
}

/* ── 1. Kelime kartında yazma ve alternatif çeviri ─────────────── */
async function testAlternativeTranslation() {
  console.log("\n1) Kelime kartı: yazma alanı ve alternatif çeviri");
  const { vocab } = vocabByFi("mies"); // tr: "erkek / koca"
  const dom = await boot(seed({ newCard: { fi: vocab.fi, dir: "fi-tr" } }));
  const w = dom.window;

  check("kart başlığı Fince kelimeyi gösteriyor", $(w, "#fcPrompt").textContent.trim() === "mies");
  check("yazma alanı açık", $(w, "#clozeForm").hidden === false);
  check("'Cevabı göster' düğmesi yazma modunda gizli", $(w, "#revealRow").hidden === true);

  submitAnswer(w, "koca"); // ikinci alternatif
  const feedback = $(w, "#clozeFeedback");
  check("alternatif çeviri doğru kabul edildi", feedback.classList.contains("ok"), feedback.textContent);
  check("cevap açıldı, not düğmeleri göründü", $(w, "#gradeRow").hidden === false);

  const saved = await savedState(w);
  check("doğru cevap sayaçlara işlendi", saved.typing.correct === 1 && saved.typing.attempts === 1);
  await close(dom);
}

/* ── 2. Hata eşiği → ek tekrar kartı → emeklilik ──────────────── */
async function testExtraRepeatCard() {
  console.log("\n2) Ek tekrar: eşikte kart oluşur, iyi cevapla emekli olur");
  const { vocab } = vocabByFi("mies");
  const mapKey = `${vocab.fi}|fi-tr`;
  const state = seed({
    newCard: { fi: vocab.fi, dir: "fi-tr" },
    byCard: { [mapKey]: { errors: 1, pending: 1, lastError: Date.now() } },
  });
  const dom = await boot(state);
  const w = dom.window;

  submitAnswer(w, "zzz");
  const afterError = await savedState(w);
  check(
    "hata sayacı arttı (1 → 2)",
    afterError.typing.byCard[mapKey]?.pending === 2,
    JSON.stringify(afterError.typing.byCard[mapKey]),
  );
  const extraKey = `${vocab.fi}|extra:fi-tr`;
  check("eşikte ek tekrar kartı oluştu", Boolean(afterError.cards[extraKey]), extraKey);
  check("ek kart emekli değil", afterError.cards[extraKey]?.retired === false);
  check("ek kartın kaynağı fi-tr", afterError.cards[extraKey]?.source === "fi-tr");

  grade(w, "again");
  await wait(80);
  check("sıradaki kart ek tekrar", $(w, "#fcState").textContent.trim() === "Ek tekrar");
  check("ek kart aynı kelimeyi soruyor", $(w, "#fcPrompt").textContent.trim() === vocab.fi);

  submitAnswer(w, "erkek");
  check("ek kartta cevap kabul edildi", $(w, "#clozeFeedback").classList.contains("ok"));
  grade(w, "good");
  const afterRetire = await savedState(w);
  check("iyi cevap ek kartı emekliye ayırdı", afterRetire.cards[extraKey]?.retired === true);
  await close(dom);
}

/* ── 3. Kelime yazma kapalı, boşluk yazma açık ────────────────── */
async function testSplitToggles() {
  console.log("\n3) Ayrı anahtarlar: kelime kapalı, boşluk açık");
  const { vocab } = vocabByFi("mies");
  const dom = await boot(
    seed({
      newCard: { fi: vocab.fi, dir: "fi-tr" },
      settings: { typingWords: false, typingCloze: true },
    }),
  );
  const w = dom.window;

  check("kelime kartında yazma alanı kapalı", $(w, "#clozeForm").hidden === true);
  check("cevap gösterme satırı açık", $(w, "#revealRow").hidden === false);
  $(w, "#revealBtn").click();
  await wait(40);
  check("cevap açıldı", $(w, "#fcAnswer").hidden === false);
  check("ayarlarda kelime anahtarı kapalı", $(w, "#typingWordsEnabled").checked === false);
  check("ayarlarda boşluk anahtarı açık", $(w, "#typingClozeEnabled").checked === true);
  await close(dom);

  const clozeVocab = VOCAB.find((v) => v.cloze);
  const clozeDom = await boot(
    seed({
      newCard: { fi: clozeVocab.fi, dir: "cloze" },
      settings: { typingWords: false, typingCloze: true },
    }),
  );
  const cw = clozeDom.window;
  check("boşluk kartında yazma alanı açık", $(cw, "#clozeForm").hidden === false);
  check(
    "boşluk kartı alanı ifade istiyor",
    $(cw, "#clozeInput").placeholder.includes("Eksik ifade"),
    $(cw, "#clozeInput").placeholder,
  );
  await close(clozeDom);
}

/* ── 4. Ek kartın yazma davranışı kaynağa bağlı ───────────────── */
async function testExtraCardUsesSourceSetting() {
  console.log("\n4) Ek kart yazma davranışını kaynak türünden alır");
  const { vocab } = vocabByFi("mies");
  const state = seed({ settings: { typingWords: false, direction: "tr-fi" } });
  const key = `${vocab.fi}|extra:fi-tr`;
  state.cards[key] = {
    id: vocab.fi, dir: "extra", source: "fi-tr",
    state: "learning", step: 0, due: Date.now(), interval: 0,
    ease: 2.5, reps: 0, lapses: 0, retired: false,
  };
  const dom = await boot(state);
  const w = dom.window;

  check("ek kart gösteriliyor", $(w, "#fcState").textContent.trim() === "Ek tekrar");
  check("kaynağı fi-tr olduğu için yazma kapalı", $(w, "#clozeForm").hidden === true);
  check("cevap gösterme satırı açık", $(w, "#revealRow").hidden === false);
  await close(dom);
}

/* ── 5. Eski tek `typing` anahtarının taşınması ───────────────── */
function storageStub(value) {
  let current = value === undefined ? null : JSON.stringify(value);
  return {
    getItem: () => current,
    setItem: (_key, next) => { current = next; },
    removeItem: () => { current = null; },
  };
}

function testLegacyMigration() {
  console.log("\n5) Eski tek 'typing' anahtarı iki anahtara taşınır");

  global.localStorage = storageStub({ version: 1, settings: { typing: false }, cards: {} });
  const off = store.loadState();
  check("typing:false → typingWords:false", off.settings.typingWords === false);
  check("typing:false → typingCloze:false", off.settings.typingCloze === false);
  check("eski anahtar silindi", !("typing" in off.settings));

  global.localStorage = storageStub({ version: 1, settings: { typing: true, typingWords: false }, cards: {} });
  const mixed = store.loadState();
  check("açık anahtar eski değeri ezer", mixed.settings.typingWords === false);
  check("eksik anahtar eski değeri alır", mixed.settings.typingCloze === true);

  global.localStorage = storageStub({ version: 1, settings: {}, cards: {} });
  const fresh = store.loadState();
  check("kayıt yokken iki anahtar da açık", fresh.settings.typingWords === true && fresh.settings.typingCloze === true);
}

/* ── 6. Boşluk kartı: yazma, tolerans ve geri bildirim ───────── */
async function testClozeCard() {
  console.log("\n6) Boşluk kartı: yazma, toleranslı eşleşme ve geri bildirim");
  const clozeVocab = VOCAB.find((v) => v.cloze);
  const answer = clozeVocab.cloze.answer;
  // Büyük harfe çevirip ä/ö/å ayrımını kaldır: foldAnswer bunları eşitlemeli.
  const tolerant = answer
    .toLocaleUpperCase("fi")
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/Å/g, "A");

  const dom = await boot(seed({ newCard: { fi: clozeVocab.fi, dir: "cloze" } }));
  const w = dom.window;
  check("cümlede boşluk gösteriliyor", Boolean($(w, ".cloze-gap")));
  check("yazma alanı eksik ifadeyi istiyor", $(w, "#clozeInput").placeholder.includes("Eksik ifade"));
  check("cevap açılmadan telaffuz düğmesi gizli", $(w, "#speakPrompt").hidden === true);

  submitAnswer(w, tolerant);
  check("büyük harf ve ä/ö farkı toleransla kabul edildi", $(w, "#clozeFeedback").classList.contains("ok"), tolerant);
  check("doğru yazım notu gösterildi", $(w, "#clozeFeedback").textContent.includes("Doğru yazım"));
  await close(dom);

  const wrongDom = await boot(seed({ newCard: { fi: clozeVocab.fi, dir: "cloze" } }));
  const ww = wrongDom.window;
  submitAnswer(ww, "tamamen yanlis");
  const feedback = $(ww, "#clozeFeedback");
  check("yanlış cevap olumsuz geri bildirim verdi", feedback.classList.contains("no"));
  check("doğru cevap gösterildi", feedback.textContent.includes("Doğrusu"));
  await close(wrongDom);
}

/* ── 7. Son cevabı geri alma ──────────────────────────────────── */
async function testUndo() {
  console.log("\n7) Son cevabı geri alma");
  const { vocab } = vocabByFi("mies");
  const key = `${vocab.fi}|fi-tr`;
  const state = seed({ settings: { typingWords: false } });
  Object.assign(state.cards[key], {
    state: "review",
    due: Date.now() - 1000,
    interval: 10,
    reps: 3,
    ease: 2.5,
    step: 0,
  });

  const dom = await boot(state);
  const w = dom.window;
  check("tekrar kartı sırada", $(w, "#fcPrompt").textContent.trim() === vocab.fi);
  $(w, "#revealBtn").click();
  await wait(40);
  grade(w, "good");

  const graded = await savedState(w);
  check("not sonrası tekrar sayısı arttı", graded.cards[key].reps === 4, `reps=${graded.cards[key].reps}`);
  check("aralık büyüdü", graded.cards[key].interval > 10, `interval=${graded.cards[key].interval}`);
  check("günlük ve toplam sayaç arttı", graded.daily.total === 1 && graded.totals.reviews === 1);
  check("geri al düğmesi etkinleşti", $(w, "#undoBtn").disabled === false);

  $(w, "#undoBtn").click();
  const undone = await savedState(w);
  check("kart eski zamanlamasına döndü", undone.cards[key].reps === 3 && undone.cards[key].interval === 10, JSON.stringify(undone.cards[key]));
  check("sayaçlar geri alındı", undone.daily.total === 0 && undone.totals.reviews === 0);
  check("geri al düğmesi yeniden pasif", $(w, "#undoBtn").disabled === true);
  await close(dom);
}

/* ── 8. Yedek geri yükleme: eski biçimlerin taşınması ────────── */
async function testBackupImport() {
  console.log("\n8) Yedek geri yükleme: eski biçimler taşınır");
  const dom = await boot(seed({}));
  const w = dom.window;
  const payload = {
    app: "suomi-tr",
    exportedAt: new Date().toISOString(),
    state: {
      version: 1,
      settings: { typing: false, extraThreshold: 2 },
      cards: {
        "hei|extra": {
          id: "hei", dir: "extra", state: "learning", step: 0,
          due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0,
        },
      },
      typing: { attempts: 4, correct: 1, byPhrase: { hei: { errors: 3, pending: 3, lastError: Date.now() } } },
    },
  };

  const input = $(w, "#importInput");
  Object.defineProperty(input, "files", {
    value: [{ text: async () => JSON.stringify(payload) }],
    configurable: true,
  });
  input.dispatchEvent(new w.Event("change"));
  await wait(250);

  const saved = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
  check(
    "eski tek typing anahtarı iki anahtara taşındı",
    saved.settings.typingWords === false && saved.settings.typingCloze === false && !("typing" in saved.settings),
  );
  check("ek kart anahtarı kaynakla yeniden yazıldı", Boolean(saved.cards["hei|extra:cloze"]) && !saved.cards["hei|extra"]);
  check("ek kartın kaynağı cloze", saved.cards["hei|extra:cloze"]?.source === "cloze");
  check("byPhrase sayaçları byCard'a taşındı", saved.typing.byCard["hei|cloze"]?.pending === 3);
  check("ayar kutuları yeni değerleri gösteriyor", $(w, "#typingWordsEnabled").checked === false);
  await close(dom);
}

/* ── 9. Hâl eki verisi ve kart üretimi ───────────────────────── */
function testFormData() {
  console.log("\n9) Hâl eki verisi: tablo, çekimler ve kart üretimi");
  const byFi = new Map(VOCAB.map((v) => [v.fi, v]));
  const keys = Object.keys(FORMS);

  const unknown = keys.filter((k) => !byFi.has(k));
  check("çekim tablosundaki her kelime sözlükte var", unknown.length === 0, unknown.join(", "));

  const missing = [];
  const same = [];
  for (const [fi, forms] of Object.entries(FORMS)) {
    for (const c of Object.keys(CASES)) {
      if (!forms[c]) missing.push(`${fi}.${c}`);
      else if (forms[c] === fi) same.push(`${fi}.${c}`);
    }
    const vals = Object.keys(CASES).map((c) => forms[c]);
    if (new Set(vals).size !== vals.length) same.push(`${fi} (aynı biçim)`);
  }
  check("her kelimede üç hâl eki de tanımlı", missing.length === 0, missing.join(", "));
  check("çekimler taban kelimeden farklı", same.length === 0, same.join(", "));
  check("yeterli sayıda kelime kapsanıyor (80+)", keys.length >= 80, `${keys.length} kelime`);

  const state = store.defaultState();
  store.ensureCards(state);
  check("hâl eki kartı oluşturuldu", Boolean(state.cards["talo|form:ines"]));
  check("kart yönü form:<durum> biçiminde", state.cards["talo|form:ines"]?.dir === "form:ines");
  const created = Object.keys(state.cards).filter((k) => k.includes("|form:")).length;
  check("kart sayısı = kelime × 3", created === keys.length * 3, `${created} kart / ${keys.length} kelime`);
}

/* ── 10. Hâl eki kartı: soru, cevap, yazma ve ayar ───────────── */
async function testFormCard() {
  console.log("\n10) Hâl eki kartı: çekim üretimi, yazma ve kapatma");
  const { vocab } = vocabByFi("talo");
  const dom = await boot(seed({ newCard: { fi: "talo", dir: "form:ines" } }));
  const w = dom.window;

  check("soru Türkçe anlamı gösteriyor", $(w, "#fcPrompt").textContent.trim() === vocab.tr, $(w, "#fcPrompt").textContent);
  check("çip hâl ekinin adını gösteriyor", $(w, "#fcState").textContent.trim() === CASES.ines.label, $(w, "#fcState").textContent);
  check("yazma alanı açık", $(w, "#clozeForm").hidden === false);
  check(
    "alan hâl ekli biçimi istiyor",
    $(w, "#clozeInput").placeholder.includes("Hâl ekli"),
    $(w, "#clozeInput").placeholder,
  );

  submitAnswer(w, "talossa");
  check("doğru çekim kabul edildi", $(w, "#clozeFeedback").classList.contains("ok"), $(w, "#clozeFeedback").textContent);
  check("cevap çekimli biçimi gösteriyor", $(w, "#fcAnswerText").textContent.trim() === "talossa");
  check("örnek satırı taban kelimeyi ve eki gösteriyor", $(w, "#fcExample").textContent.includes("talo"), $(w, "#fcExample").textContent);

  // "Kolay" yeni kartı doğrudan mezun eder: gramer kartı normal SRS'e girer.
  grade(w, "easy");
  const saved = await savedState(w);
  const card = saved.cards["talo|form:ines"];
  check("hâl eki kartı SRS'e girdi", card?.state === "review" && card.interval >= 4, JSON.stringify(card));
  await close(dom);

  const offDom = await boot(
    seed({ newCard: { fi: "talo", dir: "form:ines" }, settings: { forms: false } }),
  );
  const ow = offDom.window;
  check("ayar kapalıyken hâl eki kartı sorulmuyor", $(ow, "#fcEmpty").hidden === false);
  check("ayar kutusu kapalı görünüyor", $(ow, "#formsEnabled").checked === false);
  await close(offDom);
}

/* ── 11. Fiil çekimi verisi ve kart üretimi ──────────────────── */
function testConjData() {
  console.log("\n11) Fiil çekimi verisi: kişiler, fiil tipleri ve kart üretimi");
  const byFi = new Map(VOCAB.map((v) => [v.fi, v]));
  const keys = Object.keys(CONJ);

  const unknown = keys.filter((k) => !byFi.has(k));
  check("her fiil sözlükte var", unknown.length === 0, unknown.join(", "));

  const missing = [], same = [], badType = [];
  for (const [fi, forms] of Object.entries(CONJ)) {
    if (!VERB_TYPES[forms.type]) badType.push(fi);
    for (const person of Object.keys(PERSONS)) if (!forms[person]) missing.push(`${fi}.${person}`);
    // 1. tekil her zaman -n alır; uzun ünlülü tip 1 fiillerde hän biçimi mastarla aynı olabilir (ostaa).
    if (forms.mina === fi) same.push(`${fi}.mina`);
    const vals = Object.keys(PERSONS).map((p) => forms[p]);
    if (new Set(vals).size !== vals.length) same.push(`${fi} (aynı biçim)`);
  }
  check("altı kişinin hepsi tanımlı", missing.length === 0, missing.join(", "));
  check("tipler 1–5 arasında", badType.length === 0, badType.join(", "));
  check("1. tekil mastardan farklı, kişiler birbirinden ayrı", same.length === 0, same.join(", "));
  check(
    "düzensiz ve gövde değiştiren çekimler doğru",
    CONJ.olla.han === "on" && CONJ.tehdä.han === "tekee" && CONJ.juoda.han === "juo" && CONJ.tarvita.mina === "tarvitsen",
    [CONJ.olla.han, CONJ.tehdä.han, CONJ.juoda.han, CONJ.tarvita.mina].join(", "),
  );
  check("en az 15 fiil kapsanıyor", keys.length >= 15, `${keys.length} fiil`);
  const types = new Set(Object.values(CONJ).map((c) => c.type));
  check("beş temel fiil tipi de temsil ediliyor", [1, 2, 3, 4, 5].every((t) => types.has(t)), [...types].join(","));

  const unattached = keys.filter((k) => !byFi.get(k)?.conj);
  check("çekimler sözlük kayıtlarına iliştirildi", unattached.length === 0, unattached.join(", "));

  const state = store.defaultState();
  store.ensureCards(state);
  check("fiil kartı oluşturuldu", Boolean(state.cards["puhua|conj:mina"]));
  check("kart yönü conj:<kişi>", state.cards["puhua|conj:mina"]?.dir === "conj:mina");
  const created = Object.keys(state.cards).filter((k) => k.includes("|conj:")).length;
  check("kart sayısı = fiil × 6", created === keys.length * 6, `${created} kart / ${keys.length} fiil`);
}

/* ── 12. Fiil çekimi kartı: kişi, yazma ve kapatma ────────────── */
async function testConjCard() {
  console.log("\n12) Fiil çekimi kartı: kişi sorusu, yazma ve kapatma");
  const { vocab } = vocabByFi("puhua");
  const dom = await boot(seed({ newCard: { fi: "puhua", dir: "conj:mina" } }));
  const w = dom.window;

  check("soru mastarı gösteriyor", $(w, "#fcPrompt").textContent.trim() === vocab.tr, $(w, "#fcPrompt").textContent);
  check("çip kişiyi gösteriyor", $(w, "#fcState").textContent.trim() === PERSONS.mina.label, $(w, "#fcState").textContent);
  check("yazma alanı açık", $(w, "#clozeForm").hidden === false);
  check(
    "alan çekimli fiili istiyor",
    $(w, "#clozeInput").placeholder.includes("Çekimli"),
    $(w, "#clozeInput").placeholder,
  );

  submitAnswer(w, "puhun");
  check("doğru çekim kabul edildi", $(w, "#clozeFeedback").classList.contains("ok"), $(w, "#clozeFeedback").textContent);
  check("cevap çekimli biçimi gösteriyor", $(w, "#fcAnswerText").textContent.trim() === "puhun");
  check("örnek satırı fiil tipini gösteriyor", $(w, "#fcExample").textContent.includes("Tip 1"), $(w, "#fcExample").textContent);

  grade(w, "easy");
  const saved = await savedState(w);
  const card = saved.cards["puhua|conj:mina"];
  check("fiil kartı SRS'e girdi", card?.state === "review" && card.interval >= 4, JSON.stringify(card));
  await close(dom);

  const offDom = await boot(seed({ newCard: { fi: "puhua", dir: "conj:mina" }, settings: { conj: false } }));
  const ow = offDom.window;
  check("ayar kapalıyken fiil kartı sorulmuyor", $(ow, "#fcEmpty").hidden === false);
  check("ayar kutusu kapalı görünüyor", $(ow, "#conjEnabled").checked === false);
  await close(offDom);
}

/* ── 13. Kendi kelimelerini ekleme ve silme ─────────────────── */
async function testCustomWords() {
  console.log("\n13) Kendi kelimeni ekle: kart üretimi, yinelenen, silme");
  const dom = await boot(seed());
  const w = dom.window;
  const add = (fi, tr, lvl = "A2", cat = "kultur") => {
    $(w, "#newWordFi").value = fi;
    $(w, "#newWordTr").value = tr;
    $(w, "#newWordLvl").value = lvl;
    $(w, "#newWordCat").value = cat;
    $(w, "#addWordForm").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  };

  // Yerleşik sözlükte olan bir kelime eklenmemeli (sauna zaten var).
  add("sauna", "sauna");
  const builtinDup = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY) || "{}");
  check("sözlükte olan kelime yeniden eklenmiyor", (builtinDup.custom || []).length === 0);

  add("viini", "şarap");
  const saved = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
  check("kelime duruma yazıldı", saved.custom?.length === 1 && saved.custom[0].fi === "viini", JSON.stringify(saved.custom));
  check("seviye ve kategori korundu", saved.custom[0].lvl === "A2" && saved.custom[0].cat === "kultur");
  check("iki yönlü kart oluştu", Boolean(saved.cards["viini|fi-tr"] && saved.cards["viini|tr-fi"]));
  check("kelime sözlük dizisine eklendi", VOCAB.some((v) => v.fi === "viini"));
  check("sözlük listesinde görünüyor", $(w, "#wordList").textContent.includes("viini"), $(w, "#dictCount").textContent);

  $(w, "#dictScope").value = "custom";
  $(w, "#dictScope").dispatchEvent(new w.Event("change", { bubbles: true }));
  const ownRows = [...$(w, "#wordList").querySelectorAll(".word")];
  check(
    "kendi kelime filtresi yalnızca kendi kelimeyi gösteriyor",
    ownRows.length === 1 && ownRows[0].textContent.includes("viini"),
    `${ownRows.length} satır`
  );
  check("filtre sayacı eşleşiyor", $(w, "#dictCount").textContent === "1", $(w, "#dictCount").textContent);

  add("viini", "farklı anlam");
  const dup = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
  check("aynı Fince kelime ikinci kez eklenmiyor", dup.custom.length === 1, `${dup.custom.length} kayıt`);

  $(w, "#wordList button[data-del='viini']").click();
  const after = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
  check("kelime silindi", after.custom.length === 0);
  check("kartları da temizlendi", !after.cards["viini|fi-tr"] && !after.cards["viini|tr-fi"]);
  check("sözlükten kalktı", !VOCAB.some((v) => v.fi === "viini"));
  check("liste yeniden çizildi", !$(w, "#wordList").textContent.includes("viini"));
  check(
    "filtre boşken ipucu gösteriyor",
    $(w, "#wordList .empty-hint")?.textContent.includes("Henüz kendi kelimeni"),
    $(w, "#wordList").textContent.trim()
  );

  $(w, "#dictCat").value = "yemek";
  $(w, "#dictCat").dispatchEvent(new w.Event("change", { bubbles: true }));
  $(w, "#dictSearch").value = "vii";
  $(w, "#dictSearch").dispatchEvent(new w.Event("input", { bubbles: true }));
  await wait(260);
  const persisted = JSON.parse(w.localStorage.getItem(store.STORAGE_KEY));
  check(
    "kapsam ve kategori kaydedildi",
    persisted.ui?.dictScope === "custom" && persisted.ui?.dictCat === "yemek",
    JSON.stringify(persisted.ui)
  );
  check("arama metni kaydedildi", persisted.ui?.dictSearch === "vii", JSON.stringify(persisted.ui?.dictSearch));
  await close(dom);

  const again = await boot(persisted);
  const w2 = again.window;
  check("yeniden açılışta kategori seçili", $(w2, "#dictCat").value === "yemek", $(w2, "#dictCat").value);
  check("yeniden açılışta kapsam seçili", $(w2, "#dictScope").value === "custom", $(w2, "#dictScope").value);
  check("yeniden açılışta arama metni korundu", $(w2, "#dictSearch").value === "vii", $(w2, "#dictSearch").value);
}

/* ── 14. Sistematik hata raporu ─────────────────── */
async function testMistakeReport() {
  console.log("\n14) Sistematik hata raporu: desen, kelime ve harf özeti");
  const st = seed();
  const formFi = Object.keys(FORMS)[0];
  const conjFi = Object.keys(CONJ)[0];
  const person = Object.keys(PERSONS)[0];
  const caseKey = Object.keys(CASES)[2]; // illatiivi
  const word = VOCAB[0];
  const catWord = VOCAB.find((v) => v.cat !== word.cat);
  const catKey = catWord.cat;

  Object.assign(st.cards[`${formFi}|form:${caseKey}`], { lapses: 4, reps: 9 });
  Object.assign(st.cards[`${conjFi}|conj:${person}`], { lapses: 2, reps: 6 });
  Object.assign(st.cards[`${word.fi}|fi-tr`], { lapses: 7, reps: 12 });
  Object.assign(st.cards[`${catWord.fi}|fi-tr`], { lapses: 5, reps: 8 });
  st.typing.recent = [{ fi: word.fi, given: "aiti", answer: "äiti", type: "letter", at: Date.now() }];

  const dom = await boot(st);
  const w = dom.window;
  $(w, '.tab[data-view="stats"]').click();

  check("özet tekrar ve unutma sayısını veriyor", $(w, "#reportSummary").textContent.includes("18 unutma"), $(w, "#reportSummary").textContent);
  check("en zayıf desen ipucu", $(w, "#reportHint").textContent.includes("En zayıf desen: Fince → Türkçe"), $(w, "#reportHint").textContent);
  const patternsText = $(w, "#reportPatterns").textContent;
  check("hâl eki deseni listede", patternsText.includes(CASES[caseKey].label), patternsText);
  check("fiil kişisi deseni listede", patternsText.includes(PERSONS[person].label), patternsText);
  check("desen satırı kart sayısını gösteriyor", patternsText.includes("4 / "), patternsText);

  const wordsText = $(w, "#reportWords").textContent;
  check("en çok unutulan kelime ve çevirisi", wordsText.includes(word.fi) && wordsText.includes(word.tr), wordsText);
  check("kelimenin deseni gösteriliyor", wordsText.includes("Fince → Türkçe"), wordsText);
  check("harf deseni çıkarıldı", $(w, "#reportLetters").textContent.includes("ä"), $(w, "#reportLetters").textContent);

  const catsText = $(w, "#reportCats").textContent;
  check("zayıf kategori listeleniyor", catsText.includes(CATEGORIES[catKey].label), catsText);

  // Kategori toplamı kartlardan bağımsız hesaplanıp satırla karşılaştırılır.
  const expectedCats = new Map();
  for (const [key, card] of Object.entries(st.cards)) {
    if (!card.lapses) continue;
    const fi = key.slice(0, key.indexOf("|"));
    const vocab = VOCAB.find((v) => v.fi === fi);
    if (!vocab) continue;
    const row = expectedCats.get(vocab.cat) || { lapses: 0, words: new Set() };
    row.lapses += card.lapses;
    row.words.add(fi);
    expectedCats.set(vocab.cat, row);
  }
  const [topCat, topRow] = [...expectedCats.entries()].sort((a, b) => b[1].lapses - a[1].lapses)[0];
  check(
    "kategori satırı unutma/kelime sayısını doğru veriyor",
    catsText.includes(`${topRow.lapses} / ${topRow.words.size} kelime`),
    catsText
  );
  check(
    "en zayıf kategori ilk sırada",
    ($(w, "#reportCats .cat-name")?.textContent || "").includes(CATEGORIES[topCat].label),
    $(w, "#reportCats .cat-name")?.textContent
  );
  check("kategori başlığı görünür", $(w, "#reportCatLabel").hidden === false);
  await close(dom);

  const fresh = await boot(seed());
  const w2 = fresh.window;
  $(w2, '.tab[data-view="stats"]').click();
  check("veri yokken rapor ipucu gösteriyor", $(w2, "#reportHint").textContent.includes("Rapor çalıştıkça"), $(w2, "#reportHint").textContent);
  check("boş durumda kelime listesi gizli", $(w2, "#reportWords").hidden === true);
  check("boş durumda desen satırı yok", $(w2, "#reportPatterns").textContent === "");
  check("boş durumda kategori satırı yok", $(w2, "#reportCats").textContent === "");
  check("boş durumda kategori başlığı gizli", $(w2, "#reportCatLabel").hidden === true);
  await close(fresh);
}

/* ── 15. Rapordan odaklı çalışma ────────────────── */
async function testFocusFromReport() {
  console.log("\n15) Rapordan odaklı çalışma: desen ve kategori kısayolu");
  const formFi = Object.keys(FORMS)[0];
  const caseKey = Object.keys(CASES)[0];
  const dir = `form:${caseKey}`;
  const st = seed({ newCard: { fi: formFi, dir } });
  st.cards[`${formFi}|${dir}`].lapses = 3;

  const dom = await boot(st);
  const w = dom.window;
  $(w, '.tab[data-view="stats"]').click();

  const rows = [...$(w, "#reportPatterns").querySelectorAll(".cat-row")];
  const caseRow = rows.find((row) => row.textContent.includes(CASES[caseKey].label));
  check("desen satırı tıklanabilir", Boolean(caseRow) && caseRow.classList.contains("is-clickable"), caseRow?.className);
  caseRow.click();

  check("çalışma görünümüne geçildi", $(w, "#view-study").hidden === false && $(w, "#view-stats").hidden === true);
  check("odak etiketi deseni gösteriyor", $(w, "#focusPill").textContent.includes(CASES[caseKey].label), $(w, "#focusPill").textContent);
  check("odaktaki kart soruluyor", $(w, "#fcState").textContent === CASES[caseKey].label, $(w, "#fcState").textContent);
  check("odak sayacı yalnız odak kartını sayıyor", $(w, "#cntNew").textContent === "1", $(w, "#cntNew").textContent);

  $(w, "#focusPill").click();
  check("etiketle odak kaldırılıyor", $(w, "#focusPill").hidden === true, $(w, "#focusPill").textContent);
  check("odak kalkınca normal boş duruma dönüldü", $(w, "#emptyTitle").textContent !== "Odakta kart kalmadı", $(w, "#emptyTitle").textContent);

  $(w, '.tab[data-view="stats"]').click();
  const catRow = $(w, "#reportCats .cat-row");
  const catLabel = catRow.querySelector(".cat-name").textContent.trim();
  catRow.click();
  check("kategori satırı odak kuruyor", $(w, "#focusPill").textContent.includes(catLabel), $(w, "#focusPill").textContent);
  check("kategori odağında çalışma açık", $(w, "#view-study").hidden === false);
  check("istatistik kapsamı odağı gösteriyor", $(w, "#statsScope").textContent.includes("Odak:"), $(w, "#statsScope").textContent);
  await close(dom);
}

const tests = [
  testAlternativeTranslation,
  testExtraRepeatCard,
  testSplitToggles,
  testExtraCardUsesSourceSetting,
  testLegacyMigration,
  testClozeCard,
  testUndo,
  testBackupImport,
  testFormData,
  testFormCard,
  testConjData,
  testConjCard,
  testCustomWords,
  testMistakeReport,
  testFocusFromReport,
];

for (const test of tests) {
  try {
    await test();
  } catch (err) {
    failures += 1;
    console.log(`  ✗ beklenmeyen hata: ${err.message}`);
    if (err.stack) console.log(err.stack.split("\n").slice(1, 4).join("\n"));
  }
}

console.log(`\n${checks - failures}/${checks} kontrol geçti, ${failures} hata.`);
process.exit(failures ? 1 : 0);
