"""Render actual protected-staging captures; never overwrite the published guide."""
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
CAPTURE = ROOT / "tmp/payments-walkthrough"
OUTPUT = ROOT / "output/pdf/givetogive-payments-staging-walkthrough.pdf"
manifest = json.loads((CAPTURE / "manifest.json").read_text(encoding="utf-8"))
if (manifest.get("status") != "captured" or manifest.get("diagnostics")
        or manifest.get("cleanup") != "temporary capture accounts removed; append-only audit events retained"
        or manifest.get("baseURL") != "https://givetogive-staging.vercel.app"):
    raise ValueError("Require a complete, error-free, cleaned-up protected staging capture")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

INK, COBALT, CORAL, PAPER, MUTED = map(colors.HexColor, ["#202742", "#233EB8", "#E8513B", "#FBF7EF", "#53617B"])
WIDTH, HEIGHT = 1008, 720
styles = getSampleStyleSheet()
for name, face, size, leading, color, after in [
    ("Cover", "Times-Bold", 46, 51, INK, 22),
    ("Section", "Times-Bold", 27, 31, INK, 13),
    ("View", "Times-Bold", 24, 28, INK, 8),
    ("Copy", "Helvetica", 11, 16, INK, 9),
    ("Caption", "Helvetica", 10, 14, MUTED, 8),
    ("Label", "Helvetica-Bold", 10, 14, CORAL, 12),
    ("Cell", "Helvetica", 9, 12, INK, 0),
    ("Head", "Helvetica-Bold", 9, 12, colors.white, 0),
]:
    styles.add(ParagraphStyle(name, fontName=face, fontSize=size, leading=leading,
                             textColor=color, spaceAfter=after, keepWithNext=name in ("Section", "View")))


def rich(value):
    text = str(value).translate(str.maketrans({"–": "-", "—": "-", "‑": "-", "→": " to ", "≥": ">=", "’": "'", "“": '"', "”": '"'}))
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = escape(text).replace("\n", "<br/>")
    text = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", text)
    return re.sub(r"`(.*?)`", r'<font color="#233EB8">\1</font>', text)


def para(text, style="Copy"):
    return Paragraph(rich(text), styles[style])


def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    canvas.setFillColor(COBALT)
    canvas.rect(0, HEIGHT - 7, WIDTH, 7, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(36, 22, "GIVETOGIVE  /  PROTECTED STAGING  /  PARTIAL ACCEPTANCE")
    canvas.drawRightString(WIDTH - 36, 22, str(doc.page))
    canvas.restoreState()


story = [Spacer(1, 24), para("WORK IN PROGRESS / TEST ENVIRONMENT", "Label"),
         para("More ways to give.\nA clearer view of the work.", "Cover"),
         para("Payments, operations and a simulated neighborhood", "Section"),
         para(f"{len(manifest['views'])} actual browser views captured on {manifest['capturedAt']}"),
         para(manifest["baseURL"], "Caption"),
         para(manifest["verificationBoundary"]),
         para("Stripe payment, subscription and fund gates are OFF. No real money was moved. This is not the final production or completed payment-acceptance walkthrough."),
         para(manifest["fixtureDisclosure"], "Caption"), PageBreak(),
         para("Read the evidence, not just the screens.", "Section"),
         para("The existing public site remains the non-payment release. The new work is deployed to a separate protected staging project, using synthetic records and isolated credentials."),
         para("Views below show genuine availability, empty states, account boundaries, measured operations and stored agent histories. A plan card is not an active subscription. A seeded cohort is not a paid tier. A run record is not proof that 100 agents completed a soak."),
         para("Still awaiting provider-backed verification", "Section")]
story += [para("- " + item) for item in manifest["unmetStripeFlows"]]
story += [para("The feature appendix distinguishes origin from acceptance against main at f6638fe. See docs/payments-verification.md for the final test and deployment record.", "Caption"), PageBreak()]

for view in manifest["views"]:
    heading = para(f"{view['index']:02d} / {view['title']}", "View")
    caption = para(view["caption"], "Caption")
    route = para(view["route"], "Caption")
    image_path = Path(view["image"]).resolve()
    if not image_path.is_relative_to((CAPTURE / "images").resolve()):
        raise ValueError("Capture image must stay inside the manifest image directory")
    with PILImage.open(image_path) as picture:
        width, height = picture.size
    text_height = sum(part.wrap(924, 640)[1] + part.getSpaceAfter() for part in (heading, caption, route))
    scale = min(924 / width, min(530, 626 - text_height) / height)
    shot = Image(str(image_path), width=width * scale, height=height * scale)
    shot.hAlign = "CENTER"
    story += [heading, caption, shot, Spacer(1, 7), route, PageBreak()]

story += [para("Deliberate gaps in this capture", "Section"),
          para("Disabled controls were not bypassed, and financial rows were not fabricated to obtain screenshots.")]
for item in manifest["omitted"]:
    story += [para(item["route"], "Label"), para(item["reason"])]
story += [PageBreak(), para("Feature provenance and implementation boundaries", "Section")]

buffer, rows = [], []


def flush_text():
    if buffer:
        story.append(para(" ".join(buffer)))
        buffer.clear()


def flush_table():
    if not rows:
        return
    widths = [220, 130, 574] if len(rows[0]) == 3 else [245, 679]
    if rows[0][0] == "Evidence":
        widths = [220, 352, 352]
    table = Table([[para(cell, "Head" if index == 0 else "Cell") for cell in row] for index, row in enumerate(rows)], colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COBALT),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1EFE9")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([table, Spacer(1, 12)])
    rows.clear()


for line in (ROOT / "docs/payments-feature-outline.md").read_text(encoding="utf-8").splitlines():
    if line.startswith("# "):
        continue
    if line.startswith("|"):
        flush_text()
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if not all(re.fullmatch(r"[- :]+", cell) for cell in cells):
            rows.append(cells)
    else:
        flush_table()
        if line.startswith("## "):
            flush_text()
            story.append(para(line[3:], "Section"))
        elif line.startswith("- "):
            flush_text()
            story.append(para(line))
        elif line.strip():
            buffer.append(line.strip())
        else:
            flush_text()
flush_table()
flush_text()

SimpleDocTemplate(str(OUTPUT), pagesize=(WIDTH, HEIGHT), leftMargin=42, rightMargin=42,
                  topMargin=35, bottomMargin=42,
                  title="GiveToGive - Partial Protected Staging Walkthrough",
                  author="GiveToGive").build(story, onFirstPage=chrome, onLaterPages=chrome)
print(f"Created {OUTPUT}")
