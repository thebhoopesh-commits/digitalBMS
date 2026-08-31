"""
test_adversarial_challenger_2.py
================================
Adversarial Stress Testing & Concurrency/Error-Injection Verification Suite.

Target: `local_translator.py`
Author: Challenger 2 (Empirical Challenger Agent)
Purpose: Stress test backend adapter lifecycle, mock concurrency, error injection
         (timeouts, network exceptions, memory errors), fallback mechanisms,
         and serialization correctness.

Execution:
    python -m unittest test_adversarial_challenger_2.py -v
"""

from __future__ import annotations

import concurrent.futures
import gc
import io
import json
import logging
import math
import os
import random
import re
import sys
import time
import tracemalloc
import unittest
import urllib.error
import uuid
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

from local_translator import (
    ComfortDomain,
    ComfortEvent,
    TranslationResult,
    BaseInferenceBackend,
    LlamaCppBackend,
    OllamaBackend,
    MockBackend,
    LocalTranslator,
    stage1_strip_markdown_fences,
    stage2_slice_outer_json_boundaries,
    stage3_normalize_json_syntax,
    stage4_regex_field_recovery,
    stage5_heuristic_fallback,
    parse_and_validate,
    build_full_prompt,
    GBNF_COMFORT_EVENT_GRAMMAR,
)

# Silence debug logging during heavy fuzzing and error simulation
logging.getLogger("local_translator").setLevel(logging.CRITICAL)


class AdversarialTestBase(unittest.TestCase):
    """Base test case providing invariant validators for TranslationResult and ComfortEvent."""

    def assert_valid_invariants(
        self,
        result: TranslationResult,
        expected_raw_text: Optional[str] = None,
        expected_backend: Optional[str] = None
    ) -> None:
        """Verify strict invariants on TranslationResult and nested ComfortEvent."""
        self.assertIsInstance(result, TranslationResult)
        self.assertIsInstance(result.success, bool)
        self.assertIsInstance(result.execution_time_ms, (int, float))
        self.assertGreaterEqual(result.execution_time_ms, 0.0)
        self.assertIsInstance(result.backend_used, str)
        self.assertIsInstance(result.raw_response, str)

        if expected_backend:
            self.assertEqual(result.backend_used, expected_backend)

        # Crash-proof guarantee: event is never None
        self.assertIsNotNone(result.event, "result.event must never be None")
        event = result.event
        self.assertIsInstance(event, ComfortEvent)

        # Event ID: valid UUID string
        self.assertIsInstance(event.event_id, str)
        try:
            uuid_obj = uuid.UUID(event.event_id)
            self.assertEqual(str(uuid_obj), event.event_id)
        except ValueError:
            self.fail(f"event_id '{event.event_id}' is not a valid UUID string")

        # Timestamp: non-empty string
        self.assertIsInstance(event.timestamp, str)
        self.assertGreater(len(event.timestamp), 0)

        # Domain enum validation
        valid_domains = {d.value for d in ComfortDomain}.union({d for d in ComfortDomain})
        self.assertIn(event.domain, valid_domains, f"Invalid domain: {event.domain}")

        # Sensation: non-empty string
        self.assertIsInstance(event.sensation, str)
        self.assertGreater(len(event.sensation), 0)

        # Intensity: integer in [1, 5]
        self.assertIsInstance(event.intensity, int)
        self.assertGreaterEqual(event.intensity, 1)
        self.assertLessEqual(event.intensity, 5)

        # Confidence: float in [0.0, 1.0]
        self.assertIsInstance(event.confidence, (int, float))
        self.assertGreaterEqual(event.confidence, 0.0)
        self.assertLessEqual(event.confidence, 1.0)

        # Raw text match
        if expected_raw_text is not None:
            self.assertEqual(event.raw_text, expected_raw_text)

        # Serialization to dict and JSON round-trip
        d = event.to_dict()
        self.assertIsInstance(d, dict)
        dumped = json.dumps(d)
        self.assertIsInstance(dumped, str)

        res_d = result.to_dict()
        self.assertIsInstance(res_d, dict)
        dumped_res = json.dumps(res_d)
        self.assertIsInstance(dumped_res, str)


# ============================================================================
# 1. BACKEND ADAPTER LIFECYCLE & RESOLUTION MATRIX
# ============================================================================

