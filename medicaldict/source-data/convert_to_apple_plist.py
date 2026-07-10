# -*- coding: utf-8 -*-
"""精査済み辞書(medical_dict_cleaned_v2026.7.5.txt)を macOS / iOS の
「ユーザ辞書(テキスト置換)」インポート用 .plist (XML) に変換する。

macOSの「システム設定 > キーボード > ユーザ辞書」にこの.plistをドラッグして
取り込むと、iCloud経由でiPhone/iPadの「設定 > 一般 > キーボード > ユーザ辞書」
にも同期される。よみ(shortcut)を入力すると単語(phrase)が候補に出る。

plistの各エントリ:
    <dict>
      <key>phrase</key><string>単語(変換後に出したい語)</string>
      <key>shortcut</key><string>よみ(入力する読み)</string>
    </dict>

使い方: python convert_to_apple_plist.py
出力:  medical_dict_apple_v2026.7.5.plist
"""
import io
from xml.sax.saxutils import escape

SRC = "medical_dict_cleaned_v2026.7.5.txt"
OUT = "medical_dict_apple_v2026.7.5.plist"

HEADER = ('<?xml version="1.0" encoding="UTF-8"?>\n'
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
          '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
          '<plist version="1.0">\n<array>\n')
FOOTER = '</array>\n</plist>\n'


def main():
    lines = io.open(SRC, "r", encoding="utf-8").read().splitlines()
    seen = set()
    n = 0
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER)
        for line in lines:
            if not line.strip() or line.startswith("!"):
                continue
            cols = line.split("\t")
            if len(cols) < 2:
                continue
            yomi, word = cols[0].strip(), cols[1].strip()
            if not yomi or not word:
                continue
            if (yomi, word) in seen:
                continue
            seen.add((yomi, word))
            f.write("  <dict>\n"
                    f"    <key>phrase</key><string>{escape(word)}</string>\n"
                    f"    <key>shortcut</key><string>{escape(yomi)}</string>\n"
                    "  </dict>\n")
            n += 1
        f.write(FOOTER)
    print(f"[OK] 出力: {OUT}")
    print(f"エントリ数: {n}")


if __name__ == "__main__":
    main()
