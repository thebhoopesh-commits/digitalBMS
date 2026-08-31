"""
Adversarial Stress Suite — Challenger 3 (Gate Iteration 2 Verification).

Tests:
1. Direct reproduction & verification of all Challenger 1 reported defects:
   - Backend returning None, dict, list, int, bytes, exception
   - Corrupted types triggering failsafe recovery (e.g. {"location": 101, "action_requested": 404})
   - Float NaN, +Inf, -Inf in intensity and confidence validators
   - Non-string inputs (None, int, list, dict, bytes) for text and location_hint
2. Edge cases in ComfortEvent and TranslationResult schema validation & serialization:
   - Bizarre types in metadata, sensation, action_requested, location, raw_text
   - Qualitative words for intensity ("freezing", "burning", "mild", "urgent")
   - Percentage strings for confidence ("100%", "0%", "75.5%")
3. High concurrency stress testing:
   - 32 concurrent threads executing 320 requests on a single shared LocalTranslator
4. Sustained 1,000-iteration memory and throughput benchmark with tracemalloc
"""

import math
import json
import time
import tracemalloc
import unittest
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from unittest.mock import MagicMock

from local_translator import (
    ComfortDomain,
    ComfortEvent,
    TranslationResult,
    LocalTranslator,
    MockBackend,
    BaseInferenceBackend,
    parse_and_validate,
    stage1_strip_markdown_fences,
    stage2_slice_json_boundary,
    stage3_normalize_json_syntax,
    stage4_regex_key_value_repair,
    stage5_rule_based_fallback,
)


class TestChallenger1DefectRemediation(unittest.TestCase):
    """Verify that all 4 defects reported by Challenger 1 are fully remediated."""

    def test_remediation_obs1_failsafe_recovery_type_corruption(self):
        """Observation 1: parse_and_validate must not crash when data has corrupted field types."""
        corrupted_payloads = [
            '{"location": 101, "action_requested": 404}',
            '{"location": {"room": 204}, "action_requested": ["ventilate"]}',
            '{"domain": "not_a_domain", "location": 999, "action_requested": 888, "intensity": "super_hot"}',
            '{"location": true, "action_requested": false, "sensation": 123}',
            '{"location": [1, 2, 3], "action_requested": {"nested": "dict"}}',
        ]
        for payload in corrupted_payloads:
            with self.subTest(payload=payload):
                event, meta = parse_and_validate(payload, "It is freezing in room 101", location_hint=101)
                self.assertIsInstance(event, ComfortEvent)
                self.assertIsInstance(event.domain, ComfortDomain)
                self.assertIsInstance(event.intensity, int)
                self.assertTrue(1 <= event.intensity <= 5)
                self.assertIsInstance(event.confidence, float)
                self.assertTrue(0.0 <= event.confidence <= 1.0)
                self.assertIsInstance(event.raw_text, str)
                # Ensure to_dict() serialization works without exception
                d = event.to_dict()
                self.assertIsInstance(d, dict)
                json_str = json.dumps(d)
                self.assertIsInstance(json_str, str)

    def test_remediation_obs2_non_string_backend_returns(self):
        """Observation 2: stage1 and translate() must handle non-string backend return types cleanly."""
        non_string_outputs = [
            None,
            12345,
            {"domain": "thermal", "sensation": "cold"},
            ["comfort", "event"],
            b'{"domain": "thermal", "sensation": "freezing"}',
            3.14159,
            False,
        ]
        for output in non_string_outputs:
            with self.subTest(output=type(output)):
                stripped = stage1_strip_markdown_fences(output)
                self.assertIsInstance(stripped, str)

                # Test via LocalTranslator
                backend = MagicMock()
                backend.name = "mock_corrupt"
                backend.health_check.return_value = True
                backend.generate.return_value = output

                translator = LocalTranslator(backend=backend)
                res = translator.translate("It is too cold in office 3B")
                self.assertIsInstance(res, TranslationResult)
                self.assertTrue(res.success)
                self.assertIsInstance(res.event, ComfortEvent)
                self.assertEqual(res.event.domain, ComfortDomain.THERMAL)

    def test_remediation_obs3_nan_inf_intensity_and_confidence(self):
        """Observation 3: float('nan') and float('inf') must not raise unhandled ValueError/OverflowError."""
        nan_vals = [float("nan"), float("inf"), float("-inf")]
        for val in nan_vals:
            with self.subTest(val=val):
                # Direct ComfortEvent instantiation
                event = ComfortEvent(
                    domain=ComfortDomain.THERMAL,
                    sensation="freezing",
                    intensity=val,
                    confidence=val,
                    raw_text="cold",
                )
                self.assertIsInstance(event.intensity, int)
                self.assertTrue(1 <= event.intensity <= 5)
                self.assertFalse(math.isnan(event.intensity))
                self.assertIsInstance(event.confidence, float)
                self.assertTrue(0.0 <= event.confidence <= 1.0)
                self.assertFalse(math.isnan(event.confidence))

    def test_remediation_obs4_non_string_translate_inputs(self):
        """Observation 4: translate() must handle None, int, dict, list for text and location_hint."""
        translator = LocalTranslator()
        non_string_inputs = [
            (None, None),
            (101, 101),
            ({"msg": "too hot"}, {"room": 204}),
            (["freezing", "help"], [101, 102]),
            (b"cold room", b"room 301"),
            (True, False),
        ]
        for text_in, loc_in in non_string_inputs:
            with self.subTest(text_in=type(text_in), loc_in=type(loc_in)):
                res = translator.translate(text_in, location_hint=loc_in)
                self.assertIsInstance(res, TranslationResult)
                self.assertTrue(res.success)
                self.assertIsInstance(res.event, ComfortEvent)
                self.assertIsInstance(res.event.raw_text, str)
                if res.event.location is not None:
                    self.assertIsInstance(res.event.location, str)


