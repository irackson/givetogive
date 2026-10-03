"""Offline metadata/path regression tests. Never author or render a PDF."""
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from walkthrough_inputs import (ALIASES, AVAILABILITY, BASELINE, DIALOGS, GATES,
                                ORIGINS, ROUTES, STATES, TAGS, digest, load_inputs)


class WalkthroughInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="givetogive-pdf-inputs-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.namespace = self.root / "tmp" / f"walkthrough-unit-{uuid4()}"
        self.capture = self.namespace / "community-staging"
        (self.capture / "images").mkdir(parents=True)
        self.image = self.capture / "images/view.png"
        self.image.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGv8AAAAASUVORK5CYII="))
        self.feature = self.root / "docs/payments-feature-outline.md"
        self.feature.parent.mkdir()
        self.feature.write_text(BASELINE + "\n" + "\n".join(TAGS), encoding="utf-8")
        self.view = {"index": 1, "title": "Actual home", "caption": "Synthetic test fixture.",
                     "route": "/", "image": str(self.image),
                     "capturedAt": "2026-10-03T21:00:00Z", "viewport": {"width": 1440, "height": 1000}}
        self.manifest = {"baseURL": ORIGINS["staging"], "origin": ORIGINS["staging"],
                         "environment": "staging", "status": "complete", "cleanup": "complete",
                         "errors": [], "capturedAt": "2026-10-03T21:01:00Z",
                         "fixtureDisclosure": "Owned synthetic test fixtures; no provider action.",
                         "views": [deepcopy(self.view)]}
        self.file = self.capture / "manifest.json"
        self.binding = {"manifest": str(self.file), "sha256": "",
                        "environment": "staging", "origin": ORIGINS["staging"], "kind": "community",
                        "deploymentId": "dpl_TestFixture", "commit": None, "nodeVersion": "24.x",
                        "sourceDigest": "a" * 64, "lockDigest": "b" * 64,
                        "observedAt": "2026-10-03T20:59:59Z",
                        "gates": {key: key in ("SUPPORTERS_ENABLED", "SIMULATION_ENABLED") for key in GATES},
                        "availability": {key: key in ("enabled", "subscriptions", "billingManagement") for key in AVAILABILITY}}
        self.context = {"schemaVersion": 1, "documentation": {"commit": "c" * 40,
                        "sha256": digest(self.feature), "baseline": BASELINE},
                        "captures": [self.binding],
                        "verificationSummary": ["Offline fixture only; provider and full-community acceptance unverified."]}
        def row(item):
            return {"id": item, "observations": [{"environment": "staging", "status": "not-captured",
                    "reason": "Not captured by this offline metadata fixture.", "views": []}]}
        self.matrix = {"schemaVersion": 1, "routes": [row(item) for item in ROUTES],
                       "aliases": [row(item) for item in ALIASES], "dialogs": [row(item) for item in DIALOGS]}
        self.context_file = self.namespace / "release-context.json"
        self.matrix_file = self.namespace / "coverage.json"
        self.output = self.root / "output/pdf/fresh-guide.pdf"
        self.sync()

    def sync(self):
        self.file.write_text(json.dumps(self.manifest), encoding="utf-8")
        self.binding["sha256"] = digest(self.file)
        self.context_file.write_text(json.dumps(self.context), encoding="utf-8")
        self.matrix_file.write_text(json.dumps(self.matrix), encoding="utf-8")

    def load(self, **changes):
        values = {"manifests": [str(self.file)], "output": str(self.output),
                  "release_context": str(self.context_file), "coverage": str(self.matrix_file),
                  "feature_outline": str(self.feature)}
        values.update(changes)
        return load_inputs(self.root, **values)

    def use_kind(self, kind):
        image_bytes = self.image.read_bytes()
        self.capture = self.namespace / ("production" if kind == "public" else "payments-staging")
        (self.capture / "images").mkdir(parents=True)
        self.image = self.capture / "images/view.png"
        self.image.write_bytes(image_bytes)
        self.file = self.capture / "manifest.json"
        self.manifest["views"][0]["image"] = str(self.image)
        self.binding.update(manifest=str(self.file), kind=kind)
        if kind == "payments":
            self.manifest.update(status="captured", diagnostics=[],
                cleanup="temporary capture accounts removed; append-only audit events retained",
                paymentAvailability={**{key: self.binding["availability"][key]
                    for key in ("enabled", "askPayments", "subscriptions", "funds", "livemode")}, "environment": "staging"})
        else:
            self.binding.update(environment="production", origin=ORIGINS["production"], commit="d" * 40,
                                gates={key: False for key in GATES}, availability={key: False for key in AVAILABILITY})
            self.manifest.update(baseURL=ORIGINS["production"], origin=ORIGINS["production"], environment="production",
                                 kind="anonymous-public-walkthrough", cleanup="no-fixtures",
                                 readOnly=True, authenticated=False, mutationRequests=0)
        self.sync()

    def test_valid_partial_inventory_preserves_every_missing_state_and_creates_no_output(self):
        inputs = self.load()
        self.assertEqual(len(inputs.coverage_rows("routes")), 29)
        self.assertEqual(len(inputs.coverage_rows("aliases")), 4)
        self.assertEqual(len(inputs.coverage_rows("dialogs")), 21)
        self.assertEqual(len(list(inputs.views())), 1)
        self.assertIn("Supporter ON", inputs.captures[0].label(self.view))
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.rglob("*.pdf")), [])

    def test_legacy_or_duplicate_manifests_are_refused(self):
        legacy = self.root / "tmp/walkthrough/manifest.json"
        legacy.parent.mkdir()
        legacy.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.load(manifests=[str(legacy)])
        with self.assertRaises(ValueError):
            self.load(manifests=[str(self.file), str(self.file)])

    def test_missing_and_duplicate_inventory_rows_are_not_excluded(self):
        for kind in ("routes", "aliases", "dialogs"):
            original = deepcopy(self.matrix[kind])
            self.matrix[kind] = original[:-1]
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.matrix[kind] = original[:-1] + [original[0]]
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.matrix[kind] = original

    def test_captured_rows_require_real_same_environment_and_route_evidence(self):
        row = self.matrix["routes"][0]["observations"][0]
        row["status"] = "captured"
        for refs in ([], ["community-staging:99"]):
            row["views"] = refs
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
        row["views"] = ["community-staging:1"]
        self.sync()
        self.load()
        row["environment"] = "production"
        self.sync()
        with self.assertRaises(ValueError):
            self.load()
        row["environment"] = "staging"
        self.manifest["views"][0]["route"] = "/support"
        self.sync()
        with self.assertRaises(ValueError):
            self.load()

    def test_dynamic_route_layout_and_alias_target_are_checked(self):
        self.manifest["views"][0]["route"] = "/members/dummy-member"
        self.matrix["routes"][3]["observations"][0].update(status="captured", views=["community-staging:1"])
        self.matrix["aliases"][0]["observations"][0].update(status="captured", views=["community-staging:1"])
        self.sync()
        self.load()
        self.manifest["views"][0]["route"] = "/members/dummy-member/private"
        self.sync()
        with self.assertRaises(ValueError):
            self.load()
        self.manifest["views"][0]["route"] = "/members/" + "a" * 256
        self.sync()
        with self.assertRaises(ValueError):
            self.load()

    def test_payments_capture_retains_its_own_acceptance_and_recorded_gate_checks(self):
        self.use_kind("payments")
        self.load()
        for field, value in (("diagnostics", [{"kind": "error"}]), ("cleanup", "complete"),
                             ("status", "captured-with-diagnostics")):
            original = deepcopy(self.manifest)
            self.manifest[field] = value
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.manifest = original
        self.manifest["paymentAvailability"]["subscriptions"] = False
        self.sync()
        with self.assertRaises(ValueError):
            self.load()

    def test_public_capture_is_dark_read_only_anonymous_and_has_no_mutations(self):
        self.use_kind("public")
        self.load()
        for field, value in (("readOnly", False), ("authenticated", True), ("mutationRequests", 1)):
            self.manifest[field] = value
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.manifest[field] = 0 if field == "mutationRequests" else field == "readOnly"
        self.binding["gates"]["SIMULATION_ENABLED"] = True
        self.sync()
        with self.assertRaises(ValueError):
            self.load()

    def test_combined_hosts_keep_their_own_gates_but_require_identical_runtime_and_lock(self):
        original_file, original_binding = self.file, deepcopy(self.binding)
        self.use_kind("public")
        self.context["captures"] = [original_binding, self.binding]
        self.sync()
        inputs = self.load(manifests=[str(original_file), str(self.file)])
        self.assertEqual(len(inputs.captures), 2)
        self.assertNotEqual(inputs.captures[0].binding["gates"], inputs.captures[1].binding["gates"])
        self.binding["lockDigest"] = "e" * 64
        self.sync()
        with self.assertRaises(ValueError):
            self.load(manifests=[str(original_file), str(self.file)])

    def test_digest_and_current_feature_provenance_are_required(self):
        self.context["documentation"]["sha256"] = "d" * 64
        self.sync()
        with self.assertRaises(ValueError):
            self.load()
        self.context["documentation"]["sha256"] = digest(self.feature)
        self.binding["sha256"] = "d" * 64
        self.context_file.write_text(json.dumps(self.context), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.load()
        self.sync()
        self.context["documentation"]["baseline"] = "1ecb2ee"
        self.sync()
        with self.assertRaises(ValueError):
            self.load()

    def test_environment_gate_and_private_metadata_mismatches_fail_closed(self):
        mutations = [
            lambda: self.binding.update(origin=ORIGINS["production"]),
            lambda: self.binding["availability"].update(askPayments=True),
            lambda: self.binding["gates"].update(STRIPE_LIVE_APPROVED=True),
            lambda: self.binding.update(vercelProtectionBypass="dummy-private"),
            lambda: self.manifest.update(environment="production"),
        ]
        for mutation in mutations:
            original_binding, original_manifest = deepcopy(self.binding), deepcopy(self.manifest)
            mutation()
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.binding.clear()
            self.binding.update(original_binding)
            self.manifest = original_manifest

    def test_incomplete_cleanup_errors_and_duplicate_view_ids_are_not_waived(self):
        for field, value in (("status", "incomplete"), ("cleanup", "failed"),
                             ("errors", ["redacted error"]), ("views", [self.view, self.view])):
            original = deepcopy(self.manifest)
            self.manifest[field] = value
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
            self.manifest = original

    def test_image_escape_redirect_missing_or_invalid_dimensions_are_refused(self):
        original = self.manifest["views"][0]["image"]
        outside = self.root / "outside.png"
        outside.write_bytes(self.image.read_bytes())
        for requested in (str(outside), str(self.capture / "images/missing.png")):
            self.manifest["views"][0]["image"] = requested
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
        self.manifest["views"][0]["image"] = original
        self.sync()
        self.image.write_bytes(b"not-a-PNG-image")
        with self.assertRaises(ValueError):
            self.load()

    def test_symlink_input_or_output_escape_is_refused(self):
        def redirect(link, target):
            if os.name == "nt":
                # Both literal targets belong to this test's validated temp fixture.
                subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(target)],
                               check=True, capture_output=True)
            else:
                link.symlink_to(target, target_is_directory=True)
        outside = self.root / "other-images"
        outside.mkdir()
        (outside / "view.png").write_bytes(self.image.read_bytes())
        link = self.capture / "images/redirect"
        redirect(link, outside)
        self.manifest["views"][0]["image"] = str(link / "view.png")
        self.sync()
        with self.assertRaises(ValueError):
            self.load()
        self.manifest["views"][0]["image"] = str(self.image)
        self.sync()
        redirect(self.root / "output", outside)
        with self.assertRaises(ValueError):
            self.load()

    def test_existing_output_directory_and_late_output_race_are_preserved_without_pdf_creation(self):
        inputs = self.load()
        # A directory models an occupied destination without creating any PDF.
        self.output.mkdir(parents=True)
        marker = self.output / "retained.txt"
        marker.write_text("must be preserved", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.load()
        with self.assertRaises(ValueError):
            inputs.open_output()
        self.assertEqual(marker.read_text(encoding="utf-8"), "must be preserved")
        self.assertFalse(any(file.is_file() for file in self.root.rglob("*.pdf")))

    def test_all_dispositions_are_retained_and_secret_values_are_never_echoed(self):
        self.manifest["views"][0]["dialogIds"] = ["create-ask"]
        for row, state in zip(self.matrix["dialogs"], STATES):
            observation = row["observations"][0]
            observation["status"] = state
            if state == "captured":
                observation["views"] = ["community-staging:1"]
        self.sync()
        self.assertEqual(len(self.load().coverage_rows("dialogs")), 21)
        value = "rk_test_dummyPrivateValueNeverEcho"
        self.context["verificationSummary"] = [value]
        self.sync()
        with self.assertRaises(ValueError) as error:
            self.load()
        self.assertNotIn(value, str(error.exception))

    def test_dialog_claims_need_explicit_unique_allowlisted_associations(self):
        observation = self.matrix["dialogs"][0]["observations"][0]
        observation.update(status="captured", views=["community-staging:1"])
        for associations in (None, ["refund-payment"], ["create-ask", "create-ask"], ["not-a-dialog"]):
            if associations is None:
                self.manifest["views"][0].pop("dialogIds", None)
            else:
                self.manifest["views"][0]["dialogIds"] = associations
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
        self.manifest["views"][0]["dialogIds"] = ["create-ask"]
        self.sync()
        self.load()

    def test_utc_observation_view_manifest_ordering_is_enforced(self):
        for moment in ("2026-10-03T20:59:58Z", "2026-10-03T21:01:01Z",
                       "2026-10-03T21:00:00", "2026-10-03T21:00:00+05:00"):
            self.manifest["views"][0]["capturedAt"] = moment
            self.sync()
            with self.assertRaises(ValueError):
                self.load()
        self.manifest["views"][0]["capturedAt"] = "2026-10-03T21:00:00Z"
        self.binding["observedAt"] = "2026-10-03T21:02:00Z"
        self.sync()
        with self.assertRaises(ValueError):
            self.load()


if __name__ == "__main__":
    unittest.main()
