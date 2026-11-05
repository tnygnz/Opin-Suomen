/* Suomi–Türkçe — uygulama mantığı */
import { VOCAB, CATEGORIES, DIRS, LEVELS, CASES, caseOfDir, formDir, PERSONS, VERB_TYPES, conjOfDir, conjDir } from "./data.js";
import {
  schedule, previewIntervals, cardStatusLabel, isMature, formatInterval, newCard,
} from "./srs.js";
import * as fsrs from "./fsrs.js";
import * as reading from "./reading.js";
import * as store from "./store.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = store.loadState();
let current = null;         // { key, id, dir }
let revealed = false;
let undoSnapshot = null;
let sessionAnswered = 0;
let lastAutoSpoken = null;
let speaking = "speechSynthesis" in window;
let clozeChecked = null;     // { ok, given, skipped } — yazma modu sonucu
let clozeFocusKey = null;    // odaklanılan kart anahtarı
let focusFilter = null;      // rapordan kurulan oturum odağı: { kind, key, label }
let focusSummary = null;     // odak oturumundaki cevaplar: { answered, correct }

/* ── Yardımcılar ─────────────────────────────────── */
function dirsActive() {
  return store.activeDirs(state.settings.direction);
}

function dirLabel() {
  return state.settings.direction === "both" ? "Karışık (FI↔TR)" : DIRS[state.settings.direction].label;
}

function cardAt(vocab, dir) {
  return state.cards[store.cardKey(vocab, dir)];
}

function levelFilter() {
  return state.settings.levelFilter || "all";
}

function matchesLevel(id) {
  const lv = levelFilter();
  return lv === "all" || VOCAB[id].lvl === lv;
}

function clozeEnabled() {
  return state.settings.cloze !== false;
}

/** Hâl eki (gramer) kartları açık mı? Varsayılan: açık. */
function formsEnabled() {
  return state.settings.forms !== false;
}

/** Fiil çekimi kartları açık mı? Varsayılan: açık. */
function conjEnabled() {
  return state.settings.conj !== false;
}

/* ── Kendi kelimelerim ─────────────────────────────
   Kullanıcı kelimeleri state.custom içinde tutulur ve sözlük dizisinin (VOCAB)
   sonuna eklenir. Kart anahtarı kelimenin kendisine bağlı olduğu için ekleme
   ya da silme var olan ilerlemeyi bozmaz. */

const BUILTIN_WORDS = VOCAB.length;

function customEntry(word) {
  return {
    fi: word.fi,
    tr: word.tr,
    lvl: LEVELS[word.lvl] ? word.lvl : "A1",
    cat: CATEGORIES[word.cat] ? word.cat : Object.keys(CATEGORIES)[0],
    ex: Array.isArray(word.ex) && word.ex.length === 2 && word.ex[0] ? word.ex : null,
    custom: true,
    // Taslak: okuma modunda toplu eklenen, Türkçesi henüz yazılmamış kelime.
    draft: Boolean(word.draft),
  };
}

/** Yerleşik sözlüğü korur, kullanıcı kelimelerini sona yeniden ekler. */
function applyCustomWords() {
  if (VOCAB.length > BUILTIN_WORDS) VOCAB.length = BUILTIN_WORDS;
  for (const word of state.custom || []) VOCAB.push(customEntry(word));
  // Okuma modu indeksi sözlük değişince tazelenir; yoksa yeni kelimeler tanınmaz.
  refreshReadingIndex();
}

/** Değişiklikten sonra kartları, sayaçları ve sözlüğü tazeler. */
function persistCustomWords() {
  applyCustomWords();
  store.ensureCards(state);
  store.saveNow(state);
  // Silinen kelimenin kartı ekranda açıksa çalışma görünümü sıfırlanır.
  if (current && !state.cards[current.key]) {
    current = null;
    revealed = false;
    clozeChecked = null;
    undoSnapshot = null;
  }
  $("#footWords").textContent = VOCAB.length;
  renderDictionary();
  renderCounters();
  renderStudy();
  renderStats();
}

function addCustomWord() {
  const fi = $("#newWordFi").value.trim().replace(/\s+/g, " ");
  const tr = $("#newWordTr").value.trim().replace(/\s+/g, " ");
  if (!fi || !tr) {
    toast("Fince ve Türkçe alanları zorunlu.");
    return;
  }
  const key = fi.toLocaleLowerCase("fi");
  if (VOCAB.some((v) => v.fi.toLocaleLowerCase("fi") === key)) {
    toast(`“${fi}” sözlükte zaten var.`);
    return;
  }
  const exFi = $("#newWordEx").value.trim();
  const exTr = $("#newWordExTr").value.trim();
  state.custom = [
    ...(state.custom || []),
    {
      fi,
      tr,
      lvl: $("#newWordLvl").value,
      cat: $("#newWordCat").value,
      ex: exFi && exTr ? [exFi, exTr] : null,
    },
  ];
  persistCustomWords();
  $("#addWordForm").reset();
  toast(`“${fi}” eklendi.`);
}

/**
 * Kelime paketini mevcut duruma katar: kartlar, ayarlar ve seri korunur.
 * Aynı kelime (yerleşik sözlük veya paketin kendi içi) ikinci kez eklenmez.
 */
function mergeWordPack(words) {
  const taken = new Set(VOCAB.map((vocab) => vocab.fi.toLocaleLowerCase("fi")));
  const fresh = [];
  let skipped = 0;
  for (const word of words) {
    const fi = String(word?.fi || "").trim().replace(/\s+/g, " ");
    const tr = String(word?.tr || "").trim().replace(/\s+/g, " ");
    if (!fi || !tr) continue;
    const key = fi.toLocaleLowerCase("fi");
    if (taken.has(key)) {
      skipped += 1;
      continue;
    }
    taken.add(key);
    fresh.push({
      fi,
      tr,
      lvl: LEVELS[word.lvl] ? word.lvl : "A1",
      cat: CATEGORIES[word.cat] ? word.cat : "yhteiskunta",
      ex: Array.isArray(word.ex) && word.ex.length === 2 && word.ex[0] && word.ex[1]
        ? [String(word.ex[0]), String(word.ex[1])]
        : null,
    });
  }
  if (fresh.length) {
    state.custom = [...(state.custom || []), ...fresh];
    persistCustomWords();
  }
  return { added: fresh.length, skipped };
}

function removeCustomWord(fi) {
  if (!confirm(`“${fi}” kelimesi ve kartları silinsin mi?`)) return;
  state.custom = (state.custom || []).filter((w) => w.fi !== fi);
  store.pruneWordCards(state, fi);
  persistCustomWords();
  toast(`“${fi}” silindi.`);
}

/** Aynı kalıpta bu kadar hata birikince otomatik ek tekrar kartı üretilir (ayarlardan 1–6). */
function extraThreshold() {
  const raw = Number(state.settings.extraThreshold);
  if (!Number.isFinite(raw)) return 2;
  return Math.min(6, Math.max(1, Math.round(raw)));
}

function extraStats() {
  if (!state.typing) state.typing = { attempts: 0, correct: 0, tolerated: 0, order: 0, letter: 0, word: 0, recent: [], byCard: {} };
  if (!state.typing.byCard) state.typing.byCard = {};
  return state.typing.byCard;
}

/** Eski `byPhrase` sayaçlarını ve `${fi}|extra` kartlarını yeni biçime taşır. */
function migrateTypingState() {
  const typing = state.typing;
  if (!typing) return;
  if (!typing.byCard) typing.byCard = {};
  for (const [fi, info] of Object.entries(typing.byPhrase || {})) {
    const key = `${fi}|cloze`;
    if (!typing.byCard[key]) typing.byCard[key] = info;
  }
  typing.byPhrase = {};

  for (const [key, card] of Object.entries(state.cards)) {
    if (card.dir !== "extra") continue;
    if (!card.source) card.source = "cloze";
    const target = `${card.id}|extra:${card.source}`;
    if (target !== key) {
      state.cards[target] = card;
      delete state.cards[key];
    }
  }
}

function extraCardKey(vocab, source) {
  return `${vocab.fi}|extra:${source}`;
}

/** Yazma modunda beklenen cevabı ve kabul edilen alternatifleri üretir. */
function answerTarget(vocab, dir, source) {
  const kind = dir === "extra" ? (source || "cloze") : dir;
  const caseKey = caseOfDir(kind);
  if (caseKey) {
    const answer = vocab.forms?.[caseKey];
    if (!answer) return null;
    return { kind, lang: "fi", text: answer, variants: [answer] };
  }
  const person = conjOfDir(kind);
  if (person) {
    const answer = vocab.conj?.[person];
    if (!answer) return null;
    return { kind, lang: "fi", text: answer, variants: [answer] };
  }
  if (kind === "cloze") {
    if (!vocab.cloze) return null;
    return { kind, lang: "fi", text: vocab.cloze.answer, variants: [vocab.cloze.answer] };
  }
  const lang = kind === "fi-tr" ? "tr" : "fi";
  const raw = lang === "fi" ? vocab.fi : vocab.tr;
  const variants = raw.split("/").map((s) => s.trim()).filter(Boolean);
  return { kind, lang, text: variants[0] || raw, variants: variants.length ? variants : [raw] };
}

function bestVariant(given, variants) {
  const folded = foldAnswer(given);
  let best = variants[0];
  let bestDistance = Infinity;
  for (const variant of variants) {
    const distance = levenshtein(folded, foldAnswer(variant));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = variant;
    }
  }
  return best;
}

/** Hata biriktiren kartlar için `${fi}|extra:<kaynak>` kartını oluşturur / emekliye ayırır. */
function syncExtraCards(now = Date.now()) {
  const threshold = extraThreshold();
  for (const [entryKey, info] of Object.entries(extraStats())) {
    const [fi, source] = entryKey.split("|");
    const vocab = VOCAB.find((v) => v.fi === fi);
    if (!vocab) continue;
    if (source === "cloze" && !vocab.cloze) continue;
    const caseKey = caseOfDir(source);
    if (caseKey && !vocab.forms?.[caseKey]) continue;
    const person = conjOfDir(source);
    if (person && !vocab.conj?.[person]) continue;
    const key = extraCardKey(vocab, source);
    const card = state.cards[key];
    const pending = info.pending || 0;

    if (pending >= threshold) {
      if (!card) {
        state.cards[key] = { ...newCard(fi, "extra"), source, state: "learning", step: 0, due: now, interval: 0, retired: false };
      } else if (card.retired) {
        card.retired = false;
        card.state = "learning";
        card.step = 0;
        card.interval = 0;
        card.due = now;
      }
    } else if (card && !card.retired) {
      card.retired = true;
    }
  }
}

