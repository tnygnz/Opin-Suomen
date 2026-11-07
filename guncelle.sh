#!/usr/bin/env bash
# guncelle.sh — kısa yol: tek.sh'i zaman damgalı mesajla çağırır.
#   ./guncelle.sh   -> test, damga, commit, site push, yedek aynası, doğrulama
set -euo pipefail
cd "$(dirname "$0")"
exec ./tek.sh "update: $(date '+%Y-%m-%d %H:%M:%S')"
