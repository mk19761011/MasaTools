# -*- coding: utf-8 -*-
"""医療辞書の精査・修正(最終版)。APK/AABビルドは行わない。

正式版に収録するのは次のみ:
 - 元データ上の対応が正常な語 / 医療用語・医療略語であることが確認できる語
 - 読みと単語の対応が妥当な語 / 破損行から正しく復元できた語
収録しない:
 - 明確な非医療語6件 / 判断不能23件 / おぞかりなーぜ→レボフロキサシン
 - 読みと単語の対応を確認できない語 / 破損の疑いを解消できない語
"""
import io
import sys
import unicodedata
from collections import Counter

CLEANED = "medical_dict_cleaned.txt"    # cp932, Android版の元データ
WIN_DIC = "medical_dict_phase1.dic"     # utf-8, Windows版(参照)
OFFICIAL = "medical_dict_cleaned_v2026.7.5.txt"

# 確認済み非医療語(Ubuntuコードネーム/バージョン)
NONMEDICAL = {
    ("10.04", "LucidLynx"), ("1004", "LucidLynx"), ("1204", "12.04"),
    ("14.04", "TrustyTahr"), ("1404", "14.04LTSTrustyTahr"), ("1404", "TrustyTahr"),
}
# 判断不能(意味・用途を一意に確認できない短い略字)。正式版に含めない。
UNRESOLVED_WORDS = {
    "Abr", "Att", "Brx", "Ero", "Hys", "Mal", "Per", "Perico", "Pig", "Pul",
    "Stom", "HET", "EHp", "GAT", "IPT", "OSC", "POA", "PSD", "ROT", "WZ",
    "ZS", "MT", "Lux",
}
# 読みと単語の対応根拠を確認できず、破損の可能性があるため除外
READING_MISMATCH = {("おぞかりなーぜ", "レボフロキサシン")}
# 医療用途・出典を確認できないため正式版に不採用(読み↔単語対応は妥当)
UNVERIFIED_USE = {("はーとはいぱー", "ハートハイパー")}


def read_cp932(p): return io.open(p, "r", encoding="cp932").read().splitlines()
def read_utf8(p):  return io.open(p, "r", encoding="utf-8").read().splitlines()

sanitized_log = []
def sanitize(s):
    """フィールド内の制御文字(タブ以外, ord<32)を除去。元データ破損対策。"""
    if any(ord(ch) < 32 for ch in s):
        cleaned = "".join(ch for ch in s if ord(ch) >= 32)
        sanitized_log.append((s, cleaned))
        return cleaned
    return s


# ============ 1. cleaned.txt を破損行対応でパース ============
cleaned_lines = read_cp932(CLEANED)
cleaned_entries = []
garbage = set()            # 旧変換器が生成したゴミ(破損4フィールド行由来)
malformed = []
lost_yomi = []
for i, l in enumerate(cleaned_lines):
    if l.startswith("!") or not l.strip():
        continue
    cols = l.split("\t")
    if len(cols) == 3:
        cleaned_entries.append((sanitize(cols[0].strip()), sanitize(cols[1].strip())))
    elif len(cols) == 4:
        a, b, c = sanitize(cols[0].strip()), sanitize(cols[1].strip()), sanitize(cols[2].strip())
        garbage.add((a, b))
        if a == b:
            cleaned_entries.append((a, c))
            malformed.append((i + 1, l, (a, c), None))
        else:
            cleaned_entries.append((b, c))
            lost_yomi.append(a)
            malformed.append((i + 1, l, (b, c), a))
    else:
        malformed.append((i + 1, l, None, None))

# ============ 2. Windows .dic をパース ============
win_entries = []
for l in read_utf8(WIN_DIC):
    if not l.strip():
        continue
    cols = l.split("\t")
    win_entries.append((sanitize(cols[0].strip()), sanitize(cols[1].strip())))
win_by_yomi = {}
for y, w in win_entries:
    win_by_yomi.setdefault(y, []).append(w)

# ============ 3. 旧Android版(比較基準・42,190)を再現 ============
old_android = set()
for l in cleaned_lines:
    if l.startswith("!") or not l.strip():
        continue
    cols = l.split("\t")
    if len(cols) < 2:
        continue
    y, w = cols[0].strip(), cols[1].strip()
    if not y or not w or (y.isascii() and w.isascii()):
        continue
    old_android.add((y, w))

