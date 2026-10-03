"""Inspect PDF text and create contact sheets from Poppler renderings."""
from pathlib import Path
import re

from PIL import Image, ImageDraw
from pypdf import PdfReader
from walkthrough_inputs import BASELINE, NAMESPACE, SECRET, TAGS, contained, input_parser, load_inputs, require

root = Path(__file__).resolve().parents[1]
parser = input_parser("Verify the selected final PDF and create fresh contact sheets; no PDF authoring.")
parser.add_argument("--render-dir", required=True)
args = parser.parse_args()
inputs = load_inputs(root, args.manifest, args.output, args.release_context, args.coverage,
                     args.feature_outline, existing_output=True)
pdf = inputs.output
render = contained(root, args.render_dir)
require(render.is_dir() and render.parent == root / "tmp/pdfs" and NAMESPACE.fullmatch(render.name),
        "Use a fresh UUID-specific render directory beneath tmp/pdfs")
files = list(render.glob("render-*.png"))
require(files and all(re.fullmatch(r"render-\d+\.png", file.name) for file in files),
        "Render filenames must contain numeric page indices")
pages = sorted(files, key=lambda file: int(file.stem.split("-")[-1]))
require([int(file.stem.split("-")[-1]) for file in pages] == list(range(1, len(pages) + 1)),
        "Render every page exactly once, with contiguous numeric filenames")
require(not list(render.glob("contact-*.png")), "Never overwrite historical contact sheets")
for file in pages:
    require(contained(root, file).parent == render, "Rendered pages must not redirect")
reader = PdfReader(pdf)
assert len(pages) == len(reader.pages), "Render all final pages first."
texts = []
for index, page in enumerate(reader.pages, 1):
    text = page.extract_text()
    assert text and len(text) > 65, f"Unexpectedly empty page {index}"
    assert "\u25a0" not in text, f"Unsupported glyph on page {index}"
    require(not SECRET.search(text), f"Sensitive material found on page {index}")
    texts.append(text)
compact = lambda text: re.sub(r"\s+", "", text)
all_text = compact("\n".join(texts))
for token in (BASELINE, *TAGS, inputs.context["documentation"]["commit"],
              inputs.context["documentation"]["sha256"], *("29 rendered routes", "Four redirect aliases", "21 source dialogs")):
    require(compact(token) in all_text, "Expected coverage/provenance text is missing")
for kind in ("routes", "aliases", "dialogs"):
    for row in inputs.coverage[kind]:
        require(compact(row["id"]) in all_text, "Coverage row was omitted from the final PDF")
        for observation in row["observations"]:
            require(compact(observation["reason"]) in all_text, "Coverage disposition/reason is missing")
for capture, view in inputs.views():
    token = compact(f"evidence {capture.section}:{view['index']}")
    matches = [index for index, text in enumerate(texts)
               if re.search(re.escape(token) + r"(?!\d)", compact(text))]
    require(len(matches) == 1, "Each actual screenshot needs exactly one labeled image page")
    index = matches[0]
    require(compact(capture.label(view)) in compact(texts[index]), "Per-image environment/gates binding is missing")
    objects = reader.pages[index]["/Resources"].get("/XObject", {})
    objects = objects.get_object() if hasattr(objects, "get_object") else objects
    require(any(item.get_object().get("/Subtype") == "/Image" for item in objects.values()),
            "A screenshot page must contain an actual embedded image")
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
    with (render / f"contact-{offset // 12 + 1}.png").open("xb") as output:
        sheet.save(output, format="PNG")
print(f"Text verified on {len(reader.pages)} pages; generated {(len(pages) + 11) // 12} contact sheets.")
