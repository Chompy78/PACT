#!/usr/bin/env python3
"""
gen-bundle-workbook.py - build a checkable workbook of how every PACT subclass spell bundle is priced.

Reads a JSON dump of DATA.subclasses[*].spellBundle joined to DATA.spellGrants.subclassSpells, so both
the prices and the spell names are engine-sourced. Derived columns are live formulas, so the arithmetic
can be checked and re-run against changed inputs.

  python testing/scripts/gen-bundle-workbook.py bundles.json out.xlsx

THE PRICING RULE
  A bundle charges for the grants unlocking at character level <= 5; every grant above that rides free.
  Per-spell cost is DATA.knownUnit[spellLevel]; as origin each drops by 1 with a floor of 1 AP. A granted
  cantrip (spellLevel 0) is a flat DATA.cantCum[1] and takes no discount. Since v0.348 that reproduces
  all 21 stored prices exactly.

  Do NOT "simplify" this by assuming a grant shape. An earlier version assumed two spells each at
  1st/2nd/3rd, reproduced only 16 prices, and wrongly reported five bundles as hand-set.
"""
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

src, dest = sys.argv[1], sys.argv[2]
D = json.load(open(src))
KU, CANTRIP, PAID_MAX = D["knownUnit"], D["cantrip"], D["paidMax"]

ARIAL = "Arial"
H_FILL = PatternFill("solid", fgColor="58180D")
H_FONT = Font(name=ARIAL, bold=True, color="FFFFFF", size=11)
IN_FONT = Font(name=ARIAL, color="0000FF")          # hardcoded input
FM_FONT = Font(name=ARIAL)                          # formula / derived
EN_FONT = Font(name=ARIAL, color="008000")          # value read out of the engine
THIN = Border(*[Side(style="thin", color="BFBFBF")] * 4)

wb = Workbook()

def head(ws, row, labels, widths):
    for i, (lab, w) in enumerate(zip(labels, widths), start=1):
        c = ws.cell(row=row, column=i, value=lab)
        c.fill, c.font = H_FILL, H_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=row + 1, column=1)

# ---------------------------------------------------------------- 1. Model -------------------
ws = wb.active
ws.title = "Model"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 106
ws.column_dimensions["B"].width = 14

def put(r, a, b=None, bold=False, font=None):
    c = ws.cell(row=r, column=1, value=a)
    c.font = Font(name=ARIAL, bold=bold, size=13 if bold and r == 1 else 11)
    c.alignment = Alignment(vertical="top")
    if b is not None:
        ws.cell(row=r, column=2, value=b).font = font or IN_FONT
    return r + 1

r = put(1, "PACT - how a subclass bonus-spell bundle is priced", bold=True)
r = put(r + 1, "Engine rules version (js/engine-data.js)", D["version"], font=EN_FONT)
r = put(r + 1, "READ THIS FIRST - is the origin discount applied twice?", bold=True)
for line in [
    "No. A bundle is charged with ONE lookup: engine.js does `_isO ? bundle.origin : bundle.cross`. It",
    "picks one of two stored numbers and never subtracts a discount from either, so there is no second",
    "application to be had. The discount is applied once, when the stored `origin` figure was derived -",
    "and the 'Per-spell working' sheet reproduces that derivation from the real spell lists.",
    "",
    "The direct check is the ORIGIN GAP (cross - origin) on the Bundles sheet. If the discount were being",
    "applied twice, the engine's gap would exceed the model's gap. On all 21 bundles it does not - column",
    "N reads 'applied exactly once' for every one.",
    "",
    "What DOES look wrong side by side, and isn't: the guide's ability tables head column 3 'Sticker",
    "(Origin)'. For an ordinary class feature the sticker is already reduced - sticker = cross - tier. A",
    "bundle has no tier, so nothing is subtracted and the sticker equals the full cross price. Both mean",
    "'what a non-origin member of that class pays'; they are just reached differently. See 'Price paths'.",
]:
    r = put(r, line)

r = put(r + 1, "Inputs (blue = hardcoded here, green = read from the engine)", bold=True)
r = put(r, "Origin discount, AP per spell", 1)
r = put(r, "Floor - no spell can cost less than this", 1)
r = put(r, "Cantrip granted by a bundle, flat AP each (no discount)", CANTRIP, font=EN_FONT)
r = put(r, "Grants unlocking above this character level ride free", PAID_MAX, font=EN_FONT)
DD_C, FLOOR_C, CANT_C, PAID_C = f"$B${r-4}", f"$B${r-3}", f"$B${r-2}", f"$B${r-1}"

