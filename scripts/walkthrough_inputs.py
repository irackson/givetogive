"""Offline, fail-closed inputs for current walkthrough PDFs. No provider calls."""
import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import struct
from urllib.parse import urlsplit

ORIGINS = {
    "production": "https://givetogive.vercel.app",
    "staging": "https://givetogive-staging.vercel.app",
}
BASELINE = "f6638fe0b1845ae9cceb937959138af38d1ba971"
TAGS = ("existed before", "partly implemented before", "brand new", "newly finished")
GATES = ("PAYMENTS_ENABLED", "SUPPORTERS_ENABLED", "FUNDS_ENABLED",
         "STRIPE_LIVE_APPROVED", "SIMULATION_ENABLED")
AVAILABILITY = ("enabled", "askPayments", "subscriptions", "funds",
                "livemode", "billingManagement")
ROUTES = (
    "/", "/asks", "/asks/[slugOrId]", "/members/[id]", "/signin", "/signup",
    "/forgot-password", "/reset-password", "/verify-email", "/auth-error",
    "/signout", "/support", "/funds", "/funds/[slug]", "/giving", "/giving/[id]",
    "/account/billing", "/account/receiving", "/account/security", "/admin",
    "/admin/activity", "/admin/users", "/admin/users/[id]", "/admin/payments",
    "/admin/payments/[id]", "/admin/funds", "/admin/simulations",
    "/admin/simulations/[id]", "/admin/simulations/[id]/agents/[agentId]",
)
ALIASES = {"/members": "/members/[id]", "/account": "/account/billing",
           "/billing": "/account/billing", "/receiving": "/account/receiving"}
DIALOGS = (
    "create-ask", "offer-contribution", "edit-ask", "complete-contribution",
    "cancel-contribution", "edit-profile", "revoke-sessions", "freeze-member",
    "review-case", "ask-payment-pause", "create-simulation", "recover-controller",
    "stop-simulation", "create-fund", "allocate-fund", "refund-payment",
    "enable-ask-payments", "contribution-checkout", "cancel-checkout",
    "cancel-fund-subscription", "change-supporter-membership",
)
STATES = ("captured", "disabled", "no-owned-record", "not-applicable", "not-captured")
SECTIONS = {"production": "public", "community-staging": "community", "payments-staging": "payments"}
NAMESPACE = re.compile(r"walkthrough-[a-z0-9-]+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
SECRET = re.compile(
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|"
    r"otpauth://|-----BEGIN [^\n]*PRIVATE KEY|https?://[^/\s:@]+:[^/\s@]+@|"
    r"client_secret[\"']?\s*[:=]\s*[\"']?[^\s\"',}]{8,}", re.I)
PRIVATE_FIELDS = {"password", "access_token", "refresh_token", "client_secret",
                  "secretKey", "storageState", "vercelProtectionBypass"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_text(value):
    require(isinstance(value, str) and value.strip() and not SECRET.search(value),
            "Required text is missing or contains sensitive material")
    return value


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None and parsed.utcoffset() == timedelta(0),
                "Capture timestamps must be UTC")
        return parsed
    except (AttributeError, TypeError, ValueError):
        raise ValueError("Invalid timezone-aware capture timestamp") from None


def contained(root, requested, exists=True):
    file = Path(requested)
    absolute = file if file.is_absolute() else root / file
    try:
        resolved = absolute.resolve(strict=exists)
        require(resolved == absolute.absolute() and resolved.is_relative_to(root),
                "Input/output path must stay inside the repository without redirection")
        return resolved
    except (OSError, RuntimeError):
        raise ValueError("Input/output path is unavailable or redirected") from None


def read_json(file):
    try:
        require(file.stat().st_size <= 2_000_000, "Metadata input is too large")
        value = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("Missing or malformed walkthrough metadata") from None
    def inspect(item):
        if isinstance(item, dict):
            require(not PRIVATE_FIELDS.intersection(item), "Private fields are not walkthrough metadata")
            for child in item.values():
                inspect(child)
        elif isinstance(item, list):
            for child in item:
                inspect(child)
        elif isinstance(item, str):
            require(not SECRET.search(item), "Sensitive material is not walkthrough metadata")
    inspect(value)
    require(isinstance(value, dict), "Metadata must be a JSON object")
    return value


def boolean_fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names)
            and all(type(value[name]) is bool for name in names),
            "All gate/availability values must be explicit booleans")


