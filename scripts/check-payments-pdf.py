"""Inspect PDF text and create contact sheets from Poppler renderings."""
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
pdf = root / "output/pdf/givetogive-payments-staging-walkthrough.pdf"
render = root / "tmp/payments-walkthrough"
pages = sorted(render.glob("render-*.png"))
reader = PdfReader(pdf)
assert len(pages) == len(reader.pages), "Render all final pages first."
for index, page in enumerate(reader.pages, 1):
    text = page.extract_text()
    assert text and len(text) > 65, f"Unexpectedly empty page {index}"
    assert "\u25a0" not in text, f"Unsupported glyph on page {index}"
for offset in range(0, len(pages), 12):
    selected = pages[offset:offset + 12]
    sheet = Image.new("RGB", (1080, 1120), "#d8d8d8")
    draw = ImageDraw.Draw(sheet)
    for cell, file in enumerate(selected):
        with Image.open(file) as source:
            source.thumbnail((348, 254))
            x = (cell % 3) * 360 + 6
            y = (cell // 3) * 280 + 22
            sheet.paste(source, (x, y))
            draw.text((x, y - 17), f"Page {offset + cell + 1}", fill="#202742")
    sheet.save(render / f"contact-{offset // 12 + 1}.png")
print(f"Text verified on {len(reader.pages)} pages; generated {(len(pages) + 11) // 12} contact sheets.")
