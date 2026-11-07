/* Okuma modu: yapıştırılan Fince metinde sözlükteki kelimeleri tanır.
 *
 * Sözlük temel biçimleri tuttuğu için çekim ekleri kısa bir ek listesiyle
 * sıyrılır (en çok iki adım: "taloissa" → "taloi" → "talo"). Yalnızca gerçek
 * sözlük eşleşmeleri sayılır; kök tahmini ya da uydurma eşleşme üretilmez.
 */

const SUFFIXES = [
  "ssakaan",
  "ssakin",
  "stakaan",
  "stakin",
  "ssa",
  "ssä",
  "sta",
  "stä",
  "lla",
  "llä",
  "lta",
  "ltä",
  "lle",
  "ksi",
  "tta",
  "ttä",
  "han",
  "hän",
  "kin",
  "kaan",
  "kään",
  "jen",
  "ine",
  "na",
  "nä",
  "ta",
  "tä",
  "an",
  "än",
  "on",
  "ön",
  "un",
  "yn",
  "in",
  "en",
  "a",
  "ä",
  "i",
  "t",
  "n",
  "s",
  "e",
];

const WORD_RE = /[A-Za-zÅÄÖåäöŠšŽž'-]+/g;
const RANK = { unknown: 0, learning: 1, known: 2 };

/** Metni Fince kelimelere ayırır; 1 harflik parçalar ve noktalama atılır. */
export function tokenize(text) {
  const tokens = [];
  const matches = String(text || "").match(WORD_RE) || [];
  for (const raw of matches) {
    const lower = raw.toLocaleLowerCase("fi").replace(/^[-']+|[-']+$/g, "");
    if (lower.length < 2) continue;
    tokens.push({ raw, lower });
  }
  return tokens;
}

/** Kelimenin kendisi ve ekleri sıyrılmış biçimleri (en çok iki adım). */
export function stems(word) {
  const seen = new Set([word]);
  let frontier = [word];
  for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
    const next = [];
    for (const base of frontier) {
      for (const suffix of SUFFIXES) {
        if (!base.endsWith(suffix)) continue;
        const stem = base.slice(0, base.length - suffix.length);
        if (stem.length < 3 || seen.has(stem)) continue;
        seen.add(stem);
        next.push(stem);
      }
    }
    frontier = next;
  }
  return [...seen];
}

/**
 * Metni sözlükle eşleştirir. `lookup(lower)` eşleşme için `{ vocab, studied }`
 * ya da `null` döndürür; öğrenilmemiş kartlar "learning" sayılır.
 */
export function analyze(text, lookup) {
  const tokens = tokenize(text);
  const unique = new Map();
  let known = 0;
  let learning = 0;

  for (const token of tokens) {
    const match = lookup ? lookup(token.lower) : null;
    const status = !match ? "unknown" : match.studied ? "known" : "learning";
    if (status === "known") known += 1;
    else if (status === "learning") learning += 1;

    const word = match?.vocab?.fi || token.lower;
    const entry = unique.get(word) || { word, count: 0, status };
    entry.count += 1;
    if (RANK[status] < RANK[entry.status]) entry.status = status;
    unique.set(word, entry);
  }

  const total = tokens.length;
  const words = [...unique.values()].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || b.count - a.count || a.word.localeCompare(b.word, "fi")
  );
  const uniqueTotal = words.length;
  const uniqueKnown = words.filter((word) => word.status === "known").length;

  return {
    total,
    known,
    learning,
    unknown: total - known - learning,
    uniqueTotal,
    uniqueKnown,
    coverage: total ? known / total : 0,
    uniqueCoverage: uniqueTotal ? uniqueKnown / uniqueTotal : 0,
    words,
  };
}
