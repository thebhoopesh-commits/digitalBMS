"""
local_translator.py — Production-Grade Edge AI Semantic Extraction Module
==========================================================================
Part of the Raspberry Pi 4 Local AI Research & Comfort Translator project.

Replaces cloud-based LLM APIs (e.g., Gemini) with local inference running directly
on Raspberry Pi 4 hardware (ARM Cortex-A72 @ 1.5GHz, 4GB/8GB LPDDR4 RAM).

Extracts structured occupant comfort telemetry (`ComfortEvent`) conforming to
international BMS comfort standards (ASHRAE 55, ASHRAE 62.1, ISO 7730, EN 16798-1).

Key Features:
- Multi-backend architecture: `LlamaCppBackend` (in-process GGUF), `OllamaBackend` (local REST API),
  and deterministic `MockBackend` (for testing/CI).
- GBNF grammar specification for hardware-accelerated constrained decoding in llama.cpp.
- Zero-external-dependency REST client for Ollama using Python standard library `urllib.request`.
- Crash-proof 6-stage extraction and sanitization pipeline (markdown stripping, boundary slicing,
  syntax repair, regex recovery, rule-based heuristic fallback, Pydantic validation).
- Fully validated Pydantic v2 data models with automatic value clamping and dictionary serialization.
"""

from __future__ import annotations

import abc
import json
import logging
import math
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from pydantic import BaseModel, Field, field_validator, ConfigDict
    PYDANTIC_V2 = True
except ImportError:  # pragma: no cover
    from pydantic import BaseModel, Field, validator  # type: ignore
    ConfigDict = None  # type: ignore
    PYDANTIC_V2 = False

logger = logging.getLogger("local_translator")


# ============================================================================
# 1. DOMAIN ENUMS & PYDANTIC DATA MODELS
# ============================================================================

class ComfortDomain(str, Enum):
    """Environmental comfort domains grounded in ASHRAE / ISO building standards."""
    THERMAL = "thermal"
    VISUAL = "visual"
    ACOUSTIC = "acoustic"
    AIR_QUALITY = "air_quality"
    ERGONOMIC = "ergonomic"
    OTHER = "other"
    GENERAL = "general"


