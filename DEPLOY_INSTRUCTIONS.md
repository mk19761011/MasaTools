# 医療用語辞書ページ 公開手順

## 配布ファイル更新日時（サイト共通）

トップページと各アプリのダウンロードボタン付近に、`mt-release-info` の段落で日時を表示しています。
基準は**現在リンクしている配布ファイルを公開リポジトリへ登録・差し替えたコミットの committer 日時**です。
ビルド日時、READMEに記載したアプリ更新日、紹介ページの編集日時、Cloudflareへのデプロイ完了日時とは区別します。
画面は日本時間で分まで表示し、`time` 要素の `datetime` に秒・タイムゾーンを含む日時を保持します。

2026-09-19調査時点の根拠：

| 配布物 | 更新日時（日本時間） | 根拠コミット | 配布元 |
| --- | --- | --- | --- |
| AI Talk Notes v1.2.1 APK | 2026-08-01 23:56:45 | `f99dacc0724c83cb579a3b4323182f55b6a2cd60` | main / aitalknotes/download |
| 医療用語辞書 Android APK | 2026-08-01 23:56:45 | `f99dacc0724c83cb579a3b4323182f55b6a2cd60` | main / medicaldict/download |
| 医療用語辞書 MS-IME TXT | 2026-07-14 09:26:09 | `fd25ce8f8a2605c97c3d336d9e071bd42eaed021` | main / medicaldict/download |
| 医療用語辞書 Apple PLIST | 2026-07-10 19:41:51 | `4841633a510de2357d096534a8743057e7e72394` | main / medicaldict/download |
| Volume Area Controller v1.5.22 APK | 2026-09-13 14:41:15 | `27201ccf6ede70f87c8d65a40b440a04109d5d02` | main / volumeac/download |
| MultiLibLink v1.2 EXE | 2026-09-16 01:21:42 | `ba8a7f51af6a76f2bac64f3c8630a03e1f9ff93c` | tag: multiliblink-v1.2 |
| WinTimeLock v1.6 EXE | 2026-08-14 11:49:00 | `e39ba315210ede3fc8da3713b4621e1ecf3c80f3` | tag: wintimelock-v1.6 |

次回配布時は `git log -1 --format=%cI <配布元のブランチまたはタグ> -- <配布ファイル>` で確認し、
トップページ・紹介ページ内の全ダウンロードボタン・専用ダウンロードページの日時を同時に更新してください。
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
