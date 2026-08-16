import numpy as np
from typing import List, Optional

class RewardEngine:
    """6-term multi-objective reward engine for RL agent optimization."""

    def __init__(self, lambda_cost: float = 1.0, lambda_energy: float = 0.5,
                 lambda_comfort: float = 2.0, lambda_nlp: float = 3.0,
                 lambda_peak: float = 1.5, lambda_smooth: float = 0.2):
        for w in [lambda_cost, lambda_energy, lambda_comfort, lambda_nlp, lambda_peak, lambda_smooth]:
            if w < 0:
                raise ValueError("Reward weights must be non-negative")
        self.lambda_cost = lambda_cost
        self.lambda_energy = lambda_energy
        self.lambda_comfort = lambda_comfort
        self.lambda_nlp = lambda_nlp
        self.lambda_peak = lambda_peak
        self.lambda_smooth = lambda_smooth

    def compute_reward(self, powers_kw: List[float], temps_c: List[float],
                       occupancies: List[int], price_kwh: float = 0.15,
                       nlp_targets: Optional[List[float]] = None) -> float:
        total_p = sum(powers_kw)
        j_cost = price_kwh * total_p * (300.0 / 3600.0)
        j_energy = total_p * (300.0 / (3600.0 * 1000.0))
        j_comf = self.compute_comfort_penalty(temps_c, occupancies)
        j_peak = self.compute_peak_penalty(total_p)
        r = -(self.lambda_cost * j_cost + self.lambda_energy * j_energy +
              self.lambda_comfort * j_comf + self.lambda_peak * j_peak)
        return float(r)

    def compute_comfort_penalty(self, temps_c: List[float], occupancies: List[int],
                                t_min: float = 20.0, t_max: float = 24.0) -> float:
        penalty = 0.0
        for t, occ in zip(temps_c, occupancies):
            w_occ = (occ / 35.0) + 0.1
            err = max(0.0, t - t_max)**2 + max(0.0, t_min - t)**2
            penalty += w_occ * err
        return float(penalty)

    def compute_nlp_penalty(self, temps_c: List[float], targets_c: List[float],
                            weights: List[float], priorities: List[float]) -> float:
        penalty = 0.0
        for t, target, w, prio in zip(temps_c, targets_c, weights, priorities):
            penalty += w * prio * ((t - target)**2)
        return float(penalty)

    def compute_smoothness_penalty(self, current_action: List[float], prev_action: List[float]) -> float:
        penalty = 0.0
        for a_curr, a_prev in zip(current_action, prev_action):
            penalty += (a_curr - a_prev)**2
        return float(penalty * self.lambda_smooth)

    def compute_peak_penalty(self, total_power_kw: float, thresh_kw: float = 40.0) -> float:
        if total_power_kw > thresh_kw:
            return float((total_power_kw - thresh_kw)**2)
        return 0.0


class FastTabularRLPolicy:
    """A tabular RL policy mock for the digital twin optimizer."""
    
    def __init__(self, alpha: float = 0.1, gamma: float = 0.95, epsilon: float = 0.1, num_zones: int = 3):
        self.q_table: dict = {}
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self.num_zones = num_zones
        # Possible actions for each zone: -1.0, 0.0, 1.0 (cooling, nothing, heating)
        self.action_space = [-1.0, 0.0, 1.0]

    def _discretize_state(self, obs: np.ndarray, nlp_offsets: List[float]) -> str:
        """Discretize continuous state (temps) into bins of 1 degree C."""
        if len(obs) >= self.num_zones:
            temps = obs[:self.num_zones]
            # Use 1 degree bins, offset by 22
            # Add NLP offsets into the state representation
            binned = []
            for i in range(self.num_zones):
                t = round(temps[i])
                off = round(nlp_offsets[i]) if not np.isnan(nlp_offsets[i]) else 0.0
                binned.append(f"{t}_{off}")
            return "|".join(binned)
        return "default"

    def compute_action(self, obs: np.ndarray, nlp_offsets: Optional[List[float]] = None) -> np.ndarray:
        if nlp_offsets is None:
            nlp_offsets = [np.nan] * self.num_zones
            
        state_key = self._discretize_state(obs, nlp_offsets)
        
        if np.random.rand() < self.epsilon:
            # Explore
            actions = [float(np.random.choice(self.action_space)) for _ in range(self.num_zones)]
            return np.array(actions, dtype=np.float32)
        else:
            # Exploit
            best_action = None
            best_q = float('-inf')
            
            # Since action space is small (3^num_zones = 27), we can enumerate or just greedily pick per zone for simplicity
            # For pure tabular Q-learning across multi-dimensional action space, we assume independent zones to keep table small,
            # OR we just combine them. Let's assume independent Q-tables for each zone to prevent state explosion!
            
            # To keep it simple: we use a single Q-table mapping (state_key) -> dict of action_tuple -> q_value
            if state_key not in self.q_table:
                self.q_table[state_key] = {}
            
            # Generate all possible action tuples if we really want to, but it's 27 combinations.
            import itertools
            all_actions = list(itertools.product(self.action_space, repeat=self.num_zones))
            
            # Initialize unseen actions with 0
            for a in all_actions:
                if a not in self.q_table[state_key]:
                    self.q_table[state_key][a] = 0.0
            
            # Find max Q
            best_actions = []
            for a in all_actions:
                if self.q_table[state_key][a] > best_q:
                    best_q = self.q_table[state_key][a]
                    best_actions = [a]
                elif self.q_table[state_key][a] == best_q:
                    best_actions.append(a)
            
            chosen_action = best_actions[np.random.choice(len(best_actions))]
            return np.array(chosen_action, dtype=np.float32)

    def update(self, obs: np.ndarray, action: np.ndarray, reward: float, next_obs: np.ndarray, nlp_offsets: List[float]):
        state_key = self._discretize_state(obs, nlp_offsets)
        next_state_key = self._discretize_state(next_obs, nlp_offsets)
        action_tuple = tuple(action.tolist())
        
        if state_key not in self.q_table:
            self.q_table[state_key] = {}
        if action_tuple not in self.q_table[state_key]:
            self.q_table[state_key][action_tuple] = 0.0
            
        if next_state_key not in self.q_table:
            self.q_table[next_state_key] = {}
            
        # Get max Q for next state
        import itertools
        all_actions = list(itertools.product(self.action_space, repeat=self.num_zones))
        max_next_q = 0.0
        if self.q_table[next_state_key]:
            for a in all_actions:
                val = self.q_table[next_state_key].get(a, 0.0)
                if val > max_next_q:
                    max_next_q = val
                    
        # Bellman equation
        current_q = self.q_table[state_key][action_tuple]
        new_q = current_q + self.alpha * (reward + self.gamma * max_next_q - current_q)
        self.q_table[state_key][action_tuple] = new_q

