# Sanat — kişisel Fince ↔ Türkçe çalışma uygulaması

Tek dosyalık, bağımlılıksız bir web uygulaması. Sunucu, hesap, ağ isteği yok;
tüm ilerleme tarayıcının `localStorage` alanında (`sanat.v1` anahtarı) tutulur.

## Çalıştırma

Herhangi bir statik sunucu yeterli:

```bash
python3 -m http.server 3000 --bind 0.0.0.0
# sonra: http://localhost:3000
```

`index.html` doğrudan çift tıklanarak da açılır; ancak bazı tarayıcılar
`file://` altında modül/CSP kısıtları uygulayabilir, sunucu daha güvenli.

## Testler

`tests/` altında iki bağımlılıksız test dosyası var:

| Dosya | Kapsam |
|---|---|
| `smoke.test.js` | genel paket (105 kontrol): SRS/Leitner, seri ve rekor tablosu, oturum akışı, dört modun ekran okuyucu etiketleri, klavye ipucu |
| `kbd-hint.test.js` | klavye ipucu odaklı paket (9 kontrol): ipucunun moda ve cevap durumuna göre değişmesi |

Hepsi birlikte, tek komut:

```bash
cd sanat
npm test            # = node tests/run.js
```

`package.json` yalnızca bu komutu tanımlar; bağımlılık yok, `npm install`
gerekmez (`npm test` doğrudan yerel Node'u kullanır). Tek tek de koşulur
(`node tests/smoke.test.js`, `node tests/kbd-hint.test.js`).
Runner dosyaları ayrı süreçlerde çalıştırır ve herhangi biri başarısızsa 1 ile
çıkar. Testler `data.js` ve `app.js`'i küçük bir DOM taklidiyle (`document`,
`localStorage`, `Date`, `SpeechRecognition`) yükler; gerçek tarayıcı, mikrofon
ya da ağ gerekmez ve üretilen HTML denetlenir — duyuru ve görünüm değil.

## Arayüz turu

Ekran görüntüsü yerine: tek sütun, üstte üst bar, altta dört sekmeli sabit
çubuk. Aşağıdaki sıra telefonda yukarıdan aşağıya kaydırma sırasıdır.

```text
üst bar:        S Sanat · [alev] 3 (günlük seri)
sekme içeriği:  seçili sekmenin ekranı, kaydırılır
alt sekmeler:   [kart] Çalış · [liste] Liste · [ampul] İpuçları · [çubuk] İstatistik
```

- **İkonlar** — arayüzdeki simgeler emoji değil. `index.html` gövdesinin başında
  gizli bir `<svg class="svg-sprite">` durur; içinde **10 `<symbol>`** var:
  `i-study`, `i-list`, `i-tips`, `i-stats`, `i-flame`, `i-speaker`, `i-mic`,
  `i-kart`, `i-test`, `i-yaz`. Hepsi 24×24 kutuda, 1.5 px çizgi, `fill: none`.
  Sayfada `<svg class="ico"><use href="#i-…"/></svg>` ile kullanılır; renk
  `currentColor` olduğu için ikon bulunduğu metnin rengini alır. Tek tanım, tek
  stil dosyası — ek ikon dosyası, ikon fontu ya da ağ isteği yok. Bütün simgeler
  `aria-hidden="true" focusable="false"` taşır: ekran okuyucu simgeyi okumaz,
  anlamı etiket ve `aria-label` verir.
- **Alt sekme çubuğu** — sayfanın altında sabit; kıl üst çizgi, buzlu cam zemin.
  Her sekmede 20×20 ikon ve `10.5px` etiket, düğme en az **48 px** yüksek
  (dokunma hedefi). Aktif sekme ladin renginde ve kalın, ikonunun altında
  **2 px alt çizgi** gösterir; pasif sekmeler soluk. Sekme değişince yalnızca
  içerik yenilenir, çubuk yerinde kalır ve `#srStatus` "Liste sekmesi" der.