@dataclass
class Capture:
    file: Path
    manifest: dict
    binding: dict

    @property
    def section(self):
        return self.file.parent.name

    def label(self, view=None):
        b = self.binding
        gates = b["gates"]
        mode = "PRODUCTION / DARK" if b["environment"] == "production" else "PROTECTED STAGING / TEST"
        flags = ", ".join(f"{name} {'ON' if gates[key] else 'OFF'}" for name, key in zip(
            ("Ask", "Supporter", "fund", "live", "simulation"), GATES))
        result = f"{mode} | {b['origin']} | {flags} | deployment {b['deploymentId']}"
        if view:
            viewport = view["viewport"]
            result += f" | captured {view['capturedAt']} | {viewport['width']}x{viewport['height']}"
        return result


@dataclass
class WalkthroughInputs:
    root: Path
    output: Path
    captures: list
    context: dict
    coverage: dict
    feature_text: str

    def views(self):
        for capture in self.captures:
            for view in capture.manifest["views"]:
                yield capture, view

    def image(self, capture, view):
        file = contained(self.root, view["image"])
        require(file.is_file() and file.suffix.lower() == ".png"
                and file.is_relative_to(capture.file.parent / "images"),
                "Screenshot must stay inside its own manifest image directory")
        with file.open("rb") as source:
            header = source.read(24)
        require(len(header) == 24 and header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR",
                "Screenshot must have a PNG image header")
        width, height = struct.unpack(">II", header[16:24])
        require(width > 0 and height > 0 and width * height <= 50_000_000,
                "Screenshot dimensions must be positive and bounded")
        return file

    def coverage_rows(self, kind):
        rows = []
        for item in self.coverage[kind]:
            for observation in item["observations"]:
                evidence = ", ".join(observation["views"]) or "No screenshot"
                rows.append([item["id"], f"{observation['environment']} / {observation['status']}",
                             f"{evidence}. {observation['reason']}"])
        return rows

    def open_output(self):
        # No filesystem output is allocated until the actual authoring command.
        require(not self.output.exists(), "Refusing to overwrite an existing PDF")
        self.output.parent.mkdir(parents=True, exist_ok=True)
        return self.output.open("xb")


