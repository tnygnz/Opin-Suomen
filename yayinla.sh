#!/usr/bin/env bash
# sanat/ altindaki degisiklikleri TEK komutla GitHub Pages'e yayimlar.
#
#   ./yayinla.sh "sanat: kisa degisiklik ozeti"
#   KURU=1 ./yayinla.sh              # token gerekmez: yalnizca plan
#   TEST_YOK=1 ./yayinla.sh "..."    # test kapisini atla
#   DOGRULA=1 ./yayinla.sh "..."     # yayindan sonra canli baytlari da dogrula
#   SILME_ONAY=1 ./yayinla.sh "..."  # yerelde olmayan uzak dosyalari da sil
#
# Neden API: bu depoda yerel gecmis ile uzak gecmis iliskisiz (ortak ata yok),
# bu yuzden duz `git push` "non-fast-forward" ile reddedilir. Betik Git Data
# API'siyle uzak agacin uzerine TEK commit uretir; uzak gecmis yeniden yazilmaz.
#
# Kimlik: token yalnizca GH_TOKEN ortam degiskeninden okunur. Ekrana basilmaz,
# argv'ye konmaz, depoya yazilmaz (curl --config + gecici, chmod 600 dosya).
set -uo pipefail

REPO=${REPO:-tnygnz/suomi-kartat}
BRANCH=${BRANCH:-main}
DAL=${DAL:-sanat}
KURU=${KURU:-0}
TEST_YOK=${TEST_YOK:-0}
SILME_ONAY=${SILME_ONAY:-0}
DOGRULA=${DOGRULA:-0}
SAYFA=${SAYFA:-https://tnygnz.github.io/suomi-kartat/sanat/}
MSG=${1:-${MSG:-"sanat: site guncellemesi"}}
API="https://api.github.com/repos/$REPO"

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
cd "$SRC" || exit 2

say() { printf '%s\n' "$*"; }
die() { local kod=${2:-1}; printf '\nDURDU: %s\n' "$1" >&2; exit "$kod"; }

for a in git python3 curl; do
  command -v "$a" >/dev/null 2>&1 || die "$a bulunamadi" 2
done
[ -d "$DAL" ] || die "$DAL dizini yok" 2

jget() { # jget DOSYA anahtar.yolu
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    d = {}
for p in sys.argv[2].split("."):
    d = d.get(p) if isinstance(d, dict) else None
print(d if isinstance(d, str) and d else "")' "$1" "$2"
}

# --- 1) uzak taban -------------------------------------------------------
git fetch -q origin "$BRANCH" 2>/dev/null || die "origin/$BRANCH alinamadi (git remote / ag)" 2
TABAN=$(git rev-parse "origin/$BRANCH" 2>/dev/null) || die "origin/$BRANCH cozulemedi" 2

# --- 2) degisen ve silinen dosyalar -------------------------------------
DEGISEN=()
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && DEGISEN+=("$f")
done < <(
  { git diff --name-only "origin/$BRANCH" -- "$DAL"
    git ls-files --others --exclude-standard -- "$DAL"; } | sort -u
)

SILINEN=()
while IFS= read -r f; do
  [ -n "$f" ] && [ ! -f "$f" ] && SILINEN+=("$f")
done < <(git ls-tree -r --name-only "origin/$BRANCH" -- "$DAL")

say "Depo : $REPO · dal: $BRANCH · taban: ${TABAN:0:12}"
say "Dizin: $DAL/ · degisen: ${#DEGISEN[@]} · uzakta olup yerelde olmayan: ${#SILINEN[@]}"

if [ "${#DEGISEN[@]}" -eq 0 ] && [ "${#SILINEN[@]}" -eq 0 ]; then
  say "Yayinlanacak degisiklik yok (uzak $BRANCH ile ayni)."
  exit 0
fi

for f in "${DEGISEN[@]}"; do say "  degisti : $f ($(wc -c <"$f") bayt)"; done

if [ "${#SILINEN[@]}" -gt 0 ]; then
  if [ "$SILME_ONAY" = "1" ]; then
    for f in "${SILINEN[@]}"; do say "  silinecek: $f"; done
  else
    printf 'UYARI: su dosyalar uzakta var, yerelde yok; SILME_ONAY=1 verilmedigi icin korunacak:\n' >&2
    for f in "${SILINEN[@]}"; do printf '  %s\n' "$f" >&2; done
    SILINEN=()
  fi
fi

# --- 3) test kapisi ------------------------------------------------------
if [ "$TEST_YOK" = "1" ]; then
  say "Testler atlandi (TEST_YOK=1)."
else
  command -v node >/dev/null 2>&1 || die "node bulunamadi (TEST_YOK=1 ile atlanabilir)" 2
  say ""
  say "Testler: node $DAL/tests/run.js"
  node "$DAL/tests/run.js" || die "testler basarisiz; yayin yapilmadi (TEST_YOK=1 ile atlanabilir)" 1
fi

# --- 4) plan -------------------------------------------------------------
if [ "$KURU" = "1" ]; then
  say ""
  say "KURU plan (aga cikilmadi):"
  for f in "${DEGISEN[@]}"; do say "  POST /git/blobs            $f"; done
  for f in "${SILINEN[@]}"; do say "  agac girdisi: sha=null     $f"; done
  say "  POST /git/trees            base_tree=${TABAN:0:12}"
  say "  POST /git/commits          tek ebeveyn=${TABAN:0:12}"
  say "  PATCH /git/refs/heads/$BRANCH"
  say "  mesaj: $MSG"
  exit 0
fi

# --- 5) kimlik ----------------------------------------------------------
[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN tanimli degil.
Yapilacaklar:
  1) GitHub -> Settings -> Developer settings -> Personal access tokens
     - Fine-grained: yalnizca $REPO, izin 'Contents: Read and write'
     - ya da Classic: 'repo' kapsami
  2) Bu projede Settings -> Secrets -> GH_TOKEN olarak ekle (sohbete YAPISTIRMA)
  3) Yeni oturumda:  ./yayinla.sh \"mesaj\"" 3

