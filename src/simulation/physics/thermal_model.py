"""
Coupled Multi-Zone 3R2C Lumped-Parameter Thermal Model.
Ultra-fast, vectorized linear state-space ODE network supporting batch multi-twin integration.
"""

from typing import Dict, List, Optional, Tuple, Union
import numpy as np

from src.config import BuildingConfig, SimulationConfig, ZoneConfig


class MultiZoneThermalModel:
    """Coupled Multi-Zone 3R2C Lumped-Parameter Thermal Physics Engine."""

    def __init__(
        self,
        config: Optional[BuildingConfig] = None,
        sim_config: Optional[SimulationConfig] = None,
        zones: Optional[Dict[str, ZoneConfig]] = None,
        inter_zone_r: Optional[np.ndarray] = None,
    ):
        if config is None:
            if zones is not None:
                self.zones = zones
                self.num_zones = len(zones)
                self.inter_zone_r = (
                    inter_zone_r
                    if inter_zone_r is not None
                    else np.zeros((self.num_zones, self.num_zones))
                )
                self.config = BuildingConfig(
                    zones=zones, inter_zone_r_matrix=self.inter_zone_r.tolist()
                )
            else:
                self.config = BuildingConfig()
                self.zones = self.config.zones
                self.num_zones = len(self.zones)
                self.inter_zone_r = self.config.inter_zone_r
        else:
            self.config = config
            self.zones = config.zones
            self.num_zones = len(self.zones)
            self.inter_zone_r = config.inter_zone_r

        self.sim_config = sim_config if sim_config is not None else SimulationConfig()
        self.zone_ids = list(self.zones.keys())

        # Extract zone parameters into fast numpy arrays
        self.c_air = np.array([z.c_air for z in self.zones.values()], dtype=np.float64)
        self.c_wall = np.array([z.c_wall for z in self.zones.values()], dtype=np.float64)
        self.inv_c_air = 1.0 / self.c_air
        self.inv_c_wall = 1.0 / self.c_wall

        self.r_w = np.array([z.r_w for z in self.zones.values()], dtype=np.float64)
        self.r_amb = np.array([z.r_amb for z in self.zones.values()], dtype=np.float64)
        self.r_inf = np.array([z.r_inf for z in self.zones.values()], dtype=np.float64)

        self.inv_r_w = 1.0 / self.r_w
        self.inv_r_amb = 1.0 / self.r_amb
        self.inv_r_inf = 1.0 / self.r_inf

        self.window_area = np.array(
            [z.window_area_m2 for z in self.zones.values()], dtype=np.float64
        )
        self.shgc = np.array([z.shgc for z in self.zones.values()], dtype=np.float64)
        self.orientation = np.array(
            [z.orientation_factor for z in self.zones.values()], dtype=np.float64
        )
        self.wall_solar_frac = np.array(
            [z.wall_solar_absorption_frac for z in self.zones.values()], dtype=np.float64
        )

        # Precomputed solar multiplier: window_area * shgc * orientation
        self.solar_mult = self.window_area * self.shgc * self.orientation
        self.solar_wall_mult = self.solar_mult * self.wall_solar_frac
        self.solar_air_mult = self.solar_mult * (1.0 - self.wall_solar_frac)

        # Build system matrix A (2N x 2N)
        self.A = self._build_system_matrix()

    def _build_system_matrix(self) -> np.ndarray:
        """Constructs the exact 2N x 2N state-space Hurwitz system matrix A."""
        n = self.num_zones
        dim = 2 * n
        A = np.zeros((dim, dim), dtype=np.float64)

        for i in range(n):
            idx_z = 2 * i
            idx_w = 2 * i + 1

            sum_g_inter = 0.0
            for j in range(n):
                if i != j and self.inter_zone_r[i, j] > 0:
                    g_ij = 1.0 / self.inter_zone_r[i, j]
                    sum_g_inter += g_ij
                    idx_zj = 2 * j
                    A[idx_z, idx_zj] = g_ij * self.inv_c_air[i]

            A[idx_z, idx_z] = -(
                self.inv_r_w[i] + self.inv_r_inf[i] + sum_g_inter
            ) * self.inv_c_air[i]

            A[idx_z, idx_w] = self.inv_r_w[i] * self.inv_c_air[i]
            A[idx_w, idx_w] = -(self.inv_r_amb[i] + self.inv_r_w[i]) * self.inv_c_wall[i]
            A[idx_w, idx_z] = self.inv_r_w[i] * self.inv_c_wall[i]

        return A

    def get_system_matrix(self) -> np.ndarray:
        """Returns the 2N x 2N system matrix A."""
        return self.A.copy()

    def get_eigenvalues(self) -> np.ndarray:
        """Returns the eigenvalues of the system matrix A."""
        return np.linalg.eigvals(self.A)

    def init_state(
        self,
        T_air: Union[List[float], np.ndarray, float] = 22.0,
        T_wall: Union[List[float], np.ndarray, float] = 22.0,
    ) -> np.ndarray:
        """Initializes the 2N state vector."""
        n = self.num_zones
        state = np.zeros(2 * n, dtype=np.float64)

        if np.isscalar(T_air):
            t_air_arr = np.full(n, T_air, dtype=np.float64)
        else:
            t_air_arr = np.array(T_air, dtype=np.float64)

        if np.isscalar(T_wall):
            t_wall_arr = np.full(n, T_wall, dtype=np.float64)
        else:
            t_wall_arr = np.array(T_wall, dtype=np.float64)

        state[0::2] = t_air_arr
        state[1::2] = t_wall_arr
        return state

    def get_air_temperatures(self, state: np.ndarray) -> np.ndarray:
        """Extracts the N air temperatures from state vector."""
        return state[0::2]

    def get_wall_temperatures(self, state: np.ndarray) -> np.ndarray:
        """Extracts the N wall temperatures from state vector."""
        return state[1::2]

    def compute_internal_energy(self, state: np.ndarray) -> float:
        """Computes the total sensible internal energy of the building (Joules)."""
        t_z = state[0::2]
        t_w = state[1::2]
        return float(np.sum(self.c_air * t_z + self.c_wall * t_w))

    def compute_interzone_flux_matrix(self, T_zones: np.ndarray) -> np.ndarray:
        """Computes the N x N inter-zone heat transfer matrix."""
        n = len(T_zones)
        flux_matrix = np.zeros((n, n), dtype=np.float64)
        for i in range(n):
            for j in range(n):
                if i != j and self.inter_zone_r[i, j] > 0:
                    flux_matrix[i, j] = (T_zones[j] - T_zones[i]) / self.inter_zone_r[i, j]
        return flux_matrix

    def compute_net_boundary_flux(
        self,
        state: np.ndarray,
        T_amb: float,
        I_solar: float = 0.0,
        Q_int: Optional[np.ndarray] = None,
        Q_hvac: Optional[np.ndarray] = None,
    ) -> float:
        """Computes total net boundary heat flux entering the building system (Watts)."""
        n = self.num_zones
        t_z = state[0::2]
        t_w = state[1::2]

        if Q_int is None:
            Q_int = np.zeros(n, dtype=np.float64)
        if Q_hvac is None:
            Q_hvac = np.zeros(n, dtype=np.float64)

        q_solar_total = self.solar_mult * I_solar
        q_inf = (T_amb - t_z) * self.inv_r_inf
        q_amb = (T_amb - t_w) * self.inv_r_amb

        net_flux = float(
            np.sum(q_inf + q_amb + q_solar_total + Q_int + Q_hvac)
        )
        return net_flux

    def compute_exogenous_vector(
        self,
        T_amb: float,
        I_solar: float = 0.0,
        Q_int: Optional[np.ndarray] = None,
        Q_hvac: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Computes the 2N disturbance/input vector b(t)."""
        n = self.num_zones
        b = np.empty(2 * n, dtype=np.float64)

        q_solar_wall = self.solar_wall_mult * I_solar
        q_solar_air = self.solar_air_mult * I_solar

        if Q_int is None and Q_hvac is None:
            b[0::2] = self.inv_c_air * (T_amb * self.inv_r_inf + q_solar_air)
        elif Q_int is None:
            b[0::2] = self.inv_c_air * (T_amb * self.inv_r_inf + Q_hvac + q_solar_air)
        elif Q_hvac is None:
            b[0::2] = self.inv_c_air * (T_amb * self.inv_r_inf + Q_int + q_solar_air)
        else:
            b[0::2] = self.inv_c_air * (T_amb * self.inv_r_inf + Q_int + Q_hvac + q_solar_air)

        b[1::2] = self.inv_c_wall * (T_amb * self.inv_r_amb + q_solar_wall)
        return b

    def step(
        self,
        state: np.ndarray,
        T_amb: float,
        I_solar: float = 0.0,
        Q_int: Optional[np.ndarray] = None,
        Q_hvac: Optional[np.ndarray] = None,
        dt: Optional[float] = None,
        sub_steps: Optional[int] = None,
    ) -> np.ndarray:
        """Performs explicit Runge-Kutta 4th order (RK4) integration for a single state."""
        macro_dt = dt if dt is not None else self.sim_config.dt_step_seconds
        num_sub = max(1, sub_steps) if sub_steps is not None else 1

        sub_dt = macro_dt / num_sub
        half_sub_dt = 0.5 * sub_dt
        dt_div_6 = sub_dt / 6.0

        b = self.compute_exogenous_vector(
            T_amb=T_amb, I_solar=I_solar, Q_int=Q_int, Q_hvac=Q_hvac
        )

        curr_state = state.copy()
        A = self.A

        for _ in range(num_sub):
            k1 = A @ curr_state + b
            k2 = A @ (curr_state + half_sub_dt * k1) + b
            k3 = A @ (curr_state + half_sub_dt * k2) + b
            k4 = A @ (curr_state + sub_dt * k3) + b

            curr_state += dt_div_6 * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

        return curr_state

    def step_batch(
        self,
        states: np.ndarray,
        T_amb: float,
        I_solar: float,
        Q_int: np.ndarray,
        Q_hvac_batch: np.ndarray,
        dt: float = 300.0,
    ) -> np.ndarray:
        """Batch RK4 integrator for multiple states simultaneously (e.g. Baseline & RL twins).

        Args:
            states: Array of shape (2N, K)
            T_amb: Ambient outdoor temperature (°C)
            I_solar: Solar irradiance (W/m^2)
            Q_int: Internal gains per zone (W), shape (N,)
            Q_hvac_batch: HVAC thermal power per zone for each twin (W), shape (N, K)
            dt: Macro time step in seconds

        Returns:
            next_states: Array of shape (2N, K)
        """
        n, k = Q_hvac_batch.shape
        b_batch = np.empty((2 * n, k), dtype=np.float64)

        q_solar_wall = self.solar_wall_mult * I_solar
        q_solar_air = self.solar_air_mult * I_solar
        inf_term = T_amb * self.inv_r_inf + q_solar_air + Q_int
        wall_term = (T_amb * self.inv_r_amb + q_solar_wall) * self.inv_c_wall

        for col in range(k):
            b_batch[0::2, col] = self.inv_c_air * (inf_term + Q_hvac_batch[:, col])
            b_batch[1::2, col] = wall_term

        half_dt = 0.5 * dt
        dt_div_6 = dt / 6.0
        A = self.A

        k1 = A @ states + b_batch
        k2 = A @ (states + half_dt * k1) + b_batch
        k3 = A @ (states + half_dt * k2) + b_batch
        k4 = A @ (states + dt * k3) + b_batch

        return states + dt_div_6 * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

    def step_isolated(
        self, state: np.ndarray, dt: Optional[float] = None, sub_steps: Optional[int] = None
    ) -> np.ndarray:
        """Integrates an insulated/isolated system with zero external and HVAC gains."""
        return self.step(
            state=state,
            T_amb=0.0,
            I_solar=0.0,
            Q_int=np.zeros(self.num_zones),
            Q_hvac=np.zeros(self.num_zones),
            dt=dt,
            sub_steps=sub_steps,
        )


ThermalNetwork = MultiZoneThermalModel