/** Aktif yönler ve açık kart türleri için kart işlerini üretir. */
function activeJobs() {
  const jobs = [];
  for (const dir of dirsActive()) {
    for (let id = 0; id < VOCAB.length; id++) {
      if (!matchesLevel(id)) continue;
      const vocab = VOCAB[id];
      const key = store.cardKey(vocab, dir);
      const card = state.cards[key];
      if (card) jobs.push({ id, dir, key, card, vocab });
    }
  }
  if (clozeEnabled()) {
    VOCAB.forEach((vocab, id) => {
      if (!vocab.cloze || !matchesLevel(id)) return;
      const key = store.cardKey(vocab, "cloze");
      const card = state.cards[key];
      if (card) jobs.push({ id, dir: "cloze", key, card, vocab });
    });
  }
  // Hâl eki kartları: yön filtresinden bağımsız, yalnızca çekimi olan kelimeler.
  if (formsEnabled()) {
    VOCAB.forEach((vocab, id) => {
      if (!vocab.forms || !matchesLevel(id)) return;
      for (const caseKey of Object.keys(CASES)) {
        const dir = formDir(caseKey);
        const key = store.cardKey(vocab, dir);
        const card = state.cards[key];
        if (card) jobs.push({ id, dir, key, card, vocab, caseKey });
      }
    });
  }
  // Fiil çekimi kartları: her kişi ayrı kart, yön filtresinden bağımsız.
  if (conjEnabled()) {
    VOCAB.forEach((vocab, id) => {
      if (!vocab.conj || !matchesLevel(id)) return;
      for (const person of Object.keys(PERSONS)) {
        const dir = conjDir(person);
        const key = store.cardKey(vocab, dir);
        const card = state.cards[key];
        if (card) jobs.push({ id, dir, key, card, vocab, person });
      }
    });
  }
  // Ek tekrar kartları: kaynak türü neyse o biçimde gelir, yön filtresinden bağımsızdır.
  const indexByFi = new Map(VOCAB.map((v, i) => [v.fi, i]));
  for (const [key, card] of Object.entries(state.cards)) {
    if (card.dir !== "extra" || card.retired) continue;
    const id = indexByFi.get(card.id);
    if (id === undefined || !matchesLevel(id)) continue;
    const source = card.source || "cloze";
    if (source === "cloze" && !clozeEnabled()) continue;
    const caseKey = caseOfDir(source);
    if (caseKey && !formsEnabled()) continue;
    if (conjOfDir(source) && !conjEnabled()) continue;
    jobs.push({ id, dir: "extra", key, card, vocab: VOCAB[id], source });
  }
  // Taslak kelimeler anlamı yazılana kadar çalışma kuyruğuna girmez.
  const usable = jobs.filter((job) => !job.vocab.draft);
  return focusFilter ? usable.filter(focusMatches) : usable;
}

/** Ek tekrar kartının kaynak yönü (odak eşleşmesi için). */
function jobPatternDir(job) {
  return job.dir === "extra" ? state.cards[job.key]?.source || "cloze" : job.dir;
}

/** Rapordan kurulan odak: desen (hâl eki/fiil/yön) ya da kategori. */
function focusMatches(job) {
  if (!focusFilter) return true;
  if (focusFilter.kind === "cat") return job.vocab.cat === focusFilter.key;
  return reportPattern(jobPatternDir(job)).key === focusFilter.key;
}

function setFocus(next) {
  focusFilter = next;
  focusSummary = { answered: 0, correct: 0 };
  current = null;
  revealed = false;
  clozeChecked = null;
  undoSnapshot = null;
  switchView("study");
  renderStats();
  toast(`Odak: ${next.label}`);
}

function clearFocus() {
  if (!focusFilter) return;
  focusFilter = null;
  focusSummary = null;
  current = null;
  revealed = false;
  clozeChecked = null;
  undoSnapshot = null;
  renderStudy();
  renderStats();
}

/** Çalışma ekranındaki odak etiketini günceller. */
function syncFocusUi() {
  const pill = $("#focusPill");
  if (!pill) return;
  pill.hidden = !focusFilter;
  pill.textContent = focusFilter ? `Odak: ${focusFilter.label} · kaldır` : "";
  pill.title = focusFilter ? "Bu odaktan çıkıp tüm destelere dön" : "";
}

/** Yeni kartlarda her üç karttan birini boşluk doldurma yapar.
 *  Sıra, kalan listenin konumuna değil günlük sayaca bağlıdır; böylece kuyruk
 *  her yeniden kurulduğunda boşluk kartları sona itilmez. */
function pickFresh(fresh) {
  if (!fresh.length) return null;
  const words = fresh.filter((j) => j.dir !== "cloze");
  const cloze = fresh.filter((j) => j.dir === "cloze");
  if (!cloze.length) return words[0] || null;
  if (!words.length) return cloze[0];
  return (state.daily.newDone + 1) % 3 === 0 ? cloze[0] : words[0];
}

/** Yazma modu kelime ve boşluk kartları için ayrı ayrı açılıp kapatılabilir. */
function typingSettingOn(kind) {
  return kind === "cloze" ? state.settings.typingCloze !== false : state.settings.typingWords !== false;
}

function clozeTypingEnabled() {
  return clozeEnabled() && typingSettingOn("cloze");
}

/** Kartın kaynağına göre yazma modunun açık olup olmadığını söyler. */
function typingEnabledFor(job) {
  if (!job) return false;
  const source = job.dir === "extra" ? (state.cards[job.key]?.source || "cloze") : job.dir;
  return source === "cloze" ? clozeTypingEnabled() : typingSettingOn(source);
}

/** Karşılaştırma için küçük/büyük harf, noktalama ve ä/ö/å ayrımını eşitler. */
function foldAnswer(text) {
  return String(text)
    .toLocaleLowerCase("fi")
    .replace(/[.,!?;:—–\-()"'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/å/g, "a")
    .replace(/š/g, "s")
    .replace(/ž/g, "z");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Toleranslı eşleştirme: harf büyüklüğü, noktalama ve ä/ö farkı yok sayılır;
 *  uzun cevaplarda tek harflik yazım hatası kabul edilir. */
function clozeMatches(given, expected) {
  const g = foldAnswer(given);
  const e = foldAnswer(expected);
  if (!g) return false;
  if (g === e) return true;
  return levenshtein(g, e) <= (e.length >= 5 ? 1 : 0);
}

/** İki metni harf harf karşılaştırır (büyük/küçük harf yok sayılır, görünen harfler korunur). */
function diffChars(given, correct) {
  const a = given.toLocaleLowerCase("fi");
  const b = correct.toLocaleLowerCase("fi");
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const givenSegs = [], correctSegs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      givenSegs.push([given[i], "same"]);
      correctSegs.push([correct[j], "same"]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      givenSegs.push([given[i], "bad"]);
      i++;
    } else {
      correctSegs.push([correct[j], "miss"]);
      j++;
    }
  }
  while (i < n) givenSegs.push([given[i++], "bad"]);
  while (j < m) correctSegs.push([correct[j++], "miss"]);
  return { given: mergeSegs(givenSegs), correct: mergeSegs(correctSegs) };
}

function mergeSegs(segs) {
  const out = [];
  for (const [ch, cls] of segs) {
    const last = out[out.length - 1];
    if (last && last[1] === cls) last[0] += ch;
    else out.push([ch, cls]);
  }
  return out;
}

function diffLine(label, segs) {
  const line = document.createElement("p");
  line.className = "fb-line";
  const head = document.createElement("span");
  head.className = "fb-label";
  head.textContent = label;
  line.append(head);

  const text = document.createElement("span");
  text.className = "fb-text";
  for (const [chunk, cls, whole] of segs) {
    if (cls === "same") {
      text.append(document.createTextNode(chunk));
    } else {
      const mark = document.createElement("span");
      mark.className = `${cls === "bad" ? "ch-bad" : "ch-miss"}${whole ? " word" : ""}`;
      mark.textContent = chunk;
      text.append(mark);
    }
  }
  line.append(text);
  return line;
}

function splitWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

/** Parçayı ve ardından tek boşluk ekler; tam kelime işaretleri `word` sınıfı alır. */
function pushChunk(arr, text, cls, whole = false) {
  if (!text) return;
  arr.push([text, cls, whole]);
  arr.push([" ", "same", false]);
}

function trimTrailingSpace(chunks) {
  const last = chunks[chunks.length - 1];
  if (last && last[0] === " " && last[1] === "same") chunks.pop();
  return chunks;
}

/** İki kelime yazım açısından yakın mı? Yakınsa harf harf, değilse bütün kelime işaretlenir. */
function areSimilar(a, b) {
  const fa = foldAnswer(a);
  const fb = foldAnswer(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const tolerance = Math.max(1, Math.floor(Math.min(fa.length, fb.length) / 3));
  return levenshtein(fa, fb) <= tolerance;
}

/** Aynı kelimeler yalnızca sıra değiştirmiş mi? */
function wordOrderOnlyDiffers(a, b) {
  const wa = splitWords(a);
  const wb = splitWords(b);
  if (wa.length < 2 || wb.length < 2) return false;
  return wa.map(foldAnswer).sort().join(" ") === wb.map(foldAnswer).sort().join(" ");
}

/** Kelime bazlı fark: kelime sırası değişince tüm harfler değil, yalnızca ilgili kelimeler işaretlenir.
 *  Karşılıklı gelen ve birbirine yakın kelimelerde harf düzeyinde karşılaştırma yapılır. */
function wordDiff(given, correct) {
  const gTokens = splitWords(given);
  const cTokens = splitWords(correct);
  const gKeys = gTokens.map(foldAnswer);
  const cKeys = cTokens.map(foldAnswer);
  const n = gKeys.length, m = cKeys.length;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = gKeys[i] === cKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (gKeys[i] === cKeys[j]) { ops.push({ t: "same", gi: i, ci: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "del", gi: i }); i++; }
    else { ops.push({ t: "ins", ci: j }); j++; }
  }
  while (i < n) ops.push({ t: "del", gi: i++ });
  while (j < m) ops.push({ t: "ins", ci: j++ });

  const givenChunks = [], correctChunks = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === "same") {
      pushChunk(givenChunks, gTokens[ops[k].gi], "same");
      pushChunk(correctChunks, cTokens[ops[k].ci], "same");
      k++;
      continue;
    }

    const dels = [], inss = [];
    while (k < ops.length && ops[k].t !== "same") {
      if (ops[k].t === "del") dels.push(ops[k].gi);
      else inss.push(ops[k].ci);
      k++;
    }

    const pairs = Math.min(dels.length, inss.length);
    for (let p = 0; p < pairs; p++) {
      const gw = gTokens[dels[p]];
      const cw = cTokens[inss[p]];
      if (areSimilar(gw, cw)) {
        const d = diffChars(gw, cw);
        for (const [chunk, cls] of d.given) pushChunk(givenChunks, chunk, cls);
        for (const [chunk, cls] of d.correct) pushChunk(correctChunks, chunk, cls);
      } else {
        pushChunk(givenChunks, gw, "bad", true);
        pushChunk(correctChunks, cw, "miss", true);
      }
    }
    for (let p = pairs; p < dels.length; p++) pushChunk(givenChunks, gTokens[dels[p]], "bad", true);
    for (let p = pairs; p < inss.length; p++) pushChunk(correctChunks, cTokens[inss[p]], "miss", true);
  }

  return { given: trimTrailingSpace(givenChunks), correct: trimTrailingSpace(correctChunks) };
}

/** Yanlış cevabın türünü belirler: kelime sırası, kelime farkı veya harf hatası. */
function classifyClozeError(given, answer) {
  if (wordOrderOnlyDiffers(given, answer)) return "order";
  const d = wordDiff(given, answer);
  const hasWholeWordMark = [...d.given, ...d.correct].some(([, , whole]) => whole);
  return hasWholeWordMark ? "word" : "letter";
}

