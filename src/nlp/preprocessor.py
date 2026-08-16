"""
Explicit NLP Pre-processing Pipeline for Hackathon Architecture.
Implements Layer 1 (Sanitization) and Layer 2 (Entity Resolution).
"""

import re
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

class NLPPreprocessor:
    @staticmethod
    def sanitize_text(text: str) -> str:
        """
        Layer 1: Text Sanitization & Emoji Normalization
        - Strips HTML tags
        - Normalizes multiple spaces
        - Maps emojis to explicit semantic text
        """
        # Strip HTML/script tags
        clean_text = re.sub(r'<[^>]+>', '', text)
        
        # Replace emojis
        for emoji, word in EMOJI_MAP.items():
            clean_text = clean_text.replace(emoji, f" {word} ")
            
        # Normalize whitespace
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
        
        return clean_text

    @staticmethod
    def resolve_entities(text: str) -> str:
        """
        Layer 2: Spatial Entity & Alias Resolution
        - Scans for colloquial aliases ("front desk")
        - Replaces with explicit tags ("[ZONE: lobby]")
        """
        resolved_text = text.lower()
        
        # Sort aliases by length descending so "conference room" matches before "conference"
        sorted_aliases = sorted(ZONE_ALIAS_MAP.keys(), key=len, reverse=True)
        
        for alias in sorted_aliases:
            canonical_zone = ZONE_ALIAS_MAP[alias]
            # Use regex boundaries to match whole words/phrases
            pattern = r'\b' + re.escape(alias) + r'\b'
            resolved_text = re.sub(pattern, f"[ZONE: {canonical_zone}]", resolved_text)
            
        return resolved_text
    
    @classmethod
    def process(cls, raw_text: str) -> str:
        """Runs the sequential preprocessing pipeline."""
        sanitized = cls.sanitize_text(raw_text)
        resolved = cls.resolve_entities(sanitized)
        return resolved