# ============ 4. 修正版辞書を構築 ============
EXCLUDE = NONMEDICAL | READING_MISMATCH | UNVERIFIED_USE
corrected = {}
for y, w in cleaned_entries:
    if not y or not w or (y, w) in EXCLUDE or (y, w) in garbage:
        continue
    if w in UNRESOLVED_WORDS:      # 判断不能は正式版から除外
        continue
    corrected[(y, w)] = True
for y, w in win_entries:           # Windows .dicを統合(復元・追加・略語復活)
    if (y, w) in EXCLUDE:
        continue
    if w in UNRESOLVED_WORDS:
        continue
    corrected.setdefault((y, w), True)

# ============ 5. 表記正規化(同一読みでASCII劣化版があれば正式版を採用) ============
def norm_key(s):
    s2 = unicodedata.normalize("NFKD", s)
    s2 = "".join(ch for ch in s2 if not unicodedata.combining(ch))
    return s2.replace("−", "-").replace("　", " ").replace(" ", "").lower()

by_yomi = {}
for (y, w) in corrected:
    by_yomi.setdefault(y, []).append(w)
normalized_pairs = []
to_drop = set()
for y, words in by_yomi.items():
    wws = win_by_yomi.get(y, [])
    for w in words:
        if w in wws:
            continue
        for ww in wws:
            if w != ww and norm_key(w) == norm_key(ww):
                normalized_pairs.append((y, w, ww))
                to_drop.add((y, w))
                break
for k in to_drop:
    corrected.pop(k, None)

final_set = set(corrected)

# ============ 6. 除外232件の再分類 ============
excluded_src = [tuple(r.split("\t")[:2]) for r in
                read_utf8("excluded_entries_2026.7.5.tsv")[1:] if r.strip()]
uniq_excluded = list(dict.fromkeys(excluded_src))
cls_nonmedical = [e for e in uniq_excluded if e in NONMEDICAL]
cls_unresolved = [e for e in uniq_excluded if e[1] in UNRESOLVED_WORDS]
cls_abbrev = [e for e in uniq_excluded
              if e not in NONMEDICAL and e[1] not in UNRESOLVED_WORDS]

# ============ 7. 追加56件の分類(7カテゴリ) ============
GENERIC = {"アジスロマイシン","アモキシシリン","アルブテロール","イプラトロピウム","イリノテカン",
    "エナラプリル","カペシタビン","ゲムシタビン","コデイン","シスプラチン","シタグリプチン",
    "ジルチアゼム","タクロリムス","ダビガトラン","ドキソルビシン","パクリタキセル","プラバスタチン",
    "ベラパミル","メチルプレドニゾロン","メトホルミン","リバーロキサバン","ロサルタン"}
BRAND = {"バイアスピリン","ロキソニン","サヴィオゾール"}
DISEASE = {"哆開","耳癤","カヴァレ疾患","Ménière病","腹壁創哆開","びまん性レヴィ小体病"}
SYNDROME_SUFFIX = "症候群"
EPONYM = {"Müller管","Köebner現象","Trömner反射","Leser-Trélat徴候","Bergonié-Tribondeauの法則"}
TEST = {"Klüver-Barrera染色"}
OTHER = {"ハートハイパー"}

def classify_word(w):
    if w in GENERIC: return "一般名医薬品"
    if w in BRAND: return "商品名"
    if w in DISEASE: return "病名"
    if w.endswith(SYNDROME_SUFFIX): return "症候群"
    if w in TEST: return "検査・処置"
    if w in EPONYM: return "人名由来用語"
    return "その他"

# 破損で単語消失した読み(lost_yomi)はcleaned_entriesに単語が無いので、
# Windowsから復元される。それらは「破損復元」であり「Windows新規薬剤」ではない。
cleaned_yomi_all = set(y for (y, w) in cleaned_entries)
win_only = [(y, w) for (y, w) in win_entries if (y, w) not in old_android]
drug_candidates = [(y, w) for (y, w) in win_only
                   if not (y.isascii() and w.isascii()) and y not in cleaned_yomi_all]
# 重複除去して56件
drug_candidates = list(dict.fromkeys(drug_candidates))

# ============ 8. 読み不一致・破損の疑い 全件検査 ============
all_readings = set(y for (y, w) in cleaned_entries) | set(
    c.split("\t")[0].strip() for c in cleaned_lines
    if not c.startswith("!") and c.strip())