class ComfortEvent(BaseModel):
    """
    Standardized occupant comfort telemetry event.
    
    Represents structured semantic data extracted from natural language feedback,
    ready for ingestion by Building Management System (BMS) controllers and actuators.
    """
    if PYDANTIC_V2:
        model_config = ConfigDict(extra="ignore", use_enum_values=True)
    else:  # pragma: no cover
        class Config:
            extra = "ignore"
            use_enum_values = True

    event_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for telemetry deduplication and tracking"
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC timestamp of event creation"
    )
    domain: ComfortDomain = Field(
        default=ComfortDomain.OTHER,
        description="Environmental comfort category"
    )
    sensation: str = Field(
        default="other",
        description="Specific sensation experienced by occupant (e.g. too_cold, glare, stuffy)"
    )
    location: Optional[str] = Field(
        default=None,
        description="Identified room, zone, floor, or desk location"
    )
    intensity: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Severity rating on 1-5 scale (1=mild, 2=slight, 3=moderate, 4=severe, 5=extreme)"
    )
    action_requested: Optional[str] = Field(
        default=None,
        description="Actionable BMS recommendation (e.g. increase_temperature, dim_lights, ventilate)"
    )
    confidence: float = Field(
        default=0.8,
        ge=0.0,
        le=1.0,
        description="Model confidence score in semantic classification"
    )
    raw_text: str = Field(
        default="",
        description="Original unaltered natural language feedback"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Processing telemetry, backend attributes, and execution metrics"
    )

    if PYDANTIC_V2:
        @field_validator("domain", mode="before")
        @classmethod
        def validate_domain(cls, v: Any) -> ComfortDomain:
            if isinstance(v, ComfortDomain):
                return v
            if isinstance(v, str):
                v_clean = v.strip().lower()
                for domain in ComfortDomain:
                    if domain.value == v_clean:
                        return domain
                if v_clean in ("hvac", "temp", "temperature", "heat", "cold"):
                    return ComfortDomain.THERMAL
                if v_clean in ("light", "lighting", "glare", "sun"):
                    return ComfortDomain.VISUAL
                if v_clean in ("sound", "noise", "audio"):
                    return ComfortDomain.ACOUSTIC
                if v_clean in ("air", "iaq", "ventilation", "odor", "smell"):
                    return ComfortDomain.AIR_QUALITY
                if v_clean in ("seating", "chair", "desk", "posture"):
                    return ComfortDomain.ERGONOMIC
            return ComfortDomain.OTHER

        @field_validator("sensation", mode="before")
        @classmethod
        def validate_sensation(cls, v: Any) -> str:
            if v is None or isinstance(v, (dict, list)):
                return "other"
            s = str(v).strip()
            if not s or s.lower() in ("null", "none", "undefined"):
                return "other"
            return s

        @field_validator("location", mode="before")
        @classmethod
        def validate_location(cls, v: Any) -> Optional[str]:
            if v is None or isinstance(v, (dict, list)):
                return None
            s = str(v).strip()
            if s.lower() in ("null", "none", "undefined", ""):
                return None
            return s

        @field_validator("intensity", mode="before")
        @classmethod
        def validate_intensity(cls, v: Any) -> int:
            if v is None or isinstance(v, (dict, list)):
                return 3
            if isinstance(v, (int, float)):
                try:
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                        return 3
                    return max(1, min(5, int(round(v))))
                except (ValueError, OverflowError, TypeError):
                    return 3
            if isinstance(v, str):
                v_clean = v.strip().lower()
                if v_clean in ("nan", "inf", "-inf", "infinity", "-infinity", "null", "none", "undefined"):
                    return 3
                intensity_map = {
                    "barely": 1, "mild": 1, "slight": 2, "low": 2,
                    "moderate": 3, "medium": 3, "med": 3,
                    "severe": 4, "high": 4, "very": 4,
                    "extreme": 5, "urgent": 5, "unbearable": 5, "critical": 5
                }
                if v_clean in intensity_map:
                    return intensity_map[v_clean]
                try:
                    val = float(v_clean)
                    if math.isnan(val) or math.isinf(val):
                        return 3
                    return max(1, min(5, int(round(val))))
                except (ValueError, OverflowError, TypeError):
                    pass
            return 3

        @field_validator("action_requested", mode="before")
        @classmethod
        def validate_action_requested(cls, v: Any) -> Optional[str]:
            if v is None or isinstance(v, (dict, list)):
                return None
            s = str(v).strip()
            if s.lower() in ("null", "undefined", ""):
                return None
            return s

        @field_validator("confidence", mode="before")
        @classmethod
        def validate_confidence(cls, v: Any) -> float:
            if v is None or isinstance(v, (dict, list)):
                return 0.7
            try:
                if isinstance(v, str) and v.endswith("%"):
                    val = float(v[:-1].strip()) / 100.0
                else:
                    val = float(v)
                if math.isnan(val) or math.isinf(val):
                    return 0.7
                return max(0.0, min(1.0, val))
            except (ValueError, OverflowError, TypeError):
                return 0.7

        @field_validator("raw_text", mode="before")
        @classmethod
        def validate_raw_text(cls, v: Any) -> str:
            if v is None:
                return ""
            if isinstance(v, str):
                return v
            if isinstance(v, bytes):
                return v.decode("utf-8", errors="replace")
            return str(v)

        @field_validator("metadata", mode="before")
        @classmethod
        def validate_metadata(cls, v: Any) -> Dict[str, Any]:
            if isinstance(v, dict):
                return v
            return {}

    else:  # pragma: no cover
        @validator("domain", pre=True, always=True)
        def validate_domain(cls, v: Any) -> ComfortDomain:
            if isinstance(v, ComfortDomain):
                return v
            if isinstance(v, str):
                v_clean = v.strip().lower()
                for domain in ComfortDomain:
                    if domain.value == v_clean:
                        return domain
                if v_clean in ("hvac", "temp", "temperature", "heat", "cold"):
                    return ComfortDomain.THERMAL
                if v_clean in ("light", "lighting", "glare", "sun"):
                    return ComfortDomain.VISUAL
                if v_clean in ("sound", "noise", "audio"):
                    return ComfortDomain.ACOUSTIC
                if v_clean in ("air", "iaq", "ventilation", "odor", "smell"):
                    return ComfortDomain.AIR_QUALITY
                if v_clean in ("seating", "chair", "desk", "posture"):
                    return ComfortDomain.ERGONOMIC
            return ComfortDomain.OTHER

        @validator("sensation", pre=True, always=True)
        def validate_sensation(cls, v: Any) -> str:
            if v is None or isinstance(v, (dict, list)):
                return "other"
            s = str(v).strip()
            if not s or s.lower() in ("null", "none", "undefined"):
                return "other"
            return s

        @validator("location", pre=True, always=True)
        def validate_location(cls, v: Any) -> Optional[str]:
            if v is None or isinstance(v, (dict, list)):
                return None
            s = str(v).strip()
            if s.lower() in ("null", "none", "undefined", ""):
                return None
            return s

        @validator("intensity", pre=True, always=True)
        def validate_intensity(cls, v: Any) -> int:
            if v is None or isinstance(v, (dict, list)):
                return 3
            if isinstance(v, (int, float)):
                try:
                    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                        return 3
                    return max(1, min(5, int(round(v))))
                except (ValueError, OverflowError, TypeError):
                    return 3
            if isinstance(v, str):
                v_clean = v.strip().lower()
                intensity_map = {
                    "barely": 1, "mild": 1, "slight": 2, "low": 2,
                    "moderate": 3, "medium": 3, "med": 3,
                    "severe": 4, "high": 4, "very": 4,
                    "extreme": 5, "urgent": 5, "unbearable": 5, "critical": 5
                }
                if v_clean in intensity_map:
                    return intensity_map[v_clean]
                try:
                    val = float(v_clean)
                    if math.isnan(val) or math.isinf(val):
                        return 3
                    return max(1, min(5, int(round(val))))
                except (ValueError, OverflowError, TypeError):
                    pass
            return 3

        @validator("action_requested", pre=True, always=True)
        def validate_action_requested(cls, v: Any) -> Optional[str]:
            if v is None or isinstance(v, (dict, list)):
                return None
            s = str(v).strip()
            if s.lower() in ("null", "undefined", ""):
                return None
            return s

        @validator("confidence", pre=True, always=True)
        def validate_confidence(cls, v: Any) -> float:
            if v is None or isinstance(v, (dict, list)):
                return 0.7
            try:
                if isinstance(v, str) and v.endswith("%"):
                    val = float(v[:-1].strip()) / 100.0
                else:
                    val = float(v)
                if math.isnan(val) or math.isinf(val):
                    return 0.7
                return max(0.0, min(1.0, val))
            except (ValueError, OverflowError, TypeError):
                return 0.7

        @validator("raw_text", pre=True, always=True)
        def validate_raw_text(cls, v: Any) -> str:
            if v is None:
                return ""
            if isinstance(v, str):
                return v
            if isinstance(v, bytes):
                return v.decode("utf-8", errors="replace")
            return str(v)

        @validator("metadata", pre=True, always=True)
        def validate_metadata(cls, v: Any) -> Dict[str, Any]:
            if isinstance(v, dict):
                return v
            return {}

    def to_dict(self) -> Dict[str, Any]:
        """Export model to a JSON-serializable standard Python dictionary."""
        if hasattr(self, "model_dump"):
            return self.model_dump()
        return self.dict()  # pragma: no cover


