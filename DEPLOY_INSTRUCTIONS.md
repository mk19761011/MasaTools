# 医療用語辞書ページ 公開手順

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