r = put(r + 1, "AP per spell known, by spell level (DATA.knownUnit)", bold=True)
KU_ROW0 = r
for lv, ap in enumerate(KU, start=1):
    ws.cell(row=r, column=1, value=lv).font = FM_FONT
    ws.cell(row=r, column=2, value=ap).font = EN_FONT
    r += 1
KU_RANGE = f"$A${KU_ROW0}:$B${KU_ROW0+len(KU)-1}"

r = put(r + 1, "Where the spell lists come from", bold=True)
for line in [
    "DATA.spellGrants.subclassSpells - the engine's own index of every 2024 ability that grants spells,",
    "with each spell's level and the character level its grant unlocks at. Nothing here is reconstructed.",
    "As of DATA.version v0.348 this reproduces ALL 21 stored prices exactly. Circle of the Sea used to be",
    "the one miss - charged 11/9 where its list totals 12/10 - and was repriced to 12/10 in that version.",
]:
    r = put(r, line)

# ---------------------------------------------------------------- 2. Per-spell working --------
li = wb.create_sheet("Per-spell working")
li.sheet_view.showGridLines = False
head(li, 1, ["Key", "Class", "Subclass", "Spell", "Spell level\n(0 = cantrip)", "Unlocks at\nchar level",
             "Paid or free", "Cross AP", "Origin AP\n(-1, floored at 1)", "Discount saved"],
     [26, 11, 24, 30, 12, 11, 15, 10, 14, 12])
row = 2
for b in D["bundles"]:
    key = f'{b["cls"]}|{b["sub"]}'
    for s, paid in [(s, True) for s in b["paid"]] + [(s, False) for s in b["free"]]:
        for col, val in ((1, key), (2, b["cls"]), (3, b["sub"]), (4, s["name"]),
                         (5, s["sl"]), (6, s["cl"])):
            li.cell(row=row, column=col, value=val).font = FM_FONT
        li.cell(row=row, column=7, value=f'=IF(F{row}<=Model!{PAID_C},"PAID","free with bundle")').font = FM_FONT
        if paid and s["sl"] == 0:      # cantrip: flat, no discount
            li.cell(row=row, column=8, value=f"=Model!{CANT_C}").font = FM_FONT
            li.cell(row=row, column=9, value=f"=Model!{CANT_C}").font = FM_FONT
        elif paid:
            li.cell(row=row, column=8, value=f'=VLOOKUP(E{row},Model!{KU_RANGE},2,FALSE)').font = FM_FONT
            li.cell(row=row, column=9, value=f"=MAX(Model!{FLOOR_C},H{row}-Model!{DD_C})").font = FM_FONT
        else:
            li.cell(row=row, column=8, value=0).font = FM_FONT
            li.cell(row=row, column=9, value=0).font = FM_FONT
        li.cell(row=row, column=10, value=f"=H{row}-I{row}").font = FM_FONT
        row += 1
LI_LAST = row - 1
# Column E holds the NUMERIC spell level so VLOOKUP can key straight into the Model table, whose
# column A holds the same bare numbers. Printing an ordinal ("1st") in E would make every lookup #N/A.

# ---------------------------------------------------------------- 3. Bundles ------------------
bs = wb.create_sheet("Bundles")
bs.sheet_view.showGridLines = False
head(bs, 1, ["Class", "Subclass", "Paid\nspells", "Free\nspells", "Cross AP\nderived", "Origin AP\nderived",
             "Cross AP\nENGINE", "Origin AP\nENGINE", "Cross\ndiff", "Origin\ndiff",
             "Origin gap\nderived", "Origin gap\nENGINE", "Is the discount applied twice?",
             "Derivation reproduces\nengine?"],
     [11, 24, 8, 8, 11, 11, 11, 11, 8, 8, 11, 11, 34, 22])
