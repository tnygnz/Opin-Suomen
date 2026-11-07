/* Genel davranış paketi: SRS, seri, rekor tablosu, oturum akışı, oturum
   ekranı etiketleri ve klavye ipucu.

   Bağımlılıksız:  cd sanat && node tests/smoke.test.js
   Hepsi birlikte: node tests/run.js

   Tarayıcı yok: data.js + app.js küçük bir DOM taklidiyle yüklenir
   (sahte Date, localStorage, SpeechRecognition) ve üretilen HTML denetlenir. */

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "data.js"), "utf8") + "\n" +
            fs.readFileSync(path.join(root, "app.js"), "utf8");
const RealDate = Date;
let offset = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
global.Date = FakeDate;
const DAY = 86400000, base = RealDate.now();
const pad = n => (n < 10 ? "0" : "") + n;
const keyOf = ms => { const d = new RealDate(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const keyAt = off => keyOf(base + offset - off * DAY);
const fmt = k => k.split("-").reverse().join(".");
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k,v)=>{store[k]=v;}, removeItem: k=>{delete store[k];} };
let intervalCalls = 0, classAdds = [], docH = {}, winH = {};
global.setTimeout = () => 1;
global.clearTimeout = () => {};
global.setInterval = () => { intervalCalls += 1; return 1; };
const at = (fi, off, score) => ({ fi, score, at: base - off * DAY - 60000 });
const dayLog = (off, words) => words.map((w, i) => at(w, off, 80 + i));
function mk(log, over) {
  return Object.assign({
    settings: { direction: "fi-tr", goal: 20, pronGoal: 5 }, cards: {}, history: {},
    streak: { last: null, days: 0 }, answers: 0, correct: 0, pron: {}, pronLog: log,
    pronBest: {}, pronRun: {}, dayNote: null, lastSeen: null
  }, over || {});
}
const put = o => { store["sanat.v1"] = JSON.stringify(o); };
function boot() {
  var H = {};
  function el(id){ return { id, innerHTML:"", textContent:"", value:"", offsetWidth: 1,
    classList:{ add(c){ classAdds.push(id + "." + c); }, remove(){}, toggle(){} },
    addEventListener(t,f){ H[id + ":" + t] = f; }, appendChild(){}, removeChild(){},
    querySelector(){return null;}, querySelectorAll(){return [];}, getAttribute(){return null;},
    setAttribute(){}, focus(){}, click(){}, style:{} }; }
  const nodes = { app: el("app"), toast: el("toast"), streakDays: el("streakDays"), tabs: el("tabs") };
  global.document = { getElementById: id => nodes[id] || (nodes[id] = el(id)), querySelector: ()=>null, querySelectorAll: ()=>[],
    createElement: ()=>el("tmp"), body: el("body"), hidden: false, addEventListener(t,f){ docH[t] = f; } };
  function FakeSR(){}
  FakeSR.next = "";
  FakeSR.prototype.start = function(){ this.onresult({ results: [[{ transcript: FakeSR.next }]] }); };
  FakeSR.prototype.abort = function(){};
  global.window = { scrollTo(){}, SpeechRecognition: FakeSR, addEventListener(t,f){ winH[t] = f; } };
  global.confirm = () => true;
  new Function(src)();
  const A = nodes.app;
  const tgt = (sels, val) => ({ closest: s => (sels.indexOf(s) !== -1 ? { getAttribute: () => val } : null) });
  const fire = (sels, val, which, extra) => {
    if (typeof sels === "string") sels = [sels];
    (which ? H[which] : H["app:click"])(Object.assign({ target: tgt(sels, val) }, extra || {}));
  };
  return { A, toast: nodes.toast, sr: FakeSR, fire, tab: n => fire(["button[data-tab]"], n, "tabs:click") };
}
let ok = 0, fail = 0;
function t(label, cond, extra) { if (cond) { ok++; console.log("  [OK]  " + label + (extra ? " -> " + extra : "")); } else { fail++; console.log("  [FAIL] " + label + (extra ? " -> " + extra : "")); } }

console.log("A) hedef 2: 4 günlük seri (bugün dahil), hedef 5 boş");
put(mk([].concat(dayLog(3, ["hei","vesi"]), dayLog(2, ["hei","vesi"]), dayLog(1, ["hei","vesi"]),
  dayLog(0, ["hei","vesi"])), { lastSeen: keyAt(1), pronBest: { "2": 3, "5": 0 } }));
