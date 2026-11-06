# suomi-kartat

Kişisel Fince ↔ Türkçe çalışma uygulaması. Statik, bağımlılıksız; verisi yalnızca
tarayıcının `localStorage` alanında. Uygulama `sanat/` dizininde, ayrıntılar
[`sanat/README.md`](sanat/README.md) içinde.

- Canlı: <https://tnygnz.github.io/suomi-kartat/sanat/>
- Özel yedek depo: <https://github.com/tnygnz/Opin-Suomen> (GitHub Pages kapalı)

## Yayınlama

Depo kökündeki betik iki hedefi destekler:

| Hedef | Depo | Not |
|---|---|---|
| `site` | `tnygnz/suomi-kartat` | GitHub Pages; canlı adres yayımlanır |
| `yedek` | `tnygnz/Opin-Suomen` | özel depo; Pages yok |

Betiğin **varsayılan hedefi `yedek`**. Bu depoya, yani canlı siteye yayın için:

```bash
HEDEF=site ./yayinla.sh "sanat: kısa değişiklik özeti"
```

Betik sırayla:

1. `node sanat/tests/run.js` — testler kırıksa yayın yapılmaz (`TEST_YOK=1` ile atlanır).
2. Hedef dal ile `sanat/` arasındaki farkı çıkarır (yeni dosyalar ve silmeler dahil).
3. Farkı **tek commit** olarak yazar; `site` hedefinde GitHub Pages 1–3 dakikada yayımlar.
4. Uzak blob'ların yerelle aynı olduğunu doğrular; `DOGRULA=1` verilirse canlı
   dosyaların baytlarını da bekler (yalnızca `site` hedefinde).

Kimlik: `GH_TOKEN` — fine-grained PAT, ilgili depo için **Contents: Read and write**
(ya da Classic `repo`). Token yalnızca ortam değişkeninden okunur; ekrana, komut
satırına ya da depoya yazılmaz. Token yoksa betik yapılacakları yazıp **3** ile çıkar.

| Komut | Ne yapar |
|---|---|
| `KURU=1 HEDEF=site ./yayinla.sh` | token gerekmez; yalnızca planı gösterir |
| `./yayinla.sh "mesaj"` | varsayılan hedefe (`yedek`) tek commit |
| `HEDEF=site ./yayinla.sh "mesaj"` | canlı siteye tek commit |
| `DOGRULA=1 HEDEF=site ./yayinla.sh "mesaj"` | yayımdan sonra canlı baytları da doğrular |
| `TEST_YOK=1 ./yayinla.sh "mesaj"` | test kapısını atlar |
| `SILME_ONAY=1 ./yayinla.sh "mesaj"` | yerelde olmayan uzak dosyaları da siler |

`KURU=1` özel depo hedefinde token ister (özel depoyu okumak kimlik gerektirir).

`git push` neden kullanılmıyor: bu depoda yerel geçmiş ile uzak geçmiş ilgisiz
(ortak ata yok), düz `git push` "non-fast-forward" ile reddedilir. Betik GitHub
Git Data API'siyle uzak ağacın üzerine tek commit üretir ve uzak geçmişi yeniden
yazmaz.
