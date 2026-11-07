#!/usr/bin/env bash
set -e

git config pull.rebase false

echo "--> Değişiklikler ekleniyor..."
git add .

echo "--> Commit oluşturuluyor..."
git commit -m "update: yerel güncellemeler ve senkronizasyon" || true

echo "--> Ana depoya push yapılıyor..."
git push origin main

echo "--> Yan depolar senkronize ediliyor..."
for repo in "git@github.com:tnygnz/suomi-kartat.git" "git@github.com:tnygnz/Opin-Suomen.git"; do
  if ! git push "$repo" main 2>/dev/null; then
    git pull "$repo" main --no-edit -X ours || true
    git add .
    git commit -m "merge: otomatik senkronizasyon birleştirmesi" || true
    git push "$repo" main
  fi
done

echo "--> Tüm depolar koruma altında başarıyla eşitlendi!"
