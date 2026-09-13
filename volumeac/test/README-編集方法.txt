Volume Area Controller テスター向けWebページ
=================================

■ ファイル
- index.html
  テスター向けの案内ページ本体です。
- images/
  後から差し替えられる説明画像です。

■ 最初に編集する場所
index.htmlの末尾にある CONFIG を編集してください。

const CONFIG = {
  signupUrl: "",       // Googleフォームなどの申込URL
  feedbackUrl: "",     // Googleフォーム / GitHub Issuesなど
  privacyUrl: "https://masatools.pages.dev/volumeac/privacy/",
  contact: "masatools.info@gmail.com",
  testStartDate: "",   // 例: "2026年9月20日"
  testEndDate: "",     // 例: "2026年10月3日"
  updatedDate: "2026年9月13日"
};

■ 画像の差し替え
imagesフォルダ内の次のファイルを、実際の画面キャプチャへ差し替えます。

- step-1-application.svg  参加申込フォーム          （差し替え待ち）
- step-2-opt-in.svg       Google Playのテスター参加画面（差し替え待ち）
- step-3-install.svg      Google PlayのVolume Area Controllerページ（差し替え待ち）
- step-4-first-use.jpg    実際の画面（ホーム／場所タブ）  （作成済み。store_assets内の
                          screenshot-home.jpg / screenshot-locations.jpg相当を合成）

ファイル名を変えずに同名で保存すれば、index.htmlの修正は不要です。
PNGやWebPへ変更する場合は、index.htmlの画像ファイル名も変更してください。

「差し替え待ち」の3枚は、内容が分かる仮の図に「画像は準備中です」と
入れてあります。Google Playでクローズドテストを設定し、申込フォームを
作ったあとに、実際の画面を撮影して差し替えてください。

画像の大きさは 1600 x 870（16:8.7）で作ってあります。index.html 側が
object-fit: cover のため、これと違う比率にすると上下または左右が
切り取られます。スマートフォンの縦長スクリーンショットをそのまま入れると
大きく切れるので、横長の背景に配置した画像にしてください
（step-4-first-use.jpgと同じ要領で、白いカードに乗せて並べる形が簡単です）。

※アプリの画面を撮影するときは、「現在地の判定」欄の緯度・経度が写り込まないよう
　折りたたんでから撮影してください（自宅などの座標が特定できてしまいます）。
　ホーム・場所・音量・権限タブなら安全です。

■ 公開場所（現行）
https://masatools.pages.dev/volumeac/test/

このフォルダは volumeac/test/ にあり、サイト全体と同じ扱いです。
実際のデプロイ元はリポジトリ mk19761011/MasaTools です（Cloudflare Pagesが
mainブランチを自動デプロイします）。

このページは検索結果に出さない設定（noindex,nofollow）です。トップページ等から
リンクも張っていません。テスターにURLを直接伝えて使います。
※リンクを張らなくてもURLを知っていれば誰でも開けます。非公開ではありません。


■ テスト開始前に埋めるチェックリスト
テスターへURLを伝える前に、次がすべて埋まっているか確認してください。
埋まっていない項目があると、ボタンを押しても「準備中です」と出ます。

  [ ] signupUrl      参加申込フォーム（Googleフォーム）のURL
  [ ] feedbackUrl    不具合・感想の送り先URL
  [ ] testStartDate  テスト開始日（例: "2026年9月20日"）
  [ ] testEndDate    テスト終了日（開始から14日後）
  [ ] updatedDate    このページを最後に直した日
  [ ] images/step-1-application.svg  申込フォームの画面に差し替え
  [ ] images/step-2-opt-in.svg       Google Playの参加ページに差し替え
  [ ] images/step-3-install.svg      Google Playのアプリページに差し替え
  [ ] スマートフォンで表示を確認した

  設定済み: privacyUrl / contact / images/step-4-first-use.jpg


■ 公開前の確認事項
- 上の「テスト開始前に埋めるチェックリスト」がすべて埋まっているか
- Volume Area Controllerの実際の権限・データの扱いと、ページ内の説明が一致しているか
  （公開プライバシーポリシー https://masatools.pages.dev/volumeac/privacy/ が正）
- 特に「位置情報の許可を2つとも必須としてお願いする」旨が、実際のアプリの
  初回セットアップ（バックグラウンド位置情報を含む）と食い違っていないか
