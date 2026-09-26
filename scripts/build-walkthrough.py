"""Build a readable release walkthrough from real browser captures.

Uses the Codex PDF runtime (reportlab), not a browser print of the website.
Capture first with the opt-in Playwright walkthrough test against the release.
"""
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Table, TableStyle,
    KeepTogether,
)
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tmp/walkthrough/manifest.json"
OUTPUT = ROOT / "output/pdf/givetogive-published-walkthrough.pdf"
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#202742")
BLUE = colors.HexColor("#233EB8")
CORAL = colors.HexColor("#E8513B")
PAPER = colors.HexColor("#FBF7EF")
MUTED = colors.HexColor("#53617B")
PAGE_W, PAGE_H = 1008, 720
styles = getSampleStyleSheet()
styles.add(ParagraphStyle("Cover", fontName="Times-Bold", fontSize=49, leading=53, textColor=INK, spaceAfter=24))
styles.add(ParagraphStyle("Section", fontName="Times-Bold", fontSize=28, leading=32, textColor=INK, spaceAfter=14))
styles.add(ParagraphStyle("ViewTitle", fontName="Times-Bold", fontSize=25, leading=29, textColor=INK, spaceAfter=8))
styles.add(ParagraphStyle("BodyCopy", fontName="Helvetica", fontSize=11, leading=16, textColor=INK, spaceAfter=9))
styles.add(ParagraphStyle("Caption", fontName="Helvetica", fontSize=10, leading=14, textColor=MUTED, spaceAfter=8))
styles.add(ParagraphStyle("Cell", fontName="Helvetica", fontSize=10, leading=14, textColor=INK))
styles.add(ParagraphStyle("CellHead", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.white))
styles.add(ParagraphStyle("Label", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=CORAL, spaceAfter=12))


def plain(value):
    return str(value).replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-").replace("→", " / ").replace("↗", "")


def rich(value):
    value = escape(plain(value))
    value = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`(.*?)`", r'<font color="#233EB8">\1</font>', value)
    return value


def para(value, style="BodyCopy"):
    return Paragraph(rich(value), styles[style])


def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - 7, PAGE_W, 7, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(36, 22, "GIVETOGIVE  /  PUBLISHED SITE WALKTHROUGH")
    canvas.drawRightString(PAGE_W - 36, 22, f"{doc.page}")
    canvas.restoreState()


story = [Spacer(1, 40), para("RELEASE WALKTHROUGH", "Label"),
         para("Useful things.<br/>Finished workflows.<br/>A neighborly place.", "Cover"),
         para("GiveToGive - published-site visual and capability guide", "Section"),
         para(f"Captured from {manifest['baseURL']} on {manifest['capturedAt']}", "BodyCopy"),
         para(f"{len(manifest['views'])} browser views: public pages, signed-in experiences, open dialogs, recovery states, and mobile layouts."),
         para(manifest.get("fixtureDisclosure", "Illustrative synthetic members and Asks were created for the walkthrough and removed after capture. No real passwords or private account details are shown.")),
         para("Money Asks record pledges only. This release does not process payments, run pooled funds, or sell subscriptions."),
         para("The capability appendix distinguishes existed before, partly implemented before, brand new, and newly finished against main at 1ecb2ee.", "Caption"),
         PageBreak()]

for index, view in enumerate(manifest["views"], 1):
    story += [para(f"{index:02d} / {view['title']}", "ViewTitle"),
              para(view["caption"], "Caption")]
    image_path = Path(view["image"])
    if not image_path.is_absolute():
        image_path = ROOT / image_path
    with PILImage.open(image_path) as im:
        width, height = im.size
    scale = min(928 / width, 542 / height)
    shot = Image(str(image_path), width=width * scale, height=height * scale)
    shot.hAlign = "CENTER"
    story += [shot, Spacer(1, 7), para(view["route"], "Caption"), PageBreak()]

story += [para("Capability appendix", "Section"),
          para("A complete inventory of what the current release does, what was completed from the three spinoff tasks, and what is intentionally not implemented.")]

lines = (ROOT / "docs/feature-outline.md").read_text(encoding="utf-8").splitlines()
buffer = []
table_rows = []


def flush_text():
    if buffer:
        story.append(para(" ".join(buffer)))
        buffer.clear()


def flush_table():
    if not table_rows:
        return
    count = len(table_rows[0])
    widths = [225, 200, 503] if count == 3 else [280, 648]
    rendered = [[para(cell, "CellHead" if i == 0 else "Cell") for cell in row] for i, row in enumerate(table_rows)]
    table = Table(rendered, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1EFE9")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1, BLUE),
    ]))
    story.extend([table, Spacer(1, 15)])
    table_rows.clear()


for line in lines:
    if line.startswith("# "):
        continue
    if line.startswith("|"):
        flush_text()
        cells = [part.strip() for part in line.strip("|").split("|")]
        if not all(re.fullmatch(r"[- :]+", cell) for cell in cells):
            table_rows.append(cells)
        continue
    flush_table()
    if line.startswith("## "):
        flush_text()
        story += [Spacer(1, 10), para(line[3:], "Section")]
    elif line.startswith("- "):
        flush_text()
        buffer.append(line[2:])
    elif not line.strip():
        flush_text()
    else:
        buffer.append(line.strip())
flush_text()
flush_table()

doc = SimpleDocTemplate(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), leftMargin=40,
                        rightMargin=40, topMargin=28, bottomMargin=42,
                        title="GiveToGive - Published Site Walkthrough", author="GiveToGive",
                        pageCompression=1)
doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
print(f"Built {OUTPUT}")
