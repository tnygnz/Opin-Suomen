#!/usr/bin/env bash
# Siteyi günceller: testleri çalıştırır, çevrimdışı kabuk değiştiyse service
# worker önbellek sürümünü artırır, değişiklikleri commit'ler ve main'e push
# eder. GitHub Pages her push'ta siteyi kendisi yeniden yayınlar.
#
#   ./guncelle.sh                    # otomatik commit mesajı
#   ./guncelle.sh "mesaj"            # kendi commit mesajın
#   ./guncelle.sh --no-push          # yalnızca test + commit
#   ./guncelle.sh --help

set -euo pipefail

cd "$(dirname "$0")"

PUSH=1
MSG=""

usage() {
  cat <<'USAGE'
Kullanım: ./guncelle.sh [mesaj] [--no-push]

  mesaj      Commit mesajı (verilmezse otomatik yazılır)
  --no-push  Commit'i oluştur ama main'e push etme
  --help     Bu metni göster

Betik sırayla: bağımlılıkları kurar (gerekirse), testleri çalıştırır,
çevrimdışı kabuk (index.html, manifest.json, sw.js, assets/*) değiştiyse
sw.js içindeki CACHE sürümünü bir artırır, her şeyi commit'ler ve
HEAD'i origin/main'e push eder.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --no-push) PUSH=0 ;;
    -*) printf 'hata: bilinmeyen seçenek: %s\n' "$arg" >&2; exit 2 ;;
    *)
      if [ -n "$MSG" ]; then
        printf 'hata: beklenmeyen argüman: %s\n' "$arg" >&2
        exit 2
      fi
      MSG="$arg"
      ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'hata: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git bulunamadı"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "bu betik bir git deposunda çalışmalı"
command -v node >/dev/null 2>&1 || die "node bulunamadı (testler node ile çalışıyor)"
[ -f sw.js ] || die "sw.js bulunamadı; betik depo kökünde çalışmalı"

# Çalışma ağacındaki değişiklikler (yeniden adlandırmada hedef yol alınır).
changed_paths() {
  git status --porcelain=v1 --untracked-files=all |
    while IFS= read -r line; do
      path=${line:3}
      case "$path" in
        *" -> "*) path=${path##* -> } ;;
      esac
      path=${path#\"}
      path=${path%\"}
      printf '%s\n' "$path"
    done
}

CHANGES=$(changed_paths)
if [ -z "$CHANGES" ]; then
  say "Yayınlanacak değişiklik yok; çalışma ağacı temiz."
  exit 0
fi

# Önbellek sürümü yalnızca çevrimdışı kabuk değiştiğinde artırılmalı;
# aksi halde kullanıcılara gereksiz "yeni sürüm" bildirimi gider.
SHELL_CHANGED=0
while IFS= read -r path; do
  case "$path" in
    index.html|manifest.json|sw.js|assets/*) SHELL_CHANGED=1 ;;
  esac
done <<EOF
$CHANGES
EOF

say "Değişen dosyalar:"
printf '%s\n' "$CHANGES" | sed 's/^/  - /'

if [ ! -d node_modules/jsdom ]; then
  say "Bağımlılıklar kuruluyor (npm ci)…"
  npm ci --no-audit --no-fund
fi

say "Testler çalışıyor (npm test)…"
npm test

if [ "$SHELL_CHANGED" -eq 1 ]; then
  cache_line=$(grep -m1 -E '^const CACHE = "[^"]+";$' sw.js || true)
  [ -n "$cache_line" ] || die 'sw.js içinde "const CACHE = \"...\";" satırı bulunamadı'

  cache_name=$(printf '%s\n' "$cache_line" | sed -E 's/^const CACHE = "(.*)";$/\1/')
  prefix=${cache_name%-v*}-v
  number=${cache_name##*-v}
  case "$number" in
    ''|*[!0-9]*) die "önbellek sürümü okunamadı: $cache_name" ;;
  esac

  next=$((number + 1))
  sed -i.bak -E "s/^const CACHE = \"${prefix}[0-9]+\";$/const CACHE = \"${prefix}${next}\";/" sw.js
  rm -f sw.js.bak
  grep -q "^const CACHE = \"${prefix}${next}\";$" sw.js || die "service worker sürümü güncellenemedi"

  say "Service worker önbelleği: ${cache_name} -> ${prefix}${next}"
  [ -n "$MSG" ] || MSG="Ship a fresh offline shell as v${next}"
else
  say "Çevrimdışı kabuk değişmedi; service worker sürümü aynı kalıyor."
  [ -n "$MSG" ] || MSG="Update site content"
fi

git add -A
git commit -m "$MSG"
say "Commit oluşturuldu: $(git --no-pager log -1 --oneline)"

if [ "$PUSH" -eq 0 ]; then
  say "--no-push verildi; push edilmedi."
  exit 0
fi

git symbolic-ref -q HEAD >/dev/null || die "HEAD ayrık (detached); push edilecek bir dal yok"

say "origin/main alınıyor…"
git fetch --quiet origin main || die "origin/main alınamadı (ağ ya da kimlik doğrulama sorunu?)"

if git rev-parse --verify -q origin/main >/dev/null; then
  git merge-base --is-ancestor origin/main HEAD ||
    die "origin/main bu commit'in atası değil; önce main'i birleştirip (merge/rebase) tekrar dene"
fi

say "main'e push ediliyor…"
git push origin HEAD:main

say "Yayınlandı. GitHub Pages siteyi genellikle bir dakika içinde yeniler:"
pages_url=$(git remote get-url origin 2>/dev/null |
  sed -E -e 's#^git@github\.com:([^/]+)/(.+)$#https://\1.github.io/\2/#' \
         -e 's#^https://github\.com/([^/]+)/(.+)$#https://\1.github.io/\2/#' \
         -e 's#\.git/$#/#' || true)
case "$pages_url" in
  https://*) say "  $pages_url" ;;
esac
