#!/usr/bin/env bash
# ayna.sh — üç kopyayı doğrular: yerel ↔ site main ↔ canlı ↔ yedek.
#   bash tools/ayna.sh              -> doğrula; yerel yalnızca hızlı-ileri sarılır
#   bash tools/ayna.sh --kontrol    -> hiçbir şeyi değiştirme (kayma varsa çıkış 2)
#   bash tools/ayna.sh --bekle 120  -> yedeğin yetişmesini en çok 120 sn bekle
# Çıkış: 0 sağlam · 1 sorun var · 2 durduruldu (ayrık geçmiş / kirli ağaç / kayma)
set -uo pipefail
KOK=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "HATA: git deposu degil"; exit 1; }
cd "$KOK" || exit 1
SITE_URL=${SITE_URL:-https://github.com/tnygnz/suomi-kartat.git}
YEDEK_URL=${YEDEK_URL:-https://github.com/tnygnz/Opin-Suomen.git}
CANLI=${CANLI:-https://tnygnz.github.io/suomi-kartat/sanat}
MOD=ayna; BEKLE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kontrol) MOD=kontrol; shift ;;
    --bekle) BEKLE=${2:-120}; shift; [ $# -gt 0 ] && shift ;;
    *) echo "bilinmeyen argüman: $1"; exit 1 ;;
  esac
done
rc=0
yaz(){ printf '%s\n' "$*"; }
hata(){ printf '  !! %s\n' "$*"; rc=1; }

# 1) kaynak: site main
if ! git fetch -q --no-tags "$SITE_URL" "+refs/heads/main:refs/remotes/ayna/site" 2>/dev/null; then
  hata "site main indirilemedi (ağ?)"; yaz "SONUÇ: BAŞARISIZ"; exit 1
fi
sah=$(git rev-parse refs/remotes/ayna/site)
stree=$(git rev-parse "refs/remotes/ayna/site^{tree}")
sdosya=$(git ls-tree -r --name-only refs/remotes/ayna/site | wc -l | tr -d ' ')
yaz "kaynak : site main ${sah:0:7} · ağaç ${stree:0:8} · $sdosya dosya"

# 2) yerel ağaç
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  yaz "yerel  : izlenen dosyalarda değişiklik var"
  if [ "$MOD" != kontrol ]; then
    hata "eşitleme yapılmadı; önce commit/stash"
    yaz "SONUÇ: DURDURULDU (yerel değişiklik korunuyor)"; exit 2
  fi
fi
ltree=$(git rev-parse "HEAD^{tree}" 2>/dev/null || echo yok)
onceki=$(git rev-parse --short HEAD 2>/dev/null || echo yok)
if [ "$ltree" = "$stree" ]; then
  yaz "yerel  : ${onceki} · ağaç AYNI"
elif [ "$MOD" = kontrol ]; then
  yaz "yerel  : ${onceki} · ağaç FARKLI (kontrol modu)"; rc=2
elif git merge-base --is-ancestor HEAD "$sah" 2>/dev/null; then
  if out=$(git merge --ff-only --quiet "$sah" 2>&1); then
    yaz "yerel  : ${onceki} -> $(git rev-parse --short HEAD) (hızlı-ileri sarıldı)"
  else
    hata "hızlı-ileri sarma başarısız: $(printf '%s' "$out" | tail -1)"
  fi
else
  hata "yerel ile site main AYRIK geçmişler — otomatik eşitleme yapılmadı"
  yaz "        karşılaştır: git log --oneline --left-right HEAD...refs/remotes/ayna/site"
  yaz "SONUÇ: DURDURULDU (elle karar gerekli)"; exit 2
fi

# 3) testler
if command -v node >/dev/null 2>&1 && [ -f sanat/tests/run.js ]; then
  tout=$(node sanat/tests/run.js 2>&1); trc=$?
  ozet=$(printf '%s' "$tout" | grep -E 'SONUC:|başarısız|geçti' | tail -1)
  if [ "$trc" -eq 0 ]; then yaz "testler: ${ozet:-geçti} · node $(node -v 2>/dev/null)"
  else hata "testler başarısız: ${ozet:-rc=$trc}"; fi
else
  yaz "testler: ATLANDI (node yok)"
fi

# 4) canlı site
kod=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$CANLI/" 2>/dev/null || echo 000)
if [ "$kod" = "200" ]; then
  fark=""
  for f in index.html app.js styles.css data.js; do
    [ -f "sanat/$f" ] || continue
    y=$(curl -s -H 'Cache-Control: no-cache' --max-time 20 "$CANLI/$f" | sha256sum | cut -d' ' -f1)
    [ "$y" = "$(sha256sum "sanat/$f" | cut -d' ' -f1)" ] || fark="$fark $f"
  done
  if [ -z "$fark" ]; then yaz "canlı  : HTTP 200 · dosyalar repo ile AYNI"
  else yaz "canlı  : HTTP 200 · repodan FARKLI:$fark (Pages gecikmesi olabilir)"; fi
else
  hata "canlı site HTTP $kod"
fi

# 5) yedek (public: kimlik gerekmez; iş akışları yedeğe dokunulmaz)
son=$(( $(date +%s) + BEKLE ))
while :; do
  if ! git fetch -q --no-tags "$YEDEK_URL" "+refs/heads/main:refs/remotes/ayna/yedek" 2>/dev/null; then
    yaz "yedek  : indirilemedi ($YEDEK_URL)"; break
  fi
  fark=$(git diff --name-status refs/remotes/ayna/site refs/remotes/ayna/yedek \
           -- ':(exclude).github/workflows' 2>/dev/null | head -6)
  [ -z "$fark" ] && break
  [ "$(date +%s)" -ge "$son" ] && break
  sleep 5
done
if [ -z "${fark:-}" ]; then
  yaz "yedek  : ağaç AYNI (iş akışları hariç) · $(git rev-parse --short refs/remotes/ayna/yedek)"
else
  yaz "yedek  : FARKLI (ayna en geç 6 saatte düzeltir)"
  printf '%s\n' "$fark" | sed 's/^/         /'
fi

[ "$rc" -eq 0 ] && yaz "SONUÇ : SAĞLAM" || yaz "SONUÇ : EKSİK (rc=$rc)"
exit "$rc"
