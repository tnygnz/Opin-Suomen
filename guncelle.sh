#!/usr/bin/env bash

echo "--> Değişiklikler ekleniyor..."
git add .

echo "--> Commit atılıyor..."
git commit -m "update: $(date '+%Y-%m-%d %H:%M:%S')" || true

echo "--> Depolar güncelleniyor..."
git push origin main
git push -f git@github.com:tnygnz/suomi-kartat.git main
git push -f git@github.com:tnygnz/Opin-Suomen.git main

echo "--> Tüm depolar başarıyla eşitlendi!"
