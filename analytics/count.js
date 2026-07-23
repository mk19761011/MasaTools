/* ============================================================
 * MasaTools ダウンロード数 / 訪問数カウンター（クライアント側）
 * ------------------------------------------------------------
 * 使い方:
 *   1. 各ページの </body> 直前に次の1行を追加:
 *        <script src="/analytics/count.js" defer></script>
 *   2. ダウンロードリンクに data-mt-download="アプリキー" を付けると
 *        クリック時に自動でカウントされる。
 *        例: <a href="..." data-mt-download="wintimelock">ダウンロード</a>
 *   3. 訪問数を数えたいページ（自己分析サイト）では、読み込み時に
 *        1回だけ MasaCount.visit("iq-test") が呼ばれるよう、body に
 *        data-mt-visit="iq-test" を付けるか、明示的に呼び出す。
 *
 *   ENDPOINT には Apps Script ウェブアプリの /exec URL を貼る。
 *   ※ 同一端末の重複は、集計側の「ユニーク」列で除外される。
 *      さらに短時間の二重クリックはこのスクリプトが抑制する。
 * ============================================================ */
(function () {
  "use strict";

  // ↓ Apps Script デプロイ後の /exec URL に差し替える
  var ENDPOINT = "https://script.google.com/macros/s/AKfycby9Z7Kjh99UOXkbJ9mS13PyfRn7lv0Z3ieUqFtCdjoVp9NkONGXvBdRntAsCnBVJpQh/exec";

  var VID_KEY = "mt_vid";
  var recent = {};            // 直近送信の抑制用
  var THROTTLE_MS = 4000;     // 同一(アプリ+種別)は4秒以内の再送を抑制

  function isConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(ENDPOINT);
  }

  function visitorId() {
    try {
      var v = localStorage.getItem(VID_KEY);
      if (!v) {
        v = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(16).slice(2));
        localStorage.setItem(VID_KEY, v);
      }
      return v;
    } catch (e) {
      return "nostore";
    }
  }

  function send(app, event) {
    if (!app || !isConfigured()) return;
    var key = app + "|" + event;
    var now = Date.now();
    if (recent[key] && now - recent[key] < THROTTLE_MS) return;
    recent[key] = now;

    var payload = JSON.stringify({
      app: app,
      event: event,
      vid: visitorId(),
      t: new Date().toISOString()
    });

    // sendBeacon 優先（ページ遷移/ダウンロードでも確実に飛ぶ）
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
    } catch (e) { /* fallthrough */ }

    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: payload,
        keepalive: true,
        mode: "no-cors"
      });
    } catch (e) { /* ignore */ }
  }

  window.MasaCount = {
    download: function (app) { send(app, "download"); },
    visit: function (app) { send(app, "visit"); }
  };

  // data-mt-download を持つ要素のクリックを自動計測
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest
      ? e.target.closest("[data-mt-download]")
      : null;
    if (el) send(el.getAttribute("data-mt-download"), "download");
  }, true);

  // body[data-mt-visit] があれば読み込み時に訪問を1回計測
  function autoVisit() {
    var b = document.body;
    if (b && b.getAttribute("data-mt-visit")) {
      send(b.getAttribute("data-mt-visit"), "visit");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoVisit);
  } else {
    autoVisit();
  }
})();