def load_inputs(root, manifests, output, release_context, coverage, feature_outline, *, existing_output=False):
    root = root.resolve(strict=True)
    files = [contained(root, item) for item in manifests]
    require(files and len(set(files)) == len(files), "Manifest inputs must be distinct")
    namespaces = set()
    for file in files:
        require(file.name == "manifest.json" and file.parent.name in SECTIONS
                and file.parent.parent.parent == root / "tmp"
                and NAMESPACE.fullmatch(file.parent.parent.name),
                "Manifests require a fresh UUID capture namespace, never historical defaults")
        namespaces.add(file.parent.parent)
    require(len(namespaces) == 1, "All captures must belong to the same reviewed namespace")
    namespace = next(iter(namespaces))
    context_file, coverage_file = contained(root, release_context), contained(root, coverage)
    require(context_file.parent == namespace and coverage_file.parent == namespace,
            "Release context and coverage must stay inside the capture namespace")
    require(context_file.name == "release-context.json" and coverage_file.name == "coverage.json",
            "Only explicit JSON metadata inputs may be read")
    context, matrix = read_json(context_file), read_json(coverage_file)
    require(set(context) == {"schemaVersion", "documentation", "captures", "verificationSummary"}
            and context["schemaVersion"] == 1, "Unsupported release context")
    document = contained(root, feature_outline)
    require(document == root / "docs/payments-feature-outline.md", "Use the current payments feature provenance")
    documentation = context["documentation"]
    require(isinstance(documentation, dict)
            and set(documentation) == {"commit", "sha256", "baseline"}
            and re.fullmatch(r"[a-f0-9]{40}", documentation["commit"])
            and documentation["sha256"] == digest(document) and documentation["baseline"] == BASELINE,
            "Feature provenance is not bound to the reviewed document and baseline")
    feature_text = document.read_text(encoding="utf-8")
    require(BASELINE in feature_text and all(tag in feature_text for tag in TAGS)
            and not SECRET.search(feature_text), "Feature tags/baseline or text safety mismatch")
    require(isinstance(context["verificationSummary"], list) and context["verificationSummary"],
            "An explicitly reviewed verification summary is required")
    for line in context["verificationSummary"]:
        safe_text(line)
    bindings = context["captures"]
    require(isinstance(bindings, list) and len(bindings) == len(files), "Every manifest needs one reviewed binding")
    captures, seen, sources, locks = [], set(), set(), set()
    for binding in bindings:
        require(isinstance(binding, dict) and set(binding) == {
            "manifest", "sha256", "environment", "origin", "deploymentId", "commit",
            "sourceDigest", "lockDigest", "nodeVersion", "observedAt", "gates", "availability", "kind"},
            "Release bindings must use only the redacted allowlist")
        file = contained(root, binding["manifest"])
        require(file in files and file not in seen and binding["sha256"] == digest(file),
                "Manifest digest/binding mismatch")
        seen.add(file)
        env = binding["environment"]
        require(env in ORIGINS and binding["origin"] == ORIGINS[env]
                and binding["nodeVersion"] == "24.x"
                and re.fullmatch(r"dpl_[A-Za-z0-9]+", binding["deploymentId"])
                and (binding["commit"] is None or re.fullmatch(r"[a-f0-9]{40}", binding["commit"])),
                "Invalid host/deployment identity")
        for key in ("sourceDigest", "lockDigest"):
            require(isinstance(binding[key], str) and re.fullmatch(r"[a-f0-9]{64}", binding[key]),
                    "Runtime/lock digests are required")
        sources.add(binding["sourceDigest"])
        locks.add(binding["lockDigest"])
        observed = timestamp(binding["observedAt"])
        boolean_fields(binding["gates"], GATES)
        boolean_fields(binding["availability"], AVAILABILITY)
        flags, availability = binding["gates"], binding["availability"]
        require(not flags["STRIPE_LIVE_APPROVED"] and not availability["livemode"],
                "These walkthroughs must not claim live-money enablement")
        require(not availability["askPayments"] or flags["PAYMENTS_ENABLED"], "Ask availability contradicts gate")
        require(not availability["subscriptions"] or flags["SUPPORTERS_ENABLED"], "Supporter availability contradicts gate")
        require(not availability["funds"] or flags["FUNDS_ENABLED"], "Fund availability contradicts gate")
        require(availability["enabled"] == any(availability[key] for key in ("askPayments", "subscriptions", "funds")),
                "Overall payment availability is inconsistent")
        if env == "production":
            require(not any(flags.values()) and not any(availability.values()) and binding["commit"] is not None,
                    "Production must remain explicitly dark")
        manifest = read_json(file)
        require(manifest.get("baseURL") == binding["origin"] and manifest.get("environment") == env
                and manifest.get("origin") == binding["origin"], "Manifest host/environment mismatch")
        kind = binding["kind"]
        require(kind == SECTIONS[file.parent.name], "Capture kind/section mismatch")
        if kind == "community":
            require(env == "staging" and manifest.get("status") == "complete"
                    and manifest.get("cleanup") == "complete" and manifest.get("errors") == [],
                    "Community capture must be completed, cleaned and error-free in staging")
        elif kind == "payments":
            require(env == "staging" and manifest.get("status") == "captured"
                    and manifest.get("diagnostics") == []
                    and manifest.get("cleanup") == "temporary capture accounts removed; append-only audit events retained",
                    "Payment capture must preserve its complete/error-free/cleanup checks")
            recorded = manifest.get("paymentAvailability")
            require(isinstance(recorded, dict) and recorded.get("environment") == env
                    and all(type(recorded.get(key)) is bool and recorded[key] == availability[key]
                            for key in ("enabled", "askPayments", "subscriptions", "funds", "livemode")),
                    "Recorded payment availability differs from the reviewed context")
        else:
            require(env == "production" and manifest.get("kind") == "anonymous-public-walkthrough"
                    and manifest.get("status") == "complete" and manifest.get("cleanup") == "no-fixtures"
                    and manifest.get("errors") == [] and manifest.get("readOnly") is True
                    and manifest.get("authenticated") is False and type(manifest.get("mutationRequests")) is int
                    and manifest["mutationRequests"] == 0, "Public capture must be genuinely anonymous and read-only")
        finished = timestamp(manifest.get("capturedAt"))
        require(observed <= finished, "Reviewed gate observation must precede the capture interval")
        safe_text(manifest.get("fixtureDisclosure"))
        require(isinstance(manifest.get("views"), list) and manifest["views"], "Capture has no actual views")
        indices = set()
        for view in manifest["views"]:
            require(isinstance(view, dict) and type(view.get("index")) is int and view["index"] > 0
                    and view["index"] not in indices, "View IDs must be positive and unique")
            indices.add(view["index"])
            for key in ("title", "caption", "route", "image"):
                safe_text(view.get(key))
            require(view["route"].startswith("/") and not view["route"].startswith("//"), "View route must be local")
            require(observed <= timestamp(view.get("capturedAt")) <= finished,
                    "Each UTC view must fall within the reviewed observation/manifest interval")
            dialog_ids = view.get("dialogIds", [])
            require(isinstance(dialog_ids, list) and all(isinstance(item, str) and item in DIALOGS for item in dialog_ids)
                    and len(dialog_ids) == len(set(dialog_ids)), "Dialog associations must be unique allowlisted IDs")
            viewport = view.get("viewport")
            require(isinstance(viewport, dict) and set(viewport) == {"width", "height"}
                    and all(type(value) is int and value > 0 for value in viewport.values()),
                    "Positive viewport dimensions are required")
        captures.append(Capture(file, manifest, binding))
    require(len(sources) == len(locks) == 1, "Combined captures must match authored runtime and lock")
    for env in ORIGINS:
        same_host = [capture.binding for capture in captures if capture.binding["environment"] == env]
        require(not same_host or all(item["deploymentId"] == same_host[0]["deploymentId"]
                and item["gates"] == same_host[0]["gates"] and item["availability"] == same_host[0]["availability"]
                for item in same_host), "Same-host captures must share the reviewed deployment/gate configuration")
    require(set(matrix) == {"schemaVersion", "routes", "aliases", "dialogs"} and matrix["schemaVersion"] == 1,
            "Unsupported coverage matrix")
    references = {f"{capture.section}:{view['index']}": capture.binding["environment"]
                  for capture in captures for view in capture.manifest["views"]}
    reference_paths = {f"{capture.section}:{view['index']}": urlsplit(view["route"]).path
                       for capture in captures for view in capture.manifest["views"]}
    reference_dialogs = {f"{capture.section}:{view['index']}": view.get("dialogIds", [])
                        for capture in captures for view in capture.manifest["views"]}
    for kind, expected in (("routes", ROUTES), ("aliases", ALIASES), ("dialogs", DIALOGS)):
        rows = matrix[kind]
        require(isinstance(rows, list) and len(rows) == len(expected), "Complete coverage denominator is required")
        ids = set()
        for row in rows:
            require(isinstance(row, dict) and set(row) == {"id", "observations"}
                    and row["id"] in expected and row["id"] not in ids, "Coverage inventory mismatch or duplicate")
            ids.add(row["id"])
            observations = row["observations"]
            require(isinstance(observations, list) and observations, "Every coverage row needs an actual disposition")
            envs = set()
            for observation in observations:
                require(isinstance(observation, dict) and set(observation) == {"environment", "status", "reason", "views"},
                        "Invalid coverage observation")
                env = observation["environment"]
                require(env in ORIGINS and env not in envs and observation["status"] in STATES,
                        "Coverage environment/status mismatch")
                envs.add(env)
                safe_text(observation["reason"])
                refs = observation["views"]
                require(isinstance(refs, list) and len(refs) == len(set(refs))
                        and all(ref in references and references[ref] == env for ref in refs),
                        "Coverage must refer to real images from its stated environment")
                require(observation["status"] != "captured" or bool(refs), "Captured coverage requires actual screenshots")
                if observation["status"] == "captured" and kind in ("routes", "aliases"):
                    route = ALIASES[row["id"]] if kind == "aliases" else row["id"]
                    pattern = re.escape(route)
                    pattern = re.sub(r"\\\[[^]]+\\\]", "[^/]{1,255}", pattern)
                    require(any(re.fullmatch(pattern, reference_paths[ref]) for ref in refs),
                            "Captured route/alias evidence must show its actual page layout")
                if observation["status"] == "captured" and kind == "dialogs":
                    require(all(row["id"] in reference_dialogs[ref] for ref in refs),
                            "Captured dialog evidence needs its explicitly reviewed per-view dialog ID")
    target = contained(root, output, exists=False)
    require(target.parent == root / "output/pdf" and target.suffix == ".pdf"
            and (target.is_file() if existing_output else not target.exists()),
            "Output must be a contained PDF with the expected new/existing state")
    result = WalkthroughInputs(root, target, captures, context, matrix, feature_text)
    for capture, view in result.views():
        result.image(capture, view)
    return result


def input_parser(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--manifest", action="append", required=True)
    parser.add_argument("--output", "--pdf", dest="output", required=True)
    parser.add_argument("--release-context", required=True)
    parser.add_argument("--coverage", required=True)
    parser.add_argument("--feature-outline", required=True)
    return parser


def parse_inputs(root):
    arguments = input_parser("Build a verified-checkpoint walkthrough from explicit fresh inputs.").parse_args()
    return load_inputs(root, arguments.manifest, arguments.output, arguments.release_context,
                       arguments.coverage, arguments.feature_outline)