function checkClozeAnswer() {
  if (!current || revealed || !typingEnabledFor(current)) return;
  const input = $("#clozeInput");
  const given = (input?.value || "").trim();
  if (!given) { toast("Önce cevabı yaz."); input?.focus(); return; }

  const vocab = VOCAB[current.id];
  const card = state.cards[current.key];
  const target = answerTarget(vocab, current.dir, card?.source);
  if (!target) return;
  const ok = target.variants.some((v) => clozeMatches(given, v));
  const best = bestVariant(given, target.variants);
  clozeChecked = { ok, given, target, best };

  // Yazma istatistikleri
  const stats = state.typing || (state.typing = { attempts: 0, correct: 0, tolerated: 0, order: 0, letter: 0, word: 0, recent: [], byCard: {} });
  stats.attempts = (stats.attempts || 0) + 1;
  if (ok) {
    stats.correct = (stats.correct || 0) + 1;
    if (!target.variants.includes(given)) stats.tolerated = (stats.tolerated || 0) + 1;
  } else {
    const type = classifyClozeError(given, best);
    stats[type] = (stats[type] || 0) + 1;
    stats.recent = [{ fi: vocab.fi, given, answer: best, type, at: Date.now() }, ...(stats.recent || [])].slice(0, 12);

    const source = current.dir === "extra" ? (card?.source || "cloze") : current.dir;
    const byCard = extraStats();
    const mapKey = `${vocab.fi}|${source}`;
    const info = byCard[mapKey] || { errors: 0, pending: 0, lastError: 0 };
    info.errors = (info.errors || 0) + 1;
    info.pending = (info.pending || 0) + 1;
    info.lastError = Date.now();
    byCard[mapKey] = info;
  }
  syncExtraCards();
  store.saveState(state);

  revealed = true;
  renderStudy();
  if (ok) toast("Doğru!");
}

function skipCloze() {
  if (!current || revealed) return;
  const card = state.cards[current.key];
  const target = answerTarget(VOCAB[current.id], current.dir, card?.source);
  clozeChecked = { ok: false, given: "", skipped: true, target, best: target?.text || "" };
  revealed = true;
  renderStudy();
}

function syncLevelSeg() {
  $$("#levelSeg button").forEach((btn) => {
    const on = btn.dataset.level === levelFilter();
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function newLimit() {
  return state.settings.newPerDay + (state.daily.bonus || 0);
}

function reviewLimit() {
  return state.settings.reviewsPerDay + (state.daily.bonus || 0);
}

function buildQueues(now = Date.now()) {
  const learn = [], review = [], fresh = [];
  for (const job of activeJobs()) {
    const { card } = job;
    if (card.state === "new") fresh.push(job);
    else if (card.state === "learning" || card.state === "relearn") {
      if (card.due <= now) learn.push(job);
    } else if (card.state === "review" && card.due <= now) {
      review.push(job);
    }
  }
  learn.sort((a, b) => a.card.due - b.card.due);
  review.sort((a, b) => a.card.due - b.card.due);
  return { learn, review, fresh };
}

function remainingCounts(now = Date.now()) {
  const q = buildQueues(now);
  const newLeft = Math.min(q.fresh.length, Math.max(0, newLimit() - state.daily.newDone));
  const reviewLeft = Math.min(q.review.length, Math.max(0, reviewLimit() - state.daily.reviewDone));
  return { newLeft, learnLeft: q.learn.length, reviewLeft, total: newLeft + q.learn.length + reviewLeft };
}

function nextItem(now = Date.now()) {
  const q = buildQueues(now);
  if (q.learn.length) return q.learn[0];
  if (q.review.length && state.daily.reviewDone < reviewLimit()) return q.review[0];
  if (q.fresh.length && state.daily.newDone < newLimit()) return pickFresh(q.fresh);
  return null;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 220);
  }, 2600);
}