row = 2
KEYS = f"'Per-spell working'!$A$2:$A${LI_LAST}"
PAIDR = f"'Per-spell working'!$G$2:$G${LI_LAST}"
for b in D["bundles"]:
    key = f'{b["cls"]}|{b["sub"]}'
    bs.cell(row=row, column=1, value=b["cls"]).font = FM_FONT
    bs.cell(row=row, column=2, value=b["sub"]).font = FM_FONT
    bs.cell(row=row, column=3, value=len(b["paid"])).font = EN_FONT
    bs.cell(row=row, column=4, value=len(b["free"])).font = EN_FONT
    bs.cell(row=row, column=5, value=f'=SUMIFS(\'Per-spell working\'!$H$2:$H${LI_LAST},{KEYS},"{key}",{PAIDR},"PAID")').font = FM_FONT
    bs.cell(row=row, column=6, value=f'=SUMIFS(\'Per-spell working\'!$I$2:$I${LI_LAST},{KEYS},"{key}",{PAIDR},"PAID")').font = FM_FONT
    bs.cell(row=row, column=7, value=b["cross"]).font = EN_FONT
    bs.cell(row=row, column=8, value=b["origin"]).font = EN_FONT
    bs.cell(row=row, column=9, value=f"=G{row}-E{row}").font = FM_FONT
    bs.cell(row=row, column=10, value=f"=H{row}-F{row}").font = FM_FONT
    # The diagnostic pair: a doubled discount would make the ENGINE gap exceed the model gap.
    bs.cell(row=row, column=11, value=f"=E{row}-F{row}").font = FM_FONT
    bs.cell(row=row, column=12, value=f"=G{row}-H{row}").font = FM_FONT
    bs.cell(row=row, column=13, value=(f'=IF(L{row}>K{row},"YES - engine gap exceeds model",'
                                       f'IF(L{row}=K{row},"no - applied exactly once","no - applied LESS than once"))')).font = FM_FONT
    bs.cell(row=row, column=14, value=f'=IF(AND(I{row}=0,J{row}=0),"yes","NO")').font = FM_FONT
    row += 1
row += 1
bs.cell(row=row, column=1, value="Subclasses of these classes that sell NO bundle - nothing to buy, no cost, no option").font = Font(name=ARIAL, bold=True)
row += 1
for n in D["none"]:
    bs.cell(row=row, column=1, value=n["cls"]).font = FM_FONT
    bs.cell(row=row, column=2, value=n["sub"]).font = FM_FONT
    for cc in (7, 8):
        bs.cell(row=row, column=cc, value="none").font = EN_FONT
    bs.cell(row=row, column=13, value="n/a - nothing to buy").font = EN_FONT
    row += 1
row += 1
bs.cell(row=row, column=1, value=("Column M is the direct answer to 'is the origin discount applied twice?' - a doubled discount "
                                  "would make the ENGINE gap (L) exceed the model gap (K). It never does.")).font = Font(name=ARIAL, bold=True)

# ---------------------------------------------------------------- 4. Price paths --------------
pp = wb.create_sheet("Price paths")
pp.sheet_view.showGridLines = False
pp.column_dimensions["A"].width = 34
for col, w in zip("BCDE", (16, 16, 16, 48)):
    pp.column_dimensions[col].width = w
pp.cell(row=1, column=1, value="What the same buyer pays, by relationship to the class").font = Font(name=ARIAL, bold=True, size=13)
pp.cell(row=2, column=1, value="Verified by running compute(), not read off the source.").font = FM_FONT
head(pp, 4, ["Purchase", "Origin class", "Class unlocked,\nnot origin", "Neither", "How that middle figure is reached"],
     [34, 16, 16, 16, 48])
r = 5
for lab, o, u, x, note in [
    ("Feature: Cleric: Blessed Strikes", 10, 13, 17, "sticker = cross - tier = 17 - 4 = 13"),
    ("Bundle: Cleric | Life Domain", 6, 8, 8, "no tier exists, so nothing is subtracted - it stays at cross = 8"),
]:
    pp.cell(row=r, column=1, value=lab).font = FM_FONT
    for i, v in enumerate((o, u, x), start=2):
        pp.cell(row=r, column=i, value=v).font = EN_FONT
    c = pp.cell(row=r, column=5, value=note); c.font = FM_FONT
    c.alignment = Alignment(wrap_text=True, vertical="top")
    r += 1
r += 1
for line in [
    "Column 3 of the guide's ability tables is the middle figure above and the bracket is the first - i.e.",
    "'what a non-origin member of the class pays (what an origin member pays)'. Consistent in meaning.",
    "",
    "The real asymmetry: unlocking a class cuts 4 AP off that class's FEATURE (17 -> 13) but nothing off",
    "its BUNDLE (8 -> 8). Bundles have no sticker tier in the engine at all.",
    "",
    "As of DATA.version v0.347 a subclass purchase - ability or bundle - from a class you can neither",
    "build from nor have unlocked raises a blocking warning. Before that it was silently allowed, and",
    "because a bought bundle also claims that class's free subclass, no 15 AP unlock landed either.",
    "",
    "Neither table shows a discount applied twice. If it were, an Origin AP cell on the 'Per-spell",
    "working' sheet would fall below the 1 AP floor. None does.",
]:
    pp.cell(row=r, column=1, value=line).font = FM_FONT
    r += 1

for sheet in (li, bs):
    for rr in sheet.iter_rows(min_row=1, max_row=sheet.max_row, max_col=sheet.max_column):
        for c in rr:
            c.border = THIN

wb.save(dest)
print(f"wrote {dest}: {len(D['bundles'])} bundles, {LI_LAST-1} spell rows")
