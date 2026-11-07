#!/usr/bin/env bash
# tek.sh — tek komutla yayın: test + damga + site push + yedek aynası + doğrulama
#   ./tek.sh "commit mesajı"   -> test, ?v= damgası, commit, site push, ayna tetiği, denetim
#   ./tek.sh --kuru "mesaj"    -> hiçbir şey yazmadan test + damga hesabı
# Çıkış: 0 tamam · 1 sorun · 2 eksik adım (gh yok, kimlik yok vb.)
set -uo pipefail
KOK=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "HATA: git deposu değil"; exit 1; }
cd "$KOK" || exit 1
KURU=0
[ "${1:-}" = "--kuru" ] && { KURU=1; shift; }
MESAJ=${1:-}
if [ -z "$MESAJ" ]; then
  echo 'kullanım: ./tek.sh "commit mesajı"    (kuru: ./tek.sh --kuru "mesaj")'
  exit 1
fi
SITE_REMOTE=${SITE_REMOTE:-origin}
YEDEK_REPO=${YEDEK_REPO:-tnygnz/Opin-Suomen}
rc=0
yaz(){ printf '%s\n' "$*"; }
hata(){ printf '  !! %s\n' "$*"; rc=1; }

# 1) testler
if command -v node >/dev/null 2>&1 && [ -f sanat/tests/run.js ]; then
  t=$(node sanat/tests/run.js 2>&1); tr=$?
  ozet=$(printf '%s' "$t" | grep -E 'SONUC:|başarısız|geçti' | tail -1)
  if [ "$tr" -eq 0 ]; then yaz "test    : ${ozet:-geçti}"
  else yaz "test    : BAŞARISIZ (yayın durduruldu)"; printf '%s\n' "$t" | tail -20; exit 1; fi
else
  yaz "test    : ATLANDI (node yok)"; rc=2
fi

# 2) damga: index.html içindeki ?v= değeri = içerik özeti (tarayıcı önbelleğini tazeler)
damga=$( { for f in sanat/app.js sanat/styles.css sanat/data.js; do
            [ -f "$f" ] && sha256sum "$f"; done; } | sha256sum | cut -c1-8 )
yaz "damga   : sanat içerik ${damga}"
if [ "$KURU" -eq 0 ]; then
  node -e '
    const fs = require("fs");
    const p = "sanat/index.html";
    const v = process.argv[1];
    let s = fs.readFileSync(p, "utf8");
    ["styles.css", "data.js", "app.js"].forEach(function (f) {
      s = s.replace(new RegExp(f.replace(/\./g, "\\.") + "(\\?v=[0-9a-zA-Z._-]+)?"), f + "?v=" + v);
    });
    fs.writeFileSync(p, s);
  ' "$damga"
  git add -A
  if git diff --cached --quiet; then yaz "commit  : değişiklik yok"
  else git commit -q -m "$MESAJ" && yaz "commit  : $(git rev-parse --short HEAD) · $MESAJ"; fi
else
  yaz "damga   : (kuru) yazılmadı, commit yok"
fi

# 3) site push + yedek aynası
if [ "$KURU" -eq 0 ]; then
  if git push "$SITE_REMOTE" HEAD:main >/dev/null 2>&1; then
    yaz "site    : push TAMAM ($(git rev-parse --short HEAD))"
  else
    hata "site push yapılamadı — elle: git push $SITE_REMOTE HEAD:main"
  fi
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh workflow run ayna.yml -R "$YEDEK_REPO" >/dev/null 2>&1; then
      yaz "yedek   : ayna tetiklendi ($YEDEK_REPO)"
    else
      hata "yedek aynası tetiklenemedi — elle: gh workflow run ayna.yml -R $YEDEK_REPO"
    fi
  else
    yaz "yedek   : gh yok/oturum yok; ayna en geç 6 saatte kendisi yetişir"
    yaz "          elle: gh workflow run ayna.yml -R $YEDEK_REPO"
    rc=2
  fi
fi

# 4) doğrulama: yerel ↔ site ↔ canlı ↔ yedek
if [ "$KURU" -eq 0 ] && [ -f tools/ayna.sh ]; then
  bash tools/ayna.sh --bekle 120 || rc=$?
else
  yaz "denetim : atlandı"
fi

[ "$rc" -eq 0 ] && yaz "SONUÇ   : TAMAM" || yaz "SONUÇ   : EKSİK (rc=$rc)"
exit "$rc"