CFG=$(mktemp) || die "gecici dosya acilamadi" 2
chmod 600 "$CFG"
printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/vnd.github+json"\nheader = "X-GitHub-Api-Version: 2022-11-28"\n' \
  "$GH_TOKEN" >"$CFG"
TMP=$(mktemp -d) || die "gecici dizin acilamadi" 2
trap 'rm -f "$CFG"; rm -rf "$TMP"' EXIT

api() { # api YONTEM YOL CIKTI [GOVDE]  -> HTTP kodu
  local yontem=$1 yol=$2 cikti=$3 govde=${4:-}
  if [ -n "$govde" ]; then
    curl -sS -m 60 --config "$CFG" -X "$yontem" -H "Content-Type: application/json" \
      --data @"$govde" -o "$cikti" -w '%{http_code}' "$API$yol"
  else
    curl -sS -m 60 --config "$CFG" -X "$yontem" -o "$cikti" -w '%{http_code}' "$API$yol"
  fi
}

# --- 6) tek commit ------------------------------------------------------
say ""
say "Yayinlaniyor..."
COMMIT=""
deneme=0
while [ "$deneme" -lt 3 ]; do
  deneme=$((deneme + 1))
  git fetch -q origin "$BRANCH" 2>/dev/null || true
  TABAN=$(git rev-parse "origin/$BRANCH") || die "origin/$BRANCH cozulemedi" 2

  kod=$(api GET "/git/commits/$TABAN" "$TMP/taban.json")
  [ "$kod" = "200" ] || die "taban commit okunamadi (HTTP $kod): $(head -c 200 "$TMP/taban.json")" 1
  AGAC=$(jget "$TMP/taban.json" "tree.sha")
  [ -n "$AGAC" ] || die "taban agac sha alinamadi" 1

  : >"$TMP/girdiler"
  for f in "${DEGISEN[@]}"; do
    python3 -c '
import base64, json, sys
print(json.dumps({"content": base64.b64encode(open(sys.argv[1], "rb").read()).decode(),
                  "encoding": "base64"}))' "$f" >"$TMP/blob.json"
    kod=$(api POST "/git/blobs" "$TMP/blob.json.out" "$TMP/blob.json")
    sha=$(jget "$TMP/blob.json.out" "sha")
    [ "$kod" = "201" ] && [ -n "$sha" ] \
      || die "blob olusturulamadi: $f (HTTP $kod): $(head -c 200 "$TMP/blob.json.out")" 1
    printf '%s\t%s\n' "$f" "$sha" >>"$TMP/girdiler"
    say "  blob  $f -> ${sha:0:10}"
  done

  python3 - "$TMP/girdiler" "$AGAC" ${SILINEN[@]+"${SILINEN[@]}"} >"$TMP/agac.json" <<'PY'
import json, sys
liste, taban_agac = sys.argv[1], sys.argv[2]
agac = []
for satir in open(liste, encoding="utf-8"):
    satir = satir.rstrip("\n")
    if not satir:
        continue
    yol, sha = satir.split("\t")
    agac.append({"path": yol, "mode": "100644", "type": "blob", "sha": sha})