class TestExtremeTypeCoercionAndEdgeCases(unittest.TestCase):
    """Verify deep edge cases, percentage parsing, and qualitative intensity mapping."""

    def test_qualitative_intensity_words(self):
        """Qualitative intensity words map to appropriate 1-5 scale."""
        test_cases = [
            ("barely", 1),
            ("subtle", 1),
            ("mild", 2),
            ("moderate", 3),
            ("severe", 4),
            ("extreme", 5),
            ("urgent", 5),
            ("unbearable", 5),
        ]
        for word, expected in test_cases:
            with self.subTest(word=word):
                e = ComfortEvent(
                    domain=ComfortDomain.THERMAL,
                    sensation="hot",
                    intensity=word,
                    raw_text="hot",
                )
                self.assertEqual(e.intensity, expected)

    def test_confidence_percentage_and_string_coercion(self):
        """Confidence string variations ("100%", "85%", "0.95", "invalid") parse cleanly."""
        test_cases = [
            ("100%", 1.0),
            ("0%", 0.0),
            ("85.5%", 0.855),
            ("0.75", 0.75),
            ("150%", 1.0),  # clamped
            ("-20%", 0.0),  # clamped
            ("garbage_str", 0.8),  # default
        ]
        for conf_str, expected in test_cases:
            with self.subTest(conf_str=conf_str):
                e = ComfortEvent(
                    domain=ComfortDomain.THERMAL,
                    sensation="hot",
                    confidence=conf_str,
                    raw_text="hot",
                )
                self.assertAlmostEqual(e.confidence, expected, places=3)

    def test_location_and_action_edge_cases(self):
        """Null representation strings ('null', 'undefined', 'none') normalize correctly."""
        # 'null' and 'undefined' should become None
        e1 = ComfortEvent(
            domain=ComfortDomain.THERMAL,
            sensation="hot",
            location="null",
            action_requested="undefined",
            raw_text="hot",
        )
        self.assertIsNone(e1.location)
        self.assertIsNone(e1.action_requested)

        # 'none' in action_requested is a valid BMS recommendation and should be preserved as 'none'
        e2 = ComfortEvent(
            domain=ComfortDomain.THERMAL,
            sensation="comfortable",
            action_requested="none",
            raw_text="fine",
        )
        self.assertEqual(e2.action_requested, "none")

    def test_metadata_robustness(self):
        """Metadata field accepts non-dict values and normalizes them to dict."""
        for meta_val in [None, "string_meta", 123, ["list", "meta"]]:
            with self.subTest(meta_val=type(meta_val)):
                e = ComfortEvent(
                    domain=ComfortDomain.THERMAL,
                    sensation="hot",
                    metadata=meta_val,
                    raw_text="hot",
                )
                self.assertIsInstance(e.metadata, dict)


