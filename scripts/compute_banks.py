"""Recompute banks.js metrics from xlsx + pairs.js (reference script).

Grade rules (STEP 2):
  C / 부적합  : 취약점수(A) >= 8
  B / 조건부  : 취약점수(A) >= 6
  A / 적합    : 취약점수(A) < 6 and 디지털 대체성 >= 50

Run: PYTHONUTF8=1 py scripts/compute_banks.py
"""
from __future__ import annotations

import csv
import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

BANKS_CFG = {
    "hana": {
        "pair": "하나은행 강남역금융센터지점",
        "dongs": ["서초1동", "서초2동", "서초3동", "서초4동"],
    },
    "kb": {
        "pair": "KB국민은행 노원종합금융센터",
        "dongs": [
            "상계1동", "상계2동", "상계3.4동", "상계5동",
            "상계6.7동", "상계8동", "상계9동", "상계10동",
        ],
    },
    "shinhan": {"pair": "신한은행 여의도중앙금융센터", "dongs": ["여의동"]},
    "woori": {"pair": "우리은행 청담중앙지점", "dongs": ["청담동"]},
}


def parse_sheet(path: Path, sheet_file: str = "sheet1.xml") -> list[list[str]]:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read(f"xl/worksheets/{sheet_file}"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

        def cell_val(c: ET.Element) -> str:
            if c.attrib.get("t") == "inlineStr":
                return "".join((t.text or "") for t in c.findall(".//m:t", ns))
            v = c.find("m:v", ns)
            return v.text if v is not None else ""

        rows: list[list[str]] = []
        for row in root.findall(".//m:sheetData/m:row", ns):
            cells: list[str] = []
            for c in row.findall("m:c", ns):
                ref = c.attrib["r"]
                col = 0
                for ch in ref:
                    if ch.isalpha():
                        col = col * 26 + ord(ch) - 64
                    else:
                        break
                while len(cells) < col:
                    cells.append("")
                cells[col - 1] = cell_val(c)
            if any(cells):
                rows.append(cells)
        return rows


def sheet_file_for(path: Path, sheet_name: str) -> str:
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        ns = {
            "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        }
        sheets = wb.findall(".//m:sheet", ns)
        target = next(s for s in sheets if s.attrib["name"] == sheet_name)
        rid = target.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rns = {"m": "http://schemas.openxmlformats.org/package/2006/relationships"}
        rel = next(r for r in rels.findall("m:Relationship", rns) if r.attrib["Id"] == rid)
        return rel.attrib["Target"].lstrip("/").replace("xl/worksheets/", "")


def table_rows(path: Path, sheet_name: str) -> tuple[list[str], list[dict[str, str]]]:
    sheet = sheet_file_for(path, sheet_name)
    raw = parse_sheet(path, sheet)
    hdr_i = next(i for i, r in enumerate(raw) if any("총인구수" in (x or "") or "은행명" in (x or "") for x in r))
    header = raw[hdr_i]
    data = [{header[j]: (r[j] if j < len(r) else "") for j in range(len(header))} for r in raw[hdr_i + 1 :]]
    return header, data


def aggregate_admin(rows: list[dict[str, str]], dongs: list[str]) -> dict[str, float]:
    pop = elder_w = a_w = 0.0
    for d in rows:
        if d.get("행정동") in dongs:
            p = float(d["총인구수"])
            e = float(d["고령인구비율"])
            a = float(d.get("취약점수(A)", 0) or 0)
            pop += p
            elder_w += p * e
            a_w += p * a
    return {"pop": pop, "elder_pct": elder_w / pop * 100, "vuln_a": a_w / pop}


def grade_from(vuln_a: float, digital: int) -> tuple[str, str]:
    if vuln_a >= 8:
        return "C", "부적합"
    if vuln_a >= 6:
        return "B", "조건부 적합"
    if digital >= 50:
        return "A", "적합"
    return "B", "조건부 적합"


def main() -> None:
    pairs = json.loads(
        re.search(
            r"const PAIRS = (\{.*\});",
            (DATA / "pairs.js").read_text(encoding="utf-8"),
            re.S,
        ).group(1)
    )
    _, admin_rows = table_rows(DATA / "행정동_통합비율_취약점수_최종.xlsx", "행정동별_비율")
    _, dummy_rows = table_rows(DATA / "지역별은행_더미데이터_전체.xlsx", "은행별_더미데이터")

    for bid, cfg in BANKS_CFG.items():
        adm = aggregate_admin(admin_rows, cfg["dongs"])
        dm = next(d for d in dummy_rows if d.get("은행명") == cfg["pair"])
        dist = pairs[cfg["pair"]]["인근"][0]["거리"]
        rep = float(dm["일평균 이용객(대표)"])
        counter = float(dm["일평균 이용객(창구)"])
        monthly = round(counter * 22)
        atm_pct = round(float(dm["ATM 이용비율"]) * 100, 1)
        face = min(50.0, round(counter / rep * 100, 1))
        digital = round(100 - face)
        grade, glabel = grade_from(adm["vuln_a"], digital)
        score = min(
            100,
            (30 if adm["elder_pct"] >= 30 else 20 if adm["elder_pct"] >= 20 else 10 if adm["elder_pct"] >= 10 else 0)
            + (30 if dist >= 5 else 20 if dist >= 2 else 0 if dist < 1 else 10)
            + (20 if monthly >= 7000 else 10 if monthly >= 4000 else 0),
        )
        print(
            bid,
            f"score={score}",
            f"A={adm['vuln_a']:.1f}",
            f"grade={grade}",
            f"dist={dist:.4f}km",
            f"digital={digital}%",
        )


if __name__ == "__main__":
    main()