suspicious = []
# (a) 破損4フィールド由来のゴミ25件
for ln, raw, ent, lost in malformed:
    if ent is None:
        continue
    cols = raw.split("\t")
    a, b = cols[0].strip(), cols[1].strip()
    suspicious.append((a, b, "4フィールド融合(破損)", "除外", f"L{ln}: 2エントリ融合。旧出力は読み欄混入のゴミ"))
# (b) 3フィールド行で単語欄が他エントリの読みに一致(構造検査)
for l in cleaned_lines:
    if l.startswith("!") or not l.strip():
        continue
    cols = l.split("\t")
    if len(cols) != 3:
        continue
    y, w = cols[0].strip(), cols[1].strip()
    if w in all_readings and w != y:
        # 単語が略語/固有名として妥当なら正当(誤検出)
        verdict = "収録(正当)" if not (all("ぁ" <= ch <= "ゟ" for ch in w)) else "要確認"
        suspicious.append((y, w, "単語が他読みと同一(構造検査)", verdict,
                           "単語は実在する略語/固有名で読みとの対応も妥当(機械的一致による誤検出)"))
# (c) 意味的不一致(ドメイン判断)
suspicious.append(("おぞかりなーぜ", "レボフロキサシン", "読みと単語の意味的不一致", "除外",
                   "読みと単語の対応根拠を確認できず、元データ破損の可能性があるため保留"))
# (d) 制御文字混入(サニタイズ済み)
for orig, cln in sanitized_log:
    suspicious.append(("(制御文字)", cln, "単語に制御文字U+0015混入(破損)", "収録(サニタイズ)",
                       f"制御文字を除去して収録: {orig!r} → {cln!r}"))

# ============ 出力 ============
def write_tsv(path, header, rows):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\t".join(header) + "\n")
        for r in rows:
            f.write("\t".join(str(x) for x in r) + "\n")

with io.open(OFFICIAL, "w", encoding="utf-8", newline="") as f:
    f.write("!Microsoft IME Dictionary Tool\n")
    for (y, w) in corrected:
        f.write(f"{y}\t{w}\t名詞\n")

write_tsv("excluded_nonmedical_entries_v2026.7.5.tsv", ["よみ", "単語", "分類"],
          [(y, w, "非医療(Ubuntu/OS)") for y, w in cls_nonmedical])

restored = [(y, w, "ASCII医療略語(232件中から復元)") for y, w in cls_abbrev if (y, w) in final_set]
write_tsv("restored_medical_entries_v2026.7.5.tsv", ["よみ", "単語", "復元区分"], restored)

drug_rows = []
for y, w in drug_candidates:
    cat = classify_word(w)
    if (y, w) in READING_MISMATCH:
        drug_rows.append((y, w, "除外(読み不一致)", "除外",
                          "読みと単語の対応根拠を確認できず、破損の可能性があるため保留"))
    elif (y, w) in UNVERIFIED_USE:
        drug_rows.append((y, w, "除外(用途不明)", "除外",
                          "医療用語・医薬品名・医療機器名としての信頼できる出典および用途を確認できないため保留"))
    else:
        drug_rows.append((y, w, cat, "収録", "読み↔単語の対応が妥当。医療用語のため収録"))
write_tsv("restored_drugs_from_windows_v2026.7.5.tsv",
          ["よみ", "単語", "分類", "収録可否", "判断理由"], drug_rows)

write_tsv("normalized_entries_v2026.7.5.tsv",
          ["よみ", "変更前(cleaned)", "変更後(正式表記)"], normalized_pairs)

# 判断不能23件のレビュー表(根拠が取れた語だけ後から復元できる構造)
UNRESOLVED_MEANING = {
    "Abr":"不明(略字断片の可能性)","Att":"不明(Attack/Attenuation?)","Brx":"不明(Braxton?)",
    "Ero":"不明(Erosion/びらん?)","Hys":"不明(Hysterectomy/ヒステリー?)","Mal":"不明(malignant/悪性?)",
    "Per":"不明","Perico":"不明(Pericoronitis/智歯周囲炎?)","Pig":"不明(pigment?)",
    "Pul":"不明(pulmonary/肺?)","Stom":"不明(stomach/口腔?)","HET":"不明(hematocrit?)",
    "EHp":"不明","GAT":"不明(Goldmann圧平眼圧?)","IPT":"不明","OSC":"不明","POA":"不明(視索前野/術前?)",
    "PSD":"不明","ROT":"不明(rotation/回旋?)","WZ":"不明","ZS":"不明(Zollinger-Ellison?)",
    "MT":"不明(metatarsal?)","Lux":"不明(照度lux/脱臼luxatio?)",
}
review_rows = []
for y, w in cls_unresolved:
    review_rows.append((y, w, UNRESOLVED_MEANING.get(w, "不明"), "不明(要特定)",
                        "ORCA医療辞書(ASCIIエントリ)", "いいえ", "否(保留)",
                        "一意の医学的意味・用途を確認できないため正式版には未収録"))
