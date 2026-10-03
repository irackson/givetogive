"""Render actual protected-staging captures; never overwrite the published guide."""
import re
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from walkthrough_inputs import BASELINE, parse_inputs

ROOT = Path(__file__).resolve().parents[1]
inputs = parse_inputs(ROOT)
OUTPUT = inputs.output

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
    canvas.drawString(36, 22, "GIVETOGIVE  /  VERIFIED CHECKPOINT  /  PARTIAL ACCEPTANCE")
    canvas.drawRightString(WIDTH - 36, 22, str(doc.page))
    canvas.restoreState()


story = [Spacer(1, 24), para("VERIFIED CHECKPOINT / ACCESSIBLE VIEWS", "Label"),
         para("More ways to give.\nA clearer view of the work.", "Cover"),
         para("GiveToGive - published site and protected-staging capabilities", "Section"),
         para(f"{sum(len(c.manifest['views']) for c in inputs.captures)} actual browser views, labeled by origin, observed gates and capture time."),
         para("Production remains dark. Protected staging can expose configured test sales; configuration is not settlement or paid membership. This is not completed provider or full-community acceptance."),
         para("All 29 rendered routes, four redirect aliases and 21 source dialogs remain in the coverage appendix, including missing and unavailable states."), PageBreak(),
         para("Read the evidence, not just the screens.", "Section"),
         para("The published application and protected staging may share authored runtime while retaining different environments and gates. Staging is not a production deployment or a substitute for genuine paid acceptance."),
         para("Views below show genuine availability, empty states, account boundaries, measured operations and stored agent histories. A plan card is not an active subscription. A seeded cohort is not a paid tier. A run record is not proof that 100 agents completed a soak."),
         para("Capture and documentation binding", "Section")]
for capture in inputs.captures:
    b = capture.binding
    story += [para(capture.label(), "Caption"),
              para(f"Capture {capture.manifest['capturedAt']}; gates observed {b['observedAt']}; Git commit {b['commit'] or 'not a Git-commit deployment'}; Node {b['nodeVersion']}.", "Caption"),
              para(f"Authored runtime {b['sourceDigest']}; lock {b['lockDigest']}.", "Caption"),
              para(capture.manifest["fixtureDisclosure"], "Caption")]
    if capture.manifest.get("verificationBoundary"):
        story.append(para(capture.manifest["verificationBoundary"]))
story += [para(f"Feature baseline {BASELINE}; documentation commit {inputs.context['documentation']['commit']}, SHA256 {inputs.context['documentation']['sha256']}. Tags describe origin, not acceptance.", "Caption"),
          PageBreak(), para("Measured verification and remaining boundaries", "Section")]
story += [para(line) for line in inputs.context["verificationSummary"]]
unmet = dict.fromkeys(item for capture in inputs.captures for item in capture.manifest.get("unmetStripeFlows", []))
story += [para("- " + item) for item in unmet]
story += [PageBreak()]

for index, (capture, view) in enumerate(inputs.views(), 1):
    heading = para(f"{index:02d} / {view['title']}", "View")
    caption = para(view["caption"], "Caption")
    route = para(view["route"], "Caption")
    identity = para(capture.label(view) + f" | evidence {capture.section}:{view['index']}", "Caption")
    image_path = inputs.image(capture, view)
    with PILImage.open(image_path) as picture:
        width, height = picture.size
    text_height = sum(part.wrap(924, 640)[1] + part.getSpaceAfter() for part in (heading, caption, identity, route))
    image_height = min(530, 626 - text_height)
    if image_height < 240 or width <= 0 or height <= 0:
        raise ValueError("Screenshot metadata cannot fit legibly on its page")
    scale = min(924 / width, image_height / height)
    shot = Image(str(image_path), width=width * scale, height=height * scale)
    shot.hAlign = "CENTER"
    story += [heading, caption, identity, shot, Spacer(1, 7), route, PageBreak()]

story += [para("Deliberate gaps in this capture", "Section"),
          para("Disabled controls were not bypassed, and financial rows were not fabricated to obtain screenshots.")]
for capture in inputs.captures:
    for item in capture.manifest.get("omitted", []):
        story += [para(f"{capture.binding['environment']} / {item['route']}", "Label"), para(item["reason"])]
story += [PageBreak(), para("Complete source-view coverage", "Section"),
          para("Captured, disabled, no-owned-record, not-applicable and not-captured states are all retained. Missing states are not removed from the denominator.")]
for kind, title in (("routes", "29 rendered routes"), ("aliases", "Four redirect aliases"), ("dialogs", "21 source dialogs")):
    story.append(para(title, "Section"))
    table = Table([[para(cell, "Head" if index == 0 else "Cell") for cell in row]
                   for index, row in enumerate([["Inventory ID", "Environment / status", "Evidence / reason"]] + inputs.coverage_rows(kind))],
                  colWidths=[230, 200, 494], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), COBALT),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 7),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [table, Spacer(1, 12)]
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


for line in inputs.feature_text.splitlines():
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

with inputs.open_output() as output:
    SimpleDocTemplate(output, pagesize=(WIDTH, HEIGHT), leftMargin=42, rightMargin=42,
                      topMargin=35, bottomMargin=42,
                      title="GiveToGive - Verified Checkpoint Walkthrough",
                      author="GiveToGive").build(story, onFirstPage=chrome, onLaterPages=chrome)
print(f"Created {OUTPUT}")
