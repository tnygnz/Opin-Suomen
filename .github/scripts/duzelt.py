"""sanat: masaüstü sekme hizası ve hero onay ikonu (tek seferlik uygulama)."""
import io
import sys

APP = 'sanat/app.js'
CSS = 'sanat/styles.css'
ESKI = '"Tekrar borcun yok 🎉"'
YENI = '"Tekrar borcun yok " + ico("test", "ico-inline")'
EK = """
/* Geniş ekran: sekme çubuğu içerik kolonuyla (720px) aynı genişlikte ortalanır;
   mobilde tam genişlik korunur. */
@media (min-width: 760px) {
  .tabs {
    left: 0; right: 0;
    max-width: 720px;
    margin: 0 auto;
    border-radius: 14px 14px 0 0;
  }
}
"""


def oku(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        return f.read()


def yaz(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


degisti = False

js = oku(APP)
if 'ico("test", "ico-inline")' in js:
    print('app.js: zaten düzeltilmiş, atlandı')
elif js.count(ESKI) != 1:
    print('app.js: beklenen tek eşleşme yok (%d) -> durduruldu' % js.count(ESKI))
    sys.exit(1)
else:
    yaz(APP, js.replace(ESKI, YENI))
    print('app.js: düzeltildi')
    degisti = True

css = oku(CSS)
if 'min-width: 760px' in css:
    print('styles.css: zaten düzeltilmiş, atlandı')
else:
    yaz(CSS, css + EK)
    print('styles.css: düzeltildi')
    degisti = True

print('sonuç:', 'değişti' if degisti else 'değişiklik yok')