const e = boot(); e.tab("stats");
const h = e.A.innerHTML;
t("tablo var", h.includes('class="rec-table"'));
t("baslik satiri", h.includes("<th>Hedef</th><th>Rekor</th><th>Kırıldığı gün</th><th>O gün</th>"));
t("hedef 2 icin 4 gün", h.includes('<td>2 kelime<span class="rec-tip">') && h.includes("<td><b>4</b> gün</td>"));
t("tarih bugün", h.includes("<td>" + fmt(keyAt(0)) + "</td>"), fmt(keyAt(0)));
t("o gün 2 kelime", h.includes("<td>" + fmt(keyAt(0)) + "</td><td>2 kelime</td>"));
t("şu an etiketi", h.includes('<span class="rec-cur">şu an</span>'));
t("hedef 5 sifir", h.includes('<td>5 kelime<span class="rec-cur">şu an</span><span class="rec-tip">bugün 2/5 · rekor için 1 gün</span></td><td><b>0</b> gün</td><td>—</td><td>—</td>'));
t("current satiri", h.includes('<tr class="current" data-rec-goal="5"'));
t("ipucu bugün 2/2, 1 gün", h.includes("bugün 2/2 · rekor için 1 gün"));
t("tablo satirinda klavye", h.includes('<tr class="current" data-rec-goal="5" role="button" tabindex="0"'));
t("tablo aria-label", h.includes('aria-label="5 kelime hedefiyle telaffuz oturumu başlat · rekor 0 gün · bugün 2/5"'));
t("tablo aria-label hedef 2", h.includes('aria-label="2 kelime hedefiyle telaffuz oturumu başlat · rekor 4 gün · bugün 2/2"'));
e.fire(["[data-rec-goal]"], "2", "app:keydown", { key: "Enter", preventDefault() {} });
t("tablo satirindan enter", e.A.innerHTML.includes('class="session"') && JSON.parse(store["sanat.v1"]).settings.pronGoal === 2);
e.fire(["[data-action]"], "quit");

console.log("F) rekor satirina tiklayinca o hedefle telaffuz oturumu");
t("satir tiklama isareti", h.includes('data-rec-goal="2"') && h.includes('data-rec-goal="5"'));
t("ok hucresi", h.includes('<td class="rec-go" aria-hidden="true">›</td>'));
e.fire(["[data-rec-goal]"], "3");
const saved = JSON.parse(store["sanat.v1"]);
t("hedef 3 kaydedildi", saved.settings.pronGoal === 3, String(saved.settings.pronGoal));
t("oturum acildi", e.A.innerHTML.includes('class="session"'));
t("sayac 1/3", e.A.innerHTML.includes('<span class="counter" aria-label="Kart 1 / 3">1/3</span>'));
t("cikis dugmesi etiketi", e.A.innerHTML.includes('aria-label="Oturumu bitir"'));
t("ilerleme cubugu", e.A.innerHTML.includes('role="progressbar" aria-label="Oturum ilerlemesi" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"'));
t("dinle dugmesi etiketi", e.A.innerHTML.includes('data-lang="fi-FI" aria-label="Kelimeyi Fince dinle"'));
t("mikrofon dugmesi etiketi", e.A.innerHTML.includes('aria-label="Mikrofonu aç ve kelimeyi Fince tekrar et"'));
t("kart sesli okuma etiketi", e.A.innerHTML.includes('aria-label="Kelimeyi Fince sesli oku"'));
t("toast hedefi söylüyor", String(e.toast.textContent).indexOf("Telaffuz hedefi 3") === 0, e.toast.textContent);
t("bugünkü kelimeler tekrar sorulmuyor", !/<h2 class="word">(hei|vesi)<\/h2>/.test(e.A.innerHTML));

