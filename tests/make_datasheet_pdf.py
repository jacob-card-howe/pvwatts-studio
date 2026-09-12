"""Build a text-only browser-test PDF from the existing REC text-layer fixture.

No dependencies or manufacturer artwork. The output is explicitly labelled a
UI test fixture and is not shipped with the site.

Usage: python3 tests/make_datasheet_pdf.py .impeccable/review/rec-text-fixture.pdf
"""
import json
from pathlib import Path
import sys


def make_pdf(output):
    pages = json.loads((Path(__file__).parent / "fixtures/datasheets/rec.json").read_text())
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    page_ids = []
    for page in pages:
        commands = ["BT /F1 9 Tf 1 0 0 1 20 782 Tm (Text-only UI test fixture - not the original manufacturer PDF) Tj ET"]
        for item in page["items"]:
            text = item["str"].replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            matrix = " ".join(str(n) for n in item["transform"])
            commands.append(f"BT /F1 1 Tf {matrix} Tm ({text}) Tj ET")
        content = "\n".join(commands).encode("cp1252", errors="replace")
        page_id = len(objects) + 1
        page_ids.append(page_id)
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode())
        objects.append(f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Count {len(pages)} /Kids [{' '.join(f'{n} 0 R' for n in page_ids)}] >>".encode()
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(pdf)


if __name__ == "__main__":
    make_pdf(Path(sys.argv[1]))