class TestBackendLifecycleAndResolution(AdversarialTestBase):
    """Adversarial testing of backend initialization, resolution, switching, and health checks."""

    def test_explicit_backend_injection(self) -> None:
        """Verify passing an explicit BaseInferenceBackend instance bypasses string resolution."""
        mock = MockBackend(default_response=json.dumps({"domain": "thermal", "sensation": "too_hot", "intensity": 4}))
        translator = LocalTranslator(backend=mock)
        self.assertIs(translator.backend, mock)
        self.assertEqual(translator.backend.name, "mock")
        self.assertTrue(translator.health_check())

    def test_mock_backend_resolution(self) -> None:
        """Verify backend_type='mock' initializes MockBackend."""
        translator = LocalTranslator(backend_type="mock")
        self.assertIsInstance(translator.backend, MockBackend)
        self.assertEqual(translator.backend.name, "mock")
        self.assertTrue(translator.health_check())

    def test_llama_cpp_resolution_without_model_path_fallback_true(self) -> None:
        """Verify llama_cpp without model_path falls back to MockBackend when fallback_to_mock=True."""
        translator = LocalTranslator(backend_type="llama_cpp", model_path=None, fallback_to_mock=True)
        self.assertIsInstance(translator.backend, MockBackend)
        self.assertEqual(translator.backend.name, "mock")

    def test_llama_cpp_resolution_without_model_path_fallback_false(self) -> None:
        """Verify llama_cpp without model_path raises ValueError when fallback_to_mock=False."""
        with self.assertRaises(ValueError):
            LocalTranslator(backend_type="llama_cpp", model_path=None, fallback_to_mock=False)

    def test_llama_cpp_resolution_unhealthy_fallback_true(self) -> None:
        """Verify llama_cpp with nonexistent model falls back to MockBackend when fallback_to_mock=True."""
        translator = LocalTranslator(backend_type="llama_cpp", model_path="/invalid/path/model.gguf", fallback_to_mock=True)
        self.assertIsInstance(translator.backend, MockBackend)

    def test_ollama_resolution_unreachable_fallback_true(self) -> None:
        """Verify ollama with unreachable URL falls back to MockBackend when fallback_to_mock=True."""
        translator = LocalTranslator(
            backend_type="ollama",
            ollama_url="http://localhost:59999",  # Non-existent port
            fallback_to_mock=True
        )
        self.assertIsInstance(translator.backend, MockBackend)

    def test_ollama_resolution_unreachable_fallback_false(self) -> None:
        """Verify ollama with unreachable URL keeps OllamaBackend when fallback_to_mock=False."""
        translator = LocalTranslator(
            backend_type="ollama",
            ollama_url="http://localhost:59999",
            fallback_to_mock=False
        )
        self.assertIsInstance(translator.backend, OllamaBackend)
        self.assertFalse(translator.health_check())

    def test_auto_resolution_fallbacks(self) -> None:
        """Verify auto resolution tries llama_cpp -> ollama -> mock."""
        # Auto with fallback_to_mock=True should resolve to MockBackend when no local LLMs exist
        translator = LocalTranslator(backend_type="auto", fallback_to_mock=True)
        self.assertTrue(translator.health_check())
        self.assertIn(translator.backend.name, ["llama_cpp", "ollama", "mock"])

    def test_auto_resolution_no_backend_fallback_false(self) -> None:
        """Verify auto resolution raises RuntimeError when no backends are available and fallback_to_mock=False."""
        # Patch OllamaBackend.health_check to return False
        with patch.object(OllamaBackend, "health_check", return_value=False):
            with self.assertRaises(RuntimeError):
                LocalTranslator(backend_type="auto", fallback_to_mock=False)

    def test_unknown_backend_type_raises_value_error(self) -> None:
        """Verify invalid backend_type raises ValueError."""
        with self.assertRaises(ValueError):
            LocalTranslator(backend_type="tensorrt_llm")

    def test_status_diagnostics(self) -> None:
        """Verify get_status() returns valid diagnostic telemetry dictionary."""
        translator = LocalTranslator(backend_type="mock")
        status = translator.get_status()
        self.assertIsInstance(status, dict)
        self.assertEqual(status["active_backend"], "mock")
        self.assertTrue(status["is_healthy"])
        self.assertIn("timestamp", status)


# ============================================================================
# 2. MOCKBACKEND CUSTOMIZATION & CONCURRENCY
# ============================================================================

