/* Yerel durum yönetimi: ayarlar, kart ilerlemesi, günlük istatistikler, yedekleme */
import { VOCAB, DIRS, CASES, formDir, PERSONS, conjDir } from "./data.js";
import { newCard } from "./srs.js";

// v2: kart anahtarları kelime sırasına değil kelimenin kendisine bağlı
export const STORAGE_KEY = "suomi-tr-app-v2";

export function activeDirs(direction) {
  return direction === "both" ? ["fi-tr", "tr-fi"] : [direction];
}

export function todayKey(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function defaultState() {
  return {
    version: 1,
    settings: {
      direction: "fi-tr",
      levelFilter: "all",
      newPerDay: 20,
      reviewsPerDay: 200,
      ttsRate: 1,
      autoSpeak: false,
      cloze: true,
      forms: true,
      conj: true,
      typingWords: true,
      typingCloze: true,
      extraThreshold: 2,
      theme: "light",
    },
    cards: {},
    // Kullanıcının kendi eklediği kelimeler (yerleşik sözlükten ayrı tutulur).
    custom: [],
    daily: { date: todayKey(), newDone: 0, reviewDone: 0, correct: 0, total: 0 },
    history: {},
    totals: { reviews: 0, correct: 0 },
    // FSRS gölge kalibrasyonu: gerçek hatırlama denemelerinin tahmin/gerçekleşme toplamları
    fsrs: { since: 0, reviews: 0, predicted: 0, hits: 0, brier: 0 },
    typing: { attempts: 0, correct: 0, tolerated: 0, order: 0, letter: 0, word: 0, recent: [], byCard: {} },
    // Sözlük görünümünde seçilen kategori ve kapsam sonraki açılışta korunur.
    ui: { view: "study", dictCat: "all", dictScope: "all", dictSearch: "", dictDrafts: false, planDate: "" },
  };
}

/** Her kelime için iki yönlü kart oluşturur (eksik olanları ekler). */
export function ensureCards(state) {
  for (const dir of Object.keys(DIRS)) {
    VOCAB.forEach((vocab) => {
      const key = cardKey(vocab, dir);
      if (!state.cards[key]) state.cards[key] = newCard(vocab.fi, dir);
    });
  }
  // Kalıp ifadeler için boşluk doldurma kartı (yöne bağlı değil).
  VOCAB.forEach((vocab) => {
    if (!vocab.cloze) return;
    const key = cardKey(vocab, "cloze");
    if (!state.cards[key]) state.cards[key] = newCard(vocab.fi, "cloze");
  });
  // Hâl eki kartları: yalnızca çekimi tanımlı kelimeler için, her durum ayrı kart.
  VOCAB.forEach((vocab) => {
    if (!vocab.forms) return;
    for (const caseKey of Object.keys(CASES)) {
      const dir = formDir(caseKey);
      const key = cardKey(vocab, dir);
      if (!state.cards[key]) state.cards[key] = newCard(vocab.fi, dir);
    }
  });
  // Fiil çekimi kartları: altı kişi için ayrı kart, her kişi bağımsız ilerler.
  VOCAB.forEach((vocab) => {
    if (!vocab.conj) return;
    for (const person of Object.keys(PERSONS)) {
      const dir = conjDir(person);
      const key = cardKey(vocab, dir);
      if (!state.cards[key]) state.cards[key] = newCard(vocab.fi, dir);
    }
  });
}

/** Kart anahtarı kelimenin kendisine bağlı: sözlüğe kelime eklemek ilerlemeyi bozmaz. */
export function cardKey(vocab, dir) {
  return `${vocab.fi}|${dir}`;
}

/** Bir kelimenin bütün kartlarını (iki yön, boşluk, hâl eki, çekim) siler. */
export function pruneWordCards(state, fi) {
  const prefix = `${fi}|`;
  for (const key of Object.keys(state.cards)) {
    if (key.startsWith(prefix)) delete state.cards[key];
  }
}

/** Eski tek `typing` anahtarını iki bağımsız anahtara çevirir (true/false ikisine de uygulanır). */
function normalizeTypingSettings(rawSettings = {}) {
  const legacy = typeof rawSettings.typing === "boolean" ? rawSettings.typing : null;
  const pick = (key) =>
    typeof rawSettings[key] === "boolean" ? rawSettings[key] : legacy ?? true;
  const settings = {
    ...defaultState().settings,
    ...rawSettings,
    typingWords: pick("typingWords"),
    typingCloze: pick("typingCloze"),
  };
  delete settings.typing;
  return settings;
}

function mergeDefaults(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    settings: normalizeTypingSettings(raw.settings),
    daily: { ...base.daily, ...(raw.daily || {}) },
    totals: { ...base.totals, ...(raw.totals || {}) },
    fsrs: { ...base.fsrs, ...(raw.fsrs || {}) },
    history: raw.history && typeof raw.history === "object" ? raw.history : {},
    typing: {
      ...base.typing,
      ...(raw.typing || {}),
      byCard: { ...(raw.typing?.byCard || {}), ...(raw.typing?.byPhrase || {}) },
    },
    cards: raw.cards && typeof raw.cards === "object" ? raw.cards : {},
    custom: Array.isArray(raw.custom)
      ? raw.custom.filter((w) => w && typeof w.fi === "string" && typeof w.tr === "string")
      : [],
    ui: { ...base.ui, ...(raw.ui || {}) },
  };
}