for yol in sys.argv[3:]:
    if yol:
        agac.append({"path": yol, "mode": "100644", "type": "blob", "sha": None})
print(json.dumps({"base_tree": taban_agac, "tree": agac}))
PY
  kod=$(api POST "/git/trees" "$TMP/agac.out" "$TMP/agac.json")
  [ "$kod" = "201" ] || die "agac olusturulamadi (HTTP $kod): $(head -c 200 "$TMP/agac.out")" 1
  YENI_AGAC=$(jget "$TMP/agac.out" "sha")
  [ -n "$YENI_AGAC" ] || die "yeni agac sha alinamadi" 1

  python3 -c '
import json, sys
print(json.dumps({"message": sys.argv[1], "tree": sys.argv[2], "parents": [sys.argv[3]]}))' \
    "$MSG" "$YENI_AGAC" "$TABAN" >"$TMP/commit.json"
  kod=$(api POST "/git/commits" "$TMP/commit.out" "$TMP/commit.json")
  [ "$kod" = "201" ] || die "commit olusturulamadi (HTTP $kod): $(head -c 200 "$TMP/commit.out")" 1
  YENI_COMMIT=$(jget "$TMP/commit.out" "sha")
  [ -n "$YENI_COMMIT" ] || die "commit sha alinamadi" 1

  python3 -c '
import json, sys
print(json.dumps({"sha": sys.argv[1], "force": False}))' "$YENI_COMMIT" >"$TMP/ref.json"
  kod=$(api PATCH "/git/refs/heads/$BRANCH" "$TMP/ref.out" "$TMP/ref.json")
  if [ "$kod" = "200" ]; then
    COMMIT=$YENI_COMMIT
    break
  fi
  if [ "$kod" = "422" ]; then
    say "  uzak dal bu arada ilerledi; yeniden deneniyor ($deneme/3)"
    sleep 2
    continue
  fi
  die "dal guncellenemedi (HTTP $kod): $(head -c 200 "$TMP/ref.out")" 1
done

[ -n "$COMMIT" ] || die "yayin 3 denemede tamamlanamadi" 1

say ""
say "SONUC: tek commit ${COMMIT:0:12}"
say "  commit: https://github.com/$REPO/commit/$COMMIT"
say "  site  : $SAYFA (Pages 1-3 dakikada guncellenir)"

# --- 7) uzak dogrulama ---------------------------------------------------
say ""
say "Uzak dogrulama:"
git fetch -q origin "$BRANCH" 2>/dev/null || true
hata=0
for f in "${DEGISEN[@]}"; do
  uzak=$(git rev-parse "origin/$BRANCH:$f" 2>/dev/null || echo "?")
  yerel=$(git hash-object "$f" 2>/dev/null || echo "?")
  if [ "$uzak" = "$yerel" ] && [ "$uzak" != "?" ]; then
    say "  ok    $f ${uzak:0:10}"
  else
    say "  FAIL  $f (uzak ${uzak:0:10} / yerel ${yerel:0:10})"
    hata=1
  fi
done
for f in "${SILINEN[@]}"; do
  if git cat-file -e "origin/$BRANCH:$f" 2>/dev/null; then
    say "  FAIL  silinmedi: $f"
    hata=1
  else
    say "  ok    silindi: $f"
  fi
done

# --- 8) istege bagli canli kontrol --------------------------------------
if [ "$DOGRULA" = "1" ] && [ "${#DEGISEN[@]}" -gt 0 ]; then
  say ""
  say "Canli kontrol: $SAYFA (en fazla 120 sn)"
  for f in "${DEGISEN[@]}"; do
    goreli=${f#"$DAL"/}
    canli=0
    for _ in $(seq 1 12); do
      if curl -sS -m 20 "$SAYFA$goreli?cb=$(date +%s)" -o "$TMP/canli" 2>/dev/null \
        && cmp -s "$TMP/canli" "$f"; then
        canli=1
        break
      fi
      sleep 10
    done
    if [ "$canli" = "1" ]; then say "  ok    canli = yerel: $goreli"
    else say "  BEKLE Pages henuz eski: $goreli (birkac dakika sonra tekrar bak)"; fi
  done
fi

if [ "$hata" -ne 0 ]; then
  say ""
  say "SONUC: uzak dogrulamada fark var"
  exit 1
fi
say ""
say "Tamam: $BRANCH guncel."