/* ── Konuşma ─────────────────────────────────────── */
function speak(text, lang) {
  if (!speaking) { toast("Bu tarayıcı sesli okumayı desteklemiyor."); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = Number(state.settings.ttsRate) || 1;
  const prefix = lang.slice(0, 2).toLowerCase();
  const voice = window.speechSynthesis.getVoices().find((v) => (v.lang || "").toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

if (speaking) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
}

/* ── Tema ────────────────────────────────────────── */
function applyTheme() {
  const theme = state.settings.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  $("#themeIcon").textContent = theme === "dark" ? "☀️" : "🌙";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b1220" : "#0b4f9c");
}

/* ── Çalışma ekranı ──────────────────────────────── */
function ensureCurrent() {
  if (current) return;
  const item = nextItem();
  if (item) {
    current = { key: item.key, id: item.id, dir: item.dir };
    revealed = false;
    clozeChecked = null;
    clozeFocusKey = null;
  } else {
    current = null;
    revealed = false;
  }
}

function renderCounters() {
  const { newLeft, learnLeft, reviewLeft } = remainingCounts();
  $("#cntNew").textContent = newLeft;
  $("#cntLearn").textContent = learnLeft;
  $("#cntDue").textContent = reviewLeft;
  $("#deckPill").textContent = `Bugün ${state.daily.total} cevap`;

  const total = sessionAnswered + newLeft + learnLeft + reviewLeft;
  const pct = total > 0 ? Math.round((sessionAnswered / total) * 100) : 0;
  $("#sessionBar").style.width = `${Math.min(100, pct)}%`;
  const bar = $("#sessionBar").parentElement;
  if (bar) bar.setAttribute("aria-valuenow", String(pct));
}

function renderStudy() {
  store.rollDay(state);
  ensureCurrent();
  renderCounters();
  $("#dirPill").textContent = dirLabel();
  syncLevelSeg();
  syncFocusUi();

  const cardEl = $("#flashcard");
  const emptyEl = $("#fcEmpty");
  const gradeRow = $("#gradeRow");
  const revealRow = $("#revealRow");

  if (!current) {
    cardEl.hidden = true;
    gradeRow.hidden = true;
    revealRow.hidden = true;
    emptyEl.hidden = false;
    showEmpty();
    return;
  }

  const card = state.cards[current.key];
  const vocab = VOCAB[current.id];
  const isExtra = current.dir === "extra";
  const extraSource = isExtra ? (card.source || "cloze") : null;
  const kind = isExtra ? extraSource : current.dir;
  const isCloze = kind === "cloze";
  const caseKey = caseOfDir(kind);
  const caseMeta = caseKey ? CASES[caseKey] : null;
  const personKey = conjOfDir(kind);
  const personMeta = personKey ? PERSONS[personKey] : null;
  const typing = typingEnabledFor(current);
  const frontLang = isCloze || kind === "fi-tr" ? "fi" : "tr";
  const backLang = kind === "fi-tr" ? "tr" : "fi";

  emptyEl.hidden = true;
  $("#emptySummary").hidden = true;
  cardEl.hidden = false;
  // Yazma alanı görünürken başlık ile giriş alanı arasındaki aşırı boşluk kapatılır.
  cardEl.classList.toggle("is-typing", typing && !revealed);

  $("#fcCat").textContent = `${CATEGORIES[vocab.cat].icon} ${CATEGORIES[vocab.cat].label}`;
  $("#fcLevel").textContent = vocab.lvl;
  $("#fcLevel").title = LEVELS[vocab.lvl]?.label || vocab.lvl;
  $("#fcState").textContent = isExtra
    ? "Ek tekrar"
    : personMeta ? personMeta.label : caseMeta ? caseMeta.label : cardStatusLabel(card);
  if (personMeta) $("#fcState").title = personMeta.hint;
  else if (caseMeta) $("#fcState").title = caseMeta.hint;
  else $("#fcState").removeAttribute("title");

  const promptEl = $("#fcPrompt");
  const ex = $("#fcExample");
  const answerEl = $("#fcAnswerText");
  ex.textContent = "";

  if (isCloze) {
    const cloze = vocab.cloze;
    promptEl.textContent = "";
    promptEl.classList.add("cloze");
    promptEl.setAttribute("lang", "fi");
    const parts = cloze.text.split("___");
    parts.forEach((part, i) => {
      if (i > 0) {
        const gap = document.createElement("span");
        gap.className = "cloze-gap";
        gap.setAttribute("aria-label", "boşluk");
        promptEl.append(gap);
      }
      promptEl.append(document.createTextNode(part));
    });

    answerEl.textContent = cloze.answer;
    answerEl.setAttribute("lang", "fi");

    const phrase = document.createElement("span");
    phrase.className = "fi";
    phrase.lang = "fi";
    phrase.textContent = vocab.fi;
    const meaning = document.createElement("span");
    meaning.textContent = ` — ${vocab.tr}`;
    ex.append(phrase, meaning);

    if (vocab.ex && vocab.ex.length === 2) {
      const full = document.createElement("span");
      full.className = "fi";
      full.lang = "fi";
      full.textContent = ` ${vocab.ex[0]}`;
      const fullTr = document.createElement("span");
      fullTr.textContent = ` ${vocab.ex[1]}`;
      ex.append(document.createElement("br"), full, fullTr);
    }
  } else if (caseMeta) {
    // Hâl eki kartı: anlamı Türkçe verilir, çekimli Fince biçim istenir.
    promptEl.classList.remove("cloze");
    promptEl.textContent = vocab.tr;
    promptEl.setAttribute("lang", "tr");
    answerEl.textContent = vocab.forms?.[caseKey] || "";
    answerEl.setAttribute("lang", "fi");
    const base = document.createElement("span");
    base.className = "fi";
    base.lang = "fi";
    base.textContent = `${vocab.fi} ${caseMeta.suffix}`;
    const caseHint = document.createElement("span");
    caseHint.textContent = ` — ${caseMeta.hint}`;
    ex.append(base, caseHint);
  } else if (personMeta) {
    // Fiil çekimi kartı: mastar + kişi sorulur, çekimli biçim istenir.
    promptEl.classList.remove("cloze");
    promptEl.textContent = vocab.tr;
    promptEl.setAttribute("lang", "tr");
    answerEl.textContent = vocab.conj?.[personKey] || "";
    answerEl.setAttribute("lang", "fi");
    const type = VERB_TYPES[vocab.conj?.type];
    const inf = document.createElement("span");
    inf.className = "fi";
    inf.lang = "fi";
    inf.textContent = vocab.fi;
    const typeInfo = document.createElement("span");
    typeInfo.textContent = ` — ${type ? `${type.label}: ${type.hint}` : "fiil"} · ${personMeta.suffix}`;
    ex.append(inf, typeInfo);
  } else {
    promptEl.classList.remove("cloze");
    const promptText = frontLang === "fi" ? vocab.fi : vocab.tr;
    const answerText = backLang === "fi" ? vocab.fi : vocab.tr;
    promptEl.textContent = promptText;
    promptEl.setAttribute("lang", frontLang);
    answerEl.textContent = answerText;
    answerEl.setAttribute("lang", backLang);
    if (vocab.ex && vocab.ex.length === 2) {
      const fi = document.createElement("span");
      fi.className = "fi";
      fi.lang = "fi";
      fi.textContent = vocab.ex[0];
      const tr = document.createElement("span");
      tr.lang = "tr";
      tr.textContent = vocab.ex[1];
      ex.append(fi, tr);
    }
  }

  // Boşluk kartında telaffuz, cevabı ele vermemek için cevap açılana dek gizli.
  $("#speakPrompt").hidden = isCloze && !revealed;

  // Yazma modu: cevap açılana kadar giriş alanı, açıldıktan sonra geri bildirim.
  const form = $("#clozeForm");
  const feedback = $("#clozeFeedback");
  form.hidden = !typing || revealed;
  feedback.hidden = !(typing && revealed && clozeChecked);

  if (typing && revealed && clozeChecked) {
    const target = clozeChecked.target;
    const truth = clozeChecked.best || target?.text || "";
    feedback.className = `cloze-feedback ${clozeChecked.ok ? "ok" : "no"}`;
    feedback.textContent = "";

    if (clozeChecked.skipped) {
      feedback.append(diffLine("Bilmiyorum — doğru cevap:", [[truth, "same"]]));
    } else if (clozeChecked.ok) {
      feedback.append(diffLine("✓ Doğru!", [[clozeChecked.given, "same"]]));
      if (!(target?.variants || []).includes(clozeChecked.given.trim())) {
        const note = document.createElement("span");
        note.className = "fb-note";
        note.textContent = `Doğru yazım: ${truth}`;
        feedback.append(note);
      }
    } else {
      const d = wordDiff(clozeChecked.given, truth);
      feedback.append(
        diffLine("✗ Senin cevabın:", d.given),
        diffLine("Doğrusu:", d.correct),
      );
      const hint = document.createElement("span");
      hint.className = "fb-hint";
      hint.textContent = "kırmızı: fazla ya da hatalı kelime/harf · yeşil: doğru cevapta eksik ya da yanlış yazılan kısım";
      feedback.append(hint);

      if ((target?.variants || []).length > 1) {
        const alt = document.createElement("span");
        alt.className = "fb-note";
        alt.textContent = `Kabul edilen cevaplar: ${target.variants.join(" · ")}`;
        feedback.append(alt);
      }

      if (wordOrderOnlyDiffers(clozeChecked.given, truth)) {
        const note = document.createElement("span");
        note.className = "fb-note";
        note.textContent = "Kelimeler aynı, yalnızca sıra farklı.";
        feedback.append(note);
      }
    }
  }

  if (typing && !revealed) {
    const input = $("#clozeInput");
    input.value = "";
    input.disabled = false;
    input.placeholder = isCloze
      ? "Eksik ifadeyi yaz…"
      : caseMeta
        ? "Hâl ekli biçimi yaz…"
        : personMeta
          ? "Çekimli fiili yaz…"
          : backLang === "tr" ? "Türkçe karşılığı…" : "Fince karşılığı…";
    if (clozeFocusKey !== current.key) {
      clozeFocusKey = current.key;
      requestAnimationFrame(() => $("#clozeInput")?.focus());
    }
  }

  const note = $("#fcNote");
  if (vocab.note) {
    note.textContent = vocab.note;
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  $("#fcAnswer").hidden = !revealed;
  gradeRow.hidden = !revealed;
  revealRow.hidden = revealed || typing;

  // Yazma modunda Space cevabı açmaz, giriş alanına odaklanır; ipucu buna göre değişir.
  const footHint = $("#footHint");
  if (footHint) {
    footHint.innerHTML = typing && !revealed
      ? 'Klavye: <kbd>Enter</kbd> kontrol et · <kbd>1</kbd>–<kbd>4</kbd> not ver'
      : 'Klavye: <kbd>Space</kbd> göster · <kbd>1</kbd>–<kbd>4</kbd> not ver';
  }

  if (revealed) {
    if (isExtra) {
      const labels = { again: "1 dk", hard: "5 dk", good: "bitti", easy: "bitti" };
      for (const g of ["again", "hard", "good", "easy"]) {
        const el = $(`#iv-${g}`);
        if (el) el.textContent = labels[g];
      }
    } else {
      const previews = previewIntervals(card);
      for (const g of ["again", "hard", "good", "easy"]) {
        const el = $(`#iv-${g}`);
        if (el) el.textContent = previews[g];
      }
    }
  } else if (!isCloze && state.settings.autoSpeak && frontLang === "fi" && lastAutoSpoken !== current.key) {
    lastAutoSpoken = current.key;
    speak(vocab.fi, "fi-FI");
  }
}

function showEmpty() {
  const q = buildQueues();
  const { newLeft, learnLeft, reviewLeft } = remainingCounts();
  const emptyEmoji = $("#emptyEmoji");
  const title = $("#emptyTitle");
  const text = $("#emptyText");

  const summaryEl = $("#emptySummary");
  const focusLine =
    focusFilter && focusSummary && focusSummary.answered
      ? `Bu odakta ${focusSummary.answered} cevap · %${Math.round((focusSummary.correct / focusSummary.answered) * 100)} doğru`
      : "";
  summaryEl.textContent = focusLine;
  summaryEl.hidden = !focusLine;

  if (focusFilter) {
    emptyEmoji.textContent = "🎯";
    title.textContent = "Odakta kart kalmadı";
    text.textContent = `“${focusFilter.label}” için şu an sırada kart yok. Üstteki etikete dokunarak tüm destelere dönebilirsin.`;
    return;
  }

  const allCards = activeJobs().map((j) => j.card);
  const pendingFuture = allCards
    .filter((c) => c.state !== "new")
    .map((c) => c.due)
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b);

  if (q.learn.length === 0 && q.review.length === 0 && q.fresh.length === 0) {
    emptyEmoji.textContent = "✅";
    if (levelFilter() !== "all") {
      title.textContent = `${levelFilter()} seviyesinde kart kalmadı`;
      text.textContent = "Bu seviyedeki tüm kartlar tamam. Yukarıdaki filtreden \"Tümü\" seçerek diğer seviyelere geçebilirsin.";
    } else {
      title.textContent = "Tüm kartlar tamam";
      text.textContent = "Bu yönde öğrenilecek yeni kelime kalmadı. Ayarlardan yönü değiştirebilir ya da ilerlemeyi sıfırlayabilirsin.";
    }
  } else if (newLeft === 0 && learnLeft === 0 && reviewLeft === 0) {
    emptyEmoji.textContent = "🌙";
    title.textContent = "Günlük hedef tamam";
    text.textContent = "Bugünkü yeni kart ve tekrar limitine ulaştın. İstersen 10 kart daha ekleyebilirsin.";
  } else if (pendingFuture.length) {
    emptyEmoji.textContent = "⏳";
    title.textContent = "Sıradaki kart hazırlanıyor";
    text.textContent = `Öğrenme kartı ${formatInterval(pendingFuture[0] - Date.now())} sonra tekrar sorulacak.`;
  } else {
    emptyEmoji.textContent = "🎉";
    title.textContent = "Bugünlük bitti";
    text.textContent = "Şimdilik tekrar edilecek kart yok. Yeni kelimeler için limiti artırabilirsin.";
  }
  $("#emptyAgain").hidden = false;
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  renderStudy();
}

/* ── FSRS-5 gölge motoru ───────────────────────────
 * Kartlar SM-2 ile zamanlanır; FSRS her cevabı ayrıca kendi belleğinde işler.
 * Böylece geçiş kararı verilene kadar kayıtlı aralıklar hiç değişmez. */
function fsrsParams() {
  return fsrs.fitParams(state.totals);
}

/** Kartın FSRS bellek durumu; yoksa mevcut SM-2 aralığından tohumlanır. */
function shadowOf(card) {
  return card.fsrs || fsrs.seedFromSm2(card);
}

function clampNewPerDay(n) {
  return Math.min(60, Math.max(5, Math.round(n / 5) * 5));
}

/** Aynı kartlar için iki motorun dönem içi tekrar yükünü karşılaştırır. */
function forecastReviews(cards, horizonDays, now) {
  const params = fsrsParams();
  const end = now + horizonDays * fsrs.DAY;
  let sm2 = 0;
  for (const card of cards) {
    let c = { ...card };
    let t = Math.max(now, c.due || now);
    let guard = 0;
    while (t <= end && guard < 120) {
      sm2 += 1;
      c = schedule(c, "good", t);
      t = c.due;
      guard += 1;
    }
  }
  const fsrsCount = fsrs.forecast(cards.map(shadowOf), horizonDays, {
    now,
    retention: params.retention,
    speed: params.speed,
  });
  return { sm2, fsrsCount, params };
}

function renderEngineCompare(now = Date.now()) {
  const note = $("#engineCompareNote");
  const cards = activeJobs()
    .map((j) => j.card)
    .filter((c) => c.state !== "new" && !c.retired);
  if (!cards.length) {
    $("#cmpSm2").textContent = "—";
    $("#cmpFsrs").textContent = "—";
    $("#cmpDiff").textContent = "—";
    $("#cmpInterval").textContent = "—";
    $("#cmpParams").textContent = "Karşılaştırma için en az bir tekrar edilmiş kart gerekir.";
    note.textContent = "veri bekleniyor";
    renderEngineVerdict(now, { sm2: 0, fsrsCount: 0 });
    return;
  }
  const { sm2, fsrsCount, params } = forecastReviews(cards, 30, now);
  const diff = sm2 ? Math.round((1 - fsrsCount / sm2) * 100) : 0;
  const avgSm2 = Math.round(cards.reduce((s, c) => s + (c.interval || 0), 0) / cards.length);
  const avgFsrs = Math.round(
    cards.reduce((s, c) => s + fsrs.intervalDays(shadowOf(c).s, params.retention), 0) / cards.length
  );
  $("#cmpSm2").textContent = sm2;
  $("#cmpFsrs").textContent = fsrsCount;
  $("#cmpDiff").textContent = `${diff > 0 ? "−" : diff < 0 ? "+" : ""}${Math.abs(diff)}%`;
  $("#cmpDiff").title = "FSRS-5 aynı 30 günde ne kadar daha az (eksi) ya da çok (artı) tekrar istiyor";
  $("#cmpInterval").textContent = `${avgSm2} / ${avgFsrs} gün`;
  $("#cmpInterval").title = "Ortalama aralık: SM-2 / FSRS-5";
  $("#cmpParams").textContent =
    `Kişisel parametreler: hedef hatırlama %${Math.round(params.retention * 100)} · ` +
    `başlangıç hızı ${params.speed.toFixed(2).replace(".", ",")}× · ${params.reviews} cevaptan kalibre`;
  note.textContent = `${cards.length} tekrar kartı · 30 gün`;
  renderEngineVerdict(now, { sm2, fsrsCount });
}

/** Gölge kalibrasyonu + yük farkını tek bir geçiş önerisine çevirir. */
function renderEngineVerdict(now, compare) {
  const stats = fsrs.shadowStats(state.fsrs, now);
  const verdict = fsrs.migrationVerdict({ ...stats, sm2: compare.sm2, fsrsCount: compare.fsrsCount });
  const box = $("#engineVerdict");
  box.className = `verdict ${verdict.level}`;
  box.hidden = false;
  $("#verdictTitle").textContent = verdict.title;
  $("#verdictDetail").textContent = verdict.detail;
}

function renderPlanner(now = Date.now()) {
  const input = $("#planDate");
  if (state.ui.planDate && input.value !== state.ui.planDate) input.value = state.ui.planDate;
  const out = $("#planOut");
  const apply = $("#planApply");
  const target = input.value ? new Date(`${input.value}T23:59:59`) : null;
  const days = target ? Math.ceil((target.getTime() - now) / fsrs.DAY) : 0;
  if (!target || Number.isNaN(days) || days <= 0) {
    out.textContent =
      "Gelecekte bir tarih seç: kalan kartları yetiştirmek için günde kaç yeni kart gerektiğini hesaplar.";
    apply.hidden = true;
    return;
  }
  const jobs = activeJobs();
  const newLeft = jobs.filter((j) => j.card.state === "new").length;
  const reviewCards = jobs.map((j) => j.card).filter((c) => c.state !== "new" && !c.retired);
  const params = fsrsParams();
  const reviews = fsrs.forecast(reviewCards.map(shadowOf), days, {
    now,
    retention: params.retention,
    speed: params.speed,
  });
  const plan = fsrs.plan({ newLeft, days, reviews });
  out.textContent = newLeft
    ? `${plan.days} günde ${newLeft} yeni kart → günde ${plan.perDayNew} yeni kart. Tahmini günde ≈ ${plan.perDayReviews} tekrar (FSRS-5).`
    : `Yeni kart kalmadı; ${plan.days} gün için günde ≈ ${plan.perDayReviews} tekrar yeterli.`;
  apply.hidden = newLeft === 0;
  apply.dataset.perDay = String(clampNewPerDay(plan.perDayNew));
  apply.textContent = `Günlük yeni kartı ${apply.dataset.perDay} yap`;
}

function gradeCurrent(g) {
  if (!current || !revealed) return;
  const card = state.cards[current.key];
  if (!card) return;

  const wasNew = card.state === "new";
  undoSnapshot = {
    key: current.key,
    id: current.id,
    dir: current.dir,
    prevCard: JSON.parse(JSON.stringify(card)),
    daily: { ...state.daily },
    history: JSON.parse(JSON.stringify(state.history)),
    totals: { ...state.totals },
    focus: focusSummary ? { ...focusSummary } : null,
    fsrs: { ...state.fsrs },
  };

  const ok = g !== "again";

  if (current.dir === "extra") {
    // Ek tekrar kartı SRS aralığına girmez: başarıyla bitirilirse emekliye ayrılır.
    if (g === "good" || g === "easy") {
      card.retired = true;
      const info = extraStats()[`${VOCAB[current.id].fi}|${card.source || "cloze"}`];
      if (info) info.pending = 0;
    } else {
      card.state = "learning";
      card.step = 0;
      card.due = Date.now() + (g === "again" ? 1 : 5) * 60 * 1000;
    }
  } else {
    const next = schedule(card, g);
    // FSRS-5 gölge motoru: kuyruğa dokunmadan aynı cevabı kendi belleğinde işler.
    const shadowNext = fsrs.updateCard(shadowOf(card), g, Date.now(), fsrsParams());
    next.fsrs = shadowNext;
    // Yalnızca gerçek hatırlama denemeleri kalibrasyon özetine girer (öğrenme adımları hariç).
    if (shadowNext.elapsed >= 0.5) {
      state.fsrs = fsrs.recordShadow(state.fsrs, shadowNext.r, ok, Date.now());
    }
    state.cards[current.key] = next;
  }

  const today = store.todayKey();
  state.daily.total += 1;
  if (ok) state.daily.correct += 1;
  if (wasNew) state.daily.newDone += 1;
  else state.daily.reviewDone += 1;

  const h = state.history[today] || { reviews: 0, correct: 0, new: 0 };
  h.reviews += 1;
  if (ok) h.correct += 1;
  if (wasNew) h.new = (h.new || 0) + 1;
  state.history[today] = h;

  state.totals.reviews += 1;
  if (ok) state.totals.correct += 1;

  if (focusSummary) {
    focusSummary.answered += 1;
    if (ok) focusSummary.correct += 1;
  }
  sessionAnswered += 1;
  syncExtraCards();
  store.saveState(state);

  current = null;
  revealed = false;
  clozeChecked = null;
  clozeFocusKey = null;
  $("#undoBtn").disabled = false;
  renderStudy();
}

function undo() {
  if (!undoSnapshot) return;
  const { key, id, dir, prevCard, daily, history, totals, focus, fsrs: fsrsSnapshot } = undoSnapshot;
  state.cards[key] = prevCard;
  state.daily = daily;
  state.history = history;
  state.totals = totals;
  focusSummary = focus ? { ...focus } : null;
  state.fsrs = { ...fsrsSnapshot };
  sessionAnswered = Math.max(0, sessionAnswered - 1);
  undoSnapshot = null;
  $("#undoBtn").disabled = true;

  current = { key, id, dir };
  revealed = true;
  clozeChecked = null;
  store.saveState(state);
  renderStudy();
  toast("Son cevap geri alındı.");
}

/* ── Sözlük ──────────────────────────────────────── */
function badgeFor(card) {
  if (!card) return { label: "—", cls: "" };
  if (card.state === "new") return { label: "Yeni", cls: "new" };
  if (card.state === "learning" || card.state === "relearn") return { label: "Öğrenme", cls: "learn" };
  if (isMature(card)) return { label: "Olgun", cls: "mature" };
  return { label: "İlerliyor", cls: "learn" };
}

/* ── Okuma modu ────────────────────────────────────
 * Yapıştırılan metin sözlükle eşleştirilir; "bilinen" ölçütü kart durumudur. */
let READING_BY_FI = new Map(VOCAB.map((vocab) => [vocab.fi, vocab]));
function refreshReadingIndex() {
  READING_BY_FI = new Map(VOCAB.map((vocab) => [vocab.fi, vocab]));
}

function readingLookup(lower) {
  for (const stem of reading.stems(lower)) {
    const vocab = READING_BY_FI.get(stem);
    if (!vocab) continue;
    const card = state.cards[store.cardKey(vocab, dirsActive()[0])];
    return { vocab, studied: Boolean(card) && card.state !== "new" };
  }
  return null;
}

let readingTimer = null;
function scheduleReading() {
  clearTimeout(readingTimer);
  readingTimer = setTimeout(renderReading, 150);
}

function renderReading() {
  const input = $("#readText");
  const summary = $("#readSummary");
  const list = $("#readUnknown");
  const bulk = $("#readBulk");
  const text = input.value;
  list.textContent = "";

  if (!text.trim()) {
    summary.textContent =
      "Yapıştırdığın metinde bildiğin kelimeleri sayar; bilmediklerini sözlüğe eklemene yardım eder.";
    bulk.hidden = true;
    return;
  }

  const result = reading.analyze(text, readingLookup);
  if (!result.total) {
    summary.textContent = "Metinde Fince kelime bulunamadı.";
    bulk.hidden = true;
    return;
  }

  const pct = (value) => Math.round(value * 100);
  summary.textContent =
    `Bu metnin %${pct(result.coverage)}'ini anlıyorsun: ${result.known}/${result.total} kelime. ` +
    `Tekil kelimede %${pct(result.uniqueCoverage)} (${result.uniqueKnown}/${result.uniqueTotal}).` +
    (result.learning ? ` ${result.learning} kelime sözlükte var ama henüz çalışılmamış.` : "") +
    (result.unknown ? ` ${result.unknown} kelime sözlükte yok.` : "");

  const unknownUnique = result.words.filter((word) => word.status === "unknown").length;
  bulk.hidden = unknownUnique === 0;
  bulk.textContent = unknownUnique
    ? `Bilinmeyenleri taslağa ekle (${unknownUnique})`
    : "Bilinmeyenleri taslağa ekle";

  const pending = result.words.filter((word) => word.status !== "known").slice(0, 14);
  for (const word of pending) {
    const chip = document.createElement("span");
    chip.className = `read-chip ${word.status}`;

    const label = document.createElement("b");
    label.textContent = word.word;
    const count = document.createElement("span");
    count.textContent = `${word.count}×`;
    chip.append(label, count);

    if (word.status === "unknown") {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "read-add";
      add.textContent = "ekle";
      add.title = "Bu kelimeyi sözlüğe ekle";
      add.addEventListener("click", () => {
        const fi = $("#newWordFi");
        fi.value = word.word;
        if (typeof fi.scrollIntoView === "function") {
          fi.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        $("#newWordTr").focus();
      });
      chip.append(add);
    } else {
      const tag = document.createElement("span");
      tag.textContent = "sözlükte";
      chip.append(tag);
    }

    list.append(chip);
  }
}

/** Okuma metnindeki bilinmeyenleri tek tek eklemek yerine taslak olarak ekler. */
const READING_BULK_LIMIT = 40;
function addUnknownDrafts() {
  const text = $("#readText").value;
  if (!text.trim()) return;

  const result = reading.analyze(text, readingLookup);
  const taken = new Set(VOCAB.map((vocab) => vocab.fi.toLocaleLowerCase("fi")));
  const fresh = result.words.filter(
    (word) => word.status === "unknown" && !taken.has(word.word.toLocaleLowerCase("fi"))
  );
  if (!fresh.length) {
    toast("Sözlüğe eklenecek yeni kelime yok.");
    return;
  }

  const picked = fresh.slice(0, READING_BULK_LIMIT);
  state.custom = [
    ...(state.custom || []),
    ...picked.map((word) => ({ fi: word.word, tr: "", lvl: "A1", cat: "okuma", draft: true })),
  ];
  persistCustomWords();
  renderReading();
  toast(
    picked.length < fresh.length
      ? `${picked.length} kelime taslağa eklendi (en sık geçenler; metinde ${fresh.length} bilinmeyen var).`
      : `${picked.length} kelime taslağa eklendi; anlamlarını sözlükten tamamla.`
  );
}

/** Taslak kelimenin Türkçesini yazar; kelime böylece çalışmaya hazır olur. */
function fillDraft(fi, raw) {
  const tr = String(raw || "").trim().replace(/\s+/g, " ");
  if (!tr) {
    toast("Türkçe anlamı yaz.");
    return;
  }
  const index = (state.custom || []).findIndex((word) => word.fi === fi);
  if (index < 0) return;
  state.custom = state.custom.map((word, i) =>
    i === index ? { ...word, tr, draft: false } : word
  );
  persistCustomWords();
  renderReading();
  toast(`“${fi}” çalışmaya hazır.`);
}

/** Anlamı yazılmayı bekleyen okuma taslaklarının sayısı. */
function pendingDrafts() {
  return (state.custom || []).filter((word) => word.draft).length;
}

function renderDictionary() {
  const q = $("#dictSearch").value.trim().toLocaleLowerCase("tr");
  const cat = $("#dictCat").value;
  const scope = $("#dictScope").value;
  const dir = dirsActive()[0];
  const list = $("#wordList");
  list.textContent = "";

  // Bekleyen taslak sayısı düğmenin üzerinde durur; aynı düğme listeyi süzer.
  const pending = pendingDrafts();
  const draftsOn = Boolean(state.ui.dictDrafts) && pending > 0;
  state.ui.dictDrafts = draftsOn;
  const draftToggle = $("#dictDrafts");
  draftToggle.hidden = pending === 0;
  draftToggle.textContent = `📝 Taslaklar (${pending})`;
  draftToggle.setAttribute("aria-pressed", String(draftsOn));
  draftToggle.classList.toggle("is-on", draftsOn);
  draftToggle.title = draftsOn
    ? "Taslak filtresini kapat, tüm kelimelere dön"
    : "Yalnızca Türkçesi yazılmayı bekleyen taslakları göster";

  let shown = 0;
  VOCAB.forEach((v, i) => {
    if (draftsOn && !v.draft) return;
    if (scope === "custom" && !v.custom) return;
    if (cat !== "all" && v.cat !== cat) return;
    if (q) {
      const hay = `${v.fi} ${v.tr} ${(v.ex || []).join(" ")}`.toLocaleLowerCase("tr");
      if (!hay.includes(q)) return;
    }
    shown += 1;

    const li = document.createElement("li");
    li.className = "word";

    const main = document.createElement("div");
    main.className = "word-main";
    const fi = document.createElement("span");
    fi.className = "word-fi";
    fi.lang = "fi";
    fi.textContent = v.fi;
    const sep = document.createElement("span");
    sep.className = "word-sep";
    sep.textContent = "·";
    const tr = document.createElement("span");
    tr.className = "word-tr";
    tr.lang = "tr";
    // Taslağın anlamı henüz yok; boş bırakmak yerine beklediği görünsün.
    tr.textContent = v.tr || "anlam yazılacak";
    main.append(fi, sep, tr);

    const side = document.createElement("div");
    side.className = "word-side";
    const lvlBadge = document.createElement("span");
    lvlBadge.className = "badge level";
    lvlBadge.textContent = v.lvl;
    lvlBadge.title = LEVELS[v.lvl]?.label || v.lvl;

    const badge = document.createElement("span");
    const b = badgeFor(cardAt(v, dir));
    badge.className = `badge ${b.cls}`;
    badge.textContent = b.label;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "icon-btn";
    play.title = "Fince telaffuzu dinle";
    play.setAttribute("aria-label", `${v.fi} telaffuzunu dinle`);
    play.textContent = "🔊";
    play.addEventListener("click", () => speak(v.fi, "fi-FI"));
    if (v.custom) {
      const own = document.createElement("span");
      own.className = v.draft ? "badge draft" : "badge";
      own.textContent = v.draft ? "taslak" : "özel";
      own.title = v.draft ? "Anlamı yazılmayı bekliyor" : "Kendi eklediğin kelime";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn";
      del.title = "Bu kelimeyi sil";
      del.setAttribute("aria-label", `${v.fi} kelimesini sil`);
      del.dataset.del = v.fi;
      del.textContent = "🗑";
      del.addEventListener("click", () => removeCustomWord(v.fi));
      side.append(lvlBadge, own, badge, play, del);
    } else {
      side.append(lvlBadge, badge, play);
    }

    const ex = document.createElement("p");
    ex.className = "word-ex";
    if (v.ex && v.ex.length === 2) {
      const s1 = document.createElement("span");
      s1.className = "fi";
      s1.lang = "fi";
      s1.textContent = v.ex[0];
      const s2 = document.createElement("span");
      s2.lang = "tr";
      s2.textContent = ` — ${v.ex[1]}`;
      ex.append(s1, s2);
    } else {
      ex.textContent = CATEGORIES[v.cat].label;
    }

    li.append(main, side, ex);

    // Taslak satırı: anlamı buradan yazılır, kelime sonra kuyruğa girer.
    if (v.draft) {
      const row = document.createElement("div");
      row.className = "draft-row";
      const input = document.createElement("input");
      input.type = "text";
      input.lang = "tr";
      input.autocomplete = "off";
      input.placeholder = "Türkçe anlamı yaz…";
      input.dataset.draft = v.fi;
      input.setAttribute("aria-label", `${v.fi} kelimesinin Türkçe anlamı`);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "Kaydet";
      save.dataset.draftSave = v.fi;
      const commit = () => fillDraft(v.fi, input.value);
      save.addEventListener("click", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
      row.append(input, save);
      li.append(row);
    }

    list.append(li);
  });

  $("#dictCount").textContent = shown;
  if (shown === 0) {
    const hint = document.createElement("li");
    hint.className = "empty-hint";
    hint.textContent = draftsOn
      ? "Taslak filtresi açık; eşleşen taslak yok. Anlam yazdıkça liste kısalır."
      : scope === "custom" && !q && cat === "all"
        ? "Henüz kendi kelimeni eklemedin; yukarıdaki formla ekleyebilirsin."
        : "Aramaya uygun kelime bulunamadı.";
    list.append(hint);
  }
}

/* ── İstatistik ──────────────────────────────────── */
function renderStats() {
  const now = Date.now();
  const jobs = activeJobs();
  const cards = jobs.map((j) => j.card);
  const learned = cards.filter((c) => c.state !== "new").length;
  const mature = cards.filter(isMature).length;
  const { total: remaining } = remainingCounts(now);
  const scopeText = levelFilter() === "all"
    ? "Kapsam: tüm seviyeler"
    : `Kapsam: ${LEVELS[levelFilter()]?.label || levelFilter()}`;
  $("#statsScope").textContent = focusFilter ? `${scopeText} · Odak: ${focusFilter.label}` : scopeText;

  const accuracy = (correct, total) => (total ? `doğruluk %${Math.round((correct / total) * 100)}` : "doğruluk —");

  $("#stToday").textContent = state.daily.total;
  $("#stTodayAccuracy").textContent = accuracy(state.daily.correct, state.daily.total);
  $("#stStreak").textContent = store.streakDays(state.history);
  $("#stLearned").textContent = learned;
  $("#stLearnedSub").textContent = `/ ${cards.length} kart`;
  $("#stMature").textContent = mature;
  $("#stTotal").textContent = state.totals.reviews;
  $("#stTotalAccuracy").textContent = accuracy(state.totals.correct, state.totals.reviews);
  $("#stRemaining").textContent = remaining;

  // 7 günlük grafik
  const days = store.last7Days(state.history);
  const max = Math.max(1, ...days.map((d) => d.reviews));
  const chart = $("#chart");
  chart.textContent = "";
  days.forEach((d) => {
    const col = document.createElement("div");
    col.className = "bar-col";

    const val = document.createElement("span");
    val.className = "bar-val";
    val.textContent = d.reviews || "";

    const bar = document.createElement("div");
    bar.className = `bar${d.reviews ? "" : " zero"}`;
    bar.style.height = d.reviews ? `${Math.max(6, Math.round((d.reviews / max) * 84))}%` : "4px";
    bar.title = `${d.key}: ${d.reviews} tekrar`;

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = d.label;

    col.append(val, bar, label);
    chart.append(col);
  });
  const weekTotal = days.reduce((s, d) => s + d.reviews, 0);
  $("#chartTotal").textContent = `${weekTotal} tekrar`;

  // Yazma alıştırmaları
  renderTypingStats();

  // Sistematik hata raporu (mevcut ilerlemeden türetilir)
  renderMistakeReport();

  // Zamanlayıcı karşılaştırması ve hedefe göre planlama
  renderEngineCompare(now);
  renderPlanner(now);

  // Kategori ilerlemesi
  const wrap = $("#catProgress");
  wrap.textContent = "";
  Object.entries(CATEGORIES).forEach(([key, meta]) => {
    const catCards = jobs.filter((j) => j.vocab.cat === key).map((j) => j.card);
    const done = catCards.filter((c) => c.state !== "new").length;
    const pct = catCards.length ? Math.round((done / catCards.length) * 100) : 0;

    const row = document.createElement("div");
    row.className = "cat-row";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = `${meta.icon} ${meta.label}`;
    const bar = document.createElement("div");
    bar.className = "cat-bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const num = document.createElement("span");
    num.className = "cat-num";
    num.textContent = `${done}/${catCards.length}`;
    row.append(name, bar, num);
    wrap.append(row);
  });
}

function renderTypingStats() {
  const typing = state.typing || {};
  const attempts = typing.attempts || 0;
  const correct = typing.correct || 0;

  $("#tpAttempts").textContent = attempts;
  $("#tpAccuracy").textContent = attempts ? `%${Math.round((correct / attempts) * 100)}` : "—";
  $("#tpTolerated").textContent = typing.tolerated || 0;
  $("#typingSummary").textContent = attempts
    ? `${attempts} deneme · ${correct} doğru`
    : "henüz yazma denemesi yok";

  const errWrap = $("#typingErrors");
  errWrap.textContent = "";
  const defs = [
    ["letter", "Harf hatası", "kelime içinde eksik/yanlış harf", "linear-gradient(90deg, var(--hard), #e0a94b)"],
    ["order", "Kelime sırası", "kelimeler doğru, sıra farklı", "linear-gradient(90deg, var(--brand), #59a6ff)"],
    ["word", "Kelime farkı", "eksik, fazla veya başka kelime", "linear-gradient(90deg, var(--again), #e0705f)"],
  ];
  const maxErr = Math.max(1, ...defs.map(([k]) => typing[k] || 0));
  defs.forEach(([key, label, hint, gradient]) => {
    const n = typing[key] || 0;
    const row = document.createElement("div");
    row.className = "cat-row";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = label;
    name.title = hint;
    const bar = document.createElement("div");
    bar.className = "cat-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((n / maxErr) * 100)}%`;
    fill.style.background = gradient;
    bar.append(fill);
    const num = document.createElement("span");
    num.className = "cat-num";
    num.textContent = attempts ? `${n} · %${Math.round((n / attempts) * 100)}` : String(n);
    row.append(name, bar, num);
    errWrap.append(row);
  });

  // Ek tekrar bekleyen kalıplar
  const watches = Object.entries(typing.byCard || {})
    .filter(([, info]) => (info.pending || 0) > 0)
    .sort((a, b) => (b[1].pending || 0) - (a[1].pending || 0));
  const extraWrap = $("#extraWatches");
  extraWrap.textContent = "";
  extraWrap.hidden = watches.length === 0;
  const threshold = extraThreshold();
  watches.slice(0, 6).forEach(([entryKey, info]) => {
    const [fi, source] = entryKey.split("|");
    const caseKey = caseOfDir(source);
    const personKey = conjOfDir(source);
    const sourceLabel = source === "cloze"
      ? "boşluk"
      : caseKey
        ? (CASES[caseKey]?.label || "hâl eki")
        : personKey
          ? (PERSONS[personKey]?.label || "fiil")
          : source === "fi-tr" ? "F→T" : "T→F";
    const pending = info.pending || 0;
    const li = document.createElement("li");
    li.className = "error-item";
    const tag = document.createElement("span");
    tag.className = "err-tag";
    tag.textContent = pending >= threshold ? "ek kart" : "izlemede";
    const phrase = document.createElement("span");
    phrase.className = "err-phrase";
    phrase.lang = "fi";
    phrase.textContent = fi;
    const infoText = document.createElement("span");
    infoText.className = "err-diff";
    infoText.textContent = `${sourceLabel} · ${pending} hata · ${pending >= threshold ? "ek tekrar hazır" : `${threshold - pending} hata daha`}`;
    li.append(tag, phrase, infoText);
    extraWrap.append(li);
  });

  const recent = $("#typingRecent");
  recent.textContent = "";
  const items = (typing.recent || []).slice(0, 8);
  recent.hidden = items.length === 0;
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "error-item";
    const tag = document.createElement("span");
    tag.className = "err-tag";
    tag.textContent = item.type === "order" ? "sıra" : item.type === "word" ? "kelime" : "harf";
    const phrase = document.createElement("span");
    phrase.className = "err-phrase";
    phrase.lang = "fi";
    phrase.textContent = item.fi;
    const diff = document.createElement("span");
    diff.className = "err-diff";
    diff.textContent = `${item.given} → ${item.answer}`;
    li.append(tag, phrase, diff);
    recent.append(li);
  });
}

/** Rapor satırını "bu kartları çalış" kısayoluna çevirir. */
function makeFocusRow(row, activate) {
  row.classList.add("is-clickable");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.title = "Bu kartları çalış";
  const run = () => activate();
  row.addEventListener("click", run);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      run();
    }
  });
}