class TestHighConcurrencyAndMemoryBenchmark(unittest.TestCase):
    """Stress test high concurrency and 1,000-iteration throughput/memory footprint."""

    def test_32_worker_thread_concurrency(self):
        """32 concurrent worker threads executing 320 requests on a single shared LocalTranslator."""
        translator = LocalTranslator()
        num_workers = 32
        requests_per_worker = 10
        total_requests = num_workers * requests_per_worker

        prompts = [
            "It's freezing in room 204, turn up heat!",
            "Too noisy in open workspace, construction drill outside.",
            "Blinding glare on my screen near window 4.",
            "Stuffy air and high CO2 in conference room B.",
            "The chair in cubicle 12 is broken and hurting my back.",
        ]

        def worker_task(worker_id: int):
            results = []
            for i in range(requests_per_worker):
                p = prompts[(worker_id + i) % len(prompts)]
                res = translator.translate(p, location_hint=f"Zone-{worker_id}")
                results.append(res)
            return results

        t_start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = [executor.submit(worker_task, wid) for wid in range(num_workers)]
            all_worker_results = [f.result() for f in futures]
        t_elapsed = time.perf_counter() - t_start

        flat_results = [r for sub in all_worker_results for r in sub]
        self.assertEqual(len(flat_results), total_requests)
        for r in flat_results:
            self.assertTrue(r.success)
            self.assertIsInstance(r.event, ComfortEvent)

        throughput = total_requests / t_elapsed
        print(f"\n[Challenger 3 Concurrency] {total_requests} requests across {num_workers} threads in {t_elapsed:.4f}s ({throughput:.2f} req/s)")
        self.assertGreater(throughput, 1000.0)

    def test_1000_iterations_throughput_and_memory_stability(self):
        """1,000 sequential translations with tracemalloc heap memory profiling."""
        translator = LocalTranslator()
        iterations = 1000

        complaints = [
            "Freezing in office 101, please turn off AC.",
            "Way too hot in room 302, sweating.",
            "Loud buzzing noise from ventilation fan in lab 4.",
            "Glaring light on desk 12, need blinds closed.",
            "Stale air in main conference room, feeling sleepy.",
            "Just checking in, room temp feels okay.",
            "12345 !@#$%^&*()_+ unclassifiable text",
            "Emergency: room 404 is at 35 degrees Celsius, AC failed!",
        ]

        tracemalloc.start()
        snapshot_before = tracemalloc.take_snapshot()

        t_start = time.perf_counter()
        latencies = []

        for i in range(iterations):
            text = complaints[i % len(complaints)]
            t0 = time.perf_counter()
            res = translator.translate(text, location_hint=f"Room-{i%20}")
            t1 = time.perf_counter()
            latencies.append((t1 - t0) * 1000.0)
            self.assertTrue(res.success)
            self.assertIsInstance(res.event, ComfortEvent)

        t_total = time.perf_counter() - t_start
        snapshot_after = tracemalloc.take_snapshot()
        tracemalloc.stop()

        stats = snapshot_after.compare_to(snapshot_before, "lineno")
        total_delta_bytes = sum(stat.size_diff for stat in stats)
        total_delta_kb = total_delta_bytes / 1024.0

        latencies.sort()
        p50 = latencies[int(len(latencies) * 0.50)]
        p95 = latencies[int(len(latencies) * 0.95)]
        p99 = latencies[int(len(latencies) * 0.99)]
        mean_lat = sum(latencies) / len(latencies)
        throughput = iterations / t_total

        print("\n" + "=" * 70)
        print(" [CHALLENGER 3] 1,000-ITERATION STRESS & MEMORY BENCHMARK REPORT")
        print("=" * 70)
        print(f"Total Iterations:      {iterations}")
        print(f"Total Wall Clock:      {t_total:.4f} s")
        print(f"Throughput:            {throughput:.2f} translations/sec")
        print(f"Latencies (ms):")
        print(f"  Min:                 {latencies[0]:.4f} ms")
        print(f"  Mean:                {mean_lat:.4f} ms")
        print(f"  Median (p50):        {p50:.4f} ms")
        print(f"  p95:                 {p95:.4f} ms")
        print(f"  p99:                 {p99:.4f} ms")
        print(f"  Max:                 {latencies[-1]:.4f} ms")
        print(f"Net Memory Delta:      {total_delta_kb:.2f} KB across {iterations} calls ({total_delta_kb / iterations:.4f} KB/call)")
        print("=" * 70)

        # Invariants:
        # 1. Throughput > 2,000 req/s
        self.assertGreater(throughput, 2000.0)
        # 2. Mean latency < 1.0 ms
        self.assertLess(mean_lat, 1.0)
        # 3. Net memory leak < 100 KB across 1,000 calls
        self.assertLess(total_delta_kb, 100.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