class TestMockBackendCustomizationAndConcurrency(AdversarialTestBase):
    """Stress tests MockBackend dynamic behavior and multi-threaded concurrency."""

    def test_mock_backend_dynamic_responses_mutation(self) -> None:
        """Verify dynamically modifying canned responses at runtime works cleanly."""
        backend = MockBackend()
        translator = LocalTranslator(backend=backend)

        # Baseline translation
        r1 = translator.translate("Room 101 is boiling hot")
        self.assertEqual(r1.event.domain, ComfortDomain.THERMAL)

        # Inject canned override for exact input
        backend.responses["Room 101 is boiling hot"] = json.dumps({
            "domain": "visual",
            "sensation": "glare",
            "location": "Room 101",
            "intensity": 5,
            "action_requested": "close_blinds",
            "confidence": 0.99
        })

        r2 = translator.translate("Room 101 is boiling hot")
        self.assertEqual(r2.event.domain, ComfortDomain.VISUAL)
        self.assertEqual(r2.event.sensation, "glare")
        self.assertEqual(r2.event.intensity, 5)

    def test_mock_backend_simulated_latency(self) -> None:
        """Verify simulated latency parameter adds precise delay."""
        backend = MockBackend(simulated_latency_ms=50.0)
        translator = LocalTranslator(backend=backend)

        start = time.perf_counter()
        res = translator.translate("Freezing in 204")
        elapsed = (time.perf_counter() - start) * 1000.0

        self.assertGreaterEqual(elapsed, 40.0)
        self.assertGreaterEqual(res.execution_time_ms, 40.0)

    def test_mock_backend_high_concurrency_multi_threading(self) -> None:
        """Adversarial multi-threaded stress: 16 concurrent workers executing 160 requests."""
        translator = LocalTranslator(backend=MockBackend())
        queries = [
            "It is freezing cold in Room 101, please turn up the heat!",
            "Blinding glare on monitor screen in Zone B.",
            "Loud rattling noise in conference room 3 from HVAC unit.",
            "Stuffy stale air near desk 14, need fresh ventilation.",
            "Desk chair height mechanism is broken and my back aches.",
            "General discomfort at workspace 402.",
            "Direct sunlight is too bright at window desk 7.",
            "Chemical solvent odor coming from hallway corridor 2."
        ] * 20  # 160 total requests

        start_time = time.perf_counter()
        results: List[TranslationResult] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
            future_to_query = {executor.submit(translator.translate, q): q for q in queries}
            for future in concurrent.futures.as_completed(future_to_query):
                res = future.result()
                results.append(res)

        total_time = time.perf_counter() - start_time
        self.assertEqual(len(results), 160)

        # Verify all 160 results satisfy invariants
        for res in results:
            self.assert_valid_invariants(res)

        throughput = 160.0 / total_time
        print(f"\n[MockBackend Concurrency] 160 parallel requests across 16 threads in {total_time:.4f}s ({throughput:.2f} req/s)")
        self.assertGreater(throughput, 100.0)


# ============================================================================
# 3. HIGH-THROUGHPUT BATCH & SEQUENTIAL LOAD (100+ REQUESTS)
# ============================================================================

