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
const { VOCAB } = await import(assetUrl("data.js"));

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

const tests = [
  testAlternativeTranslation,
  testExtraRepeatCard,
  testSplitToggles,
  testExtraCardUsesSourceSetting,
  testLegacyMigration,
  testClozeCard,
  testUndo,
  testBackupImport,
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