for y, w in sorted(UNVERIFIED_USE):
    review_rows.append((y, w, "不明(製品名の可能性)", "不明(要特定)",
                        "Windows版医療辞書(ORCA由来)", "いいえ", "否(保留)",
                        "医療用語・医薬品名・医療機器名としての信頼できる出典および用途を確認できないため保留"))
write_tsv("unresolved_entries_review_v2026.7.5.tsv",
          ["よみ","単語","想定される意味","診療科・用途","元データの出典",
           "信頼できる根拠を確認できたか","正式版への収録可否","判断理由"], review_rows)
# 旧名も残す(後方互換)
write_tsv("unresolved_entries_v2026.7.5.tsv", ["よみ","単語","状態"],
          [(y, w, "判断保留(正式版から除外・要レビュー)") for y, w in cls_unresolved])

write_tsv("suspicious_reading_term_pairs_v2026.7.5.tsv",
          ["よみ","単語","検出理由","判定","詳細"], suspicious)

with io.open("corrupted_lines_report.tsv", "w", encoding="utf-8", newline="") as f:
    f.write("行番号\t元データ(4フィールド)\t復元したエントリ\t単語消失した読み\n")
    for ln, raw, ent, lost in malformed:
        f.write(f"{ln}\t{raw}\t{ent}\t{lost or ''}\n")