class TestHighThroughputLoadAndMemory(AdversarialTestBase):
    """High-throughput stress testing with 200+ sequential and 150+ batch translations."""

    def test_sequential_250_requests_and_tracemalloc(self) -> None:
        """Run 250 sequential translations and profile heap memory to ensure zero leaks."""
        translator = LocalTranslator(backend=MockBackend())
        pool = [
            "Room 101 is freezing cold, please turn up the heat.",
            "Blinding glare on desk 5 monitor screen.",
            "HVAC fan making an unbearable loud hum in conference room 2.",
            "Stale and humid air in Zone C, please ventilate.",
            "My chair won't adjust and my back hurts.",
            "It is sweltering hot in office 304, turn on AC!",
            "Flickering lights in room 201 giving me a headache.",
            "Loud construction drilling outside building 4.",
            "Strong paint fumes in east corridor.",
            "Standing desk height is stuck at station 12."
        ]

        iterations = 250
        execution_times: List[float] = []

        gc.collect()
        tracemalloc.start()
        snap_start = tracemalloc.take_snapshot()

        start_time = time.perf_counter()
        for i in range(iterations):
            q = pool[i % len(pool)]
            res = translator.translate(q)
            self.assert_valid_invariants(res, expected_raw_text=q)
            execution_times.append(res.execution_time_ms)

        total_wall_time = time.perf_counter() - start_time

        gc.collect()
        snap_end = tracemalloc.take_snapshot()
        tracemalloc.stop()

        top_stats = snap_end.compare_to(snap_start, "lineno")
        mem_diff_kb = sum(stat.size_diff for stat in top_stats) / 1024.0

        execution_times.sort()
        p50 = execution_times[int(iterations * 0.50)]
        p95 = execution_times[int(iterations * 0.95)]
        p99 = execution_times[int(iterations * 0.99)]
        mean_lat = sum(execution_times) / iterations

        print("\n" + "=" * 65)
        print(" [CHALLENGER 2] 250-SEQUENTIAL LOAD & MEMORY TELEMETRY")
        print("=" * 65)
        print(f"Total Requests:       {iterations}")
        print(f"Total Time:           {total_wall_time:.4f} s")
        print(f"Throughput:           {iterations / total_wall_time:.2f} req/s")
        print(f"Mean Latency:         {mean_lat:.4f} ms")
        print(f"Median (p50):         {p50:.4f} ms")
        print(f"p95 Latency:          {p95:.4f} ms")
        print(f"p99 Latency:          {p99:.4f} ms")
        print(f"Heap Delta:           {mem_diff_kb:.2f} KB")
        print("=" * 65)

        # Assertions
        self.assertLess(mem_diff_kb, 500.0, f"Memory growth exceeded 500 KB: {mem_diff_kb:.2f} KB")
        self.assertGreater(iterations / total_wall_time, 150.0)

    def test_batch_translate_150_items(self) -> None:
        """Verify batch_translate with 150 items executes cleanly and preserves order."""
        translator = LocalTranslator(backend=MockBackend())
        templates = [
            "Cold complaint number {i} in room {i}",
            "Hot complaint number {i} in zone {i}",
            "Glare complaint number {i} at desk {i}"
        ]
        corpus = [templates[i % 3].format(i=i) for i in range(150)]

        results = translator.batch_translate(corpus)
        self.assertEqual(len(results), 150)

        for idx, res in enumerate(results):
            self.assert_valid_invariants(res, expected_raw_text=corpus[idx])
            self.assertIn(str(idx), res.event.raw_text)


# ============================================================================
# 4. ERROR INJECTION & ADAPTER FAULT SIMULATION
# ============================================================================