/* ── Sistematik hata raporu ────────────────────────
   Yeni sayaç tutmaz: kartlardaki unutma/tekrar sayıları ile yazma hatalarından
   desen çıkarır (hâl eki, fiil kişisi, yön, harf). */
function reportPattern(dir) {
  const caseKey = caseOfDir(dir);
  if (caseKey) return { key: `form:${caseKey}`, label: `Hâl eki · ${CASES[caseKey]?.label || caseKey}` };
  const personKey = conjOfDir(dir);
  if (personKey) return { key: `conj:${personKey}`, label: `Fiil · ${PERSONS[personKey]?.label || personKey}` };
  if (dir === "cloze") return { key: "cloze", label: "Boşluk doldurma" };
  if (dir.startsWith("extra")) return { key: "extra", label: "Ek tekrar kartları" };
  return { key: dir, label: dir === "tr-fi" ? "Türkçe → Fince" : "Fince → Türkçe" };
}

/** Kartlardaki unutma/tekrar sayılarını desenlere göre toplar. */
function reportPatternRows() {
  const groups = new Map();
  let lapses = 0;
  let reps = 0;
  for (const [key, card] of Object.entries(state.cards)) {
    const dir = key.slice(key.indexOf("|") + 1);
    const meta = reportPattern(dir);
    const row = groups.get(meta.key) || { ...meta, cards: 0, lapses: 0, reps: 0 };
    row.cards += 1;
    row.lapses += card.lapses || 0;
    row.reps += card.reps || 0;
    lapses += card.lapses || 0;
    reps += card.reps || 0;
    groups.set(meta.key, row);
  }
  return { rows: [...groups.values()], lapses, reps };
}

