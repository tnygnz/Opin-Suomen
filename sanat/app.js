(function () {
  "use strict";

  /* ---------------------------------------------------
     EKRAN: Liste (Optimizasyonlu 200'erli Sayfalama)
     --------------------------------------------------- */
  var listCat = "";
  var listQuery = "";
  var listLimit = 200;

  function renderList() {
    var app = document.getElementById("app");
    if (!app) return;

    var categories = Array.from(
      new Set(WORDS.map(function (w) { return w.cat; }))
    ).sort();

    var chips = '<button type="button" class="chip ' + (!listCat ? "active" : "") + '" data-cat="">Tümü (' + WORDS.length + ')</button>';
    chips += '<button type="button" class="chip ' + (listCat === "__weak__" ? "active" : "") + '" data-cat="__weak__">Zayıf Telaffuzlar</button>';
    categories.forEach(function (c) {
      chips += '<button type="button" class="chip ' + (listCat === c ? "active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    });

    app.innerHTML =
      '<section class="section">' +
        '<h2>Kelime Listesi</h2>' +
        '<p class="muted">Tüm kelimeleri arayın veya kategoriye göre süzün.</p>' +
        '<input type="search" id="search" placeholder="Fince veya Türkçe ara..." value="' + esc(listQuery) + '">' +
        '<div class="chips">' + chips + '</div>' +
        '<div id="rows" class="rows"></div>' +
      '</section>';

    var search = document.getElementById("search");
    if (search) {
      search.addEventListener("input", function () {
        listQuery = this.value;
        listLimit = 200;
        fillRows();
      });
    }

    var chipsDiv = app.querySelector(".chips");
    if (chipsDiv) {
      chipsDiv.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-cat]");
        if (!btn) return;
        listCat = btn.getAttribute("data-cat") || "";
        listLimit = 200;
        renderList();
      });
    }

    fillRows();
  }

  function fillRows() {
    var box = document.getElementById("rows");
    if (!box) return;
    var q = listQuery.trim().toLowerCase();
    var weakMode = listCat === "__weak__";
    var pool = weakMode ? weakWords() : WORDS;
    var rows = pool.filter(function (w) {
      if (!weakMode && listCat && w.cat !== listCat) return false;
      if (!q) return true;
      return (w.fi + " " + w.tr).toLowerCase().indexOf(q) !== -1;
    });

    if (!rows.length) {
      box.innerHTML = weakMode
        ? '<p class="muted center">Liste boş – Telaffuz modunda %60 altında kalan kelimeler burada birikir.</p>'
        : '<p class="muted center">Sonuç yok.</p>';
      return;
    }

    if (typeof listLimit === "undefined") listLimit = 200;
    var visibleRows = rows.slice(0, listLimit);
    var html = "";

    visibleRows.forEach(function (w) {
      var c = state.cards[w.fi];
      var dots = "";
      for (var i = 1; i <= 5; i++) dots += '<i class="dot' + (c && c.box >= i ? " on" : "") + '"></i>';

      html += '<div class="row-item">' +
        '<div class="row-main">' +
          '<div class="row-fields"><b>' + esc(w.fi) + '</b><span>' + esc(w.tr) + '</span></div>' +
          (w.note ? '<p class="note">' + esc(w.note) + '</p>' : "") +
        '</div>' +
        '<div class="row-side">' +
          '<button type="button" class="icon-btn" data-action="speak" data-fi="' + esc(w.fi) + '" data-lang="fi-FI" title="Fince oku">' + ico("speaker") + '</button>' +
          (weakMode
            ? '<span class="score-pill ' + scoreClass(state.pron[w.fi].last) + '">' + state.pron[w.fi].last + '%</span>'
            : '<div class="dots">' + dots + '</div>') +
        '</div>' +
      '</div>';
    });

    if (rows.length > listLimit) {
      html += '<div class="center" style="margin:16px 0;"><button type="button" id="btn-load-more" class="btn primary">Daha Fazla Göster (' + listLimit + ' / ' + rows.length + ')</button></div>';
    }

    box.innerHTML = html;

    var btnMore = document.getElementById("btn-load-more");
    if (btnMore) {
      btnMore.addEventListener("click", function() {
        listLimit += 200;
        fillRows();
      });
    }
  }

})();