class TestBackendErrorInjection(AdversarialTestBase):
    """Simulates network failures, HTTP errors, timeouts, and memory faults in backends."""

    def test_ollama_http_404_fallback_to_generate_api(self) -> None:
        """Verify Ollama HTTP 404 on /api/chat triggers _fallback_generate_api and succeeds if /api/generate responds."""
        mock_404 = urllib.error.HTTPError(
            url="http://localhost:11434/api/chat",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=io.BytesIO(b"Not Found")
        )

        mock_generate_resp = MagicMock()
        mock_generate_resp.read.return_value = json.dumps({
            "response": json.dumps({
                "domain": "thermal",
                "sensation": "too_hot",
                "location": "Room 101",
                "intensity": 4,
                "action_requested": "decrease_temperature",
                "confidence": 0.9
            })
        }).encode("utf-8")
        mock_generate_resp.__enter__.return_value = mock_generate_resp
        mock_generate_resp.__exit__.return_value = False

        def urlopen_side_effect(req, *args, **kwargs):
            if req.full_url.endswith("/api/chat"):
                raise mock_404
            elif req.full_url.endswith("/api/generate"):
                return mock_generate_resp
            raise urllib.error.URLError("Unexpected URL")

        with patch("urllib.request.urlopen", side_effect=urlopen_side_effect):
            backend = OllamaBackend()
            translator = LocalTranslator(backend=backend)
            result = translator.translate("Room 101 is too hot")

            self.assert_valid_invariants(result)
            self.assertTrue(result.success)
            self.assertEqual(result.event.domain, ComfortDomain.THERMAL)
            self.assertEqual(result.event.location, "Room 101")

    def test_ollama_http_502_503_504_gateway_errors(self) -> None:
        """Verify Ollama 502/503/504 gateway errors are gracefully handled via heuristic fallback."""
        for code in [500, 502, 503, 504]:
            with self.subTest(http_code=code):
                mock_http_err = urllib.error.HTTPError(
                    url="http://localhost:11434/api/chat",
                    code=code,
                    msg=f"HTTP {code}",
                    hdrs={},
                    fp=io.BytesIO(b"Error")
                )
                with patch("urllib.request.urlopen", side_effect=mock_http_err):
                    backend = OllamaBackend()
                    translator = LocalTranslator(backend=backend)
                    result = translator.translate("Freezing cold in office 204")

                    self.assert_valid_invariants(result)
                    self.assertIsNotNone(result.error_message)
                    self.assertIn(f"Ollama HTTP error {code}", result.error_message)
                    self.assertIn(result.event.domain, [ComfortDomain.THERMAL, "thermal"])
                    self.assertIn("204", result.event.location or "")

    def test_ollama_network_connection_refused_and_timeout(self) -> None:
        """Verify URLError / connection refused / timeout triggers graceful fallback."""
        network_errors = [
            urllib.error.URLError("Connection refused [Errno 111]"),
            urllib.error.URLError("timed out"),
            TimeoutError("Socket timeout"),
            ConnectionResetError("Connection reset by peer")
        ]

        for err in network_errors:
            with self.subTest(error_type=type(err).__name__):
                with patch("urllib.request.urlopen", side_effect=err):
                    backend = OllamaBackend()
                    translator = LocalTranslator(backend=backend)
                    result = translator.translate("Blinding glare in Zone B")

                    self.assert_valid_invariants(result)
                    self.assertIsNotNone(result.error_message)
                    self.assertIn(result.event.domain, [ComfortDomain.VISUAL, "visual"])

    def test_ollama_malformed_response_json(self) -> None:
        """Verify Ollama returning invalid JSON HTTP response body triggers graceful recovery."""
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b"<html><head><title>502 Bad Gateway</title></head></html>"
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False

        with patch("urllib.request.urlopen", return_value=mock_resp):
            backend = OllamaBackend()
            translator = LocalTranslator(backend=backend)
            result = translator.translate("HVAC making loud noise in conference room 3")

            self.assert_valid_invariants(result)
            self.assertIn(result.event.domain, [ComfortDomain.ACOUSTIC, "acoustic"])
            self.assertIn("3", result.event.location or "")

    def test_llama_cpp_memory_error_and_oom_fault_injection(self) -> None:
        """Verify LlamaCppBackend MemoryError (OOM) during inference is caught and gracefully salvaged."""
        mock_llama_inst = MagicMock()
        mock_llama_inst.side_effect = MemoryError("Cannot allocate memory for KV cache (RAM exhausted)")

        mock_module = MagicMock()
        mock_module.Llama.return_value = mock_llama_inst

        with patch.dict("sys.modules", {"llama_cpp": mock_module}):
            backend = LlamaCppBackend(model_path="test_model.gguf")
            self.assertTrue(backend.health_check())

            translator = LocalTranslator(backend=backend)
            result = translator.translate("Room 101 is burning hot")

            self.assert_valid_invariants(result)
            self.assertIsNotNone(result.error_message)
            self.assertIn("Cannot allocate memory", result.error_message)
            self.assertIn(result.event.domain, [ComfortDomain.THERMAL, "thermal"])
            self.assertEqual(result.event.sensation, "too_hot")

    def test_llama_cpp_gbnf_grammar_compilation_failure(self) -> None:
        """Verify LlamaGrammar compilation failure does not crash inference and proceeds without grammar."""
        mock_llama_inst = MagicMock()
        mock_llama_inst.return_value = {
            "choices": [{"text": '{"domain": "thermal", "sensation": "too_cold", "intensity": 4}'}]
        }

        mock_grammar_class = MagicMock()
        mock_grammar_class.from_string.side_effect = Exception("GBNF syntax error in grammar specification")

        mock_module = MagicMock()
        mock_module.Llama.return_value = mock_llama_inst
        mock_module.LlamaGrammar = mock_grammar_class

        with patch.dict("sys.modules", {"llama_cpp": mock_module}):
            backend = LlamaCppBackend(model_path="test_model.gguf")
            translator = LocalTranslator(backend=backend)
            result = translator.translate("Freezing cold in office 204")

            self.assert_valid_invariants(result)
            self.assertTrue(result.success)
            self.assertEqual(result.event.domain, ComfortDomain.THERMAL)

    def test_llama_cpp_empty_choices_in_response(self) -> None:
        """Verify LlamaCppBackend returning empty choices array does not crash."""
        mock_llama_inst = MagicMock()
        mock_llama_inst.return_value = {"choices": []}

        mock_module = MagicMock()
        mock_module.Llama.return_value = mock_llama_inst

        with patch.dict("sys.modules", {"llama_cpp": mock_module}):
            backend = LlamaCppBackend(model_path="test_model.gguf")
            translator = LocalTranslator(backend=backend)
            result = translator.translate("Stuffy air near desk 14")

            self.assert_valid_invariants(result)
            self.assertIn(result.event.domain, [ComfortDomain.AIR_QUALITY, "air_quality"])


