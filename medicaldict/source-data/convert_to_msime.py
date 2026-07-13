# -*- coding: utf-8 -*-
"""精査済み辞書(medical_dict_cleaned_v2026.7.5.txt)を Windows の
Microsoft IME 辞書ツール「テキストファイルからの登録」用ファイルに変換する。

MS-IME 辞書ツールの要件(2025時点):
  - 文字コード: UTF-16 LE (BOM可)。UTF-8/UTF-16 BE は不可。
  - タブ区切り: よみ<TAB>語<TAB>品詞
  - 改行: CR+LF
  - 先頭の "!" 始まりの行はコメント(ヘッダ)として扱われる。

元データ自体が既にMS-IME辞書ツール形式(ヘッダ + よみ␉語␉品詞)なので、
ここでは主にエンコーディング(UTF-16LE/CRLF)への変換を行う。

使い方: python convert_to_msime.py
出力:  medical_dict_msime_v2026.7.5.txt (UTF-16 LE BOM, CRLF)
"""
import io

SRC = "medical_dict_cleaned_v2026.7.5.txt"
OUT = "medical_dict_msime_v2026.7.5.txt"


def main():
    lines = io.open(SRC, "r", encoding="utf-8").read().splitlines()
    out_lines = []
    n = 0
    seen = set()
    for line in lines:
        if line.startswith("!"):
            out_lines.append(line)          # ヘッダ(コメント)はそのまま
            continue
        if not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) < 2:
            continue
        yomi = cols[0].strip()
        word = cols[1].strip()
        pos = cols[2].strip() if len(cols) > 2 and cols[2].strip() else "名詞"
        if not yomi or not word:
            continue
        if (yomi, word) in seen:
            continue
        seen.add((yomi, word))
        out_lines.append(f"{yomi}\t{word}\t{pos}")
        n += 1

    # CR+LF 改行で連結し、UTF-16 LE(BOM) で書き出す
    body = "\r\n".join(out_lines) + "\r\n"
    with io.open(OUT, "wb") as f:
        f.write(body.encode("utf-16-le"))   # 先頭にBOMを付与
        # ↑ utf-16-le はBOMを付けないので、先頭に手動でBOMを入れる
    # BOMを付けて書き直す(明示的に)
    with io.open(OUT, "wb") as f:
        f.write(b"\xff\xfe")                 # UTF-16 LE BOM
        f.write(body.encode("utf-16-le"))

    print(f"[OK] 出力: {OUT} (UTF-16 LE BOM, CRLF)")
    print(f"エントリ数: {n}")


if __name__ == "__main__":
    main()
