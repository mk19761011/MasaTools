# 医療用語辞書ページ 公開手順

## 配布ファイル更新日時（サイト共通）

トップページと各アプリのダウンロードボタン付近に、`mt-release-info` の段落で日時を表示しています。
基準は**現在リンクしている配布ファイルを公開リポジトリへ登録・差し替えたコミットの committer 日時**です。
ビルド日時、READMEに記載したアプリ更新日、紹介ページの編集日時、Cloudflareへのデプロイ完了日時とは区別します。
画面は日本時間で分まで表示し、`time` 要素の `datetime` に秒・タイムゾーンを含む日時を保持します。

掲載している配布ファイルの根拠：

| 配布物 | 更新日時（日本時間） | 根拠コミット | 配布元 |
| --- | --- | --- | --- |
| AI Talk Notes v1.2.2 APK | 2026-09-26 01:53:47 | `e30d13452165cabe07ac4c1cd90617d80b6fee7b` | main / aitalknotes/download |
| 医療用語辞書 Android APK | 2026-08-01 23:56:45 | `f99dacc0724c83cb579a3b4323182f55b6a2cd60` | main / medicaldict/download |
| 医療用語辞書 MS-IME TXT | 2026-07-14 09:26:09 | `fd25ce8f8a2605c97c3d336d9e071bd42eaed021` | main / medicaldict/download |
| 医療用語辞書 Apple PLIST | 2026-07-10 19:41:51 | `4841633a510de2357d096534a8743057e7e72394` | main / medicaldict/download |
| MultiLibLink v1.4.0-b27 EXE | 2026-11-24 18:15:21 | `bf98e8c3331aef3bf781708198e49124157e6554` | tag: multiliblink-v1.4.0-b27 |
| WinTimeLock v1.7（ビルド24）EXE | 2026-11-23 17:51:14 | `292c9d328ad67d4b3fff4971083514c249d3d049` | tag: wintimelock-v1.7-b24 |

Volume Area Controller のAPK配布は 2026-10-30 に停止した（今後はGoogle Playのみ）。古いAPKのURLは `_redirects` で紹介ページへ転送する。

次回配布時は `git log -1 --format=%cI <配布元のブランチまたはタグ> -- <配布ファイル>` で確認し、
トップページ・ツール一覧・紹介ページ内の全ダウンロードボタン・専用ダウンロードページの日時を同時に更新してください。
医療用語辞書は形式ごとに確認し、トップページの日時はAndroid版を示します。
文章やスクリーンショットだけを変更した場合、この日時は変更しません。

このフォルダの内容は、MasaTools（本サイト）リポジトリのルートへ上書き配置する構成です。

## 含まれるページ

- `index.html`
  - MasaToolsトップページ
  - 「医療用語辞書」カードを追加済み
- `medicaldict/index.html`
  - アプリ紹介・使い方・注意事項・APKダウンロード
- `medicaldict/source/index.html`
  - 元データ、加工内容、監査結果、ライセンス
- `medicaldict/privacy/index.html`
  - プライバシーポリシー
- `medicaldict/download/README.txt`
  - APK配置方法

## APKの配置

署名済みAPKを次の名前で配置してください。

```text
medicaldict/download/medical_dict_android_v2026.7.5.apk
```

公開前にSHA-256を確認してください。

```text
6b857804cb419ebaa6171bcbac0deba05ac28260037134e44664e4b0be7954a9
```

APKが未配置の間、紹介ページには「APK公開準備中」と表示されます。
APKが配置されると、HEADリクエストで存在を確認し、ダウンロードボタンが自動で有効になります。

## 公開前の重要確認

1. 最終APKを再ビルドした場合は、ページ記載のSHA-256も更新する
2. APKのファイル名を変えた場合は `medicaldict/index.html` の `path` も変更する
4. Cloudflare Pagesのデプロイ完了後、次を確認する
   - `/`
   - `/medicaldict/`
   - `/medicaldict/source/`
   - `/medicaldict/privacy/`
   - APKのダウンロード
5. Android実機でダウンロードからインストールまで確認する

## 推奨コミットメッセージ

```text
Add medical dictionary download and source pages
```
