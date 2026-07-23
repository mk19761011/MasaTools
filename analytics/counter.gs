// ============================================================
// MasaTools ダウンロード数 / 訪問数 / 滞在時間 カウンター  (Google Apps Script)
// ============================================================
// 各アプリの「ダウンロード」、自己分析サイトの「訪問」と「滞在時間」を
// 1件ずつスプレッドシートに記録し、管理者だけがシートで集計を確認できます。
//
// ── セットアップ手順 ─────────────────────────────
//   1. スプレッドシートを作成し、URLの ID を下の SHEET_ID に貼る。
//   2. 「拡張機能」→「Apps Script」を開き、このファイル全体をコピペ。
//   3. 関数「setup」を ▶ 実行（権限を承認）→ events / summary を作成。
//   4. 関数「setupDaily」を ▶ 実行 → daily（日別集計＋グラフ）を作成。
//   5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
//        - 実行するユーザー: 自分 / アクセスできるユーザー: 全員
//   6. 表示された /exec URL を /analytics/count.js の ENDPOINT に貼る。
//
//   ※ コードを更新したら「デプロイ」→「デプロイを管理」→ 鉛筆(編集)
//      →「バージョン: 新バージョン」→ デプロイ で反映する（URLは不変）。
// ============================================================

const SHEET_ID      = "1UNhb2Ah3bDPCya6zgCOFB36lspiuV4nYLZZWuD-QNms";
const EVENTS_SHEET  = "events";
const SUMMARY_SHEET = "summary";
const DAILY_SHEET   = "daily";
const MAX_DWELL     = 7200; // 滞在秒数の上限（異常値対策）

// 集計対象アプリ:  [表示名, キー(count.jsと一致), 主要な種別]
const APPS = [
  ["AI Talk Notes",          "aitalknotes",  "download"],
  ["医療用語辞書",            "medicaldict",  "download"],
  ["Volume Area Controller", "volumeac",     "download"],
  ["MultiLibLink",           "multiliblink", "download"],
  ["WinTimeLock",            "wintimelock",  "download"],
  ["自己分析サイト",          "iq-test",      "visit"]
];

const EVENT_HEADERS = ["日時", "アプリ", "種別", "訪問者ID", "値(秒)", "日付"];

// ============================================================
// 記録ハンドラ（各ページからのビーコンを受け取る）
// ============================================================
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const app   = String(data.app   || "").slice(0, 40);
    const event = String(data.event || "").slice(0, 20);
    const vid   = String(data.vid   || "").slice(0, 64);

    if (!app) throw new Error("app required");
    if (event !== "download" && event !== "visit" && event !== "dwell") {
      throw new Error("invalid event");
    }

    // 値（滞在秒数など）。数値以外・0以下は空欄扱い。
    let value = Number(data.value);
    value = (isFinite(value) && value > 0) ? Math.min(Math.round(value), MAX_DWELL) : "";

    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sh = getEventsSheet();
      sh.appendRow([now, app, event, vid, value, day]);
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ============================================================
// 簡易ヘルスチェック（ブラウザで /exec を開いた時用）
// ============================================================
function doGet() {
  return json({ ok: true, service: "masatools-counter" });
}