# ============================================================================
# 5. SERIALIZATION & PYDANTIC SCHEMA INTEGRITY
# ============================================================================

class TestSerializationAndSchemaIntegrity(AdversarialTestBase):
    """Validation of serialization methods: to_dict(), model_dump(), json.dumps(), and nested structures."""

    def test_comfort_event_model_dump_and_to_dict(self) -> None:
        """Verify model_dump() and to_dict() outputs match expected types."""
        event = ComfortEvent(
            domain=ComfortDomain.THERMAL,
            sensation="too_cold",
            location="Room 204",
            intensity=4,
            action_requested="increase_temperature",
            confidence=0.95,
            raw_text="It's freezing in room 204",
            metadata={"source": "slack", "user_id": "U12345", "nested": {"sensor_id": 99}}
        )

        d = event.to_dict()
        self.assertIsInstance(d, dict)
        self.assertEqual(d["domain"], "thermal")
        self.assertEqual(d["sensation"], "too_cold")
        self.assertEqual(d["location"], "Room 204")
        self.assertEqual(d["intensity"], 4)
        self.assertEqual(d["action_requested"], "increase_temperature")
        self.assertAlmostEqual(d["confidence"], 0.95)
        self.assertEqual(d["raw_text"], "It's freezing in room 204")
        self.assertEqual(d["metadata"]["nested"]["sensor_id"], 99)

        if hasattr(event, "model_dump"):
            dumped = event.model_dump()
            self.assertEqual(dumped["domain"], "thermal")
            self.assertEqual(dumped["location"], "Room 204")

    def test_translation_result_model_dump_and_to_dict(self) -> None:
        """Verify TranslationResult.to_dict() and model_dump()."""
        event = ComfortEvent(domain=ComfortDomain.VISUAL, sensation="glare", location="Zone B", intensity=3)
        res = TranslationResult(
            success=True,
            event=event,
            error_message=None,
            raw_response='{"domain": "visual"}',
            backend_used="mock",
            execution_time_ms=1.45
        )

        d = res.to_dict()
        self.assertIsInstance(d, dict)
        self.assertTrue(d["success"])
        self.assertIsInstance(d["event"], (dict, ComfortEvent))
        self.assertEqual(d["backend_used"], "mock")
        self.assertAlmostEqual(d["execution_time_ms"], 1.45)

        # Verify json.dumps on TranslationResult dict
        json_str = json.dumps(d)
        self.assertIsInstance(json_str, str)
        reloaded = json.loads(json_str)
        self.assertTrue(reloaded["success"])

    def test_json_dumps_complex_metadata_serialization(self) -> None:
        """Verify complex metadata containing lists, nested dicts, floats, ints, bools serialize safely."""
        event = ComfortEvent(
            domain=ComfortDomain.AIR_QUALITY,
            sensation="stuffy",
            metadata={
                "co2_ppm": 1250,
                "temp_c": 24.5,
                "humidity_rh": 65.2,
                "occupancy_detected": True,
                "adjacent_zones": ["zone_1", "zone_2", "zone_3"],
                "sensor_readings": {"raw_voltage": 3.28, "calibrated": True}
            }
        )

        d = event.to_dict()
        json_output = json.dumps(d, indent=2)
        self.assertIn('"co2_ppm": 1250', json_output)
        self.assertIn('"temp_c": 24.5', json_output)
        self.assertIn('"occupancy_detected": true', json_output)

        reloaded = json.loads(json_output)
        self.assertEqual(reloaded["metadata"]["adjacent_zones"], ["zone_1", "zone_2", "zone_3"])


# ============================================================================
# MAIN EXECUTION
# ============================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