class TranslationResult(BaseModel):
    """Wrapper holding extraction outcome, validated event, and performance metrics."""
    if PYDANTIC_V2:
        model_config = ConfigDict(extra="ignore")
    else:  # pragma: no cover
        class Config:
            extra = "ignore"

    success: bool = Field(description="Whether translation completed successfully")
    event: Optional[ComfortEvent] = Field(default=None, description="Extracted ComfortEvent instance")
    error_message: Optional[str] = Field(default=None, description="Error details if translation failed")
    raw_response: str = Field(default="", description="Raw string output received from inference backend")
    backend_used: str = Field(default="", description="Name of the inference backend adapter utilized")
    execution_time_ms: float = Field(default=0.0, description="Total end-to-end execution time in milliseconds")

    def to_dict(self) -> Dict[str, Any]:
        """Export result to dictionary."""
        if hasattr(self, "model_dump"):
            return self.model_dump()
        return self.dict()  # pragma: no cover


# ============================================================================
# 2. PROMPT ENGINEERING & CONSTRAINED DECODING GRAMMARS
# ============================================================================

SYSTEM_PROMPT = """Short friendly reply then JSON.
Format:
Response: <reply>
JSON: <json>
Fields: domain(thermal,visual,acoustic,air_quality,ergonomic,other), sensation(too_cold, too_warm, stuffy, too_humid, too_dry, drafty, comfortable, other), location(str/null), intensity(1-5), action_requested(increase_temperature, decrease_temperature, increase_ventilation, null), confidence(0.0-1.0)"""

FEW_SHOT_EXAMPLES = [
    {
        "input": "It's freezing in room 204, please turn up the heat!",
        "response": "Understood, increasing the heat in room 204 right away.",
        "json": json.dumps({
            "domain": "thermal",
            "sensation": "too_cold",
            "location": "room 204",
            "intensity": 4,
            "action_requested": "increase_temperature",
            "confidence": 0.95
        })
    },
    {
        "input": "The conference room is too hot, please turn up the AC.",
        "response": "Understood, increasing cooling in the conference room right away.",
        "json": json.dumps({
            "domain": "thermal",
            "sensation": "too_warm",
            "location": "conference room",
            "intensity": 4,
            "action_requested": "decrease_temperature",
            "confidence": 0.95
        })
    }
]

COMFORT_EVENT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "domain": {
            "type": "string",
            "enum": ["thermal", "visual", "acoustic", "air_quality", "ergonomic", "other", "general"]
        },
        "sensation": {"type": "string"},
        "location": {"type": ["string", "null"]},
        "intensity": {"type": "integer", "minimum": 1, "maximum": 5},
        "action_requested": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0}
    },
    "required": ["domain", "sensation", "intensity", "confidence"]
}

# GBNF (GGML BNF) Grammar for hardware-constrained decoding in llama.cpp
GBNF_COMFORT_EVENT_GRAMMAR = r'''
root ::= "{" ws "\"domain\"" ws ":" ws domain-val "," ws "\"sensation\"" ws ":" ws string-val "," ws "\"location\"" ws ":" ws opt-string-val "," ws "\"intensity\"" ws ":" ws int-val "," ws "\"action_requested\"" ws ":" ws opt-string-val "," ws "\"confidence\"" ws ":" ws float-val ws "}"
domain-val ::= "\"thermal\"" | "\"visual\"" | "\"acoustic\"" | "\"air_quality\"" | "\"ergonomic\"" | "\"other\"" | "\"general\""
string-val ::= "\"" [^"\\]* "\""
opt-string-val ::= string-val | "null"
int-val ::= [1-5]
float-val ::= "0." [0-9]+ | "1.0" | "1"
ws ::= [ \t\n\r]*
'''


def build_full_prompt(user_text: Any, environment_id: str = "corporate") -> str:
    """Construct prompt with system directives, few-shot examples, and occupant feedback."""
    if user_text is None:
        user_str = ""
    elif isinstance(user_text, str):
        user_str = user_text
    elif isinstance(user_text, bytes):
        user_str = user_text.decode("utf-8", errors="ignore")
    else:
        user_str = str(user_text)

    prompt_parts = [SYSTEM_PROMPT]
    
    if environment_id == "healthcare":
        prompt_parts.append("\nCurrent Environment: Healthcare / Hospital")
        prompt_parts.append("Available location values: hospital_lobby, clinical_areas, staff_areas, support_hvac")
    else:
        prompt_parts.append("\nCurrent Environment: Corporate Office")
        prompt_parts.append("Available location values: lobby, open_office, conference_room, server_room")

    prompt_parts.append("\nExamples:")
    for ex in FEW_SHOT_EXAMPLES:
        resp_text = ex.get("response", "Understood, updating the system settings.")
        json_text = ex.get("json") or ex.get("output", "{}")
        prompt_parts.append(f'Occupant: "{ex["input"]}"\nResponse: {resp_text}\nJSON: {json_text}')
    prompt_parts.append(f'\nOccupant: "{user_str}"\nResponse:')
    return "\n".join(prompt_parts)


# ============================================================================
# 3. BACKEND ADAPTER INTERFACES & IMPLEMENTATIONS
# ============================================================================

class BaseInferenceBackend(abc.ABC):
    """Abstract base class for local and mock inference backends."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Unique identifier name of the inference backend."""
        pass

    @abc.abstractmethod
    def generate(self, prompt: str, grammar: Optional[str] = None, **kwargs: Any) -> str:
        """
        Execute inference and return raw string response.
        
        Args:
            prompt: Formatted prompt string.
            grammar: Optional GBNF grammar string for constrained decoding.
            **kwargs: Backend-specific tuning options.
            
        Returns:
            Raw response text from LLM.
        """
        pass

    @abc.abstractmethod
    def health_check(self) -> bool:
        """Check whether backend dependencies and model/service are functional."""
        pass

    def is_available(self) -> bool:
        """Convenience alias for health_check."""
        return self.health_check()