/** Yazma hatası kayıtlarından eksik/fazla harf desenlerini çıkarır. */
function reportLetterRows() {
  const missing = new Map();
  const extra = new Map();
  const bump = (map, ch) => map.set(ch, (map.get(ch) || 0) + 1);
  const letters = (text) =>
    [...String(text || "").toLocaleLowerCase("fi")].filter((ch) => /\p{L}/u.test(ch));

  for (const item of state.typing?.recent || []) {
    if (item.type !== "letter") continue;
    const answer = letters(item.answer);
    const given = letters(item.given);
    const pool = new Map();
    answer.forEach((ch) => pool.set(ch, (pool.get(ch) || 0) + 1));
    given.forEach((ch) => {
      const left = pool.get(ch) || 0;
      if (left > 0) pool.set(ch, left - 1);
      else bump(extra, ch);
    });
    pool.forEach((left, ch) => {
      for (let i = 0; i < left; i += 1) bump(missing, ch);
    });
  }

  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fi"));
  return { missing: top(missing).slice(0, 3), extra: top(extra).slice(0, 3) };
}

function renderMistakeReport() {
  const { rows, lapses, reps } = reportPatternRows();
  const byFi = new Map(VOCAB.map((v) => [v.fi, v]));
  const typing = state.typing || {};
  const typingErrors = (typing.letter || 0) + (typing.order || 0) + (typing.word || 0);
  const ranked = rows
    .filter((r) => r.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || b.reps - a.reps);

  $("#reportSummary").textContent = lapses || typingErrors
    ? `${reps} tekrar · ${lapses} unutma · ${typingErrors} yazma hatası`
    : "veri bekleniyor";

  const weak = ranked[0];
  $("#reportHint").textContent = !reps && !typingErrors
    ? "Rapor çalıştıkça oluşur: tekrarlar ve yazma denemeleri biriktikçe zayıf desenler burada listelenir."
    : weak
      ? `En zayıf desen: ${weak.label} — ${weak.lapses} unutma / ${weak.cards} kart. Aşağıdaki listeler bu deseni, en çok takıldığın kelimeleri ve zayıf kategorileri gösterir.`
      : "Unutulan kart yok; yazmada sürekli düşen harfler aşağıda.";

  const patterns = $("#reportPatterns");
  patterns.textContent = "";
  const maxLapse = Math.max(1, ...ranked.map((r) => r.lapses));
  ranked.slice(0, 6).forEach((r) => {
    const row = document.createElement("div");
    row.className = "cat-row";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = r.label;
    name.title = `${r.cards} kart · ${r.reps} tekrar · ${r.lapses} unutma`;
    const bar = document.createElement("div");
    bar.className = "cat-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((r.lapses / maxLapse) * 100)}%`;
    fill.style.background = "linear-gradient(90deg, var(--again), #e0705f)";
    bar.append(fill);
    const num = document.createElement("span");
    num.className = "cat-num";
    num.textContent = `${r.lapses} / ${r.cards}`;
    row.append(name, bar, num);
    makeFocusRow(row, () => setFocus({ kind: "pattern", key: r.key, label: r.label }));
    patterns.append(row);
  });
  $("#reportPatternLabel").hidden = ranked.length === 0;

  // Zayıf kategoriler: unutmaların kelime gruplarına dağılımı.
  const cats = new Map();
  for (const [key, card] of Object.entries(state.cards)) {
    if (!card.lapses) continue;
    const vocab = byFi.get(key.slice(0, key.indexOf("|")));
    if (!vocab) continue;
    const row = cats.get(vocab.cat) || { cat: vocab.cat, lapses: 0, words: new Set() };
    row.lapses += card.lapses;
    row.words.add(vocab.fi);
    cats.set(vocab.cat, row);
  }
  const rankedCats = [...cats.values()]
    .sort((a, b) => b.lapses - a.lapses || b.words.size - a.words.size)
    .slice(0, 5);
  const catWrap = $("#reportCats");
  catWrap.textContent = "";
  $("#reportCatLabel").hidden = rankedCats.length === 0;
  const maxCat = Math.max(1, ...rankedCats.map((c) => c.lapses));
  rankedCats.forEach((c) => {
    const meta = CATEGORIES[c.cat] || { icon: "•", label: c.cat };
    const row = document.createElement("div");
    row.className = "cat-row";
    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = `${meta.icon} ${meta.label}`;
    name.title = `${c.lapses} unutma · ${c.words.size} kelime`;
    const bar = document.createElement("div");
    bar.className = "cat-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((c.lapses / maxCat) * 100)}%`;
    fill.style.background = "linear-gradient(90deg, #e0705f, #e0a94b)";
    bar.append(fill);
    const num = document.createElement("span");
    num.className = "cat-num";
    num.textContent = `${c.lapses} / ${c.words.size} kelime`;
    row.append(name, bar, num);
    makeFocusRow(row, () => setFocus({ kind: "cat", key: c.cat, label: `${meta.icon} ${meta.label}` }));
    catWrap.append(row);
  });

  const words = Object.entries(state.cards)
    .filter(([, card]) => (card.lapses || 0) > 0)
    .map(([key, card]) => ({
      fi: key.slice(0, key.indexOf("|")),
      dir: key.slice(key.indexOf("|") + 1),
      card,
    }))
    .sort((a, b) => (b.card.lapses || 0) - (a.card.lapses || 0) || (b.card.reps || 0) - (a.card.reps || 0))
    .slice(0, 5);

  const wordWrap = $("#reportWords");
  wordWrap.textContent = "";
  wordWrap.hidden = words.length === 0;
  words.forEach(({ fi, dir, card }) => {
    const vocab = byFi.get(fi);
    const li = document.createElement("li");
    li.className = "error-item";
    const tag = document.createElement("span");
    tag.className = "err-tag";
    tag.textContent = `${card.lapses} unutma`;
    const phrase = document.createElement("span");
    phrase.className = "err-phrase";
    phrase.lang = "fi";
    phrase.textContent = fi;
    const detail = document.createElement("span");
    detail.className = "err-diff";
    detail.textContent = `${vocab?.tr || ""} · ${reportPattern(dir).label} · ${card.reps || 0} tekrar`;
    li.append(tag, phrase, detail);
    wordWrap.append(li);
  });

  const { missing, extra } = reportLetterRows();
  const letterWrap = $("#reportLetters");
  letterWrap.textContent = "";
  const letterRows = [
    ...missing.map(([ch, n]) => [`“${ch}” harfi eksik kaldı`, `${n} kez`]),
    ...extra.map(([ch, n]) => [`“${ch}” fazladan yazıldı`, `${n} kez`]),
  ];
  letterWrap.hidden = letterRows.length === 0;
  letterRows.forEach(([label, detail]) => {
    const li = document.createElement("li");
    li.className = "error-item";
    const tag = document.createElement("span");
    tag.className = "err-tag";
    tag.textContent = "harf";
    const phrase = document.createElement("span");
    phrase.className = "err-phrase";
    phrase.textContent = label;
    const info = document.createElement("span");
    info.className = "err-diff";
    info.textContent = detail;
    li.append(tag, phrase, info);
    letterWrap.append(li);
  });
}