e.fire(["[data-action]"], "quit");
t("cikista istatistik + tablo", e.A.innerHTML.includes('class="rec-table"') && !e.A.innerHTML.includes('class="session"'));
t("cikista ozet seridi", e.A.innerHTML.includes('id="recSummary"') && e.A.innerHTML.includes("0 doğru · 0 yanlış · %0"));
t("tekrar dugmesi", e.A.innerHTML.includes('class="rec-sum-btn" data-action="rec-again"'));
e.fire(["[data-action]"], "rec-again");
t("tekrar dugmesi oturum aciyor", e.A.innerHTML.includes('class="session"') && !e.A.innerHTML.includes('id="recSummary"'));
t("ayni hedef korunuyor", JSON.parse(store["sanat.v1"]).settings.pronGoal === 3);
e.fire(["[data-action]"], "quit");
t("tekrar sonrasi serit yenilendi", e.A.innerHTML.includes('id="recSummary"'));

console.log("G) oturum bitince otomatik istatistik + rekor tablosu");
e.fire(["[data-rec-goal]"], "2");
let guard = 0;
while (e.A.innerHTML.includes('class="session"') && guard < 12) {
  const m = e.A.innerHTML.match(/<h2 class="word">([^<]*)<\/h2>/);
  e.sr.next = m ? m[1] : "";
  e.fire(["[data-action]"], "listen");
  if (e.A.innerHTML.includes('data-action="next"')) e.fire(["[data-action]"], "next");
  guard += 1;
}
t("oturum bitti", !e.A.innerHTML.includes('class="session"'), "tur=" + guard);
t("istatistik + tablo", e.A.innerHTML.includes('class="rec-table"'));
t("ozet toast", String(e.toast.textContent).indexOf("Oturum tamam") === 0, e.toast.textContent);
const gHtml = e.A.innerHTML;
t("ozet seridi var", gHtml.includes('id="recSummary"'));
t("ozet dogru/yanlis", gHtml.includes("<b>Son oturum</b> · 2 doğru · 0 yanlış · %100"), (gHtml.match(/rec-sum-text">([^<]*)/) || [])[1]);
t("ozet sure", /rec-sum-time">\d+:\d\d</.test(gHtml), (gHtml.match(/rec-sum-time">([^<]*)/) || [])[1]);
t("serit tablonun ustunde", gHtml.indexOf('id="recSummary"') > 0 && gHtml.indexOf('id="recSummary"') < gHtml.indexOf('class="rec-table"'));
t("karsilastirma satiri var", gHtml.includes('class="rec-sum-diff"') && gHtml.includes("ort. 0:00 · ortalamayla aynı"), (gHtml.match(/rec-sum-diff">([^<]*)/) || [])[1]);

console.log("B) dün biten seri: tarih dün, ipucu 4 gün");
put(mk([].concat(dayLog(3, ["hei","vesi"]), dayLog(2, ["hei","vesi"]), dayLog(1, ["hei","vesi"])),
  { lastSeen: keyAt(0), pronBest: { "2": 3 } }));
const e1 = boot(); e1.tab("stats");
t("3 gün", e1.A.innerHTML.includes("<td><b>3</b> gün</td>"));
t("tarih dün", e1.A.innerHTML.includes("<td>" + fmt(keyAt(1)) + "</td>"), fmt(keyAt(1)));
t("ipucu bugün 0/2, 4 gün", e1.A.innerHTML.includes("bugün 0/2 · rekor için 4 gün"));

console.log("C) kırpılmış kayıt: tarih yok, ipucu 10 gün");
put(mk(dayLog(1, ["hei","vesi"]), { lastSeen: keyAt(0), pronBest: { "2": 9 } }));
const e2 = boot(); e2.tab("stats");
t("saklanan rekor 9", e2.A.innerHTML.includes("<td><b>9</b> gün</td>"));
t("tarih yerine tire", e2.A.innerHTML.includes("<td>—</td><td>—</td>"));
t("kırpılma notu", e2.A.innerHTML.includes("kırpıldığı için eski rekorların tarihi"));
t("ipucu 10 gün", e2.A.innerHTML.includes("bugün 0/2 · rekor için 10 gün"));

console.log("D) hic rekor yok");
put(mk([], { lastSeen: keyAt(0), pronBest: {} }));
const e3 = boot(); e3.tab("stats");
t("bos durum metni", e3.A.innerHTML.includes("Henüz rekor yok"));
t("tablo yok", !e3.A.innerHTML.includes('class="rec-table"'));
t("ipucu yok", !e3.A.innerHTML.includes("rec-tip"));
t("oturum listesi yok", !e3.A.innerHTML.includes('class="sessions-card"'));

console.log("E) genel saglik");
const h3 = e3.A.innerHTML;
t("div dengesi", (h3.match(/<div/g)||[]).length === (h3.match(/<\/div>/g)||[]).length);
t("yoklama yok", intervalCalls === 0, String(intervalCalls));

console.log("I) oturum suresi ortalamayla karsilastirilir");
put(mk(dayLog(0, ["hei","vesi"]), { pronBest: { "2": 1 }, pronSessions: [
  { goal: 2, secs: 100, ok: 2, bad: 0, total: 2, at: base - 2*DAY },
  { goal: 2, secs: 80, ok: 1, bad: 1, total: 2, at: base - DAY }] }));
const e7 = boot(); e7.tab("stats");
e7.fire(["[data-rec-goal]"], "2");
offset += 60000;
let g7 = 0;
while (e7.A.innerHTML.includes('class="session"') && g7 < 12) {
  const m7 = e7.A.innerHTML.match(/<h2 class="word">([^<]*)<\/h2>/);
  e7.sr.next = m7 ? m7[1] : "";
  e7.fire(["[data-action]"], "listen");
  if (e7.A.innerHTML.includes('data-action="next"')) e7.fire(["[data-action]"], "next");
  g7 += 1;
}
const i7 = e7.A.innerHTML;
t("hizli karsilastirma", i7.includes("ort. 1:30 · 30 sn hızlı"), (i7.match(/rec-sum-diff">([^<]*)/) || [])[1]);
t("kayit listeye eklendi", JSON.parse(store["sanat.v1"]).pronSessions.length === 3, String(JSON.parse(store["sanat.v1"]).pronSessions.length));

console.log("K) son 5 oturum listesi");
const many = [];
for (let kk = 0; kk < 7; kk++) many.push({ goal: 3, secs: 10 * (kk + 1), ok: kk, bad: 0, total: 3, at: base - (7 - kk) * DAY });
put(mk([], { pronSessions: many }));
const e9 = boot(); e9.tab("stats");
const k9 = e9.A.innerHTML;
t("oturum listesi var", k9.includes('class="ses-list"'));
t("bes kayit", (k9.match(/class="ses-item"/g) || []).length === 5, String((k9.match(/class="ses-item"/g) || []).length));
t("en yeni once", k9.indexOf("1:10") > 0 && k9.indexOf("1:10") < k9.indexOf("0:30"), (k9.match(/ses-time">([^<]*)/g) || []).join(","));
t("kart tablonun altinda", k9.indexOf('sessions-card') > k9.indexOf('records-card') && k9.indexOf('records-card') > 0);
t("satir hedefi isaretli", k9.includes('<li class="ses-item" data-rec-goal="3" role="button" tabindex="0" title="Bu hedefle yeniden başlat"'));
t("satir oku", k9.includes('<span class="ses-go" aria-hidden="true">›</span>'));
t("liste aria-label", k9.includes('aria-label="3 kelime hedefiyle yeniden başlat · ' + fmt(keyAt(1)) + ' · 6/3 doğru · 1:10"'), (k9.match(/aria-label="3 kelime hedefiyle[^"]*"/) || [])[0]);
e9.fire(["[data-rec-goal]"], "3");
t("listedeki hedefle oturum", e9.A.innerHTML.includes('class="session"') && JSON.parse(store["sanat.v1"]).settings.pronGoal === 3);
t("klavye erisimi", k9.includes('role="button" tabindex="0"'));
e9.fire(["[data-rec-goal]"], "4", "app:keydown", { key: "Enter", preventDefault() {} });
t("enter ile baslatma", e9.A.innerHTML.includes('class="session"') && JSON.parse(store["sanat.v1"]).settings.pronGoal === 4);
let prevented = 0;
e9.fire(["[data-rec-goal]"], "5", "app:keydown", { key: " ", preventDefault() { prevented += 1; } });
t("bosluk ile baslatma", prevented === 1 && JSON.parse(store["sanat.v1"]).settings.pronGoal === 5, "prevented=" + prevented);
e9.fire(["[data-rec-goal]"], "5", "app:keydown", { key: "a", preventDefault() { prevented += 1; } });
t("diger tuslar yok sayilir", JSON.parse(store["sanat.v1"]).settings.pronGoal === 5 && prevented === 1);
e9.fire([], "5", "app:keydown", { key: "Enter", preventDefault() { prevented += 1; } });
t("satir disinda calismaz", JSON.parse(store["sanat.v1"]).settings.pronGoal === 5 && prevented === 1);

console.log("J) daha yavas oturum");
e7.fire(["[data-action]"], "rec-again");
offset += 600000;
let g8 = 0;
while (e7.A.innerHTML.includes('class="session"') && g8 < 12) {
  const m8 = e7.A.innerHTML.match(/<h2 class="word">([^<]*)<\/h2>/);
  e7.sr.next = m8 ? m8[1] : "";
  e7.fire(["[data-action]"], "listen");
  if (e7.A.innerHTML.includes('data-action="next"')) e7.fire(["[data-action]"], "next");
  g8 += 1;
}
const j7 = e7.A.innerHTML;
t("yavas karsilastirma", j7.includes("ort. 1:20 · 520 sn yavaş"), (j7.match(/rec-sum-diff">([^<]*)/) || [])[1]);
t("J sonrasi oturum listesi", j7.includes('class="ses-list"') && (j7.match(/class="ses-item"/g) || []).length === 4, String((j7.match(/class="ses-item"/g) || []).length));
t("kayit sinirli", JSON.parse(store["sanat.v1"]).pronSessions.length === 4, String(JSON.parse(store["sanat.v1"]).pronSessions.length));
offset = 0;


console.log("M) telaffuz oturumu ekran okuyucu etiketleri");
const m7 = mk([]);
const e8 = boot(m7);
e8.fire(["[data-mode]"], "telaffuz");
const s8 = e8.A.innerHTML;
t("M oturum acildi", s8.includes('class="session"'));
t("M ilerleme cubugu", s8.includes('role="progressbar" aria-label="Oturum ilerlemesi"'), (s8.match(/<div class="bar"[^>]*>/) || [])[0]);
t("M sayac etiketi", /aria-label="Kart 1 \/ \d+">1\//.test(s8), (s8.match(/aria-label="Kart [^"]*"/) || [])[0]);
t("M dinle etiketi", s8.includes('aria-label="Kelimeyi Fince dinle"'));
e8.sr.next = "";
e8.fire(["[data-action]"], "listen");
const s9 = e8.A.innerHTML;
t("M sonuc rol status", /role="status" aria-live="polite" aria-label="Tanıma sonucu yüzde \d+"/.test(s9), (s9.match(/<div class="score[^>]*>/) || [])[0]);
t("M mikrofon kilitli", s9.includes('aria-label="Mikrofonu aç ve kelimeyi Fince tekrar et"') && /data-action="listen" disabled/.test(s9));
t("M devam dugmesi", s9.includes('data-action="next"'));
e8.fire(["[data-action]"], "quit");

console.log("N) kart modu ekran okuyucu etiketleri");
const n8 = mk([]);
const e10 = boot(n8);
e10.fire(["[data-mode]"], "kart");
const n9 = e10.A.innerHTML;
t("N kart kapali kisayol ipucu", n9.includes('class="kbd-hint"') && n9.includes("<kbd>Tab</kbd> Cevabı göster"), (n9.match(/<p class="kbd-hint">.*?<\/p>/) || [])[0]);
t("N kart oturumu", n9.includes('class="session"'));
t("N sayac", /aria-label="Kart 1 \/ \d+">1\//.test(n9), (n9.match(/aria-label="Kart [^"]*"/) || [])[0]);
t("N ilerleme cubugu", n9.includes('role="progressbar" aria-label="Oturum ilerlemesi"'));
t("N sesli okuma dili", /aria-label="Kelimeyi (Fince|Türkçe) sesli oku"/.test(n9), (n9.match(/aria-label="Kelimeyi [^"]*"/) || [])[0]);
t("N cevabi goster", n9.includes('data-action="reveal"'));
e10.fire(["[data-action]"], "reveal");
const n10 = e10.A.innerHTML;
t("N puanlama kisayol ipucu", n10.includes("<kbd>Tab</kbd> puanla") && n10.includes("<kbd>Enter</kbd> onayla"), (n10.match(/<p class="kbd-hint">.*?<\/p>/) || [])[0]);
t("N cevap acildi", n10.includes('class="answer"'));
t("N puan dugmeleri", n10.includes('aria-label="Bilmedim: kelimeyi hiç hatırlamadım"') &&
  n10.includes('aria-label="Zor: zor hatırladım"') &&
  n10.includes('aria-label="İyi: iyi hatırladım"') &&
  n10.includes('aria-label="Kolay: kolay hatırladım"'));
t("N puan grubu", n10.includes('role="group" aria-label="Kendini puanla"'));
e10.fire(["[data-grade]"], "2");
t("N sonraki karta gecti", /aria-label="Kart 2 \/ \d+">2\//.test(e10.A.innerHTML), (e10.A.innerHTML.match(/aria-label="Kart [^"]*"/) || [])[0]);
e10.fire(["[data-action]"], "quit");

console.log("O) test modu ekran okuyucu etiketleri");
const o8 = mk([]);
const e11 = boot(o8);
e11.fire(["[data-mode]"], "test");
const o9 = e11.A.innerHTML;
t("O test kisayol ipucu", o9.includes("<kbd>Tab</kbd> seçenekler") && o9.includes("<kbd>Enter</kbd> seç"), (o9.match(/<p class="kbd-hint">.*?<\/p>/) || [])[0]);
t("O test oturumu", o9.includes('class="session"'));
t("O secenek grubu", o9.includes('role="group" aria-label="Seçenekler"'));
const optMatch = o9.match(/data-opt="([^"]+)"[^>]*aria-label="([^"]+)"/);
t("O secenek etiketi", !!optMatch && /^A seçeneği: /.test(optMatch[2]), optMatch ? optMatch[2] : "yok");
e11.fire(["[data-opt]"], optMatch ? optMatch[1] : "");
const o10 = e11.A.innerHTML;
t("O kilitliyken kisayol ipucu", o10.includes("<kbd>Enter</kbd> sonraki kart"), (o10.match(/<p class="kbd-hint">.*?<\/p>/) || [])[0]);
t("O geri bildirim etiketi", /aria-label="[A-D] seçeneği: [^"]* · (doğru|yanlış) cevap"/.test(o10), (o10.match(/aria-label="[A-D] seçeneği[^"]*"/g) || []).join(" | "));
t("O devam dugmesi etiketi", o10.includes('aria-label="Sonraki karta geç"'));
e11.fire(["[data-action]"], "quit");

console.log("P) yazma modu ekran okuyucu etiketleri");
const p8 = mk([]);
const e12 = boot(p8);
e12.fire(["[data-mode]"], "yaz");
const p9 = e12.A.innerHTML;
t("P yazma oturumu", p9.includes('class="session"') && p9.includes('id="typeInput"'));
t("P girdi etiketi", /aria-label="(Türkçe|Fince) karşılığını yaz"/.test(p9), (p9.match(/aria-label="(?:Türkçe|Fince) karşılığını yaz"/) || [])[0]);
t("P kontrol dugmesi", p9.includes('aria-label="Cevabı kontrol et"'));
t("P kisayol ipucu", e12.A.innerHTML.includes('class="kbd-hint"') && e12.A.innerHTML.includes("<kbd>Enter</kbd> cevabı kontrol et"));
const pLang = p9.match(/data-lang="(tr-TR|fi-FI)"[^>]*aria-label="Kelimeyi (Fince|Türkçe) sesli oku"/) || [];
t("P sesli okuma dili tutarli", pLang.length === 3 && ((pLang[1] === "fi-FI") === (pLang[2] === "Fince")), pLang[0]);
e12.fire(["[data-action]"], "check");
t("P bos cevapta uyari", String(e12.toast.textContent).includes("Önce bir cevap yaz") && !e12.A.innerHTML.includes("typeFeedback"));
global.document.getElementById("typeInput").value = "zzz";
e12.fire(["[data-action]"], "check");
const p10 = e12.A.innerHTML;
t("P yanlis cevap geri bildirimi", p10.includes('role="status" aria-live="polite" aria-atomic="true"') && p10.includes("Doğrusu: <b>"));
t("P girdi geri bildirime bagli", p10.includes('aria-describedby="typeFeedback"'));
t("P devam dugmesi etiketi", p10.includes('aria-label="Sonraki karta geç"'));
t("P kilitliyken kisayol ipucu", p10.includes("<kbd>Enter</kbd> sonraki kart"));
e12.fire(["[data-action]"], "quit");

console.log("\nSONUC: " + ok + " gecti, " + fail + " basarisiz");
process.exit(fail ? 1 : 0);