export function loadState() {
  let state = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = mergeDefaults(JSON.parse(raw));
    else state.settings = normalizeTypingSettings(state.settings);
  } catch (err) {
    console.warn("Kayıtlı veri okunamadı, sıfırdan başlanıyor.", err);
  }
  ensureCards(state);
  if (state.daily.date !== todayKey()) {
    state.daily = { date: todayKey(), newDone: 0, reviewDone: 0, correct: 0, total: 0 };
  }
  return state;
}

let saveTimer = null;
export function saveState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Kayıt başarısız:", err);
    }
  }, 120);
}

export function saveNow(state) {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Kayıt başarısız:", err);
  }
}

/** Günlük sayaçları güne göre tazeler. */
export function rollDay(state) {
  const today = todayKey();
  if (state.daily.date !== today) {
    state.daily = { date: today, newDone: 0, reviewDone: 0, correct: 0, total: 0 };
  }
}

export function resetProgress(state) {
  state.cards = {};
  ensureCards(state);
  state.daily = { date: todayKey(), newDone: 0, reviewDone: 0, correct: 0, total: 0 };
  state.history = {};
  state.totals = { reviews: 0, correct: 0 };
  state.typing = { attempts: 0, correct: 0, tolerated: 0, order: 0, letter: 0, word: 0, recent: [], byCard: {} };
  saveNow(state);
}

export function exportBackup(state) {
  const payload = { app: "suomi-tr", exportedAt: new Date().toISOString(), state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `suomi-tr-yedek-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Kendi eklenen kelimelerden taşınabilir bir kelime paketi üretir.
 * `cards` verilirse yalnızca paketteki kelimelere ait kart ilerlemesi de pakete girer;
 * verilmezse dosya başka cihazda yalnızca sözlüğe eklenir. Kelime yoksa null döner.
 */
export function buildWordPack(words, cards = null) {
  const custom = (words || [])
    .map((word) => {
      const fi = String(word?.fi || "").trim().replace(/\s+/g, " ");
      const tr = String(word?.tr || "").trim().replace(/\s+/g, " ");
      const clean = { fi, tr, lvl: word?.lvl || "A1", cat: word?.cat || "yhteiskunta" };
      const ex = word?.ex;
      if (Array.isArray(ex) && ex.length === 2 && ex[0] && ex[1]) clean.ex = [String(ex[0]), String(ex[1])];
      return clean;
    })
    .filter((word) => word.fi && word.tr);
  if (!custom.length) return null;
  return {
    app: "suomi-tr",
    pack: "Kendi kelimelerim",
    exportedAt: new Date().toISOString(),
    state: { cards: packCards(custom, cards), custom },
  };
}

/** Pakete yalnızca paketteki kelimelere ait kartlar girer; başka kelimelerin ilerlemesi taşınmaz. */
function packCards(custom, cards) {
  if (!cards || typeof cards !== "object") return {};
  const words = new Set(custom.map((word) => word.fi));
  const out = {};
  for (const [key, card] of Object.entries(cards)) {
    const fi = typeof card?.id === "string" ? card.id : key.split("|")[0];
    if (words.has(fi)) out[key] = card;
  }
  return out;
}

/** Kendi kelimelerini paket olarak indirir; taşınan kelime ve kart sayısını döndürür. */
export function exportWordPack(words, cards = null) {
  const payload = buildWordPack(words, cards);
  if (!payload) return { words: 0, cards: 0 };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `suomi-tr-kelimeler-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { words: payload.state.custom.length, cards: Object.keys(payload.state.cards).length };
}

/** Yedeği içe aktarır; doğrulama başarısızsa hata fırlatır. */
/**
 * Kelime paketini ayırır: `{ words, cards }` döner, yedek değilse null.
 * Paket kendi `pack` adını taşır; kart taşısa bile ilerlemenin yerine yazılmaz,
 * kelimelere ve o kelimelerin kartlarına eklenir. `pack` adı olmayan ve kart
 * taşıyan dosya tam yedektir: null döner, eskisi gibi ilerlemenin yerine yazılır.
 */
export function readWordPack(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed.app === "suomi-tr" ? parsed.state : parsed;
  if (!incoming || typeof incoming !== "object") {
    throw new Error("Dosya bir Suomi–Türkçe yedeği gibi görünmüyor.");
  }
  const cards = incoming.cards && typeof incoming.cards === "object" ? incoming.cards : {};
  const isPack = typeof parsed.pack === "string" && parsed.pack.trim() !== "";
  if (!isPack && Object.keys(cards).length > 0) return null;
  if (!Array.isArray(incoming.custom)) return null;
  return { words: incoming.custom, cards: isPack ? cards : {} };
}

export function importBackup(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed.app === "suomi-tr" ? parsed.state : parsed;
  if (!incoming || typeof incoming !== "object" || typeof incoming.cards !== "object") {
    throw new Error("Dosya bir Suomi–Türkçe yedeği gibi görünmüyor.");
  }
  const merged = mergeDefaults(incoming);
  ensureCards(merged);
  return merged;
}

export function streakDays(history) {
  let streak = 0;
  const cursor = new Date();
  // Bugün henüz çalışılmadıysa seriyi dünden saymaya başla.
  if (!history[todayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (history[todayKey(cursor)]?.reviews > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function last7Days(history) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    out.push({
      key,
      label: d.toLocaleDateString("tr-TR", { weekday: "short" }),
      reviews: history[key]?.reviews || 0,
    });
  }
  return out;
}
