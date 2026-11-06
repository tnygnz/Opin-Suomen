# suomi-kartat

Kişisel Fince ↔ Türkçe çalışma uygulaması. Statik, bağımlılıksız; verisi yalnızca
tarayıcının `localStorage` alanında. Uygulama `sanat/` dizininde, ayrıntılar
[`sanat/README.md`](sanat/README.md) içinde.

Canlı: <https://tnygnz.github.io/suomi-kartat/sanat/>

## Yayınlama

Depo kökünde tek komut:

```bash
./yayinla.sh "sanat: kısa değişiklik özeti"
```

Betik sırayla:

1. `node sanat/tests/run.js` — testler kırıksa yayın yapılmaz (`TEST_YOK=1` ile atlanır).
2. Uzak `main` ile `sanat/` arasındaki farkı çıkarır (yeni dosyalar ve silmeler dahil).
3. Farkı **tek commit** olarak `main`'e yazar; GitHub Pages 1–3 dakikada yayımlar.
4. Uzak blob'ların yerelle aynı olduğunu doğrular; `DOGRULA=1` verilirse canlı
   dosyaların baytlarını da bekler.

Kimlik: `GH_TOKEN` — fine-grained PAT, yalnız bu depo, izin **Contents: Read and write**
(ya da Classic `repo`). Token yalnızca ortam değişkeninden okunur; ekrana, komut
satırına ya da depoya yazılmaz. Token yoksa betik yapılacakları yazıp **3** ile çıkar.

| Komut | Ne yapar |
|---|---|
| `KURU=1 ./yayinla.sh` | token gerekmez; yalnızca planı gösterir |
| `./yayinla.sh "mesaj"` | tek commit olarak yayımlar |
| `DOGRULA=1 ./yayinla.sh "mesaj"` | yayımdan sonra canlı baytları da doğrular |
| `TEST_YOK=1 ./yayinla.sh "mesaj"` | test kapısını atlar |
| `SILME_ONAY=1 ./yayinla.sh "mesaj"` | yerelde olmayan uzak dosyaları da siler |

`git push` neden kullanılmıyor: bu depoda yerel geçmiş ile uzak geçmiş ilgisiz
(ortak ata yok), düz `git push` "non-fast-forward" ile reddedilir. Betik GitHub
Git Data API'siyle uzak ağacın üzerine tek commit üretir ve uzak geçmişi yeniden
yazmaz.
