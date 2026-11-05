# Suomi–Türkçe · kişisel dil uygulaması

Fince ↔ Türkçe çalışan, tarayıcıda tamamen yerel olarak çalışan aralıklı tekrar (SRS) uygulaması.
Hesap yok, sunucu yok, ağ isteği yok: ilerleme `localStorage` içinde tutulur.

[![Testler](https://github.com/tnygnz/suomi-tr-app/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/tnygnz/suomi-tr-app/actions/workflows/test.yml)

## Çalıştırma

Derleme adımı ve bağımlılık yoktur; dosyaları herhangi bir statik sunucudan servis etmek yeterlidir:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
# http://localhost:4173
```

`file://` ile açmak da mümkündür, ancak ES modülleri nedeniyle tarayıcıya göre CORS kısıtları çıkabilir;
statik sunucu önerilir.

## Testler

Yazma modu ve ek tekrar mantığı için jsdom tabanlı testler `tests/run.mjs` içinde durur.
Uygulamanın kendisi bağımlılıksız kalır; jsdom yalnızca geliştirme bağımlılığıdır:

```bash
npm install
npm test
```

Testler; alternatif çevirinin kabulünü, hata eşiğinde `kelime|extra:<kaynak>` kartının oluşup
İyi cevapla emekliye ayrılmasını, kelime/boşluk yazma anahtarlarının bağımsızlığını, ek kartın
yazma davranışını kaynağından almasını, eski tek `typing` anahtarının taşınmasını, boşluk kartında
toleranslı eşleşmeyi ve geri bildirimi, son cevabın geri alınmasını ve yedek geri yüklemede eski
kart/sayaç biçimlerinin taşınmasını kontrol eder. Son beş senaryo gramer katmanını ve kendi kelimeleri doğrular:
hâl eki tablosunun bütünlüğü (her kelimede üç durum, sözlükte karşılığı olan anahtarlar, kelime × 3 kart), hâl eki
kartının soru/cevap/yazma akışı, fiil çekimi tablosu (altı kişi, tipler 1–5, fiil × 6 kart, düzensiz çekimler),
fiil kartının kişi sorusu, kendi kelime ekleme (iki yönlü kart, yinelenen kelime engeli, silme, filtre kalıcılığı)
ve sistematik hata raporu (desen sıralaması, en çok unutulan kelime, eksik harf deseni, boş durum) — ayar
kapalıyken gramer kartları sıraya girmemelidir.

## Özellikler

- **Çift yönlü çalışma:** Fince → Türkçe, Türkçe → Fince veya karışık. Her yön ayrı ilerleme tutar.
- **Boşluk doldurma (cloze) kartları:** 30 kalıp ifade için cümlede boşluk bırakılır; cevap eksik ifadeyi,
  kalıbın anlamını ve tam cümleyi gösterir. Yeni kart kuyruğunda kelimelerle 2:1 oranında harmanlanır,
  Ayarlar → “Kalıp ifadeler için boşluk doldurma kartları” ile kapatılabilir.
- **Hâl eki (gramer) kartları:** çekimi tanımlı **98 isim** için Fince'nin üç temel hâli sorulur:
  **partitiivi**, **inessiivi** (`-ssa/-ssä`) ve **illatiivi** (`-Vn / -hVn`). Kart Türkçe anlamı gösterir
  (“ev”), cevap olarak çekimli biçim istenir (`talossa`); cevap açılınca taban kelime, ek kalıbı ve kısa
  kullanım açıklaması görünür. Yazma modu, toleranslı karşılaştırma ve harf bazlı fark geri bildirimi
  bu kartlarda da geçerlidir. Hâl eki kartları yön filtresinden bağımsızdır ve her hâl ayrı ilerleme tutar
  (`kelime|form:<durum>`). Ayarlar → “Hâl eki kartları” ile kapatılabilir.
- **Fiil çekimi kartları:** sözlükteki **20 fiil** için preesens (şimdiki/geniş zaman) çekimi altı kişide
  sorulur — minä, sinä, hän, me, te, he. Kart mastarı gösterir (“konuşmak”), çip kişiyi yazar
  (**minä (ben)**) ve cevap olarak çekimli fiil istenir (`puhun`); cevap açılınca fiilin temel tipi (1–5)
  ve kişi eki hatırlatılır. Her kişi ayrı kart ve ayrı ilerleme tutar (`kelime|conj:<kişi>`); yazma modu,
  harf bazlı fark ve ek tekrar akışı bu kartlarda da geçerlidir. Ayarlar → “Fiil çekimi kartları” ile kapatılabilir.
- **Kendi kelimelerin:** Sözlük ekranındaki formla Fince–Türkçe kelime ekle; seviye (A1/A2/B1), kategori ve
  isteğe bağlı örnek cümle verilebilir. Eklenen kelime iki yönlü karta dönüşür, çalışma kuyruğuna girer ve JSON
  yedeğine dahil olur. Aynı Fince kelime ikinci kez eklenmez; listedeki 🗑 düğmesi kelimeyi kartlarıyla birlikte siler.
  Kayıtlar `state.custom` alanında tutulur, yerleşik sözlük değişmez. Sözlükteki “Kapsam” seçicisiyle
  listeyi yalnızca kendi kelimelerine indirebilirsin; seçilen kategori, kapsam ve arama metni sonraki
  açılışta korunur.
- **Sistematik hata raporu:** İstatistik sekmesi, zaten biriken veriyi desenlere göre toplar: hangi hâl eki, fiil kişisi
  ya da kelime kategorisinde daha çok unutuyorsun, en çok takıldığın kelimeler hangileri ve yazmada hangi harfler
  sürekli eksik/fazla yazılıyor. Yeni bir sayaç tutulmaz; rapor mevcut kart ilerlemesi ve yazma kayıtlarından türetilir.
  Desen ya da kategori satırına dokunmak yalnız o kartları çalıştıran bir odak kurar; çalışma ekranındaki
  odak etiketiyle kaldırılır ve oturum bitince kendiliğinden kaybolur. Odak bitince boş ekran, o odakta verilen
  cevap sayısını ve doğruluk yüzdesini özetler; geri alınan cevap özetten de düşer.
- **FSRS-5 karşılaştırması ve sınav planı:** Kartlar SM-2 ile zamanlanmaya devam eder; her cevap aynı anda
  FSRS-5'in bellek modelinde (kararlılık/zorluk) de işlenir ve kayıtlı aralıklara dokunulmaz. İstatistik'te
  aynı kartlar için 30 günlük tekrar sayısı (SM-2 / FSRS), fark yüzdesi, ortalama aralık ve geçmiş
  cevaplardan kalibre edilen kişisel parametreler (hedef hatırlama, başlangıç hızı) görünür. "Sınav planı"
  hedef tarihe kadar gereken günlük yeni kart ve tekrar yükünü hesaplar; tek dokunuşla günlük limite yazar.
  Motor geçişi, gölge farkı oturana kadar yapılmaz. FSRS'in her gerçek tekrar denemesindeki hatırlama tahmini
  ile gerçekleşen sonuç ayrıca biriktirilir; "geçiş kararı" kutusu 150 cevap ve 14 gün eşiğinden sonra Brier
  skoru, öngörülen/gerçek hatırlama ve 30 günlük yük farkını birleştirip geçiş önerisi verir.
- **Okuma modu:** Sözlük sekmesine bir Fince metin yapıştırınca her kelime sözlükle eşleştirilir; çekim
  ekleri kısa bir ek listesiyle (en çok iki adım) sıyrılır, yalnızca gerçek sözlük eşleşmeleri sayılır.
  Panel "bu metnin %68'ini anlıyorsun" der, tekil kelime oranını ayrıca verir ve bilinmeyen kelimeleri
  sıklıkla listeler; "ekle" düğmesi kelimeyi ekleme formuna taşır. "Bilinen" ölçütü kartın çalışılmış
  olmasıdır, sözlükte bulunması değil.
- **Telefonda kurulabilir ve çevrimdışı (PWA):** `manifest.json` uygulamayı "ana ekrana ekle" ile
  kurulabilir yapar; `sw.js` uygulama kabuğunu (HTML, CSS, tüm JS modülleri, simgeler) kurulumda önbelleğe
  alır. Gezinme istekleri ağ-öncelikli, statik dosyalar önbellek-öncelikli ve arka planda tazelenir; uçak
  modunda da uygulama açılır ve kayıtlı ilerlemeyle çalışmaya devam eder. Dosyaları değiştirdikten sonra
  `sw.js` içindeki `CACHE` adını artırmak eski önbelleği temizler. Yeni sürüm arka planda kurulunca sayfa
  "Yeni sürüm hazır" şeridi gösterir; "Yenile" tek dokunuşla worker'ı etkinleştirip sayfayı yeniler, "Sonra"
  şeridi gizler ve güncelleme bir sonraki açılışta olur.
- **Yazma modu:** Kelime ve boşluk kartlarında cevap klavyeyle yazılır ve toleranslı karşılaştırılır:
  büyük/küçük harf, noktalama ve ä/ö/å ayrımı yok sayılır, 5+ harfli cevaplarda tek harflik yazım hatası kabul edilir.
  Kelime kartlarında `/` ile ayrılmış alternatif çevirilerden herhangi biri kabul edilir (ör. `erkek` ya da
  `koca`), yanlış cevapta kabul edilenler listelenir. Doğru/yanlış geri bildirimi ve “Bilmiyorum” seçeneği
  vardır; SRS notu yine kullanıcı verir. Kelime ve boşluk kartları Ayarlar'daki iki ayrı anahtarla
  bağımsız olarak açılıp kapatılabilir; boşluk anahtarı boşluk kartları kapalıyken etkisizdir.
  Yanlış cevapta **kelime bazlı** fark gösterilir: LCS ile kelime sırası hizalanır, yalnızca farklı kelimeler
  işaretlenir. Karşılıklı gelen ve birbirine yakın kelimelerde harf düzeyinde karşılaştırma yapılır
  (`wordDiff` → gerekirse `diffChars`). Doğru cevapta eksik/yanlış kısım yeşil, kullanıcının fazla ya da
  hatalı kelime/harfleri kırmızı ve üstü çizili görünür; kelimeler aynıysa “Kelimeler aynı, yalnızca sıra farklı.” notu eklenir.
- **SM-2 ailesi zamanlayıcı:** 1 dk → 10 dk öğrenme adımları, kolaylık çarpanı (ease 1.3–3.2),
  unutulan kartlar için 10 dk'lık telafi adımı, 21 gün ve üzeri aralıklar "olgun kart" sayılır.
- **Notlandırma:** Tekrar / Zor / İyi / Kolay; her butonun üzerinde o cevabın üreteceği aralık yazar.
- **Günlük limitler:** yeni kart ve tekrar limiti; bitince "10 kart daha çalış" ile geçici ek kota.
- **Tek kademeli geri alma:** yanlış notlandırılan son cevabı ilerlemeyi bozmadan geri alır.
- **CEFR seviyeleri:** 542 kelime; A1 (228), A2 (135) ve B1 (179). Çalışma ekranındaki **Tümü / A1 / A2 / B1** filtresi hem yeni kartları hem tekrarları hem de istatistikleri o seviyeye daraltır.
- **Kelime defteri:** 542 kelime, 16 kategori, Fince/Türkçe arama, örnek cümle, seviye ve durum etiketi.
  Yeni kategoriler: **Kalıp İfadeler** (30: "ei se mitään", "ottaa selvää", "riippuu siitä"…) ve
  **Toplum & Soyut** (26: yhteiskunta, tasa-arvo, ilmastonmuutos, mielipide…).
- **Telaffuz:** Web Speech API ile Fince (`fi-FI`) ve Türkçe (`tr-TR`) seslendirme; hız ayarlanabilir.
- **İstatistik:** günlük tekrar/doğruluk, seri, öğrenilen ve olgun kart sayısı, 7 günlük grafik,
  kategori ilerleme çubukları; hepsi seçili seviyeye göre hesaplanır.
- **Yazma hata istatistikleri:** kelime ve boşluk alıştırmalarındaki denemeler, doğruluk, toleransla kabul edilen
  cevaplar ve hata türleri (harf hatası, kelime sırası, kelime farkı) oranlarıyla gösterilir; son 8 hata
  “senin cevabın → doğrusu” biçiminde listelenir.
- **Otomatik ek tekrar:** aynı kartta (kelime ya da boşluk) ayarlanan sayıda hata (varsayılan 2, aralık 1–6)
  birikince `kelime|extra:<kaynak>` kartı üretilir. Kart, kaynağı neyse o biçimde gelir (kelime kartı ya da
  boşluk cümlesi) ve “Ek tekrar” etiketi taşır; günlük yeni kart kotasını harcamaz. **İyi/Kolay** ile
  bitirilirse emekliye ayrılır ve bekleyen hata sayacı sıfırlanır; **Tekrar/Zor** seçilirse 1–5 dk sonra
  yeniden sorulur. İstatistik ekranı, ek tekrar bekleyen kartları kaynak türü ve hata sayısıyla listeler.
- **Yedekleme:** JSON olarak indir / geri yükle, ilerlemeyi sıfırla.
- **Klavye:** `Space` cevabı gösterir (yazma modunda giriş alanına odaklanır), `1`–`4` not verir.
  Mobil öncelikli, açık/karanlık tema.

## Dosya yapısı

```
index.html          ekran iskeleti (Çalış / Sözlük / İstatistik / Ayarlar)
assets/styles.css   tema değişkenleri, kart, grafik ve duyarlı yerleşim
assets/data.js      kelime verisi (16 kategori, A1/A2/B1) + CLOZE + FORMS (hâl ekleri) + CONJ (fiiller)
assets/srs.js       zamanlayıcı: schedule(), previewIntervals(), formatInterval()
assets/store.js     localStorage, günlük sayaçlar, seri, yedekleme
assets/app.js       çalışma döngüsü, sözlük, istatistik ve ayar bağlantıları
tests/run.mjs       yazma modu ve ek tekrar testleri (npm test)
```

Yeni kelime eklemek için `assets/data.js` içindeki `VOCAB` dizisine kayıt eklemek yeterli:

```js
{ fi: "kiitos", tr: "teşekkürler", lvl: "A1", cat: "nezaket",
  ex: ["Kiitos avusta!", "Yardımın için teşekkürler."], note: "opsiyonel not" }
```

Boşluk doldurma kartı eklemek için `CLOZE` haritasına kayıt girin; anahtar `VOCAB` içindeki Fince ifadeyle
tam eşleşmelidir:

```js
"ei se mitään": { text: "Anteeksi! — Ei se ___.", answer: "mitään" }
```

`text` içinde tam olarak bir `___` boşluğu olmalı, `answer` o boşluğa gelecek ifadedir. Kayıt eklendiğinde
o ifade için `kelime|cloze` anahtarıyla tek bir kart oluşturulur ve yön ayarından bağımsız çalışır.

Kart anahtarları kelimeye bağlıdır (`kelime|yön`), bu yüzden listeye kelime eklemek mevcut ilerlemeyi kaydırmaz.
`lvl` alanı `A1`, `A2` veya `B1` olmalıdır; `LEVELS` tanımında olmayan bir değer, seviye filtresinde
görünmez ve "Hakkında"da uyarı üretmez — bu yüzden yeni kayıtta `lvl` alanını atlamayın.
Kayıt eklendiğinde her iki yön için kart otomatik oluşturulur (`store.ensureCards`).

## Referans alınan veriler

Arayüz ve veri modeli, başlangıçta paylaşılan AnkiDroid kurulum raporundaki bilgiler örnek alınarak tasarlandı:

| Alan | Değer | Bu projedeki karşılığı |
|---|---|---|
| Paket / başlama eylemi | `com.ichi2.anki` · `com.ichi2.anki.IntentHandler` | Tek giriş noktalı, sekmeli tek sayfa uygulaması |
| Sürüm | 2.25.3 (322503300) | Tek sürümlü, bağımlılıksız statik uygulama |
| minSDK / targetSDK | 24 / 36 | Modern tarayıcı + mobil öncelikli düzen, ES modülleri |
| İmza SHA-1 | `f24e06a3657b190a12671100402df32d7b9b3d36` | "Hakkında" panelinde referans olarak gösterilir |
| İzinler | yalnızca depolama, ağ, ses, bildirim | Ağ isteği yok; ses yalnızca kullanıcı eylemiyle (Web Speech) |
| Veri konumu | `/data/user/0/com.ichi2.anki/` | `localStorage` anahtarı `suomi-tr-app-v2` |
| Zamanlayıcı | Anki'nin SM-2 temelli planlayıcısı | `assets/srs.js` içindeki sadeleştirilmiş SM-2 |

Tasarım kararları bu rapordan çıkarıldı: çevrimdışı öncelik, tek kullanıcı, izin yüzeyinin küçük tutulması,
verinin cihazda kalması ve aralıklı tekrarın temel alınması.

## Sınırlar

- İlerleme tarayıcıya bağlıdır; tarayıcı verisi silinirse kaybolur (JSON yedeği alın).
- Telaffuz, işletim sisteminde yüklü `fi-FI` / `tr-TR` sesine bağlıdır; ses yoksa buton sessiz kalır.
- Veri seti tek kullanıcı için hazırlanmış 542 kelimelik bir sözlüktür; sınav modu içermez. Dilbilgisi
  tarafı `FORMS` tablosundaki 98 ismin partitiivi/inessiivi/illatiivi çekimleri ve `CONJ` tablosundaki
  20 fiilin preesens çekimiyle sınırlıdır; isimlerde çoğul ve diğer hâller (genitiivi, elatiivi, adessiivi…),
  fiillerde geçmiş zaman, olumsuz çekim ve emir kipi yoktur.
- Hâl eki kartları elle yazılmış çekimlerden üretilir; tabloda olmayan kelimeler için gramer kartı çıkmaz.
  Sözlüğe yeni kelime eklenirse çekimleri de `FORMS` tablosuna girilmelidir.
- Kendi eklediğin kelimeler için yalnızca iki yönlü kelime kartı üretilir; hâl eki ya da fiil çekimi kartı
  oluşmaz (çekim tablosu girişi gerektirir). Yeni kelimeler `localStorage` içinde saklandığı için başka
  cihazlara yalnızca JSON yedeğiyle taşınır.
- B1 destesi kelime ve kalıp ağırlıklıdır; uzun okuma metni veya dinleme alıştırması içermez.
- Boşluk doldurma yalnızca `CLOZE` haritasında karşılığı olan 30 kalıp için üretilir; diğer kelimelerde
  cümle içinde çekim değiştiği için otomatik boşluk çıkarma güvenilir değildir.
- Yazma modu sözlük tabanlı değil, hedef dizeye göre puanlar; kelime kartlarında yalnızca `/` ile ayrılmış
  alternatifler kabul edilir, bunun dışındaki eşanlamlılar ve farklı çekimler reddedilir (yalnızca
  harf/noktalama/ä-ö toleransı ve tek harflik hata payı).
- Ek tekrar kartları normal SRS aralıklarına girmez (emekli bayrağıyla kuyruktan çıkar); kelime ve boşluk
  hatalarından üretilir. Eşik Ayarlar → “Ek tekrar eşiği” kaydırıcısıyla 1–6 arasında
  değiştirilebilir; eşik yükseltilince koşulu sağlamayan kartlar anında emekliye ayrılır, düşürülünce geri gelir.
- Hata türü sezgisel sınıflandırılır: kelime kümesi aynıysa “sıra”, kelime sayısı ya da kelime kimliği
  değiştiyse “kelime farkı”, aksi halde “harf hatası”. Çekim eki farkı çoğunlukla “kelime farkı” sayılır.
  İstatistikler yalnızca bu tarayıcıda tutulur; ilerlemeyi sıfırlamak onları da temizler.

## Lisans

MIT — ayrıntılar için [LICENSE](LICENSE) dosyasına bakın. Kodu kendi çalışmanız için kopyalayabilir,
değiştirebilir ve dağıtabilirsiniz; yalnızca telif ve izin bildirimini koruyun.
