"""Build a readable release walkthrough from real browser captures.

Uses the Codex PDF runtime (reportlab), not a browser print of the website.
Capture first with the opt-in Playwright walkthrough test against the release.
"""
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Table, TableStyle,
)
from PIL import Image as PILImage
from walkthrough_inputs import BASELINE, parse_inputs

ROOT = Path(__file__).resolve().parents[1]
inputs = parse_inputs(ROOT)
OUTPUT = inputs.output

INK = colors.HexColor("#202742")
BLUE = colors.HexColor("#233EB8")
CORAL = colors.HexColor("#E8513B")
PAPER = colors.HexColor("#FBF7EF")
MUTED = colors.HexColor("#53617B")
PAGE_W, PAGE_H = 1008, 720
styles = getSampleStyleSheet()
styles.add(ParagraphStyle("Cover", fontName="Times-Bold", fontSize=49, leading=53, textColor=INK, spaceAfter=24))
styles.add(ParagraphStyle("Section", fontName="Times-Bold", fontSize=28, leading=32, textColor=INK, spaceAfter=14, keepWithNext=True))
styles.add(ParagraphStyle("ViewTitle", fontName="Times-Bold", fontSize=25, leading=29, textColor=INK, spaceAfter=8))
styles.add(ParagraphStyle("BodyCopy", fontName="Helvetica", fontSize=11, leading=16, textColor=INK, spaceAfter=9))
styles.add(ParagraphStyle("Caption", fontName="Helvetica", fontSize=10, leading=14, textColor=MUTED, spaceAfter=8))
styles.add(ParagraphStyle("Cell", fontName="Helvetica", fontSize=10, leading=14, textColor=INK))
styles.add(ParagraphStyle("CellHead", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.white))
styles.add(ParagraphStyle("Label", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=CORAL, spaceAfter=12))


def plain(value):
    return str(value).replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-").replace("→", " / ").replace("↗", "")


def rich(value):
    value = escape(plain(value)).replace("\n", "<br/>")
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
    canvas.drawString(36, 22, "GIVETOGIVE  /  VERIFIED CHECKPOINT  /  PARTIAL ACCEPTANCE")
    canvas.drawRightString(PAGE_W - 36, 22, f"{doc.page}")
    canvas.restoreState()


story = [Spacer(1, 40), para("VERIFIED CHECKPOINT / ACCESSIBLE VIEWS", "Label"),
         para("Useful things.\nA clearer view.\nA neighborly place.", "Cover"),
         para("GiveToGive - published site and protected-staging capabilities", "Section"),
         para(f"{sum(len(c.manifest['views']) for c in inputs.captures)} actual browser views, with each origin and observed gate labeled."),
         para("Production is dark; protected staging is a separate test environment. Configured test sales are not paid membership or settlement. This guide is not completed provider or full-community acceptance."),
         para("All 29 rendered routes, four redirect aliases and 21 source dialogs remain in the coverage appendix, including missing and unavailable states."),
         PageBreak()]
story += [para("Capture and documentation binding", "Section")]
for capture in inputs.captures:
    b = capture.binding
    story += [para(capture.label(), "Caption"),
              para(f"Capture {capture.manifest['capturedAt']}; gate observation {b['observedAt']}; Git commit {b['commit'] or 'not a Git-commit deployment'}; Node {b['nodeVersion']}.", "Caption"),
              para(f"Authored runtime {b['sourceDigest']}; lock {b['lockDigest']}.", "Caption"),
              para(capture.manifest["fixtureDisclosure"])]
story += [para(f"Feature provenance baseline {BASELINE}; document commit {inputs.context['documentation']['commit']}, SHA256 {inputs.context['documentation']['sha256']}. Origin tags are not acceptance statuses.", "Caption"),
          PageBreak(), para("Measured verification and remaining boundaries", "Section")]
story += [para(line) for line in inputs.context["verificationSummary"]]
story += [PageBreak()]

for index, (capture, view) in enumerate(inputs.views(), 1):
    heading = para(f"{index:02d} / {view['title']}", "ViewTitle")
    caption = para(view["caption"], "Caption")
    route = para(view["route"], "Caption")
    identity = para(capture.label(view) + f" | evidence {capture.section}:{view['index']}", "Caption")
    story += [heading, caption, identity]
    image_path = inputs.image(capture, view)
    with PILImage.open(image_path) as im:
        width, height = im.size
    text_height = sum(part.wrap(928, 650)[1] + part.getSpaceAfter() for part in [heading, caption, identity, route])
    image_height = min(542, 630 - text_height - 7)
    if image_height < 240 or width <= 0 or height <= 0:
        raise ValueError("Screenshot metadata cannot fit legibly on its page")
    scale = min(928 / width, image_height / height)
    shot = Image(str(image_path), width=width * scale, height=height * scale)
    shot.hAlign = "CENTER"
    story += [shot, Spacer(1, 7), route, PageBreak()]

story += [para("Complete source-view coverage", "Section"),
          para("Captured, disabled, no-owned-record, not-applicable and not-captured states are all retained. A screenshot of a control is not proof of provider execution.")]
for kind, title in (("routes", "29 rendered routes"), ("aliases", "Four redirect aliases"), ("dialogs", "21 source dialogs")):
    story += [para(title, "Section")]
    table = Table([[para(cell, "CellHead" if index == 0 else "Cell") for cell in row]
                   for index, row in enumerate([["Inventory ID", "Environment / status", "Evidence / reason"]] + inputs.coverage_rows(kind))],
                  colWidths=[235, 200, 493], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BLUE),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 7),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [table, Spacer(1, 15)]
story += [PageBreak(), para("Capability provenance and implementation boundaries", "Section"),
          para("The four original tags describe feature origin against the stated baseline, not a certification that every financial or community acceptance requirement passed.")]

lines = inputs.feature_text.splitlines()
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

with inputs.open_output() as output:
    doc = SimpleDocTemplate(output, pagesize=(PAGE_W, PAGE_H), leftMargin=40,
                            rightMargin=40, topMargin=28, bottomMargin=42,
                            title="GiveToGive - Verified Checkpoint Walkthrough", author="GiveToGive",
                            pageCompression=1)
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
print(f"Built {OUTPUT}")