/* ── Ayarlar ─────────────────────────────────────── */
function renderSettings() {
  $$("#dirSeg button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.dir === state.settings.direction));
  });
  $("#newPerDay").value = state.settings.newPerDay;
  $("#newPerDayVal").textContent = state.settings.newPerDay;
  $("#reviewsPerDay").value = state.settings.reviewsPerDay;
  $("#reviewsPerDayVal").textContent = state.settings.reviewsPerDay;
  $("#ttsRate").value = state.settings.ttsRate;
  $("#ttsRateVal").textContent = `${Number(state.settings.ttsRate).toFixed(1).replace(".", ",")}×`;
  $("#autoSpeak").checked = Boolean(state.settings.autoSpeak);
  $("#clozeEnabled").checked = clozeEnabled();
  $("#formsEnabled").checked = formsEnabled();
  $("#conjEnabled").checked = conjEnabled();
  $("#typingWordsEnabled").checked = typingSettingOn("words");
  $("#typingClozeEnabled").checked = typingSettingOn("cloze");
  $("#typingClozeEnabled").disabled = !clozeEnabled();
  const threshold = extraThreshold();
  $("#extraThreshold").value = threshold;
  $("#extraThresholdVal").textContent = `${threshold} hata`;
}

function settingsChanged() {
  store.saveState(state);
  renderSettings();
  renderStudy();
  renderStats();
  $("#footDirection").textContent = dirLabel();
}

/* ── Görünüm değiştirme ──────────────────────────── */
function switchView(view) {
  const known = ["study", "dictionary", "stats", "settings"];
  const target = known.includes(view) ? view : "study";
  state.ui.view = target;
  store.saveState(state);

  $$(".view").forEach((section) => {
    section.hidden = section.id !== `view-${target}`;
  });
  $$(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === target);
  });

  if (target === "study") renderStudy();
  if (target === "dictionary") renderDictionary();
  if (target === "stats") renderStats();
  if (target === "settings") renderSettings();
}