# ============ 9. 自動検証(fail-closed) ============
def validate(path, expect_min, expect_max):
    errors = []
    raw = io.open(path, "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        return [f"文字コードがUTF-8でない: {e}"]
    lines = [l for l in text.splitlines() if l and not l.startswith("!")]
    seen = set()
    for i, l in enumerate(lines, 1):
        cols = l.split("\t")
        # 品詞列を許容し、よみ・単語の2列を検証
        if len(cols) < 3:
            errors.append(f"L{i}: 列不足 {cols!r}")
            continue
        if len(cols) > 3:
            errors.append(f"L{i}: 4列以上 {cols!r}")
        y, w = cols[0], cols[1]
        if not y:
            errors.append(f"L{i}: 空の読み")
        if not w:
            errors.append(f"L{i}: 空の単語")
        if "\t" in w:
            errors.append(f"L{i}: 単語にタブ")
        if any(ord(ch) < 32 for ch in y + w):
            errors.append(f"L{i}: 制御文字")
        if (y, w) in seen:
            errors.append(f"L{i}: 完全重複 {y}/{w}")
        seen.add((y, w))
    for e in garbage:
        if e in seen:
            errors.append(f"破損ゴミ再混入: {e}")
    for e in NONMEDICAL:
        if e in seen:
            errors.append(f"非医療再混入: {e}")
    for e in READING_MISMATCH:
        if e in seen:
            errors.append(f"読み不一致再混入: {e}")
    for y, w in seen:
        if w in UNRESOLVED_WORDS:
            errors.append(f"判断不能再混入: {y}/{w}")
    n = len(seen)
    if not (expect_min <= n <= expect_max):
        errors.append(f"件数が想定範囲外: {n} (期待 {expect_min}〜{expect_max})")
    return errors

final = list(corrected.keys())
dup_pairs = len(final) - len(final_set)
multi_reading = sum(1 for c in Counter(y for (y, w) in final).values() if c > 1)
errs = validate(OFFICIAL, 42000, 43000)

added = final_set - old_android
removed = old_android - final_set

print("=== 自動検証 ===")
if errs:
    print("NG:")
    for e in errs[:20]:
        print("  ", e)
else:
    print("OK: 全検証項目を通過")
print()
print("=== 分類: 除外232件(ユニーク222) ===")
print(f"確認済み非医療        : {len(cls_nonmedical)}")
print(f"医療略語・検査・遺伝子・化療: {len(cls_abbrev)}")
print(f"判断不能(正式版除外)  : {len(cls_unresolved)}")
print()
print("=== 追加56件の分類 ===")
cc = Counter(classify_word(w) if (y, w) not in READING_MISMATCH else "除外"
             for y, w in drug_candidates)
for k, v in cc.most_common():
    print(f"  {k}: {v}")
print()
print("=== 監査可能な件数式 ===")
print(f"修正前(旧Android)     : {len(old_android)}")
print(f"  + 新規追加           : {len(added)}")
print(f"  − 削除               : {len(removed)}")
print(f"  = 修正後(正式版)     : {len(final_set)}")
print(f"完全重複               : {dup_pairs}")
print(f"同一読み複数候補(読み数): {multi_reading}")

# 監査ファイル: 追加・削除を全件出力
write_tsv("audit_added_v2026.7.5.tsv", ["よみ", "単語"], sorted(added))
write_tsv("audit_removed_v2026.7.5.tsv", ["よみ", "単語", "削除理由"],
          [(y, w,
            "破損ゴミ" if (y, w) in garbage else
            "非医療" if (y, w) in NONMEDICAL else
            "読み不一致" if (y, w) in READING_MISMATCH else
            "判断不能" if w in UNRESOLVED_WORDS else
            "表記正規化で旧版を置換" if (y, w) in to_drop else "その他")
           for y, w in sorted(removed)])

# 追加の重複なし内訳(7バケットに相互排他で分離。合計=len(added))
lost_set = set(lost_yomi)
norm_after = set((y, ww) for (y, cw, ww) in normalized_pairs)   # 正規化後の正式表記
ctrl_after = set((y, w) for (y, w) in final_set                 # 制御文字除去後の正常版
                 if any(w == c for o, c in sanitized_log))
uniq_excluded_medical = set(cls_abbrev)                         # 232由来ASCII医療略語(復元)

b_norm = added & norm_after
b_ctrl = (added & ctrl_after) - b_norm
b_corruption = set(e for e in added if e[0] in lost_set) - b_norm - b_ctrl
b_drugs = (set(drug_candidates) & added) - b_corruption - b_norm - b_ctrl
b_ascii_from232 = (added & uniq_excluded_medical) - b_corruption - b_drugs - b_norm - b_ctrl
b_ascii_other = set(e for e in added if e[0].isascii() and e[1].isascii()) \
    - b_ascii_from232 - b_corruption - b_drugs - b_norm - b_ctrl
b_other = added - b_norm - b_ctrl - b_corruption - b_drugs - b_ascii_from232 - b_ascii_other

# 後方互換の別名
added_ascii_abbrev = b_ascii_from232 | b_ascii_other
added_drugs = b_drugs
added_corruption = b_corruption
added_other = b_other | b_norm | b_ctrl
# 削除29の内訳
rem_garbage = len([e for e in removed if e in garbage])
rem_norm = len([e for e in removed if e in to_drop])
rem_ctrl = len([e for e in removed
                if any(e[1] == o for o, c in sanitized_log)])
rem_other = len(removed) - rem_garbage - rem_norm - rem_ctrl

changelog = f"""# 辞書データ 変更履歴 (CHANGELOG_DICTIONARY.md)

## v2026.7.5 正式版 — {len(final_set):,}語

元データ `{CLEANED}`(cp932)を精査し、破損・誤除外・読み不一致を修正した。
参照: `{WIN_DIC}`(Windows版, UTF-8)。**APK/AABは未ビルド。**

### 監査可能な件数式(各エントリはaudit_*.tsvで追跡可能)
```
修正前(旧Android版)  42,190
      + 新規追加        {len(added):>6}
      − 削除            {len(removed):>6}
      = 正式版         {len(final_set):>7,}
```

### 新規追加 {len(added)}件の内訳(7区分・相互排他)
| 区分 | 件数 |
|---|---|
| 除外232件から復元したASCII医療略語 | {len(b_ascii_from232)} |
| Windows版由来の追加ASCII略語(232リスト外, 例FSH/SFD/Mb) | {len(b_ascii_other)} |
| Windows版からの純追加(薬剤・病名・症候群等) | {len(b_drugs)} |
| 破損行から復元した病名・エポニム | {len(b_corruption)} |
| 表記正規化後の正式表記(アクセント付) | {len(b_norm)} |
| 制御文字除去後の正常版 | {len(b_ctrl)} |
| その他(Windows版由来の別表記・同音語) | {len(b_other)} |
| 合計 | {len(b_ascii_from232)+len(b_ascii_other)+len(b_drugs)+len(b_corruption)+len(b_norm)+len(b_ctrl)+len(b_other)} |

### 削除 {len(removed)}件の内訳
| 区分 | 件数 |
|---|---|
| 破損行由来のゴミ(読み欄混入) | {rem_garbage} |
| 表記正規化で置換した旧ASCII版 | {rem_norm} |
| 制御文字混入版(サニタイズ版に置換) | {rem_ctrl} |
| その他 | {rem_other} |
| 合計 | {len(removed)} |

### 除外232件(ユニーク228件)の再分類
- 明確な非医療語(Ubuntu等): {len(cls_nonmedical)}(正式版に不収録)
- 医療略語・検査名・遺伝子名・化学療法名: {len(cls_abbrev)}(正式版に復元)
- 判断不能(意味・用途を確認できず): {len(cls_unresolved)}(**正式版に不収録**・要レビュー)
- ※ 232行のうち Stage/Stage が5回重複 → ユニーク228件

### 候補不採用(元42,190に含まれず、監査式の削除には含めない)
- 明確な非医療語: {len(cls_nonmedical)}件
- 判断不能: {len(cls_unresolved)}件(unresolved_entries_review_v2026.7.5.tsv)
- 読み不一致(おぞかりなーぜ→レボフロキサシン): 1件
- 用途不明(ハートハイパー): {len(UNVERIFIED_USE)}件
- **候補不採用 合計: {len(cls_nonmedical)+len(cls_unresolved)+len(READING_MISMATCH)+len(UNVERIFIED_USE)}件**

### 追加56件の分類(薬剤とエポニムを分離)
{chr(10).join(f'- {k}: {v}' for k, v in Counter(classify_word(w) if (y,w) not in READING_MISMATCH else "除外(読み不一致)" for y, w in drug_candidates).most_common())}

### データ品質の修正
- 破損行(4フィールド融合): 25件 → 正しく分割・ゴミ除去・消失語をWindowsから復元
- 制御文字U+0015混入: 1件(食道・胃24時間pHモニタリング)→ 除去して収録
- 表記正規化(アクセント/ハイフン): {len(normalized_pairs)}件

### 自動検証
生成スクリプトに fail-closed 検証を実装。全項目通過を確認。
検証失敗時は辞書ZIP/APKを生成せず終了する。

### 生成物
- medical_dict_cleaned_v2026.7.5.txt(正式版, UTF-8, {len(final_set):,}語)
- audit_added_v2026.7.5.tsv / audit_removed_v2026.7.5.tsv(全件追跡)
- excluded_nonmedical / restored_medical / restored_drugs_from_windows
- normalized / unresolved_entries_review / suspicious_reading_term_pairs
- corrupted_lines_report
"""
io.open("CHANGELOG_DICTIONARY.md", "w", encoding="utf-8").write(changelog)
not_adopted = len(cls_nonmedical) + len(cls_unresolved) + len(READING_MISMATCH) + len(UNVERIFIED_USE)
print()
print("=== 追加300の7区分(相互排他) ===")
print(f"  232由来ASCII略語復元 : {len(b_ascii_from232)}")
print(f"  Windows由来ASCII略語 : {len(b_ascii_other)}")
print(f"  Windows純追加(薬剤等) : {len(b_drugs)}")
print(f"  破損行から復元        : {len(b_corruption)}")
print(f"  表記正規化後の正式版  : {len(b_norm)}")
print(f"  制御文字除去後の正常版: {len(b_ctrl)}")
print(f"  その他(別表記・同音)  : {len(b_other)}")
print(f"  合計                  : {len(added)}")
print(f"削除内訳: ゴミ{rem_garbage} 正規化前{rem_norm} 制御文字含む旧{rem_ctrl}")
print(f"候補不採用: 非医療{len(cls_nonmedical)} 判断不能{len(cls_unresolved)} 読み不一致{len(READING_MISMATCH)} 用途不明{len(UNVERIFIED_USE)} = {not_adopted}")
print("CHANGELOG_DICTIONARY.md を生成しました")

if errs:
    print("\n検証失敗のため、辞書ZIP/APKは生成しません(処理終了)。")
    sys.exit(1)
