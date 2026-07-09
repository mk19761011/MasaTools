# -*- coding: utf-8 -*-
"""精査済み辞書(medical_dict_cleaned_v2026.7.5.txt)を Android版Gboard の
単語リストインポート用ZIP (dictionary.txt入り) に変換する。

入力は curate_dictionary.py が生成・検証した正式版。ここでは追加のfail-closed
検証を行い、1つでも失敗したらZIPを生成せず終了する(APKビルドの前段防御)。

使い方: python convert_to_gboard.py
出力:  medical_dict_gboard_v2026.07.05.zip
"""
import io
import sys
import zipfile

SRC = "medical_dict_cleaned_v2026.7.5.txt"   # 精査済み正式版(UTF-8)
OUT_ZIP = "medical_dict_gboard_v2026.07.05.zip"
LOCALE = "ja-JP"
# Gboard実機のエクスポートで確認した正解フォーマット(2026-07):
#   1行目: # Gboard Dictionary version:2
#   2行目: # Gboard Dictionary format:shortcut<TAB>word<TAB>language_tag<TAB>pos_tag
#   3行目〜: 読み<TAB>単語<TAB>ja-JP<TAB>(品詞は空)
# ※ format定義行が無い/version:1 だと「2行目に形式エラー」でインポート停止。
# ※ 品詞欄はGboard自身も空でエクスポートするため空にする。
HEADER = ("# Gboard Dictionary version:2\n"
          "# Gboard Dictionary format:shortcut\tword\tlanguage_tag\tpos_tag\n")
POS = ""  # 品詞欄は空(Gboardのネイティブ形式に合わせる)
EXPECT_MIN, EXPECT_MAX = 42000, 43000

# 再混入してはならない既知の不良エントリ
FORBIDDEN = {
    ("10.04", "LucidLynx"), ("1004", "LucidLynx"), ("1204", "12.04"),
    ("14.04", "TrustyTahr"), ("1404", "14.04LTSTrustyTahr"), ("1404", "TrustyTahr"),
    ("おぞかりなーぜ", "レボフロキサシン"),
    ("Guillan-Barreしょうこうぐん", "GVHDこつずいいしょくご"),
    ("へんかんほうこくする", "https://goo.gl/forms/HEcNmMh837sgaDsx2"),
}


def load_entries(path):
    """正式版を読み込む。UTF-8以外・破損は検証で弾く。"""
    raw = io.open(path, "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise SystemExit(f"[NG] 入力がUTF-8でない: {e}")
    entries = []
    for i, line in enumerate(text.splitlines(), 1):
        if line.startswith("!") or not line.strip():
            continue
        cols = line.split("\t")
        # 品詞列を許容(よみ/単語/品詞)。よみ・単語の2列を使用。
        yomi = cols[0].strip() if len(cols) > 0 else ""
        word = cols[1].strip() if len(cols) > 1 else ""
        entries.append((i, yomi, word, len(cols)))
    return entries


def validate(entries):
    errors = []
    seen = set()
    for ln, y, w, ncol in entries:
        if ncol < 2:
            errors.append(f"L{ln}: 列不足")
            continue
        if ncol > 3:
            errors.append(f"L{ln}: 4列以上")
        if not y:
            errors.append(f"L{ln}: 空の読み")
        if not w:
            errors.append(f"L{ln}: 空の単語")
        if "\t" in w:
            errors.append(f"L{ln}: 単語にタブ")
        if any(ord(ch) < 32 for ch in y + w):
            errors.append(f"L{ln}: 制御文字")
        if (y, w) in seen:
            errors.append(f"L{ln}: 完全重複 {y}/{w}")
        seen.add((y, w))
        if (y, w) in FORBIDDEN:
            errors.append(f"L{ln}: 除外対象の再混入 {y}/{w}")
    n = len(seen)
    if not (EXPECT_MIN <= n <= EXPECT_MAX):
        errors.append(f"件数が想定範囲外: {n} (期待 {EXPECT_MIN}〜{EXPECT_MAX})")
    return errors, seen


def main():
    entries = load_entries(SRC)
    errors, pairs = validate(entries)
    if errors:
        print("[NG] 検証に失敗しました。ZIP/APKは生成しません。")
        for e in errors[:20]:
            print("  ", e)
        sys.exit(1)

    body = HEADER
    body += "".join(f"{y}\t{w}\t{LOCALE}\t{POS}\n" for (y, w) in dict.fromkeys(pairs))
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("dictionary.txt", body.encode("utf-8"))

    print(f"[OK] 検証通過")
    print(f"登録語数: {len(pairs)}")
    print(f"出力: {OUT_ZIP}")


if __name__ == "__main__":
    main()
