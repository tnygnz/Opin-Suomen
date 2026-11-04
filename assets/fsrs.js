/* FSRS-5 (Free Spaced Repetition Scheduler) — gölge motor
 *
 * Kayıtlı kartlar SM-2 ile zamanlanmaya devam eder; bu modül aynı cevapları
 * FSRS-5'in bellek modelinde (kararlılık S, zorluk D) işler ve yalnızca
 * karşılaştırma/planlama için kullanılır. Dolayısıyla mevcut veri bozulmaz.
 *
 * Model: R(t, S) = (1 + FACTOR · t / S)^DECAY, DECAY = -0,5, FACTOR = 19/81.
 * Aralık, hedef hatırlama r için I = S / FACTOR · (r^(1/DECAY) - 1) olur; r = 0,9
 * iken I ≈ S olduğundan SM-2 aralıkları doğrudan kararlılık olarak tohumlanabilir.
 */

export const DAY = 24 * 60 * 60 * 1000;

// FSRS-5 varsayılan ağırlıkları (w0–w18).
export const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;

export const GRADES = { again: 1, hard: 2, good: 3, easy: 4 };

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function gradeIndex(grade) {
  return GRADES[grade] || 3;
}

/** t gün sonra hatırlama olasılığı. */
export function retrievability(elapsedDays, stability) {
  if (!(stability > 0)) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Hedef hatırlama için gün cinsinden aralık. */
export function intervalDays(stability, retention = 0.9) {
  const r = clamp(retention, 0.75, 0.98);
  const days = (Math.max(0.1, stability) / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  return Math.max(1, Math.round(days));
}

export function initialStability(gi, w = DEFAULT_W) {
  return Math.max(0.1, w[gi - 1]);
}

export function initialDifficulty(gi, w = DEFAULT_W) {
  return clamp(w[4] - Math.exp(w[5] * (gi - 1)) + 1, 1, 10);
}

export function nextDifficulty(difficulty, gi, w = DEFAULT_W) {
  const delta = difficulty - w[6] * (gi - 3);
  return clamp(w[7] * initialDifficulty(4, w) + (1 - w[7]) * delta, 1, 10);
}

/** Başarılı hatırlamadan sonra kararlılık (Zor/İyi/Kolay). */
export function nextRecallStability(stability, difficulty, r, gi, w = DEFAULT_W) {
  const hardPenalty = gi === 2 ? w[15] : 1;
  const easyBonus = gi === 4 ? w[16] : 1;
  const growth =
    Math.exp(w[8]) * (11 - difficulty) * Math.pow(stability, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1);
  return Math.max(0.1, stability * (1 + growth * hardPenalty * easyBonus));
}

/** Unutma sonrası kararlılık; eski değeri aşamaz. */
export function nextForgetStability(stability, difficulty, r, w = DEFAULT_W) {
  const next =
    w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  return clamp(next, 0.1, stability);
}

/** Aynı gün içindeki tekrarlar için kısa vadeli kararlılık. */
export function nextShortTermStability(stability, gi, w = DEFAULT_W) {
  return Math.max(0.1, stability * Math.exp(w[17] * (gi - 3 + w[18])));
}

/**
 * Bir cevabı FSRS belleğine işler. `prev` yoksa kart ilk kez görülüyordur.
 * opts.retention hedef hatırlama, opts.speed yeni kartın başlangıç hızıdır.
 */
export function updateCard(prev, grade, now = Date.now(), opts = {}) {
  const w = opts.weights || DEFAULT_W;
  const retention = opts.retention ?? 0.9;
  const speed = opts.speed ?? 1;
  const gi = gradeIndex(grade);

  if (!prev) {
    const s = initialStability(gi, w) * speed;
    const d = initialDifficulty(gi, w);
    return {
      s,
      d,
      last: now,
      reps: 1,
      lapses: gi === 1 ? 1 : 0,
      due: now + intervalDays(s, retention) * DAY,
      elapsed: 0,
      r: 1,
    };
  }

  const elapsed = Math.max(0, (now - (prev.last || now)) / DAY);
  const r = retrievability(elapsed, prev.s);
  const s =
    gi === 1
      ? nextForgetStability(prev.s, prev.d, r, w)
      : elapsed < 0.5
        ? nextShortTermStability(prev.s, gi, w)
        : nextRecallStability(prev.s, prev.d, r, gi, w);

  return {
    s,
    d: nextDifficulty(prev.d, gi, w),
    last: now,
    reps: (prev.reps || 0) + 1,
    lapses: (prev.lapses || 0) + (gi === 1 ? 1 : 0),
    due: now + intervalDays(s, retention) * DAY,
    elapsed,
    r,
  };
}

/** SM-2 kolaylık çarpanını ve unutmaları FSRS zorluğuna çevirir. */
export function difficultyFromSm2(card) {
  const ease = typeof card.ease === "number" ? card.ease : 2.5;
  const lapses = Math.min(6, card.lapses || 0);
  return clamp(9.4 - (ease - 1.3) * 4.2 + lapses * 0.2, 1, 10);
}

/** Geçmiş SM-2 kartını FSRS belleğine tohumlar (aralık ≈ kararlılık). */
export function seedFromSm2(card, now = Date.now()) {
  const interval = Math.max(0, card.interval || 0);
  return {
    s: Math.max(0.4, interval),
    d: difficultyFromSm2(card),
    last: card.last || now,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    due: card.due || now,
  };
}

/**
 * Geçmiş cevaplardan kişisel parametreler. Ölçülen doğruluk hedef hatırlamaya
 * kalibre edilir (az cevapta 0,9'a çekilir); başlangıç hızı da aynı ölçüte bağlıdır.
 */
export function fitParams(totals = {}) {
  const reviews = Math.max(0, Math.round(totals.reviews || 0));
  const correct = clamp(totals.correct || 0, 0, reviews);
  const weight = Math.min(1, reviews / 300);
  const observed = reviews ? correct / reviews : 0.9;
  const retention = clamp(0.9 + (observed - 0.9) * weight, 0.85, 0.95);
  const speed = clamp(1 + (observed - 0.88) * 0.8 * weight, 0.7, 1.4);
  const round3 = (v) => Math.round(v * 1000) / 1000;
  return { retention: round3(retention), speed: round3(speed), observed: round3(observed), reviews };
}

/** Hedef tarihe kalan günlük yük. */
export function plan({ newLeft = 0, days = 1, reviews = 0 } = {}) {
  const span = Math.max(1, Math.round(days));
  return {
    days: span,
    perDayNew: Math.ceil(Math.max(0, newLeft) / span),
    perDayReviews: Math.ceil(Math.max(0, reviews) / span),
  };
}

/** Karar eşikleri: bu kadar cevap ve gün birikmeden geçiş konuşulmaz. */
export const MIN_SHADOW_SAMPLES = 150;
export const MIN_SHADOW_DAYS = 14;

/**
 * Tek bir hatırlama denemesinin tahminini gölge özetine ekler. Yalnızca aynı gün
 * öğrenme adımları dışındaki denemeler çağırır; `r` cevap anındaki tahmindir.
 */
export function recordShadow(aggregate, r, ok, now = Date.now()) {
  const next = { since: 0, reviews: 0, predicted: 0, hits: 0, brier: 0, ...(aggregate || {}) };
  if (!next.since) next.since = now;
  next.reviews += 1;
  next.predicted += clamp(r, 0, 1);
  if (ok) next.hits += 1;
  next.brier += Math.pow(clamp(r, 0, 1) - (ok ? 1 : 0), 2);
  return next;
}

/** Gölge özetini okunur ortalamalara çevirir. */
export function shadowStats(aggregate = {}, now = Date.now()) {
  const reviews = Math.max(0, aggregate.reviews || 0);
  return {
    samples: reviews,
    days: aggregate.since ? Math.max(0, Math.floor((now - aggregate.since) / DAY)) : 0,
    predicted: reviews ? (aggregate.predicted || 0) / reviews : 0,
    observed: reviews ? (aggregate.hits || 0) / reviews : 0,
    brier: reviews ? (aggregate.brier || 0) / reviews : 0,
  };
}

/**
 * Gölge verisinden geçiş kararı: yeterli örnek var mı, FSRS hatırlamayı iyi mi
 * öngörüyor (Brier) ve 30 günlük yük SM-2'ye göre nerede?
 */
export function migrationVerdict(opts = {}) {
  const { samples = 0, days = 0, predicted = 0, observed = 0, brier = 0, sm2 = 0, fsrsCount = 0 } = opts;
  const pct = (v) => `%${Math.round(v * 100)}`;
  const gap = Math.abs(predicted - observed);
  const workload = sm2 ? Math.round((1 - fsrsCount / sm2) * 100) : 0;
  const workloadText = !sm2
    ? ""
    : workload > 0
      ? `Aynı 30 günde FSRS %${workload} daha az tekrar istiyor.`
      : workload < 0
        ? `Aynı 30 günde FSRS %${Math.abs(workload)} daha fazla tekrar istiyor.`
        : "İki motor aynı 30 günde eşit tekrar istiyor.";

  if (samples < MIN_SHADOW_SAMPLES || days < MIN_SHADOW_DAYS) {
    return {
      level: "collect",
      title: `Karar için veri birikiyor: ${samples}/${MIN_SHADOW_SAMPLES} cevap · ${days}/${MIN_SHADOW_DAYS} gün`,
      detail: `Gölge motor yalnızca gerçek tekrar denemelerini sayar (öğrenme adımları hariç). ${workloadText}`.trim(),
    };
  }

  const calibration = `Brier ${brier.toFixed(2).replace(".", ",")} · öngörülen ${pct(predicted)} / gerçek ${pct(observed)}`;
  if (brier <= 0.22 && gap <= 0.06) {
    return {
      level: "go",
      title: `Geçiş düşük riskli · ${calibration}`,
      detail: `FSRS tahminleri tutarlı. ${workloadText}`.trim(),
    };
  }
  if (brier <= 0.28) {
    return {
      level: "caution",
      title: `Kalibrasyon sınırda · ${calibration}`,
      detail: `${workloadText} Bir hafta daha gölge verisi kararı netleştirir.`.trim(),
    };
  }
  return {
    level: "no",
    title: `Geçiş önerilmiyor · ${calibration}`,
    detail: "FSRS bu veride hatırlamayı SM-2'den daha kötü öngörüyor; önce parametrelerin kalibrasyonu gerekir.",
  };
}

/** Gölge durumlardan, "İyi" cevap varsayımıyla dönem içi tekrar sayısı. */
export function forecast(shadows, horizonDays, opts = {}) {
  const now = opts.now ?? Date.now();
  const end = now + horizonDays * DAY;
  let count = 0;
  for (const shadow of shadows) {
    let state = { ...shadow };
    let t = Math.max(now, state.due || now);
    let guard = 0;
    while (t <= end && guard < 120) {
      count += 1;
      state = updateCard(state, "good", t, opts);
      t = state.due;
      guard += 1;
    }
  }
  return count;
}
