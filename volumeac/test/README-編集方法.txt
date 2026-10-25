音量エリアコントローラー テスター向けWebページ
=================================

■ 公開場所
https://masatools.pages.dev/volumeac/test/
（検索結果に出さない設定。URLを知っている人だけが開く前提。非公開ではない）

■ 参加の流れ（2026年10月25日に作り直し。審査が通ってテストが始まってから募集する）
① テスター用Googleグループに参加
   https://groups.google.com/g/masatools-volumeac-testers
② 「テスターになる」を押す
   https://play.google.com/apps/testing/com.masatools.volumeac
③ Google Playからインストール
   https://play.google.com/store/apps/details?id=com.masatools.volumeac
以前のGoogleフォームで申し込む方式はやめた（フォーム自体はGoogleドライブに残っている）。

■ 編集する場所
index.html の末尾にある CONFIG だけ直せば、表示が変わります。

  videoId      ショート動画ができたら YouTube の動画ID を入れる（空なら動画欄は出ない）
  testStartDate / testEndDate   テスト期間（開始から14日後）
  updatedDate  このページを最後に直した日

■ 必ず残す文（大事）
参加の前に、メールアドレスの注意書きが目に入るようにしておく。
「参加すると、あなたのGoogleアカウントのメールアドレスが開発者（私）だけに見えます。
 ほかの参加者には見えません。テストの管理以外には使わず、本番公開後にグループは削除します。
 気になる方はサブのGoogleアカウントでご参加ください。」

■ 画像
images/step-4-first-use.jpg だけ使っている（実際の画面）。
step-1〜3 のSVGは旧方式の仮画像で、今は使っていない。
アプリ画面を撮り直すときは、「現在地の判定」欄の緯度・経度が写らないよう折りたたむこと。

■ 公開
MasaToolsリポジトリの main に push すると Cloudflare Pages が自動で公開する。
publish.bat（add -A）は使わず、対象ファイルだけ add してコミットする。