/* ── Olaylar ─────────────────────────────────────── */
function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  $("#themeBtn").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applyTheme();
    store.saveState(state);
  });

  $("#focusPill").addEventListener("click", clearFocus);

  $("#readText").addEventListener("input", scheduleReading);
  $("#readBulk").addEventListener("click", addUnknownDrafts);

  $("#updateReload").addEventListener("click", applyUpdate);
  $("#updateLater").addEventListener("click", () => {
    $("#updateBar").hidden = true;
  });

  $("#planDate").addEventListener("change", () => {
    state.ui.planDate = $("#planDate").value;
    store.saveState(state);
    renderPlanner();
  });

  $("#planApply").addEventListener("click", () => {
    const value = Number($("#planApply").dataset.perDay || 0);
    if (!value) return;
    state.settings.newPerDay = value;
    $("#newPerDay").value = String(value);
    $("#newPerDayVal").textContent = value;
    store.saveState(state);
    toast(`Günlük yeni kart ${value} olarak ayarlandı.`);
    renderStudy();
    renderStats();
  });

  $("#revealBtn").addEventListener("click", reveal);

  $$("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", () => gradeCurrent(btn.dataset.grade));
  });

  $("#undoBtn").addEventListener("click", undo);

  $("#speakPrompt").addEventListener("click", () => {
    if (!current) return;
    const v = VOCAB[current.id];
    const card = state.cards[current.key];
    const kind = current.dir === "extra" ? (card?.source || "cloze") : current.dir;
    if (kind === "cloze") { speak(v.ex[0], "fi-FI"); return; }
    if (caseOfDir(kind) || conjOfDir(kind)) { speak(v.tr, "tr-TR"); return; }
    const lang = current.dir === "fi-tr" ? "fi-FI" : "tr-TR";
    speak(current.dir === "fi-tr" ? v.fi : v.tr, lang);
  });

  $("#speakAnswer").addEventListener("click", () => {
    if (!current) return;
    const v = VOCAB[current.id];
    const card = state.cards[current.key];
    const kind = current.dir === "extra" ? (card?.source || "cloze") : current.dir;
    if (kind === "cloze") { speak(v.fi, "fi-FI"); return; }
    if (caseOfDir(kind) || conjOfDir(kind)) { speak(answerTarget(v, current.dir, card?.source)?.text || v.fi, "fi-FI"); return; }
    const lang = current.dir === "fi-tr" ? "tr-TR" : "fi-FI";
    speak(current.dir === "fi-tr" ? v.tr : v.fi, lang);
  });

  $("#emptyAgain").addEventListener("click", () => {
    state.daily.bonus = (state.daily.bonus || 0) + 10;
    store.saveState(state);
    current = null;
    renderStudy();
    toast("Bugün için 10 kart daha eklendi.");
  });

  $("#addWordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    addCustomWord();
  });

  $("#dictSearch").addEventListener("input", (e) => {
    state.ui.dictSearch = e.target.value;
    store.saveState(state);
    renderDictionary();
  });
  $("#dictCat").addEventListener("change", (e) => {
    state.ui.dictCat = e.target.value;
    // Taslaklar tek kategoride toplanır; başka bir kategori seçilince filtre kapanır.
    if (e.target.value !== "all") state.ui.dictDrafts = false;
    store.saveState(state);
    renderDictionary();
  });
  $("#dictScope").addEventListener("change", (e) => {
    state.ui.dictScope = e.target.value;
    store.saveState(state);
    renderDictionary();
  });
  $("#dictDrafts").addEventListener("click", () => {
    state.ui.dictDrafts = !state.ui.dictDrafts;
    if (state.ui.dictDrafts) {
      // Taslaklar kendi kategorisinde; diğer filtreler listeyi boşaltmasın.
      state.ui.dictCat = "all";
      state.ui.dictScope = "all";
      restoreDictionaryFilters();
    }
    store.saveState(state);
    renderDictionary();
  });

  $$("#dirSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.direction = btn.dataset.dir;
      current = null;
      revealed = false;
      settingsChanged();
      switchView("study");
    });
  });

  $$("#levelSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.levelFilter = btn.dataset.level;
      current = null;
      revealed = false;
      store.saveState(state);
      renderStudy();
      renderStats();
      const lv = levelFilter();
      toast(lv === "all" ? "Tüm seviyeler gösteriliyor." : `${lv} seviyesine geçildi.`);
    });
  });

  $("#newPerDay").addEventListener("input", (e) => {
    state.settings.newPerDay = Number(e.target.value);
    settingsChanged();
  });
  $("#reviewsPerDay").addEventListener("input", (e) => {
    state.settings.reviewsPerDay = Number(e.target.value);
    settingsChanged();
  });
  $("#ttsRate").addEventListener("input", (e) => {
    state.settings.ttsRate = Number(e.target.value);
    settingsChanged();
  });
  $("#autoSpeak").addEventListener("change", (e) => {
    state.settings.autoSpeak = e.target.checked;
    settingsChanged();
  });

  $("#clozeEnabled").addEventListener("change", (e) => {
    state.settings.cloze = e.target.checked;
    current = null;
    revealed = false;
    settingsChanged();
    toast(e.target.checked ? "Boşluk doldurma kartları açıldı." : "Boşluk doldurma kartları kapatıldı.");
  });

  $("#formsEnabled").addEventListener("change", (e) => {
    state.settings.forms = e.target.checked;
    current = null;
    revealed = false;
    settingsChanged();
    toast(e.target.checked ? "Hâl eki kartları açıldı." : "Hâl eki kartları kapatıldı.");
  });

  $("#conjEnabled").addEventListener("change", (e) => {
    state.settings.conj = e.target.checked;
    current = null;
    revealed = false;
    settingsChanged();
    toast(e.target.checked ? "Fiil çekimi kartları açıldı." : "Fiil çekimi kartları kapatıldı.");
  });

  $("#typingWordsEnabled").addEventListener("change", (e) => {
    state.settings.typingWords = e.target.checked;
    current = null;
    revealed = false;
    settingsChanged();
    toast(e.target.checked ? "Kelime kartlarında yazma açıldı." : "Kelime kartlarında yazma kapatıldı.");
  });

  $("#typingClozeEnabled").addEventListener("change", (e) => {
    state.settings.typingCloze = e.target.checked;
    current = null;
    revealed = false;
    settingsChanged();
    toast(e.target.checked ? "Boşluk kartlarında yazma açıldı." : "Boşluk kartlarında yazma kapatıldı.");
  });

  $("#extraThreshold").addEventListener("input", (e) => {
    state.settings.extraThreshold = Number(e.target.value);
    syncExtraCards();
    settingsChanged();
  });

  $("#clozeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    checkClozeAnswer();
  });
  $("#clozeSkip").addEventListener("click", skipCloze);

  $("#exportBtn").addEventListener("click", () => {
    store.exportBackup(state);
    toast("Yedek indirildi.");
  });

  // Kendi kelimeler yalnızca kelime paketi olarak indirilir; başka cihazda ilerlemeyi ezmeden eklenir.
  $("#wordsExportBtn").addEventListener("click", () => {
    const count = store.exportWordPack(state.custom);
    toast(count ? `${count} kelime paket olarak indirildi.` : "Sözlükte kendi kelimen yok.");
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      // Kelime paketi yalnızca sözlüğe eklenir; ilerleme ve ayarlar olduğu gibi kalır.
      const pack = store.readWordPack(text);
      if (pack) {
        const { added, skipped } = mergeWordPack(pack);
        toast(
          added
            ? `${added} kelime eklendi${skipped ? `, ${skipped} tanesi zaten vardı` : ""}. İlerlemen korundu.`
            : "Yeni kelime yok; paketteki kelimeler sözlükte zaten var."
        );
        return;
      }
      const imported = store.importBackup(text);
      if (!confirm("İçe aktarılan yedek mevcut ilerlemenin üzerine yazılacak. Devam edilsin mi?")) return;
      Object.assign(state, imported);
      applyCustomWords();
      store.ensureCards(state);
      migrateTypingState();
      syncExtraCards();
      store.saveNow(state);
      current = null;
      revealed = false;
      undoSnapshot = null;
      renderSettings();
      switchView("study");
      toast("Yedek geri yüklendi.");
    } catch (err) {
      toast(`Yedek okunamadı: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  });

  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Tüm kart ilerlemesi, seri ve istatistikler silinecek. Emin misin?")) return;
    store.resetProgress(state);
    current = null;
    revealed = false;
    undoSnapshot = null;
    sessionAnswered = 0;
    $("#undoBtn").disabled = true;
    renderStudy();
    renderStats();
    toast("İlerleme sıfırlandı.");
  });

  document.addEventListener("keydown", (e) => {
    if (state.ui.view !== "study") return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;

    if (e.code === "Space" && current && !revealed && typingEnabledFor(current)) {
      e.preventDefault();
      $("#clozeInput")?.focus();
      return;
    }

    if (e.code === "Space" || e.key === "Enter") {
      if (!revealed) { e.preventDefault(); reveal(); }
      return;
    }
    if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      gradeCurrent(["again", "hard", "good", "easy"][Number(e.key) - 1]);
    }
  });

  window.addEventListener("beforeunload", () => store.saveNow(state));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") store.saveNow(state);
    else { store.rollDay(state); renderStudy(); }
  });
}

/* ── Sözlük filtreleri ───────────────────────────── */
function pickOption(select, value, fallback = "all") {
  return [...select.options].some((option) => option.value === value) ? value : fallback;
}

/** Kapsam/kategori seçimlerini ve arama metnini kalıcı durumdan geri yükler. */
function restoreDictionaryFilters() {
  const cat = $("#dictCat");
  const scope = $("#dictScope");
  const search = $("#dictSearch");
  cat.value = pickOption(cat, state.ui.dictCat);
  scope.value = pickOption(scope, state.ui.dictScope);
  search.value = typeof state.ui.dictSearch === "string" ? state.ui.dictSearch : "";
  state.ui.dictCat = cat.value;
  state.ui.dictScope = scope.value;
  state.ui.dictSearch = search.value;
  state.ui.dictDrafts = Boolean(state.ui.dictDrafts);
}

/* ── Başlangıç ───────────────────────────────────── */
/* ── Güncelleme bildirimi ────────────────────────
 * Yeni service worker "bekliyor" durumuna geçince sayfa yenileme önerir;
 * kullanıcı onaylayınca worker etkinleşir ve sayfa bir kez yenilenir. */
let swRegistration = null;
let swReloading = false;

function showUpdateBar(registration) {
  swRegistration = registration;
  const bar = $("#updateBar");
  if (!bar || !bar.hidden) return;
  bar.hidden = false;
}

function watchServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const container = navigator.serviceWorker;

  container
    .register(new URL("../sw.js", import.meta.url))
    .then((registration) => {
      // Sayfa zaten bir worker tarafından denetleniyorsa bekleyen worker güncellemedir.
      if (registration.waiting && container.controller) showUpdateBar(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && container.controller) showUpdateBar(registration);
        });
      });
    })
    .catch((err) => console.warn("Service worker kaydedilemedi:", err));

  container.addEventListener("controllerchange", () => {
    if (!swReloading) return;
    swReloading = false;
    window.location.reload();
  });
}

function applyUpdate() {
  const waiting = swRegistration?.waiting;
  if (!waiting) return;
  swReloading = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
  $("#updateText").textContent = "Yeni sürüm yükleniyor…";
  $("#updateReload").disabled = true;
}

function init() {
  applyTheme();
  $("#storageName").textContent = store.STORAGE_KEY;

  // Kurulabilir + çevrimdışı: service worker yalnızca güvenli bağlamda kaydedilir.
  watchServiceWorker();

  // Yedekten ya da önceki oturumdan gelen kullanıcı kelimelerini sözlüğe ekle.
  applyCustomWords();
  store.ensureCards(state);

  const missingLevel = VOCAB.filter((v) => !LEVELS[v.lvl]);
  if (missingLevel.length) {
    console.warn("Seviyesi tanımsız kelimeler:", missingLevel.map((v) => v.fi));
  }

  const catSelect = $("#dictCat");
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "Tüm kategoriler";
  catSelect.append(allOpt);
  Object.entries(CATEGORIES).forEach(([key, meta]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${meta.icon} ${meta.label}`;
    catSelect.append(opt);
  });

  restoreDictionaryFilters();

  const wordCatSelect = $("#newWordCat");
  Object.entries(CATEGORIES).forEach(([key, meta]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${meta.icon} ${meta.label}`;
    wordCatSelect.append(opt);
  });

  $("#footWords").textContent = VOCAB.length;
  $("#footDirection").textContent = dirLabel();

  migrateTypingState();
  syncExtraCards();
  bindEvents();
  renderSettings();
  switchView(state.ui.view || "study");

  // Öğrenme kartları ilerideki bir dakikaya planlanmışsa ekranı tazele.
  setInterval(() => {
    if (state.ui.view !== "study" || document.hidden) return;
    store.rollDay(state);
    if (!current) renderStudy();
    else renderCounters();
  }, 20000);

  // Gece yarısını geçince günlük sayaçları sıfırla.
  setInterval(() => {
    if (document.hidden) return;
    const before = state.daily.date;
    store.rollDay(state);
    if (before !== state.daily.date) {
      current = null;
      renderStudy();
      renderStats();
    }
  }, 60000);
}

init();