// ============================================================
// setup: events（生ログ）と summary（総合集計）を作成する
// ============================================================
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // events シート: ヘッダを6列に整える（データ行には触れない）
  const ev = getEventsSheet();
  ev.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS]);
  ev.getRange("A:A").setNumberFormat("yyyy/mm/dd hh:mm:ss");
  ev.getRange("F:F").setNumberFormat("yyyy/mm/dd");
  ev.setFrozenRows(1);

  // summary シート
  let sm = ss.getSheetByName(SUMMARY_SHEET);
  if (!sm) sm = ss.insertSheet(SUMMARY_SHEET);
  sm.clear();
  sm.getRange(1, 1, 1, 5).setValues([["アプリ", "種別", "総数", "ユニーク", "最終記録"]]);
  sm.getRange(1, 1, 1, 5).setFontWeight("bold");

  const e = "'" + EVENTS_SHEET + "'";
  const rows = APPS.map(function (a) { return [a[0], a[2]]; });
  sm.getRange(2, 1, rows.length, 2).setValues(rows);

  for (let i = 0; i < APPS.length; i++) {
    const key  = '"' + APPS[i][1] + '"';
    const type = '"' + APPS[i][2] + '"';
    const r = i + 2;
    sm.getRange(r, 3).setFormula(
      '=COUNTIFS(' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + ')');
    sm.getRange(r, 4).setFormula(
      '=COUNTUNIQUEIFS(' + e + '!D2:D,' + e + '!B2:B,' + key + ',' + e + '!C2:C,' + type + ')');
    sm.getRange(r, 5).setFormula(
      '=IF(COUNTIFS(' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + ')=0,"",' +
      'MAXIFS(' + e + '!A:A,' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + '))');
  }
  sm.getRange(2, 5, APPS.length, 1).setNumberFormat("yyyy/mm/dd hh:mm");

  // 自己分析サイトの滞在時間サマリー
  const base = APPS.length + 3; // 例: 9行目
  sm.getRange(base, 1).setValue("■ 自己分析サイト 滞在時間").setFontWeight("bold");
  const visitCnt = 'COUNTIFS(' + e + '!B:B,"iq-test",' + e + '!C:C,"visit")';
  const dwellSum = 'SUMIFS(' + e + '!E:E,' + e + '!B:B,"iq-test",' + e + '!C:C,"dwell")';
  const rowsD = [
    ["訪問数",                 '=' + visitCnt],
    ["平均滞在／訪問（秒）",     '=IFERROR(ROUND(' + dwellSum + '/' + visitCnt + ',0),0)'],
    ["平均滞在／訪問（分:秒）", '=IFERROR(TEXT((' + dwellSum + '/' + visitCnt + ')/86400,"[m]:ss"),"0:00")'],
    ["総滞在（分）",           '=ROUND(' + dwellSum + '/60,1)']
  ];
  for (let i = 0; i < rowsD.length; i++) {
    sm.getRange(base + 1 + i, 1).setValue(rowsD[i][0]);
    sm.getRange(base + 1 + i, 2).setFormula(rowsD[i][1]);
  }

  sm.setFrozenRows(1);
  sm.autoResizeColumns(1, 5);
}

// ============================================================
// setupDaily: daily（日別の件数・ユニーク・グラフ）を作成する
// ============================================================
function setupDaily() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(DAILY_SHEET);
  if (!sh) sh = ss.insertSheet(DAILY_SHEET);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();

  const e = "'" + EVENTS_SHEET + "'";

  // ── 左側: 日別 件数（延べ）。ダウンロード/訪問のみ（滞在=dwellは除外） ──
  sh.getRange(1, 1).setValue("■ 日別 件数（延べ）").setFontWeight("bold");
  sh.getRange(3, 1).setFormula(
    '=IFERROR(QUERY(' + e + '!A2:F,' +
    ' "select F, count(A) where F is not null and C != \'dwell\'' +
    ' group by F pivot B order by F label F \'日付\'", 0), "データがありません")');
  sh.getRange("A4:A").setNumberFormat("yyyy/mm/dd");

  // ── 右側(J列〜): 日別 ユニーク（実利用者数） ──
  sh.getRange(2, 10).setValue("■ 日別 ユニーク（実利用者数）").setFontWeight("bold");
  sh.getRange(3, 10).setValue("日付");
  sh.getRange(4, 10).setFormula(
    '=IFERROR(SORT(UNIQUE(FILTER(' + e + '!F2:F,' + e + '!F2:F<>""))),"")');
  sh.getRange("J4:J").setNumberFormat("yyyy/mm/dd");

  for (let i = 0; i < APPS.length; i++) {
    const col = 11 + i; // K列〜
    const key  = '"' + APPS[i][1] + '"';
    const type = '"' + APPS[i][2] + '"';
    sh.getRange(3, col).setValue(APPS[i][0]);
    sh.getRange(4, col).setFormula(
      '=MAP($J$4:$J$400, LAMBDA(d, IF(d="","",' +
      'COUNTUNIQUEIFS(' + e + '!$D$2:$D,' + e + '!$B$2:$B,' + key + ',' +
      e + '!$C$2:$C,' + type + ',' + e + '!$F$2:$F,d))))');
  }

  // ── 折れ線グラフ（日別件数の推移） ──
  const chart = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sh.getRange("A3:G400"))
    .setNumHeaders(1)
    .setOption("title", "日別 件数（延べ）の推移")
    .setOption("useFirstColumnAsDomain", true)
    .setOption("legend", { position: "right" })
    .setPosition(2, 20, 0, 0) // T列あたりに配置（表と重ならない）
    .build();
  sh.insertChart(chart);
}

// ============================================================
// ヘルパー
// ============================================================
function getEventsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(EVENTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EVENTS_SHEET);
    sh.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
