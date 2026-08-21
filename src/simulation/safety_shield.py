"""
Aura Rule System - Layer 3: Safety Shield Authorization.
Ensures RL actions strictly adhere to physical safety bounds and 
occupant-defined constraints (BoundedPreferences) before execution.
"""

from typing import List, Dict, Tuple
import logging

logger = logging.getLogger("hvac.simulation.safety_shield")

# Physical constraints
ABS_MIN_TEMP = 16.0
ABS_MAX_TEMP = 28.0

class SafetyShield:
    """
    Intervenes before RL actions are executed on the Digital Twin.
    Clips actions to safe envelopes and calculates penalty signals.
    """

    def __init__(self):
        self.total_interventions = 0

    def authorize_and_clip(
        self,
        rl_action_offsets: List[float],
        current_temps: List[float],
        zone_ids: List[str],
        active_nlp_offsets: List[float]
    ) -> Tuple[List[float], float]:
        """
        Takes raw RL offsets, current temperatures, and NLP targets.
        Returns (clipped_action_offsets, intervention_penalty).
        """
        clipped_actions = []
        intervention_penalty = 0.0

        for idx, (raw_action, current_temp, z_id, nlp_offset) in enumerate(zip(
            rl_action_offsets, current_temps, zone_ids, active_nlp_offsets
        )):
            # The baseline setpoint is typically 22.0
            # Target setpoint is 22.0 + nlp_offset (if not NaN) + raw_action
            safe_nlp_offset = 0.0 if str(nlp_offset).lower() == 'nan' else nlp_offset
            
            # Action here represents a delta on top of the NLP offset
            target_sp = 22.0 + safe_nlp_offset + raw_action

            # Absolute bounds check
            if target_sp < ABS_MIN_TEMP:
                clipped_action = ABS_MIN_TEMP - (22.0 + safe_nlp_offset)
                intervention_penalty += abs(raw_action - clipped_action) * 10.0
                self.total_interventions += 1
                logger.debug(f"Shield intervened (Under-temp): Zone {z_id}")
            elif target_sp > ABS_MAX_TEMP:
                clipped_action = ABS_MAX_TEMP - (22.0 + safe_nlp_offset)
                intervention_penalty += abs(raw_action - clipped_action) * 10.0
                self.total_interventions += 1
                logger.debug(f"Shield intervened (Over-temp): Zone {z_id}")
            else:
                clipped_action = raw_action

            # If there is a strong NLP offset, we want to restrict RL from fighting it
            if abs(safe_nlp_offset) > 0.5:
                # If NLP wants cooling (offset < 0), RL shouldn't heat heavily (action > 0.5)
                if safe_nlp_offset < 0 and clipped_action > 0.5:
                    clipped_action = 0.5
                    intervention_penalty += 5.0
                    self.total_interventions += 1
                # If NLP wants heating (offset > 0), RL shouldn't cool heavily (action < -0.5)
                elif safe_nlp_offset > 0 and clipped_action < -0.5:
                    clipped_action = -0.5
                    intervention_penalty += 5.0
                    self.total_interventions += 1

            clipped_actions.append(float(clipped_action))

        return clipped_actions, intervention_penalty