class LlamaCppBackend(BaseInferenceBackend):
    """
    In-process GGUF inference backend utilizing `llama_cpp.Llama`.
    
    Optimized for ARM Cortex-A72 CPU cores with NEON SIMD vectorization.
    """

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 1024,
        n_threads: int = 4,
        n_batch: int = 128,
        use_mmap: bool = True,
        verbose: bool = False,
        **kwargs: Any
    ):
        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_threads = n_threads
        self.n_batch = n_batch
        self.use_mmap = use_mmap
        self.verbose = verbose
        self.extra_kwargs = kwargs
        self._llm: Any = None
        self._load_error: Optional[str] = None
        self._initialize_model()

    def _initialize_model(self) -> None:
        try:
            from llama_cpp import Llama
            self._llm = Llama(
                model_path=self.model_path,
                n_ctx=self.n_ctx,
                n_threads=self.n_threads,
                n_batch=self.n_batch,
                use_mmap=self.use_mmap,
                verbose=self.verbose,
                **self.extra_kwargs
            )
            self._load_error = None
        except Exception as e:
            self._llm = None
            self._load_error = str(e)
            logger.warning("Failed to initialize llama_cpp model '%s': %s", self.model_path, e)

    @property
    def name(self) -> str:
        return "llama_cpp"

    def health_check(self) -> bool:
        return self._llm is not None

    def generate(self, prompt: str, grammar: Optional[str] = None, **kwargs: Any) -> str:
        if not self.health_check():
            raise RuntimeError(f"LlamaCppBackend unavailable: {self._load_error}")

        temperature = kwargs.get("temperature", 0.1)
        max_tokens = kwargs.get("max_tokens", 256)

        grammar_obj = None
        if grammar:
            try:
                from llama_cpp import LlamaGrammar
                grammar_obj = LlamaGrammar.from_string(grammar)
            except Exception as ge:
                logger.debug("Could not compile GBNF grammar: %s", ge)

        response = self._llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            grammar=grammar_obj,
            stop=["\nOccupant:", "</s>", "<|im_end|>"],
            echo=False
        )

        choices = response.get("choices", [])
        if choices and "text" in choices[0]:
            return choices[0]["text"].strip()
        return ""


