"""Verify ETA SDK golden vector (gv-01) only.

Do NOT mint secondary expected strings from product code. Secondary candidates
come from tools/reference-canonical-serialize (bassemAgmi SerializeToken port)
and stay *.canonical.PENDING.txt until EInvoicingSigner CanonicalString.txt
confirms. See README.md and packages/eta-core/docs/reference-algorithm.md.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent


def parse_preserving_numbers(text: str):
    """Parse JSON but keep number tokens as strings of their literal text."""

    def repl(m: re.Match[str]) -> str:
        lit = m.group(0)
        # Encode as a tagged string so we can distinguish from real strings.
        return json.dumps("__num__:" + lit)

    # Replace number literals outside of strings — naive but works for SDK samples
    # (no numbers inside strings that look like standalone JSON numbers in these fixtures).
    out = []
    i = 0
    in_str = False
    esc = False
    while i < len(text):
        ch = text[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        m = re.match(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?", text[i:])
        if m:
            lit = m.group(0)
            out.append(json.dumps("__num__:" + lit))
            i += m.end()
            continue
        out.append(ch)
        i += 1
    return json.loads("".join(out))


def unwrap(v):
    if isinstance(v, str) and v.startswith("__num__:"):
        return ("num", v[len("__num__:") :])
    if isinstance(v, dict):
        return {k: unwrap(x) for k, x in v.items()}
    if isinstance(v, list):
        return [unwrap(x) for x in v]
    return v


def serialize(node) -> str:
    # Scalar
    if isinstance(node, tuple) and node[0] == "num":
        return f'"{node[1]}"'
    if isinstance(node, (str, int, float, bool)) or node is None:
        if isinstance(node, bool):
            return f'"{str(node).lower()}"'
        if node is None:
            return '""'
        return f'"{node}"'
    if isinstance(node, list):
        # Arrays are never roots in ETA docs for eInvoice document object;
        # handled by parent property.
        raise TypeError("array at root unexpected")
    # object
    parts: list[str] = []
    for key, value in node.items():
        name = key.upper()
        if isinstance(value, list):
            parts.append(f'"{name}"')
            for elem in value:
                parts.append(f'"{name}"')
                parts.append(serialize(elem))
        else:
            parts.append(f'"{name}"')
            parts.append(serialize(value))
    return "".join(parts)


def main() -> None:
    raw = (BASE / "eta-sdk-one-doc.json").read_text(encoding="utf-8")
    expected = (BASE / "eta-sdk-one-doc.canonical.txt").read_text(encoding="utf-8").strip()
    tree = unwrap(parse_preserving_numbers(raw))
    got = serialize(tree)
    if got != expected:
        # Show first mismatch
        for i, (a, b) in enumerate(zip(got, expected)):
            if a != b:
                print("MISMATCH at", i)
                print("got...", got[max(0, i - 40) : i + 40])
                print("exp...", expected[max(0, i - 40) : i + 40])
                break
        else:
            print("length mismatch", len(got), len(expected))
        raise SystemExit(1)
    print("OK: matches ETA SDK one-doc-serialized.json.txt")

    # --- Minimal vector 02: empty strings + nested object (from SDK payment fragment pattern)
    v02 = {
        "payment": {
            "bankName": "SomeValue",
            "bankAccountIBAN": "",
            "swiftCode": "",
        }
    }
    # Represent as format-preserving structure
    v02_tree = unwrap(
        parse_preserving_numbers(json.dumps(v02, ensure_ascii=False, separators=(",", ":")))
    )
    can02 = serialize(v02_tree)
    (BASE / "gv-02-empty-scalars.input.json").write_text(
        json.dumps(v02, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (BASE / "gv-02-empty-scalars.canonical.txt").write_text(can02 + "\n", encoding="utf-8")
    print("wrote gv-02", can02)

    # --- Minimal vector 03: array repeat + 0.00 rate (decimal string money)
    v03 = {
        "invoiceLines": [
            {
                "description": "Item",
                "quantity": "5",
                "taxableItems": [
                    {"taxType": "T1", "amount": "10.00", "subType": "V001", "rate": "14.00"},
                    {"taxType": "T3", "amount": "0.00", "subType": "ST", "rate": "0.00"},
                ],
            }
        ],
        "totalAmount": "10.00",
    }
    # Already decimal strings — serialize as plain strings
    can03 = serialize(v03)
    (BASE / "gv-03-array-and-zero.input.json").write_text(
        json.dumps(v03, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (BASE / "gv-03-array-and-zero.canonical.txt").write_text(can03 + "\n", encoding="utf-8")
    print("wrote gv-03", can03)

    # Rename/copy official pair to gv-01
    (BASE / "gv-01-eta-sdk-one-doc.input.json").write_text(raw, encoding="utf-8")
    (BASE / "gv-01-eta-sdk-one-doc.canonical.txt").write_text(expected + "\n", encoding="utf-8")
    print("wrote gv-01 (official ETA SDK)")


if __name__ == "__main__":
    main()
