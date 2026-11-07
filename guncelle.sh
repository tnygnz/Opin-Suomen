#!/usr/bin/env bash
set -e

echo "--> Değişiklikler ekleniyor..."
git add .

echo "--> Commit oluşturuluyor..."
git commit -m "fix: tam app.js onarımı + araçlar + 200erli lazy rendering" || true

echo "--> Ana depoya push yapılıyor..."
git push origin main

if [ -f "tools/ayna.sh" ]; then
  echo "--> Ayna senkronizasyonu çalıştırılıyor..."
  bash tools/ayna.sh || echo "Ayna senkronizasyonu uyarısı."
else
  echo "--> Yan depolar güncelleniyor..."
  git push git@github.com:tnygnz/suomi-kartat.git main || true
  git push git@github.com:tnygnz/Opin-Suomen.git main || true
fi

echo "--> Onarım ve senkronizasyon tamamlandı!"