class OllamaBackend(BaseInferenceBackend):
    """
    Zero-external-dependency REST API client for local Ollama service.
    
    Uses standard library `urllib.request` to query `http://localhost:11434/api/chat`.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model_name: str = "qwen2.5:0.5b",
        timeout: float = 30.0,
        **kwargs: Any
    ):
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.timeout = timeout
        self.extra_options = kwargs

    @property
    def name(self) -> str:
        return "ollama"

    def health_check(self) -> bool:
        """Verify Ollama daemon availability by checking /api/tags endpoint."""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                return resp.status == 200
        except Exception:
            return False

    def generate(self, prompt: str, grammar: Optional[str] = None, **kwargs: Any) -> str:
        """Dispatch chat completion to Ollama daemon with JSON format constraint."""
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            "format": "json",
            "stream": False,
            "options": {
                "temperature": kwargs.get("temperature", 0.1),
                "num_predict": kwargs.get("max_tokens", 256),
                "num_thread": kwargs.get("num_threads", 4),
                **self.extra_options
            }
        }

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                message = resp_data.get("message", {})
                content = message.get("content", "")
                if content:
                    return content.strip()
                return resp_data.get("response", "").strip()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return self._fallback_generate_api(prompt, **kwargs)
            raise RuntimeError(f"Ollama HTTP error {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Ollama connection failed: {e.reason}")

    def generate_stream(self, prompt: str, grammar: Optional[str] = None, **kwargs: Any):
        """Stream chat completion from Ollama daemon."""
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            "stream": True,
            "options": {
                "temperature": kwargs.get("temperature", 0.1),
                "num_predict": kwargs.get("max_tokens", 256),
                "num_thread": kwargs.get("num_threads", 4),
                **self.extra_options
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                for line in resp:
                    if line:
                        chunk_data = json.loads(line.decode("utf-8"))
                        msg = chunk_data.get("message", {})
                        chunk_content = msg.get("content", "")
                        if chunk_content:
                            yield chunk_content
        except Exception as e:
            logger.error(f"Ollama streaming failed: {e}")
            raise RuntimeError(f"Ollama streaming failed at {self.base_url}: {e}") from e

    def _fallback_generate_api(self, prompt: str, **kwargs: Any) -> str:
        """Fallback querying /api/generate for older Ollama versions."""
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": kwargs.get("temperature", 0.1),
                "num_predict": kwargs.get("max_tokens", 256),
                "num_thread": kwargs.get("num_threads", 4)
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            return resp_data.get("response", "").strip()


class MockBackend(BaseInferenceBackend):
    """
    Deterministic rule-based mock inference engine for testing and CI/CD.
    
    Generates realistic, fully populated JSON telemetry responses across
    thermal, visual, acoustic, air quality, ergonomic, and compound scenarios.
    """

    def __init__(
        self,
        responses: Optional[Dict[str, str]] = None,
        default_response: Optional[str] = None,
        simulated_latency_ms: float = 0.0,
        **kwargs: Any
    ):
        self.responses = responses or {}
        self.default_response = default_response
        self.simulated_latency_ms = simulated_latency_ms

    @property
    def name(self) -> str:
        return "mock"

    def health_check(self) -> bool:
        return True

    def generate(self, prompt: Any, grammar: Optional[str] = None, **kwargs: Any) -> str:
        if self.simulated_latency_ms > 0:
            time.sleep(self.simulated_latency_ms / 1000.0)

        # Check explicit canned dictionary first
        if prompt in self.responses:
            return self.responses[prompt]

        # Extract actual feedback string if prompt is formatted with wrappers
        text_to_analyze = prompt
        if isinstance(prompt, str):
            matches = re.findall(r'Occupant:\s*"([^"]*)"\s*(?:\nResponse:|\nJSON:)', prompt)
            if matches:
                text_to_analyze = matches[-1]

        if text_to_analyze in self.responses:
            return self.responses[text_to_analyze]

        if self.default_response is not None:
            return self.default_response

        # Deterministic simulation matching BMS domain rules
        return self._simulate_extraction(text_to_analyze)

    def generate_stream(self, prompt: Any, grammar: Optional[str] = None, **kwargs: Any):
        """Yield mock generation result as a stream."""
        full_res = self.generate(prompt, grammar=grammar, **kwargs)
        yield full_res

    def _simulate_extraction(self, text: Any) -> str:
        if text is None:
            t = ""
        elif isinstance(text, str):
            t = text.lower().strip()
        elif isinstance(text, bytes):
            t = text.decode("utf-8", errors="ignore").lower().strip()
        else:
            t = str(text).lower().strip()

        if not t:
            return json.dumps({
                "domain": "other",
                "sensation": "other",
                "location": None,
                "intensity": 1,
                "action_requested": "none",
                "confidence": 0.1
            })

        # Location heuristic
        loc_match = re.search(
            r'\b(lobby|room\s+\d+\w*|zone\s+\w+|desk\s+\d+|office\s+\d+\w*|floor\s+\d+|conference\s+room\s+\d+|corner\s+desk)\b',
            t,
            re.IGNORECASE
        )
        location = loc_match.group(0).strip() if loc_match else None

        # Severity heuristic
        intensity = 3
        if any(k in t for k in ["freezing", "boiling", "unbearable", "extremely", "terrible", "emergency", "killing", "screaming", "blinding"]):
            intensity = 5
        elif any(k in t for k in ["very", "really", "super", "badly", "loud", "hot", "cold", "pain"]):
            intensity = 4
        elif any(k in t for k in ["slightly", "a bit", "a little", "mild", "barely"]):
            intensity = 2

        # 1. Visual (glare, lighting, blinds, flickering)
        if re.search(r'\b(glare|bright|blinding|dark|dim|flicker|flickering|shadow|sunlight|blinds|light|lights)\b', t):
            sensation = "glare" if "glare" in t else ("flickering" if "flicker" in t else ("too_bright" if ("bright" in t or "blinding" in t) else "too_dim"))
            action = "close_blinds" if "glare" in t else ("dim_lights" if "bright" in t else "turn_on_lights")
            return json.dumps({
                "domain": "visual",
                "sensation": sensation,
                "location": location,
                "intensity": intensity,
                "action_requested": action,
                "confidence": 0.92
            })

        # 2. Thermal - Cold
        if re.search(r'\b(cold|freezing|chilly|draft|drafty|shiver|shivering|frost|ice|icy|turn\s+up\s+heat|turn\s+on\s+heat|too\s+cold)\b', t):
            return json.dumps({
                "domain": "thermal",
                "sensation": "drafty" if "draft" in t else "too_cold",
                "location": location,
                "intensity": intensity,
                "action_requested": "increase_temperature",
                "confidence": 0.95
            })

        # 3. Thermal - Hot
        if re.search(r'\b(hot|boiling|warm|sweat|sweating|baking|burn|burning|ac|a/c|air\s+conditioning|turn\s+on\s+ac|turn\s+down\s+the\s+heat|too\s+hot|cooling)\b', t):
            return json.dumps({
                "domain": "thermal",
                "sensation": "too_hot",
                "location": location,
                "intensity": intensity,
                "action_requested": "decrease_temperature",
                "confidence": 0.95
            })

        # 4. Air Quality
        if re.search(r'\b(stuffy|stale|smell|smelly|odor|fume|fumes|dust|dusty|smoke|suffocating|co2|ventilate|ventilation|air\s+quality|airflow|breathe)\b', t):
            sensation = "bad_odor" if any(k in t for k in ["smell", "odor", "fume"]) else ("dusty" if "dust" in t else "stuffy")
            return json.dumps({
                "domain": "air_quality",
                "sensation": sensation,
                "location": location,
                "intensity": intensity,
                "action_requested": "ventilate",
                "confidence": 0.90
            })

        # 5. Acoustic
        if re.search(r'\b(noise|noisy|loud|hum|humming|buzz|buzzing|rattle|rattling|drilling|sound|decibel|shouting|quiet)\b', t):
            sensation = "loud_hum" if any(k in t for k in ["hum", "buzz", "rattle"]) else "noisy"
            return json.dumps({
                "domain": "acoustic",
                "sensation": sensation,
                "location": location,
                "intensity": intensity,
                "action_requested": "reduce_noise" if "quiet" not in t else "investigate",
                "confidence": 0.92
            })

        # 6. Ergonomic (furniture, posture, physical aches)
        if re.search(r'\b(chair|monitor\s+stand|back\s+pain|wrist|ergonomic|keyboard|mouse|sitting|posture|hurting\s+my\s+back|sore\s+back|desk\s+height|standing\s+desk|armrest)\b', t):
            return json.dumps({
                "domain": "ergonomic",
                "sensation": "uncomfortable",
                "location": location,
                "intensity": intensity,
                "action_requested": "adjust_workstation",
                "confidence": 0.88
            })

        # 7. General / Other / Conversational
        return json.dumps({
            "domain": "other",
            "sensation": "other",
            "location": location,
            "intensity": 1,
            "action_requested": "none",
            "confidence": 0.35
        })


# ============================================================================
# 4. CRASH-PROOF 6-STAGE EXTRACTION & SANITIZATION PIPELINE
# ============================================================================

def stage1_strip_markdown_fences(raw: Any) -> str:
    """Stage 1: Strip markdown code blocks (```json ... ``` or ``` ... ```)."""
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    elif not isinstance(raw, str):
        if isinstance(raw, (dict, list)):
            try:
                raw = json.dumps(raw)
            except Exception:
                raw = str(raw)
        else:
            raw = str(raw)
    text = raw.strip()
    # Match ```json ... ``` or ``` ... ```
    pattern = r"```(?:json|JSON|dict|javascript|py|python)?\s*([\s\S]*?)\s*```"
    match = re.search(pattern, text)
    if match:
        return match.group(1).strip()
    # Also strip leading/trailing single fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def stage2_slice_outer_json_boundaries(text: Any) -> str:
    """Stage 2: Locate outermost '{' and '}' bounds."""
    if not isinstance(text, str):
        text = str(text) if text is not None else ""
    start_idx = text.find("{")
    end_idx = text.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
        return text[start_idx:end_idx + 1].strip()
    if start_idx != -1 and end_idx == -1:
        # Truncated JSON missing closing brace
        return text[start_idx:].strip() + "}"
    return text.strip()


def stage3_normalize_json_syntax(text: Any) -> str:
    """Stage 3: Normalize common JSON syntax errors (trailing commas, quotes, Python literals)."""
    if not isinstance(text, str):
        text = str(text) if text is not None else ""
    s = text.strip()
    
    # Remove trailing commas before closing braces/brackets
    s = re.sub(r",\s*([}\]])", r"\1", s)
    
    # Convert Python literals to JSON
    s = re.sub(r"\bTrue\b", "true", s)
    s = re.sub(r"\bFalse\b", "false", s)
    s = re.sub(r"\bNone\b", "null", s)
    
    # Fix single quotes around keys: 'key': -> "key":
    s = re.sub(r"'([a-zA-Z0-9_]+)'\s*:", r'"\1":', s)
    
    # Fix single quotes around string values: : 'value' -> : "value"
    s = re.sub(r":\s*'([^']*)'", r': "\1"', s)
    
    # Fix unquoted keys: {domain: "thermal"} -> {"domain": "thermal"}
    s = re.sub(r"([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1 "\2":', s)
    
    return s.strip()


def stage4_regex_field_recovery(raw: Any) -> Dict[str, Any]:
    """Stage 4: Robust regex pattern extraction when standard json parsing fails."""
    if not isinstance(raw, str):
        raw = str(raw) if raw is not None else ""
    data: Dict[str, Any] = {}
    
    # Domain pattern
    domain_m = re.search(
        r'["\']?domain["\']?\s*:\s*["\']?(thermal|visual|acoustic|air_quality|ergonomic|other|general)["\']?',
        raw,
        re.IGNORECASE
    )
    if domain_m:
        data["domain"] = domain_m.group(1).lower()

    # Sensation pattern
    sensation_m = re.search(r'["\']?sensation["\']?\s*:\s*["\']([^"\'\}\,]+)["\']', raw, re.IGNORECASE)
    if sensation_m:
        data["sensation"] = sensation_m.group(1).strip()

    # Location pattern
    location_m = re.search(r'["\']?location["\']?\s*:\s*(?:["\']([^"\'\}\,]+)["\']|(null)|(None))', raw, re.IGNORECASE)
    if location_m:
        if location_m.group(2) or location_m.group(3):
            data["location"] = None
        else:
            data["location"] = location_m.group(1).strip()

    # Intensity pattern
    intensity_m = re.search(r'["\']?intensity["\']?\s*:\s*([1-5])', raw)
    if intensity_m:
        data["intensity"] = int(intensity_m.group(1))

    # Action requested pattern
    action_m = re.search(r'["\']?action_requested["\']?\s*:\s*(?:["\']([^"\'\}\,]+)["\']|(null)|(None))', raw, re.IGNORECASE)
    if action_m:
        if action_m.group(2) or action_m.group(3):
            data["action_requested"] = None
        else:
            data["action_requested"] = action_m.group(1).strip()

    # Confidence pattern
    conf_m = re.search(r'["\']?confidence["\']?\s*:\s*([0-1](?:\.\d+)?)', raw)
    if conf_m:
        data["confidence"] = float(conf_m.group(1))

    return data


def stage5_heuristic_fallback(original_text: Any, location_hint: Optional[Any] = None) -> Dict[str, Any]:
    """Stage 5: Rule-based heuristic fallback if LLM output was completely unparseable."""
    if original_text is None:
        text_str = ""
    elif isinstance(original_text, str):
        text_str = original_text
    elif isinstance(original_text, bytes):
        text_str = original_text.decode("utf-8", errors="ignore")
    else:
        text_str = str(original_text)

    loc_str: Optional[str] = None
    if location_hint is not None:
        if isinstance(location_hint, str):
            loc_str = location_hint.strip() or None
        elif isinstance(location_hint, (int, float, bool)):
            loc_str = str(location_hint)

    mock = MockBackend()
    raw_sim = mock._simulate_extraction(text_str)
    try:
        data = json.loads(raw_sim)
        if loc_str and not data.get("location"):
            data["location"] = loc_str
        data["confidence"] = min(data.get("confidence", 0.7), 0.65)  # Cap fallback confidence
        return data
    except Exception:
        return {
            "domain": "other",
            "sensation": "other",
            "location": loc_str,
            "intensity": 3,
            "action_requested": "none",
            "confidence": 0.3
        }


def parse_and_validate(
    raw_response: Any,
    original_text: Any,
    location_hint: Optional[Any] = None,
    backend_name: str = "unknown"
) -> Tuple[ComfortEvent, str]:
    """
    Execute the full 6-stage crash-proof extraction and validation pipeline.
    
    Returns:
        Tuple of (validated_ComfortEvent, extraction_method_name)
    """
    extraction_method = "json_loads"
    data: Dict[str, Any] = {}

    # Sanitize original_text and location_hint
    clean_raw_text = str(original_text) if original_text is not None else ""

    safe_loc_hint: Optional[str] = None
    if location_hint is not None:
        if isinstance(location_hint, str):
            safe_loc_hint = location_hint.strip() or None
        elif isinstance(location_hint, (int, float, bool)):
            safe_loc_hint = str(location_hint)
        else:
            safe_loc_hint = None

    # Stage 1: Strip markdown fences
    s1 = stage1_strip_markdown_fences(raw_response)

    # Stage 2: Slice outer JSON boundaries
    s2 = stage2_slice_outer_json_boundaries(s1)

    # Stage 3: Normalize JSON syntax
    s3 = stage3_normalize_json_syntax(s2)

    # Stage 4: Try json.loads, fallback to regex recovery
    try:
        data = json.loads(s3)
        extraction_method = "sanitized_json"
    except Exception:
        raw_str = raw_response if isinstance(raw_response, str) else s1
        data = stage4_regex_field_recovery(raw_str)
        if data and ("domain" in data or "sensation" in data):
            extraction_method = "regex_recovery"
        else:
            # Stage 5: Rule-based heuristic fallback
            data = stage5_heuristic_fallback(clean_raw_text, safe_loc_hint)
            extraction_method = "heuristic_fallback"

    # Ensure required defaults
    if not isinstance(data, dict):
        data = stage5_heuristic_fallback(clean_raw_text, safe_loc_hint)
        extraction_method = "heuristic_fallback"

    # Location override / hint injection
    if safe_loc_hint and not data.get("location"):
        data["location"] = safe_loc_hint

    # Attach raw text and metadata
    data["raw_text"] = clean_raw_text
    meta = data.get("metadata", {})
    if not isinstance(meta, dict):
        meta = {}
    meta["extraction_method"] = extraction_method
    meta["backend_used"] = backend_name
    data["metadata"] = meta

    # Stage 6: Pydantic instantiation and validation
    try:
        event = ComfortEvent(**data)
    except Exception as e:
        logger.debug("Pydantic validation recovered with sanitized defaults: %s", e)
        # Safely sanitize all parameters before constructing failsafe ComfortEvent
        raw_loc = data.get("location") if isinstance(data, dict) else None
        if raw_loc is not None:
            if isinstance(raw_loc, str):
                loc_str = raw_loc.strip() or None
            elif isinstance(raw_loc, (int, float, bool)):
                loc_str = str(raw_loc)
            else:
                loc_str = safe_loc_hint
        else:
            loc_str = safe_loc_hint

        raw_action = data.get("action_requested") if isinstance(data, dict) else None
        if raw_action is not None:
            if isinstance(raw_action, str):
                action_str = raw_action.strip() or None
            elif isinstance(raw_action, (int, float, bool)):
                action_str = str(raw_action)
            else:
                action_str = None
        else:
            action_str = None

        raw_sensation = data.get("sensation") if isinstance(data, dict) else None
        if raw_sensation is not None and isinstance(raw_sensation, (str, int, float, bool)):
            sensation_str = str(raw_sensation).strip() or "other"
        else:
            sensation_str = "other"

        event = ComfortEvent(
            domain=ComfortDomain.OTHER,
            sensation=sensation_str,
            location=loc_str,
            intensity=3,
            action_requested=action_str,
            confidence=0.5,
            raw_text=clean_raw_text,
            metadata={"extraction_method": "failsafe_recovery", "backend_used": backend_name, "error": str(e)}
        )

    return event, extraction_method


# ============================================================================
# 5. LOCAL TRANSLATOR ORCHESTRATION FACADE
# ============================================================================

class LocalTranslator:
    """
    High-level facade for local occupant feedback semantic extraction.
    
    Provides unified API across in-process GGUF (`LlamaCppBackend`), local REST (`OllamaBackend`),
    and deterministic mock (`MockBackend`) engines.
    """

    def __init__(
        self,
        backend: Optional[BaseInferenceBackend] = None,
        backend_type: str = "auto",
        model_path: Optional[str] = None,
        ollama_url: str = "http://localhost:11434",
        model_name: str = "qwen2.5:0.5b",
        fallback_to_mock: bool = True,
        **kwargs: Any
    ):
        """
        Initialize LocalTranslator.
        
        Args:
            backend: Explicit pre-configured `BaseInferenceBackend` instance.
            backend_type: One of 'auto', 'llama_cpp', 'ollama', 'mock'.
            model_path: Absolute or relative path to GGUF model file for llama_cpp.
            ollama_url: Base URL for Ollama daemon (default: http://localhost:11434).
            model_name: Ollama model tag (default: qwen2.5:0.5b).
            fallback_to_mock: If True, falls back to MockBackend if requested engine is unavailable.
            **kwargs: Extra parameters passed to backend initialization.
        """
        self.fallback_to_mock = fallback_to_mock
        self.backend: BaseInferenceBackend = self._resolve_backend(
            backend=backend,
            backend_type=backend_type,
            model_path=model_path,
            ollama_url=ollama_url,
            model_name=model_name,
            **kwargs
        )
        logger.info("LocalTranslator initialized using backend '%s'", self.backend.name)

    def _resolve_backend(
        self,
        backend: Optional[BaseInferenceBackend],
        backend_type: str,
        model_path: Optional[str],
        ollama_url: str,
        model_name: str,
        **kwargs: Any
    ) -> BaseInferenceBackend:
        if backend is not None:
            return backend

        btype = backend_type.lower().strip()

        if btype == "mock":
            return MockBackend(**kwargs)

        if btype == "llama_cpp":
            if not model_path:
                if self.fallback_to_mock:
                    logger.warning("No model_path specified for llama_cpp; falling back to MockBackend")
                    return MockBackend(**kwargs)
                raise ValueError("model_path is required for llama_cpp backend")
            b = LlamaCppBackend(model_path=model_path, **kwargs)
            if not b.health_check() and self.fallback_to_mock:
                logger.warning("LlamaCppBackend unhealthy; falling back to MockBackend")
                return MockBackend(**kwargs)
            return b

        if btype == "ollama":
            b = OllamaBackend(base_url=ollama_url, model_name=model_name, **kwargs)
            if not b.health_check() and self.fallback_to_mock:
                logger.warning("Ollama daemon at %s unreachable; falling back to MockBackend", ollama_url)
                return MockBackend(**kwargs)
            return b

        if btype == "auto":
            # 1. Try llama_cpp if model_path provided
            if model_path:
                try:
                    b = LlamaCppBackend(model_path=model_path, **kwargs)
                    if b.health_check():
                        return b
                except Exception:
                    pass

            # 2. Try Ollama daemon
            try:
                b = OllamaBackend(base_url=ollama_url, model_name=model_name, **kwargs)
                if b.health_check():
                    return b
            except Exception:
                pass

            # 3. Fallback to MockBackend
            if self.fallback_to_mock:
                logger.info("Auto-resolution: using MockBackend")
                return MockBackend(**kwargs)

            raise RuntimeError("No local inference backend available (llama_cpp or ollama).")

        raise ValueError(f"Unknown backend_type: '{backend_type}'. Allowed: 'auto', 'llama_cpp', 'ollama', 'mock'")

    def translate(self, text: Any, location_hint: Optional[Any] = None) -> TranslationResult:
        """
        Translate natural language occupant feedback into a structured TranslationResult.
        
        Args:
            text: Occupant complaint or observation string.
            location_hint: Optional location override/fallback (e.g. room number).
            
        Returns:
            `TranslationResult` containing validated `event`, telemetry, and timing.
        """
        start_time = time.perf_counter()
        raw_response: Any = ""
        error_msg: Optional[str] = None
        event: Optional[ComfortEvent] = None
        success = True

        prompt = build_full_prompt(text)

        try:
            raw_response = self.backend.generate(
                prompt=prompt,
                grammar=None
            )
        except Exception as e:
            logger.warning("Backend generation error: %s; initiating heuristic fallback", e)
            error_msg = str(e)
            raw_response = ""
            success = False

        if raw_response is None:
            raw_response = ""
        elif isinstance(raw_response, bytes):
            raw_response = raw_response.decode("utf-8", errors="replace")
        elif not isinstance(raw_response, str):
            raw_response = str(raw_response)

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        # Execute 6-stage crash-proof parser
        event, _ = parse_and_validate(
            raw_response=raw_response,
            original_text=text,
            location_hint=location_hint,
            backend_name=self.backend.name
        )

        # Record timing and status in metadata
        event.metadata["execution_time_ms"] = round(elapsed_ms, 2)
        if error_msg:
            event.metadata["backend_error"] = error_msg

        return TranslationResult(
            success=success or (event is not None and event.domain != ComfortDomain.OTHER),
            event=event,
            error_message=error_msg,
            raw_response=raw_response,
            backend_used=self.backend.name,
            execution_time_ms=round(elapsed_ms, 2)
        )

    def batch_translate(self, texts: List[str]) -> List[TranslationResult]:
        """Translate a batch of occupant feedback strings sequentially."""
        return [self.translate(t) for t in texts]

    def parse_raw_output(
        self,
        raw_output: Any,
        original_text: Any = "",
        location_hint: Optional[Any] = None
    ) -> ComfortEvent:
        """Directly parse and validate a raw LLM output string without executing inference."""
        event, _ = parse_and_validate(
            raw_response=raw_output,
            original_text=original_text,
            location_hint=location_hint,
            backend_name="direct_parse"
        )
        return event

    def health_check(self) -> bool:
        """Verify active backend health."""
        return self.backend.health_check()

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic health and configuration status."""
        return {
            "active_backend": self.backend.name,
            "is_healthy": self.backend.health_check(),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# ============================================================================
# 6. CLI INTERFACE & VERIFICATION ENTRYPOINT
# ============================================================================

def main() -> None:
    """CLI entrypoint for testing and interactive translation."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Local AI Occupant Comfort Translator (Raspberry Pi 4 / Edge BMS)"
    )
    parser.add_argument(
        "text",
        nargs="?",
        default="It's freezing in room 204, can we please turn up the heat?",
        help="Natural language occupant feedback text to translate"
    )
    parser.add_argument(
        "--backend",
        choices=["auto", "mock", "ollama", "llama_cpp"],
        default="mock",
        help="Inference backend to use (default: mock)"
    )
    parser.add_argument(
        "--model-path",
        default=None,
        help="Path to GGUF model file for llama_cpp backend"
    )
    parser.add_argument(
        "--ollama-url",
        default="http://localhost:11434",
        help="Ollama base URL (default: http://localhost:11434)"
    )
    parser.add_argument(
        "--model-name",
        default="qwen2.5:0.5b",
        help="Ollama model name (default: qwen2.5:0.5b)"
    )
    parser.add_argument(
        "--location-hint",
        default=None,
        help="Optional location hint override"
    )

    args = parser.parse_args()

    print(f"[*] Initializing LocalTranslator (backend={args.backend})...")
    translator = LocalTranslator(
        backend_type=args.backend,
        model_path=args.model_path,
        ollama_url=args.ollama_url,
        model_name=args.model_name
    )

    print(f"[*] Input Text: '{args.text}'")
    result = translator.translate(args.text, location_hint=args.location_hint)

    print("\n" + "=" * 60)
    print(" TRANSLATION RESULT")
    print("=" * 60)
    print(f"Success:           {result.success}")
    print(f"Backend Used:      {result.backend_used}")
    print(f"Execution Time:    {result.execution_time_ms:.2f} ms")
    if result.event:
        print(f"Event ID:          {result.event.event_id}")
        print(f"Domain:            {result.event.domain}")
        print(f"Sensation:         {result.event.sensation}")
        print(f"Location:          {result.event.location}")
        print(f"Intensity:         {result.event.intensity} / 5")
        print(f"Action Requested:  {result.event.action_requested}")
        print(f"Confidence:        {result.event.confidence:.2f}")
        print(f"Extraction Method: {result.event.metadata.get('extraction_method', 'unknown')}")
        print("\nFull Dict Output:")
        print(json.dumps(result.event.to_dict(), indent=2))
    print("=" * 60)


if __name__ == "__main__":
    main()
