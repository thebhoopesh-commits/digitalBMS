"""
Unit tests for the new Aura Rule System: Semantic NLP, Constraint Bridge, and Safety Shield.
"""
import pytest
from src.nlp.schemas import ComfortIntent, SeverityLevel, SuspectedCause, ComfortEvent
from src.nlp.fallback_parser import DeterministicFallbackParser
from src.nlp.constraint_bridge import NLPConstraintBridge
from src.simulation.safety_shield import SafetyShield

def test_fallback_parser_semantic_extraction():
    """Test that the fallback parser extracts semantic intents rather than physical offsets."""
    result = DeterministicFallbackParser.parse("It's freezing in the server room!")
    assert result.is_applicable is True
    assert len(result.events) == 1
    
    event = result.events[0]
    assert event.zone_id == "server_room"
    assert event.intent == ComfortIntent.TOO_COLD
    # 'freezing' implies High or Critical severity
    assert event.severity in [SeverityLevel.HIGH, SeverityLevel.CRITICAL]

def test_constraint_bridge_deterministic_mapping():
    """Test that the constraint bridge correctly maps semantic events to physical bounds."""
    bridge = NLPConstraintBridge()
    
    event = ComfortEvent(
        zone_id="lobby",
        intent=ComfortIntent.TOO_WARM,
        severity=SeverityLevel.HIGH,
        suspected_cause=SuspectedCause.SOLAR_GAIN,
        reasoning="Test"
    )
    
    bridge.add_event(event, current_time_minutes=0.0)
    
    # Active offset should be negative (cooling)
    t_offset, rh_offset, weight = bridge.get_active_offsets("lobby", current_time_minutes=0.0)
    assert t_offset < 0.0
    assert weight > 1.0  # High severity increases weight

def test_safety_shield_clipping():
    """Test that the safety shield prevents RL agent from exceeding absolute bounds or fighting NLP constraints."""
    shield = SafetyShield()
    
    rl_actions = [3.0] # RL wants to heat heavily
    current_temps = [22.0]
    zone_ids = ["lobby"]
    nlp_offsets = [-2.0] # NLP constraint wants cooling
    
    # RL action (+3.0) + NLP offset (-2.0) = +1.0 offset (target 23.0). This is within absolute bounds (16-28),
    # BUT the NLP offset is strongly negative, so the shield should prevent RL from heating.
    
    safe_actions, penalty = shield.authorize_and_clip(rl_actions, current_temps, zone_ids, nlp_offsets)
    
    # RL action should be clipped to 0.5 because it's fighting a negative NLP offset
    assert safe_actions[0] == 0.5
    assert penalty > 0.0
    assert shield.total_interventions == 1

def test_safety_shield_absolute_bounds():
    """Test that the safety shield enforces absolute physical temperature limits."""
    shield = SafetyShield()
    
    # Target SP = 22.0 + 0.0 (nlp) + (-10.0) = 12.0 < 16.0 (ABS_MIN_TEMP)
    rl_actions = [-10.0] 
    current_temps = [22.0]
    zone_ids = ["lobby"]
    nlp_offsets = [0.0]
    
    safe_actions, penalty = shield.authorize_and_clip(rl_actions, current_temps, zone_ids, nlp_offsets)
    
    # Should clip target SP to 16.0 -> action = 16.0 - 22.0 = -6.0
    assert safe_actions[0] == -6.0
    assert penalty > 0.0
