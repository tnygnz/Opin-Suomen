/* Aralıklı tekrar (SRS) motoru
 * Anki'nin kullandığı SM-2 ailesinin sadeleştirilmiş bir uygulaması:
 * öğrenme adımları (1 dk / 10 dk), kolaylık çarpanı (ease) ve unutma sonrası tekrar adımı.
 */

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;

export const LEARNING_STEPS = [1, 10]; // dakika
export const RELEARN_STEPS = [10];     // dakika
export const GRADUATING_INTERVAL = 1;  // gün ("İyi" ile mezun olunca)
export const EASY_INTERVAL = 4;        // gün ("Kolay" ile mezun olunca)

export const GRADES = ["again", "hard", "good", "easy"];

export const GRADE_LABELS = {
  again: "Tekrar",
  hard: "Zor",
  good: "İyi",
  easy: "Kolay",
};

export function newCard(id, dir) {
  return {
    id,
    dir,
    state: "new",   // new | learning | review | relearn
    step: 0,
    due: 0,
    interval: 0,    // gün
    ease: 2.5,      // 1.3 – 3.2
    reps: 0,
    lapses: 0,
    last: 0,
  };
}

export function isDue(card, now) {
  return card.state !== "new" && card.due <= now;
}

/** Kartı verilen notla yeniden zamanlar; yeni kart döndürür (girdi değişmez). */
export function schedule(card, grade, now = Date.now()) {
  const c = { ...card };
  c.reps += 1;
  c.last = now;

  if (c.state === "new" || c.state === "learning") {
    c.state = "learning";

    if (grade === "again") {
      c.step = 0;
      c.due = now + LEARNING_STEPS[0] * MIN;
    } else if (grade === "hard") {
      const stepMin = LEARNING_STEPS[Math.min(c.step, LEARNING_STEPS.length - 1)];
      c.due = now + Math.max(1, Math.round(stepMin * 1.5)) * MIN;
    } else if (grade === "good") {
      c.step += 1;
      if (c.step >= LEARNING_STEPS.length) {
        c.state = "review";
        c.interval = GRADUATING_INTERVAL;
        c.due = now + GRADUATING_INTERVAL * DAY;
      } else {
        c.due = now + LEARNING_STEPS[c.step] * MIN;
      }
    } else {
      // easy: doğrudan mezun et
      c.state = "review";
      c.interval = EASY_INTERVAL;
      c.ease = Math.min(3.2, c.ease + 0.05);
      c.due = now + EASY_INTERVAL * DAY;
    }
    return c;
  }

  if (c.state === "review") {
    if (grade === "again") {
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
      c.state = "relearn";
      c.step = 0;
      c.interval = Math.max(1, Math.round(c.interval * 0.3));
      c.due = now + RELEARN_STEPS[0] * MIN;
    } else if (grade === "hard") {
      c.ease = Math.max(1.3, c.ease - 0.15);
      c.interval = Math.max(1, Math.round(c.interval * 1.2));
      c.due = now + c.interval * DAY;
    } else if (grade === "good") {
      c.interval = Math.max(1, Math.round(c.interval * c.ease));
      c.due = now + c.interval * DAY;
    } else {
      c.ease = Math.min(3.2, c.ease + 0.15);
      c.interval = Math.max(1, Math.round(c.interval * c.ease * 1.3));
      c.due = now + c.interval * DAY;
    }
    return c;
  }

  // relearn: unutulan kartın telafisi
  if (grade === "again") {
    c.due = now + RELEARN_STEPS[0] * MIN;
  } else if (grade === "hard") {
    c.due = now + Math.round(RELEARN_STEPS[0] * 1.5) * MIN;
  } else if (grade === "good") {
    c.state = "review";
    c.interval = Math.max(1, c.interval);
    c.due = now + c.interval * DAY;
  } else {
    c.state = "review";
    c.ease = Math.min(3.2, c.ease + 0.1);
    c.interval = Math.max(2, Math.round(Math.max(1, c.interval) * 1.2));
    c.due = now + c.interval * DAY;
  }
  return c;
}

const MIN_MONTH = 30 * DAY;

/** "10 dk", "3 sa", "12 gün", "5 ay", "2,3 yıl" gibi kısa süre metni. */
export function formatInterval(ms) {
  if (ms <= 0) return "şimdi";
  if (ms < MIN) return "<1 dk";
  if (ms < 60 * MIN) return `${Math.round(ms / MIN)} dk`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} sa`;
  if (ms < MIN_MONTH) return `${Math.round(ms / DAY)} gün`;
  if (ms < 365 * DAY) return `${Math.round(ms / MIN_MONTH)} ay`;
  const years = ms / (365 * DAY);
  return `${years.toFixed(years < 10 ? 1 : 0).replace(".", ",")} yıl`;
}

/** Buton etiketlerinde gösterilecek aralık önizlemeleri. */
export function previewIntervals(card, now = Date.now()) {
  const out = {};
  for (const g of GRADES) {
    const next = schedule(card, g, now);
    out[g] = formatInterval(next.due - now);
  }
  return out;
}

export function isMature(card) {
  return card.state === "review" && card.interval >= 21;
}

export function cardStatusLabel(card, now = Date.now()) {
  if (card.state === "new") return "Yeni";
  if (card.state === "learning") return "Öğrenme";
  if (card.state === "relearn") return "Tekrar";
  if (card.due > now) return "Planlandı";
  return "Tekrar";
}
