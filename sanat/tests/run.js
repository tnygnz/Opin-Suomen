/* Tüm test dosyalarını sırayla koşar ve tek bir çıkış kodu verir.

   Kullanım:  cd sanat && node tests/run.js
   Tek tek:   node tests/smoke.test.js  ·  node tests/kbd-hint.test.js

   Dosyalar ayrı süreçlerde koşar: her biri kendi DOM taklidini kurar, sayaçları
   ayrı kalır ve biri patlarsa diğeri yine koşar. Herhangi biri başarısızsa
   runner 1 ile çıkar. */

const { spawnSync } = require("child_process");
const path = require("path");

const files = ["smoke.test.js", "kbd-hint.test.js", "packs.test.js", "import.test.js"];
let failed = 0;

files.forEach(function (file) {
  console.log("\n=== " + file + " ===");
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  if (res.status !== 0) failed += 1;
});

console.log("\n" + (failed ? failed + " test dosyası başarısız" : "Tüm test dosyaları geçti"));
process.exit(failed ? 1 : 0);
