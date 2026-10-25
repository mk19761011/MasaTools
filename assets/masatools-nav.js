/*
  「ツール一覧へ戻る」は、一覧ページからアプリのページへ来た人にだけ出す。

  ・一覧ページ（<body data-mt-list-page>）を開くと、そのタブに一覧のURLを覚えておく。
  ・アプリのページの [data-mt-list-link] は最初は隠してあり、覚えたURLがあるときだけ
    表示して、戻り先をそのURLにする。
  ・アプリのURLを直接開いた人（Vector・Google Play・案内メールなどから来た人）には何も出ない。
  ・アプリのページのHTMLには一覧のURLを書かない（ソースを見ても分からないように）。
*/
(function () {
  var KEY = "mt_list_page";
  try {
    if (document.body.hasAttribute("data-mt-list-page")) {
      sessionStorage.setItem(KEY, location.pathname);
      return;
    }
    var listPath = sessionStorage.getItem(KEY);
    if (!listPath) return;
    var items = document.querySelectorAll("[data-mt-list-link]");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var links = el.tagName === "A" ? [el] : el.querySelectorAll("a");
      for (var j = 0; j < links.length; j++) links[j].setAttribute("href", listPath);
      el.hidden = false;
    }
  } catch (e) {
    // sessionStorage が使えない環境では、戻るリンクを出さないだけ
  }
})();
