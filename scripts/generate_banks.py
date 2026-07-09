"""Generate data/banks.json from xlsx sources for all branches.

Run: py scripts/generate_banks.py
"""
from __future__ import annotations

import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


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
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheets = wb.findall(".//m:sheet", ns)
        target = next(s for s in sheets if s.attrib["name"] == sheet_name)
        rid = target.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rns = {"m": "http://schemas.openxmlformats.org/package/2006/relationships"}
        rel = next(r for r in rels.findall("m:Relationship", rns) if r.attrib["Id"] == rid)
        return rel.attrib["Target"].lstrip("/").replace("xl/worksheets/", "")


def table_rows(path: Path, sheet_name: str) -> tuple[list[str], list[dict[str, str]]]:
    sheet = sheet_file_for(path, sheet_name)
    raw = parse_sheet(path, sheet)
    hdr_i = next(
        i
        for i, r in enumerate(raw)
        if any("총인구수" in (x or "") or "은행명" in (x or "") for x in r)
    )
    header = raw[hdr_i]
    data = [
        {header[j]: (r[j] if j < len(r) else "") for j in range(len(header))}
        for r in raw[hdr_i + 1 :]
    ]
    return header, data


def load_pairs() -> dict:
    text = (DATA / "pairs.js").read_text(encoding="utf-8")
    return json.loads(re.search(r"const PAIRS = (\{.*\});", text, re.S).group(1))


def is_atm_branch(pair_key: str) -> bool:
    return pair_key.rstrip().upper().endswith("ATM")


def split_name(pair_key: str, meta: dict) -> tuple[str, str]:
    company = meta.get("회사", "")
    if company == "농협" and pair_key.startswith("NH"):
        bank_name = "NH농협은행"
    elif company and pair_key.startswith(company):
        bank_name = company
    elif pair_key.startswith("KB국민은행"):
        bank_name = "KB국민은행"
    elif pair_key.startswith("NH농협은행"):
        bank_name = "NH농협은행"
    else:
        bank_name = pair_key.split()[0] if pair_key else ""
    branch = pair_key[len(bank_name) :].strip() if pair_key.startswith(bank_name) else pair_key
    return bank_name, branch


def fmt_num(n: float) -> str:
    return f"{int(round(n)):,}"


def to_float(value: str | float | int | None, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"—", "-", "해당없음", "해당없음(창구없음)"}:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def ages_from_elder(elder_pct: float) -> list[int]:
    age60 = round(elder_pct)
    rest = 100 - age60
    age20 = round(rest * 0.4)
    return [age20, rest - age20, age60]


def channels_from(rep: float, counter: float, atm_ratio: float) -> list[float]:
    atm = round(atm_ratio * 100, 1)
    face = min(50.0, round(counter / rep * 100, 1)) if rep > 0 else 50.0
    mobile = round(100 - atm - face, 1)
    return [mobile, atm, face]


def build_record(row: dict, admin: dict[str, dict[str, str]], pairs: dict) -> dict | None:
    pair_key = (row.get("은행명") or "").strip()
    if not pair_key:
        return None

    dong = (row.get("행정동(매칭)") or "").strip()
    adm = admin.get(dong, {})
    meta = pairs.get(pair_key, {})
    name, branch = split_name(pair_key, meta)

    pop = to_float(row.get("행정동 인구") or adm.get("총인구수"))
    elder_ratio = to_float(row.get("고령인구비율") or adm.get("고령인구비율"))
    elder_pct = round(elder_ratio * 100, 1)
    vuln_a = round(to_float(adm.get("취약점수(A)")), 1)

    rep = to_float(row.get("일평균 이용객(대표)"))
    counter = to_float(row.get("일평균 이용객(창구)"), rep)
    monthly = round(counter * 22)
    atm_ratio = to_float(row.get("ATM 이용비율"))
    lam = round(to_float(row.get("시간당 고객도착률 λ(ATM)")), 1)
    svc = round(to_float(row.get("ATM 평균처리시간(분)"), 5), 1)

    ages = ages_from_elder(elder_pct)
    channels = channels_from(rep, counter, atm_ratio)
    sido = (row.get("시도") or meta.get("지역") or "").strip()

    return {
        "pairKey": pair_key,
        "name": name,
        "branch": branch,
        "sido": sido,
        "s1": {
            "rows": [
                ["지역 인구", fmt_num(pop), "명"],
                ["65세 이상 고령자 비율", f"{elder_pct:.1f}", "%"],
                ["디지털 전환 취약점수(A)", f"{vuln_a:.1f}", "점"],
                ["일평균 방문 고객", fmt_num(rep), "명"],
                ["가장 가까운 대체 점포", "—", "km"],
                ["반경 500m 내 ATM/ITM", "0", "대"],
                ["월 창구 거래 건수", fmt_num(monthly), "건"],
            ]
        },
        "s2": {"ages": ages, "channels": channels},
        "s3": {"lambda": lam, "svc": svc},
    }


def main() -> None:
    pairs = load_pairs()
    _, admin_rows = table_rows(DATA / "행정동_통합비율_취약점수_최종.xlsx", "행정동별_비율")
    admin = {r["행정동"]: r for r in admin_rows if r.get("행정동")}
    _, dummy_rows = table_rows(DATA / "지역별은행_더미데이터_전체.xlsx", "은행별_더미데이터")

    banks: dict[str, dict] = {}
    index: list[dict[str, str]] = []
    seen: set[str] = set()

    for row in dummy_rows:
        rec = build_record(row, admin, pairs)
        if not rec:
            continue
        banks[rec["pairKey"]] = rec
        if rec["pairKey"] in seen:
            continue
        seen.add(rec["pairKey"])
        if is_atm_branch(rec["pairKey"]):
            continue
        index.append(
            {
                "k": rec["pairKey"],
                "n": rec["name"],
                "b": rec["branch"],
                "s": rec["sido"],
            }
        )

    index.sort(key=lambda x: (x["n"], x["b"]))

    out_banks = DATA / "banks.json"
    out_index = DATA / "banks_index.json"
    out_banks.write_text(json.dumps(banks, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    out_index.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(banks):,} banks -> {out_banks} ({out_banks.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"Wrote {len(index):,} index rows -> {out_index} ({out_index.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
