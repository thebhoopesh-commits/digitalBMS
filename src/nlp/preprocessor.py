"""
Explicit NLP Pre-processing Pipeline for Hackathon Architecture.
Layer 1 (Sanitization) + Layer 2 (Entity Resolution) + spaCy-enhanced extraction.
spaCy is imported lazily so a broken numpy shadow (host PYTHONPATH issue)
does not crash the application on import.
"""

import re
from typing import List, Optional, Tuple
from src.nlp.schemas import ZONE_ALIAS_MAP

# Layer 1: Emoji Normalization Dictionary
EMOJI_MAP = {
    "🥶": "freezing",
    "🧊": "cold",
    "❄️": "cold",
    "🥵": "hot",
    "🔥": "hot",
    "☀️": "hot",
    "🏜️": "dry",
    "💧": "humid",
    "💦": "humid",
    "🤢": "stuffy",
}

_SPACY_AVAILABLE: Optional[bool] = None


def _spacy_available() -> bool:
    global _SPACY_AVAILABLE
    if _SPACY_AVAILABLE is not None:
        return _SPACY_AVAILABLE
    try:
        import spacy  # noqa: F401
        _SPACY_AVAILABLE = True
    except Exception:
        _SPACY_AVAILABLE = False
    return _SPACY_AVAILABLE


class NLPPreprocessor:
    @staticmethod
    def sanitize_text(text: str) -> str:
        clean_text = re.sub(r"<[^>]+>", "", text)
        for emoji, word in EMOJI_MAP.items():
            clean_text = clean_text.replace(emoji, f" {word} ")
        clean_text = re.sub(r"\s+", " ", clean_text).strip()
        return clean_text

    @staticmethod
    def resolve_entities(text: str) -> str:
        resolved_text = text.lower()
        sorted_aliases = sorted(ZONE_ALIAS_MAP.keys(), key=len, reverse=True)
        for alias in sorted_aliases:
            canonical_zone = ZONE_ALIAS_MAP[alias]
            pattern = r"\b" + re.escape(alias) + r"\b"
            resolved_text = re.sub(
                pattern, f"[ZONE: {canonical_zone}]", resolved_text
            )
        return resolved_text

    @staticmethod
    def spacy_extract_entities(text: str) -> Tuple[List[str], Optional[str], Optional[str]]:
        """
        spaCy-enhanced entity / POS extraction for zone + metric + sensation.
        Returns (zones_found, primary_metric_hint, sensation_hint).
        Falls back gracefully when spaCy/numpy is unavailable.
        """
        zones_found: List[str] = []
        primary_metric_hint: Optional[str] = None
        sensation_hint: Optional[str] = None

        if not _spacy_available():
            # Fallback: deterministic regex (same guarantees, no spaCy dependency)
            low = text.lower()
            for alias in sorted(ZONE_ALIAS_MAP.keys(), key=len, reverse=True):
                zone_id = ZONE_ALIAS_MAP[alias]
                if re.search(rf"\b{re.escape(alias)}\b", low):
                    zones_found.append(zone_id)
                    zones_found = list(dict.fromkeys(zones_found))  # preserve order, dedup
            if re.search(
                r"\b(temperature|temp|hot|cold|freezing|warm|thermostat|degrees)\b", low
            ):
                primary_metric_hint = "temperature"
            elif re.search(
                r"\b(humidity|humid|dry|sticky|muggy|rh)\b", low
            ):
                primary_metric_hint = "humidity"
            if any(k in low for k in [
                "too_hot", "hot", "boiling", "baking", "freezing", "chilly"
            ]):
                sensation_hint = "thermal"
            return zones_found, primary_metric_hint, sensation_hint

        # spaCy live path
        try:
            import spacy
            nlp = spacy.load("en_core_web_sm")
            doc = nlp(text)
            # Named entities: GPE/LOC/ORG may map to zones via alias
            low_text = text.lower()
            seen_zones: set = set()
            for alias in sorted(ZONE_ALIAS_MAP.keys(), key=len, reverse=True):
                zone_id = ZONE_ALIAS_MAP[alias]
                if zone_id in seen_zones:
                    continue
                if re.search(rf"\b{re.escape(alias)}\b", low_text):
                    zones_found.append(zone_id)
                    seen_zones.add(zone_id)

            # Metric hints from noun chunks / tokens
            noun_texts = [chunk.text.lower() for chunk in doc.noun_chunks]
            token_texts = [token.text.lower() for token in doc if token.pos_ in ("NOUN", "ADJ")]
            combined = noun_texts + token_texts
            metric_scores = {
                "temperature": sum(1 for w in combined if w in (
                    "temperature", "temp", "degrees", "heat", "cold", "thermostat"
                )),
                "humidity": sum(1 for w in combined if w in (
                    "humidity", "humid", "dry", "sticky", "muggy", "rh"
                )),
                "co2": sum(1 for w in combined if w in ("co2", "air quality", "iaq")),
                "occupancy": sum(1 for w in combined if w in ("occupancy", "people", "head")),
            }
            best_metric = max(metric_scores, key=lambda k: metric_scores[k])
            if metric_scores[best_metric] > 0:
                primary_metric_hint = best_metric if best_metric != "occupancy" else None

            # Sensation hint from adjective/verb tokens
            sensation_words = {
                "too_hot": ["hot", "boiling", "baking", "burning", "sweltering"],
                "too_cold": ["cold", "freezing", "chilly", "icy", "frosty"],
                "stuffy": ["stuffy", "stale", "odorous", "smelly"],
                "drafty": ["drafty", "breeze", "windy"],
            }
            for hint, words in sensation_words.items():
                for token in doc:
                    if token.lemma_ in words or token.text.lower() in words:
                        sensation_hint = hint
                        break
                if sensation_hint:
                    break
        except Exception:
            # Any spaCy failure falls back silently to regex path
            pass

        # Final merge: if spaCy didn't find zones, use regex fallback
        if not zones_found:
            low = text.lower()
            for alias in sorted(ZONE_ALIAS_MAP.keys(), key=len, reverse=True):
                zone_id = ZONE_ALIAS_MAP[alias]
                if zone_id not in zones_found:
                    if re.search(rf"\b{re.escape(alias)}\b", low):
                        zones_found.append(zone_id)
        return zones_found, primary_metric_hint, sensation_hint

    @classmethod
    def process(cls, raw_text: str) -> str:
        sanitized = cls.sanitize_text(raw_text)
        resolved = cls.resolve_entities(sanitized)
        return resolved

    @classmethod
    def process_with_spacy(cls, raw_text: str) -> Tuple[str, List[str], Optional[str], Optional[str]]:
        """Full pipeline: sanitize + entities + spaCy-enhanced entity/metric/sensation hints."""
        sanitized = cls.sanitize_text(raw_text)
        resolved = cls.resolve_entities(sanitized)
        zones, metric_hint, sensation_hint = cls.spacy_extract_entities(resolved)
        return resolved, zones, metric_hint, sensation_hint
