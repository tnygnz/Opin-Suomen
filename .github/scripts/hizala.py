"""sanat: styles.css medya bloğunu .tabs kuralının hemen altına taşı (tek seferlik)."""
import io
import sys

CSS = 'sanat/styles.css'
B = (
    '/* Geniş ekran: sekme çubuğu içerik kolonuyla (720px) aynı genişlikte ortalanır;\n'
    '   mobilde tam genişlik korunur. */\n'
    '@media (min-width: 760px) {\n'
    '  .tabs {\n'
    '    left: 0; right: 0;\n'
    '    max-width: 720px;\n'
    '    margin: 0 auto;\n'
    '    border-radius: 14px 14px 0 0;\n'
    '  }\n'
    '}\n'
)
CAPA = '\n.tabs button {\n'
YERINDE = '\n' + B + '.tabs button {\n'

with io.open(CSS, encoding='utf-8', newline='') as f:
    s = f.read()

print('başlangıç: %d bayt, %d satır' % (len(s), s.count('\n')))

if YERINDE in s and not s.endswith('\n' + B):
    print('zaten yerinde, atlandı')
elif s.endswith('\n' + B):
    base = s[:len(s) - len(B) - 1]
    if base.count(CAPA) != 1:
        print('çapa bulunamadı (%d) -> durduruldu' % base.count(CAPA))
        sys.exit(1)
    yeni = base.replace(CAPA, '\n' + B + '.tabs button {\n', 1)
    with io.open(CSS, 'w', encoding='utf-8', newline='') as f:
        f.write(yeni)
    print('taşındı: %d bayt, %d satır' % (len(yeni), yeni.count('\n')))
else:
    print('beklenen yapı yok -> durduruldu')
    sys.exit(1)