- **Çalış** — halka `12/20` bugünkü hedefi gösterir; altında "5 kart tekrar
  bekliyor" ve `Seri: 3 gün · Öğrenilen: 41/599`. Üç mini kutu tekrar / yeni /
  öğrenildi sayısını verir. Zayıf telaffuz listesi varsa burada çıkar
  (kelimeye dokunup tek başına çalışılır). **Çalışma modu**: dört satır — solunda
  22×22 çizgi ikon, sağında başlık ve açıklama: **Kart** (kart ikonu, "Çevir,
  kendini puanla"), **Test** (onay işareti, "4 seçenekten bul"), **Yazma**
  (klavye, "Karşılığını yaz"), **Telaffuz** (mikrofon, "Dinle, tekrar et, puan
  al"). Altında "Serbest tekrar (10 kart)" ve **Çeviri yönü**
  (`FI → TR` / `TR → FI` / `Karışık`).
- **Liste** — `Fince veya Türkçe ara…` kutusu, `Tümü` + `Zayıf telaffuz (N)`
  + kategori çipleri, altında Fince–Türkçe satırları.
- **İpuçları** — "Fince'yi Türkçe bilen biri olarak öğrenmek": ortak noktalar,
  zor gelen üç konu, **Öğrenme yolu** (dört aşamaya bölünmüş 34 ders, Türkçe
  başlık + Fince terim), telaffuz kısa rehberi, telaffuz alıştırması ve sözlük.
  Öğrenme yolunda uygulamada kategori karşılığı olan 10 ders birer düğme:
  dokununca o kategorinin kelimeleriyle **Kart** oturumu başlar (sağında kaç
  kelime olduğu yazar). Gramer dersleri düz metin kalır — olmayan bir şeye
  dokunulabilir görünümü verilmez.
  Öğrenme yolunun sırası Argutina-Islamaeva'nın *Suomen kieltä itseopiskeluun*
  (Petroskoi 2019) kitabının birinci bölümünden; ders metinleri değil yalnızca
  konu sırası alındı, başlıklar Türkçeleştirildi.
- **İstatistik** — üstte seri / öğrenildi / doğruluk, ikinci satırda toplam
  cevap / görülen kelime / bugün tekrar; sonra **Son 7 gün** grafiği,
  **Telaffuz eğilimi**, **Telaffuz hedefi** (rekor tablosu + Son oturumlar),
  **En çok zorlanan 5 kelime**, **Kategori ilerlemesi** ve **Ayarlar**
  (günlük hedef, yedek al/yükle).
- **Oturum ekranı** — üstte `Oturumu bitir` (✕ bir metin karakteri, ikon değil),
  ilerleme çubuğu ve `Kart 2 / 20`,
  hemen altında moda göre değişen tek satırlık klavye ipucu
  (`Enter cevabı kontrol et · Tab ile gezin` gibi);
  ortada kart (kategori çipi + soru). Mod ekleri: Kart'da `Cevabı göster` ve
  dört puanlama düğmesi, Test'te `A–D` seçenekleri, Yazma'da metin kutusu +
  `Kontrol et`, Telaffuz'da hoparlör ikonlu **Dinle** ve mikrofon ikonlu
  **Tekrar et**. Kartın üstündeki sesli okuma düğmesi de aynı hoparlör
  ikonunu taşır. Cevaptan sonra `Devam →`.
  Bitince `Oturum tamam` özeti ve `Yeni oturum` düğmesi gelir.
- **Emojinin kaldığı yerler** — arayüzdeki bütün simgeler çizgi ikon; yalnızca
  metin içindeki süs emojileri kaldı: kutlama `🎉`, parıltı `✨`, "hedef tutuldu
  `✓`" ve en uzun seri rozeti `🏆`. Kelime satırlarının sağındaki sesli okuma
  düğmesi de (`.icon-btn`, 18×18 hoparlör) sprite'tan gelir. İpuçları
  sekmesindeki telaffuz paragrafı da emoji yerine aynı sprite'tan gelen hoparlör
  ve mikrofon ikonlarıyla **Dinle** ve **Tekrar et** düğmelerini anıyor
  (`ico(…, "ico-inline")` ile satır içi; `1.2em` ladin renk, 1.9 px çizgi,
  `aria-hidden`). İkon ile düğme adı `.ico-pair` içinde `white-space: nowrap`
  ile bağlı, böylece satır sonunda ikon etiketinden kopmuyor.

## Klavye kısayolları

| Tuş | Nerede | Etki |
|---|---|---|
| Tab / Shift+Tab | her yerde | düğme ve satırlar arasında gezinme; odak halkası görünür kalır |
| Enter | rekor tablosu ya da Son oturumlar satırında | o hedefle telaffuz oturumu başlat |
| Boşluk | aynı satırlarda | Enter ile aynı |
| Enter | Yazma modunda, cevap henüz kilitlenmemişken | `Kontrol et` |
| Enter | oturum kilitliyken (cevap verildi) | sonraki kart |
| Enter / Boşluk | odaktaki düğmede | düğmeyi çalıştırır (tarayıcı varsayılanı) |

Aynı ipucu yalnızca README'de kalmaz: oturum ekranında, ilerleme çubuğunun
altında soluk tek satır olarak görünür ve moda göre değişir (yazmada
`Enter cevabı kontrol et`, cevap verildikten sonra `Enter sonraki kart`,
testte `Tab seçenekler`, kart/puanlamada `Tab puanla`).

Harf kısayolu yok; oturum ekranı tek Enter ile ilerler. Rekor tablosu, Son
oturumlar ve zayıf telaffuz çipleri Tab ile gezilir. Etiketlerin ekran
okuyucudaki karşılıkları için: **Erişilebilirlik**.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `index.html` | iskelet, ikon sprite'ı (`<symbol>` ×10), üst bar, alt sekmeler |
| `styles.css` | mobil öncelikli kâğıt zeminli açık tema (Paper & Ink) |
| `data.js` | kelime listesi (`WORDS`) — düzenlenecek tek yer |
| `app.js` | SRS, oturum akışı, ekranlar, yedekleme |
| `tests/` | bağımlılıksız testler: `smoke.test.js`, `kbd-hint.test.js`, `run.js` |
| `package.json` | yalnızca `npm test` → `node tests/run.js`; bağımlılık yok |

## Kelime ekleme

`data.js` içine tek satır:

```js
{ fi: "kiitos", tr: "teşekkürler", cat: "Selamlaşma", note: "isteğe bağlı" },
```

Kurallar:

- `fi` benzersiz olmalı (kart anahtarıdır).
- `tr` içinde ` / ` ile alternatif yazılabilir: `"ev / yuva"`; yazma modunda
  alternatiflerin hepsi doğru kabul edilir.
- Yeni `cat` değeri kendiliğinden filtre çubuğuna eklenir.

## Tekrar algoritması

Leitner kutuları + aralık tablosu (`INTERVALS`, gün):

| Kutu | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Aralık | 1 | 3 | 7 | 16 | 40 | 90 |

- **Bilmedim** → kutu 1, kart 10 dakika sonra tekrar.
- **Zor** → kutu korunur, aralık yarıya iner.
- **İyi** → kutu +1, **Kolay** → kutu +2.
- `box >= 4` olan kelime "öğrenildi" sayılır.

Günlük hedef (varsayılan 20) hem tekrar hem yeni kart sayısını sınırlar;
hedef dolduğunda "Serbest tekrar" ile rastgele 10 kart çalışılabilir.

## Telaffuz modu

Kartın üstünde Fince kelime, altında Türkçe anlamı görünür:

1. **Dinle** (hoparlör ikonu) — `speechSynthesis` ile `fi-FI` telaffuz.
2. **Tekrar et** (mikrofon ikonu) — mikrofon açılır, `SpeechRecognition`
   (`fi-FI`) dinler.
3. Puan = `1 - levenshtein/max(uzunluk)`, `fold()` ile aksan ve büyük/küçük
   harf farkı yok sayılır. %85+ "iyi", %60–84 "yakın", altı "zayıf".
4. Puan SRS'e işlenir (85+ → Kolay, 60–84 → İyi, altı → Bilmedim).

Tarayıcı `SpeechRecognition` desteklemiyorsa (Firefox, Safari) mikrofon düğmesi
uyarı verir; o durumda dinle + kendini puanla akışı kullanılır.

## Zayıf telaffuz listesi

Puanı %60'ın altında kalan her kelime `state.pron` içine `{ last, tries }`
olarak yazılır; %60 ve üzeri puan alan kelime listeden çıkar. Liste üç yerden
erişilebilir:

- **Çalış ekranı kartı** — en zayıf 12 kelime puanlarıyla. Bir kelimeye
dokunmak yalnızca o kelimeyle telaffuz oturumu başlatır.
- **Sadece bunlarla çalış (N)** — tek dokunuşta yalnızca zayıf kelimelerden,
en zayıftan başlayarak telaffuz oturumu açar.
- **Liste sekmesi → Zayıf telaffuz** filtresi — aynı kelimeleri puan rozetiyle
gösterir; arama ve Fince sesli okuma burada da çalışır.

Liste boşken çalış ekranında kart görünmez; "Listeyi temizle" kayıtları siler.

## Telaffuz eğilimi (İstatistik sekmesi)

Her mikrofon ölçümü `state.pronLog` içine `{ fi, score, at }` olarak yazılır
(son 400 kayıt tutulur, yedeğe dahildir). Buradan üç şey hesaplanır:

- **Son 7 gün ortalaması** — 7 günlük penceredeki tüm puanların ortalaması ve
günlük ortalama sütun grafiği (ölçüm olmayan günler soluk çubuk).
- **Değişim** — son 7 günün ortalaması ile önceki 7 günün ortalaması
karşılaştırılır; önceki haftada kayıt yoksa karşılaştırma yapılmaz.
- **En çok zorlanan 5 kelime** — kelime başına ortalama puan (en düşük önce),
ölçüm sayısıyla. Satıra dokunmak o kelimeyle telaffuz oturumu başlatır.

Ölçüm yokken kart yerine "Telaffuz modunu aç" düğmesi görünür. Bir kelime
zayıf listeden çıksa bile geçmiş puanları eğilim grafiğinde kalır.

## Günlük telaffuz hedefi

`settings.pronGoal` (varsayılan **5**, 1–50 arası, İstatistik → Ayarlar):

Hedef **farklı kelime sayısı** üzerinden ölçülür: bir gün içinde aynı kelimeyi
kaç kez denersen dene sayaçta **bir kez** görünür (günlük `fi` tekilleştirmesi).

- **Bugünkü farklı kelime** kartı bugünkü benzersiz kelime sayısını `3 / 5`
  olarak gösterir; hedef tutulduysa rozet yeşile döner.
- **7 günlük hedef grafiği** her günün farklı kelime sayısını çubuk olarak
  verir; hedefe ulaşan günlerin çubukları yeşil, ulaşmayanlar mavi kalır.
  Hedef, kesikli "hedef N" çizgisiyle işaretlenir (çubuk ölçeği hedefe göre
  kurulur).
- "Hedefi tuttuğun gün: 2/4" ifadesi, ilk ölçümden bugüne kadarki günleri
  payda alır — uygulamaya yeni başlayan biri geçmiş boş günlerle cezalanmaz.
- **Seri** — hedefi üst üste tutturduğun gün sayısı (🔥) ve en uzun seri
  (🏆). Bugün henüz tutulmadıysa güncel seri dünden geriye sayılır, yani gün
  bitmeden sıfırlanmaz; altında "Bugün henüz tutulmadı" notu çıkar.
- **Güncel seri de kalıcıdır** (`state.pronRun`, hedef başına
  `{ days, last }`). Her açılışta ve her ölçümde tazelenir: hedef tutulan
  günde +1, hedefin tutturulmadığı bir gün geçince sıfır. `pronLog` kırpılsa
  bile seri kesilmez — yalnızca gerçekten kaçırılan gün sıfırlar.
- **Gece yarısı tazeleme** — yoklama yok: bir sonraki yerel gece yarısına
  (00:00:01) **tek bir `setTimeout`** kurulur, tetiklenince gün kontrol edilip
  yenisi planlanır. Sekme görünürlüğü ve pencere odağı yalnızca yedek
  tetikleyicidir (cihaz uykusu/saat değişimi için) ve onlar da zamanlayıcıyı
  yeniden kurar. Gün değişince seri, rekor ve hedef kartı kendiliğinden
  tazelenir. Bir oturum sürüyorsa ekran bozulmaz: veri arka planda güncellenir,
  görünüm oturum bitince (ya da bir sonraki çizimde) güncel hâliyle gelir.
- **Gün notu** — gün döndüğünde hedef kartının üstünde bir kez "Gün sıfırlandı"
  şeridi çıkar: "Dün hedef tutuldu: 4 farklı kelime · seri 3 gün" ya da
  "Dün hedef tutulmadı (2 / 5) · seri sıfırlandı". Not **gün boyu kalır**:
  ölçüm yapmak onu kaldırmaz; yalnızca ✕ düğmesi veya gün değişimi
  kaldırır. Uygulama kapalıyken gece yarısı geçtiyse `lastSeen`
  karşılaştırmasıyla açılışta üretilir. Aynı şerit **çalış
  ekranında** da (mod kartlarının hemen üstünde) görünür, böylece oturuma
  başlamadan dünkü durumu hatırlatır; kapatınca iki yerden birlikte kalkar.
- **Dünkü kelimeler dokunulabilir** — notun içinde dünkü telaffuz
  denemeleri (en fazla 8, puanlarıyla) çip olarak listelenir; çipe dokunmak
  o kelimeyle tek kartlık telaffuz oturumu açar. Alttaki düğme dünün
  **%60 altı** kelimelerinden oturum başlatır; hiç zayıf yoksa dünkü tüm
  kelimelerle çalışır ("Dünün kelimeleriyle çalış (N)"). Dün hiç ölçüm
  yoksa çip ve düğme çıkmaz.
- **Bugünün canlı durumu** — notun içinde dünkü özetin altında `2 / 5`
  rozeti ve "bugün farklı kelime" satırı durur; sayı bugünün **farklı**
  kelime sayısıdır (dünkü sayımdan bağımsız, aynı kelimeyi tekrar ölçmek
  artırmaz). Hedef tutulduğunda rozet yeşile döner, yanına
  "hedef tutuldu ✓" yazar; hiç ölçüm yoksa kırmızı, hedefe yaklaşırken
  sarı kalır. Değer her çizimde yeniden hesaplandığı için oturumdan
  dönüşte / sekme değişiminde kendiliğinden güncellenir.
- **Kutlama** — hedefi gün içinde **ilk kez** tuttuğun ölçümde kısa bir
  toast çıkar ("🎉 Hedef tutuldu: 3 / 3 farklı kelime") ve üst bardaki
  seri sayacı iki kez yeşil nabız atar. Günde bir kez tetiklenir: aynı
  gün sonraki ölçümler tekrar kutlama göstermez, hedefi sonradan
  düşürmek de kutlamayı yeniden başlatmaz. Ayrıca bugün hedef
  tutulduysa hedef kartındaki "🔥 N gün üst üste" rozeti yeşil kenarlıkla
  durur.
  Kutlama **gün notuna bağlıdır**: ölçüm yapılırken not ekranda olmadığı
  için parıltı ertelenir ve notun (çalış ekranı veya hedef kartı) bir
  sonraki çiziminde oynar — şerit 1,6 sn yeşil kenarlıkla parlar, başlığı
  yeşile döner ve "hedef tutuldu ✓" yanında ✨ doğar. Notu daha önce ✕
  ile kapattıysan parıltı gösterilmez; bekleyen kutlama gün dönünce
  sıfırlanır, yeni günün notuna taşınmaz.
  Hedef tutulduğu sürece notta bir özet satırı durur:
  `bugün 5 farklı kelime · seri 3 gün · rekor 7`. Bugünkü seri, **bugün
  hariç** geçmişin en uzun serisini geçtiyse yanına altın renkli
  **yeni rekor** rozeti eklenir; rekoru sadece eşitlemek rozeti
  göstermez. Rekoru kıran ölçümde toast tek seferde hem hedefi hem rekoru
  söyler ("🎉 Hedef tutuldu: 4 / 5 · 🏅 yeni rekor 6 gün"); nota
  dönüldüğünde rozet iki kez altın renkte parlar. Rekor kırılmadıysa
  toast eski metninde kalır ve rozet parlamaz.
- **Rekor tablosu** — İstatistik'te hedef başına bir satır: en uzun seri,
  serinin en son günü ("kırıldığı gün") ve o günkü farklı kelime sayısı
  (`bugünün hedefi` satırı "şu an" etiketiyle işaretlenir). Satırlar
  `state.pronBest` anahtarlarından ve bugünkü hedeften üretilir; seri ve
  tarih `pronLog`'dan yeniden kurulur. `pronLog` 400 kayıtta kırpıldığı
  için eski bir rekorun tarihi doğrulanamıyorsa tablo yalnız sayıyı
  gösterir, tarih ve kelime sütunu `—` kalır ve altında kırpılma notu
  çıkar.
  Her satırın altında küçük bir ipucu var: `bugün X/Y · rekor için N gün`.
  `X/Y` bugün o hedefe sayılan farklı kelime, `N` ise bugünün serisi
  hesaba katıldığında rekoru kırmak için gereken toplam gün sayısı
  (`rekor + 1 - bugünkü seri`, en az 1) — bugün hedef tutulmadıysa
  bugün de o günlerin içinde sayılır.
  Satıra tıklamak telaffuz hedefini o değere alır ve hemen `hedef`
  kelimelik bir telaffuz oturumu başlatır: önce bugün sayılmamış zayıf
  telaffuzlular, sonra hiç çalışılmamış/az çalışılmış kelimeler; havuz
  hedefe yetmezse bugün çalışılanlarla tamamlanır.
  Oturum bitince (ya da ✕ ile çıkılınca) uygulama otomatik olarak
  İstatistik sekmesine döner ve rekor tablosunu görünür alana kaydırır;
  özet toast'ta kalır (`Oturum tamam · X/Y doğru`) ve tablonun üstünde
  kısa süreli bir özet şeridi görünür: doğru/yanlış sayısı, başarı yüzdesi
  ve oturum süresi (`0:42`). Şeridin sonundaki küçük **Tekrar** düğmesi aynı
  hedefle yeni bir telaffuz oturumu başlatır (hedef ayarı değişmez).
  Şerit ~9 saniye sonra kendiliğinden kaybolur,
  kaydırılmaz ve yenilemede geri gelmez. Başka yerlerden başlatılan
  oturumlar eskisi gibi ana ekrana döner.
  Sürenin altında son 5 oturumun ortalamasıyla karşılaştırma yazar
  (`ort. 1:30 · 30 sn hızlı` / `… yavaş` / `… ortalamayla aynı`); ilk
  oturumda `ilk ölçüm · ortalama oluşuyor` görünür. Süreler yalnızca
  rekor tablosundan başlatılan oturumlar için `state.pronSessions`'da
  tutulur (en fazla 40 kayıt) ve yeniden başlatmada korunur.
  İstatistik'teki **Son oturumlar** kartı aynı kayıtlardan en yeni 5'ini
  listeler: tarih, hedef, doğru/total ve süre. Kayıt yoksa kart çizilmez.
  Satıra dokunmak rekor tablosundaki gibi çalışır: o hedef telaffuz hedefi
  yapılır ve hemen o hedefle bir oturum açılır (`data-rec-goal`).
- **Kalıcı rekor** — en uzun seri `state.pronBest` içinde **hedef başına**
  saklanır (`{ "5": 12 }` gibi) ve her ölçümde güncellenir. `pronLog`
  400 kayıtta kırpılsa, eski günler düşse bile bu değer azalmaz; hedefi
  değiştirmek o hedefin kendi rekorunu gösterir.
- Hiç ölçüm yokken grafik boş çizilir ve "Henüz ölçüm yok" notu görünür.

"Telaffuz eğilimi" kartındaki ortalama ise **ölçüm** bazlıdır (her deneme
sayılır); hedef ise **kelime çeşitliliğini** ödüllendirir. İki metrik bilinçli
olarak ayrı tutuldu.

## Erişilebilirlik

Klavye ve ekran okuyucu desteği ayrı bir katman değil; aynı DOM, aynı
düğmeler. Dört modun oturum ekranı, rekor tablosu ve Son oturumlar listesi
aynı dili konuşur.

- **Satırlar klavyeden çalışır** — rekor tablosu ve Son oturumlar satırları
  `role="button"` + `tabindex="0"` taşır; Tab ile odaklanıp **Enter** ya da
  **boşluk** ile o hedefle oturum başlar. Odak halkası görünür kalır
  (`tr[data-rec-goal]:focus-visible`, `.ses-item:focus-visible`), fare
  tıklamasında çizilmez.
- **Satır etiketleri tek cümle** — ekran okuyucu hücreleri tek tek okumaz:
  `2 kelime hedefiyle telaffuz oturumu başlat · rekor 4 gün · bugün 2/2`
  ya da `3 kelime hedefiyle yeniden başlat · 04.11.2026 · 2/3 doğru · 1:05`.
- **Oturum ekranı** — ✕ `Oturumu bitir`; ilerleme çubuğu `role="progressbar"`
  (`aria-valuemin/max/now`); sayaç `Kart 2 / 3`; "Devam" `Sonraki karta geç`.
- **Sesli okuma** — hoparlör düğmesinin etiketi yöne göre
  `Kelimeyi Fince sesli oku` / `Kelimeyi Türkçe sesli oku`; telaffuz panelinde
  `Kelimeyi Fince dinle`. İkon `aria-hidden` olduğu için etiket tek başına yeter.
- **Telaffuz** — mikrofon düğmesi `Mikrofonu aç ve kelimeyi Fince tekrar et`;
  "Dinliyorum…" ve tanıma sonucu `role="status"` + `aria-live="polite"` ile
  duyurulur.
- **Test** — seçenek grubu `Seçenekler`, her şık `A seçeneği: …`; cevaptan
  sonra doğru şık `· doğru cevap`, seçilen yanlış şık `· yanlış cevap` ekini
  alır.
- **Puanlama** — `Bilmedim: kelimeyi hiç hatırlamadım`, `Zor: zor
  hatırladım`, `İyi: iyi hatırladım`, `Kolay: kolay hatırladım`; grup
  `Kendini puanla`.
- **Yazma** — girdi `Türkçe/Fince karşılığını yaz`; cevap verildikten sonra
  `aria-describedby="typeFeedback"` ile geri bildirime bağlanır, "Kontrol et"
  düğmesi `Cevabı kontrol et`. Geri bildirim kutusu `role="status"` +
  `aria-live="polite"` + `aria-atomic="true"`.
- **Duyurular tek satır** — `<main>` canlı bölge değil. Kart değişimi,
  cevabın açılması, test sonucu, oturum özeti ve sekme geçişi yalnızca
  `#srStatus` üzerinden duyurulur (`role="status"`, `aria-live="polite"`,
  `aria-atomic="true"`, `.sr-only`); böylece her puanlamada tüm ekran yeniden
  okunmaz.
- **Sınır** — bu etiketler DOM taklidi testleriyle doğrulanır; gerçek ekran
  okuyucu ve sesli okuma davranışı tarayıcıda denenmelidir.

### Elle test — ekran okuyucu

Aşağıdaki adımlar gerçek tarayıcıda, ekran okuyucu açıkken denenir; sağ
sütundaki metin `#srStatus` bölgesinden **birebir** duyulmalıdır (NVDA +
Firefox/Chrome, VoiceOver + Safari, TalkBack + Chrome).

| Yapılan | Beklenen duyuru |
|---|---|
| Sayfa açılır | sessiz |
| Çalış → Kart | `Kart 1/20 · Fince: hei` |
| Cevabı göster | `Kart 1/20 · Fince: hei · Türkçe: merhaba` |
| Puanla (Tab + Enter) | sonraki kart, kendi kelimesiyle |
| Test → şık seç | `… · doğru: merhaba` ya da `… · yanlış, doğrusu: merhaba` |
| Yazma → Kontrol et | yalnız geri bildirim kutusu; cümle bir kez |
| Son kart → Enter | `Oturum tamam · 20 kart · 16 doğru · 4 yanlış` |
| Sekme değiştir | `Liste sekmesi` |

Ek kontroller: gezinti modunda sayfa kendiliğinden okunmamalı; her
puanlamadan sonra tek satır gelmeli; hızlı Enter'larda son kartın metni doğru
olmalı. Aynı metinli iki kart üst üste gelirse bazı ekran okuyucular ikinci
anonsu atlar — bilinen sınır.

## Gizlilik

Analiz edilen Android uygulamasındaki izin setiyle karşılaştırma:

| Android izni | Burada |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | yok — hiçbir ağ çağrısı yok |
| `AD_ID`, `ACCESS_ADSERVICES_*` | yok — reklam/izleme yok |
| `com.android.vending.BILLING` | yok — ücretsiz, IAP yok |
| `ACCESS_FINE_LOCATION` | yok |
| `RECORD_AUDIO` | isteğe bağlı — yalnızca "Tekrar et" düğmesine basınca; kayıt tutulmaz |
| `READ/WRITE_EXTERNAL_STORAGE` | yok — yalnızca localStorage |
| `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE` | yok — arka plan servisi yok |

Tek "dışa çıkış": sesli okuma için tarayıcının `speechSynthesis` API'si
(isteğe bağlı; ses paketi cihazda yoksa sessizce devre dışı kalır) ve
"Yedek al" ile kullanıcının kendi indirdiği JSON dosyası.

Telaffuz modundaki mikrofon isteğe bağlıdır ve yalnızca düğmeye basınca açılır;
ses kaydedilmez, dosyaya yazılmaz. Tanıma `SpeechRecognition` API'siyle yapılır
ve tarayıcıya göre ses bir bulut servisine gönderilebilir (Chrome'da Google).
Mikrofonu hiç kullanmamak uygulamanın geri kalanını etkilemez.

## Veri yedeği

İstatistik sekmesi → **Yedek al** bir JSON indirir; **Yedek yükle** aynı
dosyayı geri yükler (mevcut ilerlemenin üzerine yazar).
