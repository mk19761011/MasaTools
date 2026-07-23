/* ============================================================
 * MasaTools ダウンロード数 / 訪問数 / 滞在時間 カウンター（クライアント側）
 * ------------------------------------------------------------
 * 使い方:
 *   1. 各ページの </body> 直前に次の1行を追加:
 *        <script src="/analytics/count.js" defer></script>
 *   2. ダウンロードリンクに data-mt-download="アプリキー" を付けると
 *        クリック時に自動でカウントされる。
 *        例: <a href="..." data-mt-download="wintimelock">ダウンロード</a>
 *   3. 訪問・滞在時間を数えたいページ（自己分析サイト）では body に
 *        data-mt-visit="iq-test" を付ける。
 *        → 読み込み時に訪問を1回、離脱時に前面表示していた滞在秒数を送信。
 *
 *   ENDPOINT には Apps Script ウェブアプリの /exec URL を貼る。
 *   ※ 同一端末の重複は集計側の「ユニーク」列で除外。短時間の二重クリックも抑制。
 * ============================================================ */
(function () {
  "use strict";

  // ↓ Apps Script デプロイ後の /exec URL に差し替える
  var ENDPOINT = "https://script.google.com/macros/s/AKfycby9Z7Kjh99UOXkbJ9mS13PyfRn7lv0Z3ieUqFtCdjoVp9NkONGXvBdRntAsCnBVJpQh/exec";

  var VID_KEY = "mt_vid";
  var recent = {};            // 直近送信の抑制用（download/visit のみ）
  var THROTTLE_MS = 4000;     // 同一(アプリ+種別)は4秒以内の再送を抑制
  var MAX_DWELL = 7200;       // 滞在秒数の上限（異常値対策）

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

  function send(app, event, value) {
    if (!app || !isConfigured()) return;

    // download / visit は二重クリック抑制。dwell は値を持つので抑制しない。
    if (event !== "dwell") {
      var key = app + "|" + event;
      var now = Date.now();
      if (recent[key] && now - recent[key] < THROTTLE_MS) return;
      recent[key] = now;
    }

    var payload = JSON.stringify({
      app: app,
      event: event,
      vid: visitorId(),
      value: value || 0,
      t: new Date().toISOString()
    });

    // sendBeacon 優先（ページ遷移/ダウンロード/離脱でも確実に飛ぶ）
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

  // ── 滞在時間（前面表示していた実時間を積算し、離脱時に送信） ──
  var dwellKey = null;
  var activeMs = 0;
  var lastStart = 0;

  function startTimer() {
    if (dwellKey && lastStart === 0) lastStart = Date.now();
  }
  function stopTimer() {
    if (lastStart !== 0) { activeMs += Date.now() - lastStart; lastStart = 0; }
  }
  function flushDwell() {
    stopTimer();
    var sec = Math.round(activeMs / 1000);
    if (dwellKey && sec >= 1) {
      send(dwellKey, "dwell", Math.min(sec, MAX_DWELL));
      activeMs = 0; // 送信済み分はリセット（復帰後の二重計上を防ぐ）
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushDwell();
    else startTimer();
  });
  window.addEventListener("pagehide", flushDwell);

  // body[data-mt-visit] があれば読み込み時に訪問を1回計測＋滞在計測を開始
  function autoStart() {
    var b = document.body;
    var k = b && b.getAttribute("data-mt-visit");
    if (!k) return;
    send(k, "visit");
    dwellKey = k;
    if (document.visibilityState !== "hidden") startTimer();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStart);
  } else {
    autoStart();
  }
})();
