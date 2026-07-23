// ============================================================
// MasaTools ダウンロード数 / 訪問数カウンター  (Google Apps Script)
// ============================================================
// このスクリプトは、各アプリの「ダウンロード」ボタンや自己分析サイトの
// 「訪問」を1件ずつスプレッドシートに記録し、管理者だけがシートで
// 集計（総数・ユニーク）を確認できるようにするものです。
//
// ── セットアップ手順 ─────────────────────────────
//   1. Googleドライブで新しいスプレッドシートを作成する（名前は任意）。
//   2. そのスプレッドシートのURLに含まれる ID をコピーし、下の SHEET_ID に貼る。
//        例: https://docs.google.com/spreadsheets/d/【この部分がID】/edit
//   3. 同じスプレッドシートで「拡張機能」→「Apps Script」を開き、
//        このファイル全体をコピペする。
//   4. エディタ上部の関数選択で「setup」を選び ▶ 実行 → 権限を承認。
//        → events / summary シートが自動生成される。
//   5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//        - 実行するユーザー: 自分
//        - アクセスできるユーザー: 全員
//   6. 表示された /exec で終わるURLをコピーし、
//        /analytics/count.js の ENDPOINT に貼り付ける。
//
//   ※ 集計は summary シートを開くだけで確認できます（管理者＝シートの
//      オーナーのみアクセス可）。追加のパスワードやページは不要です。
// ============================================================

const SHEET_ID     = "1UNhb2Ah3bDPCya6zgCOFB36lspiuV4nYLZZWuD-QNms";
const EVENTS_SHEET = "events";
const SUMMARY_SHEET = "summary";

// 集計対象アプリ:  [表示名, キー(count.jsと一致), 種別]
const APPS = [
  ["AI Talk Notes",          "aitalknotes",  "download"],
  ["医療用語辞書",            "medicaldict",  "download"],
  ["Volume Area Controller", "volumeac",     "download"],
  ["MultiLibLink",           "multiliblink", "download"],
  ["WinTimeLock",            "wintimelock",  "download"],
  ["自己分析サイト",          "iq-test",      "visit"]
];

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
    if (event !== "download" && event !== "visit") throw new Error("invalid event");

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sh = getEventsSheet();
      sh.appendRow([new Date(), app, event, vid]);
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
// 初回セットアップ: シートと集計表を作成する
// ============================================================
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // events シート（生ログ）
  let ev = ss.getSheetByName(EVENTS_SHEET);
  if (!ev) ev = ss.insertSheet(EVENTS_SHEET);
  if (ev.getLastRow() === 0) {
    ev.getRange(1, 1, 1, 4).setValues([["日時", "アプリ", "種別", "訪問者ID"]]);
    ev.setFrozenRows(1);
  }

  // summary シート（管理者が見る集計表）
  let sm = ss.getSheetByName(SUMMARY_SHEET);
  if (!sm) sm = ss.insertSheet(SUMMARY_SHEET);
  sm.clear();
  sm.getRange(1, 1, 1, 5).setValues([["アプリ", "種別", "総数", "ユニーク", "最終記録"]]);
  sm.getRange(1, 1, 1, 5).setFontWeight("bold");

  const e = "'" + EVENTS_SHEET + "'";
  const rows = APPS.map(function (a) { return [a[0], a[2]]; });
  sm.getRange(2, 1, rows.length, 2).setValues(rows);

  for (let i = 0; i < APPS.length; i++) {
    const key   = '"' + APPS[i][1] + '"';
    const type  = '"' + APPS[i][2] + '"';
    const r = i + 2;
    // 総数
    sm.getRange(r, 3).setFormula(
      '=COUNTIFS(' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + ')');
    // ユニーク（訪問者IDの種類数。該当0件なら0）
    sm.getRange(r, 4).setFormula(
      '=COUNTUNIQUEIFS(' + e + '!D2:D,' + e + '!B2:B,' + key + ',' + e + '!C2:C,' + type + ')');
    // 最終記録日時（該当0件なら空欄）
    sm.getRange(r, 5).setFormula(
      '=IF(COUNTIFS(' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + ')=0,"",' +
      'MAXIFS(' + e + '!A:A,' + e + '!B:B,' + key + ',' + e + '!C:C,' + type + '))');
  }
  sm.getRange(2, 5, APPS.length, 1).setNumberFormat("yyyy/mm/dd hh:mm");
  sm.setFrozenRows(1);
  sm.autoResizeColumns(1, 5);

  SpreadsheetApp.getActive().toast && null; // no-op
}

// ============================================================
// ヘルパー
// ============================================================
function getEventsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(EVENTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EVENTS_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([["日時", "アプリ", "種別", "訪問者ID"]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
