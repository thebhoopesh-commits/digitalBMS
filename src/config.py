"""
Central Configuration and Parameters for Digital Twin HVAC Optimizer.
Defines Building, Zone, Simulation, and Weather configurations.
"""

from enum import Enum
from typing import Dict, List, Optional
import numpy as np
from pydantic import BaseModel, Field, ConfigDict


class WeatherPreset(str, Enum):
    """Standardized simulation weather presets."""
    SUMMER_HOT = "SummerHot"
    WINTER_COLD = "WinterCold"
    MILD_SPRING = "MildSpring"
    HEATWAVE_STRESS = "HeatwaveStress"
    STORM_FRONT = "StormFront"


class ZoneConfig(BaseModel):
    """Physical and operational configuration parameters for a single building zone."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    zone_id: str = Field(description="Unique zone identifier ('lobby', 'open_office', 'conference_room')")
    name: str = Field(description="Human-readable zone name")
    floor_area_m2: float = Field(gt=0, description="Floor area in square meters")
    ceiling_height_m: float = Field(default=3.0, gt=0, description="Ceiling height in meters")
    volume_m3: float = Field(gt=0, description="Zone air volume in cubic meters")
    air_mass_kg: float = Field(gt=0, description="Mass of indoor air in kilograms")
    
    # 3R2C Thermal Parameters
    air_heat_capacity_j_k: float = Field(gt=0, description="Indoor air thermal capacitance C_z (J/K)")
    wall_heat_capacity_j_k: float = Field(gt=0, description="Envelope wall thermal capacitance C_w (J/K)")
    wall_resistance_k_w: float = Field(gt=0, description="Internal wall-air convective resistance R_w (K/W)")
    envelope_resistance_k_w: float = Field(gt=0, description="Outdoor envelope conductive resistance R_amb (K/W)")
    infiltration_resistance_k_w: float = Field(gt=0, description="Direct infiltration/glazing resistance R_inf (K/W)")
    infiltration_ach: float = Field(default=0.3, ge=0, description="Air changes per hour (ACH)")
    
    # Solar Characteristics
    window_area_m2: float = Field(ge=0, description="Window glazing surface area (m^2)")
    shgc: float = Field(default=0.40, ge=0, le=1.0, description="Solar Heat Gain Coefficient (SHGC)")
    orientation_factor: float = Field(default=1.0, ge=0, description="Facade solar exposure multiplier")
    wall_solar_absorption_frac: float = Field(default=0.60, ge=0, le=1.0, description="Fraction of solar gain absorbed by wall mass")
    
    # Occupancy & Internal Loads
    max_occupancy: int = Field(ge=0, description="Maximum occupant design capacity")
    base_equip_power_w: float = Field(default=1000.0, ge=0, description="Nominal daytime plug equipment load (W)")
    standby_equip_power_w: float = Field(default=200.0, ge=0, description="Unoccupied baseline equipment load (W)")
    
    # HVAC Capacity & Control
    nominal_setpoint_c: float = Field(default=22.0, description="Nominal comfort target setpoint in Celsius")
    heating_setpoint_c: float = Field(default=20.0, description="ASHRAE 90.1 lower heating deadband bound in Celsius")
    cooling_setpoint_c: float = Field(default=24.0, description="ASHRAE 90.1 upper cooling deadband bound in Celsius")
    max_heating_power_w: float = Field(default=25000.0, gt=0, description="Maximum heating thermal capacity in Watts")
    max_cooling_power_w: float = Field(default=30000.0, gt=0, description="Maximum cooling thermal capacity in Watts")
    kp_heating_w_k: float = Field(default=5000.0, gt=0, description="Proportional gain for heating control (W/K)")
    kp_cooling_w_k: float = Field(default=6000.0, gt=0, description="Proportional gain for cooling control (W/K)")
    
    # Fan & Auxiliary Electrical Loads
    fan_max_power_w: float = Field(default=500.0, ge=0, description="Maximum supply fan electrical power (W)")
    fan_standby_power_w: float = Field(default=50.0, ge=0, description="Standby idle fan electrical power (W)")

    # Property aliases for mathematical convenience
    @property
    def c_air(self) -> float:
        return self.air_heat_capacity_j_k

    @property
    def c_wall(self) -> float:
        return self.wall_heat_capacity_j_k

    @property
    def r_w(self) -> float:
        return self.wall_resistance_k_w

    @property
    def r_amb(self) -> float:
        return self.envelope_resistance_k_w

    @property
    def r_out(self) -> float:
        return self.envelope_resistance_k_w

    @property
    def r_inf(self) -> float:
        return self.infiltration_resistance_k_w


class BuildingConfig(BaseModel):
    """Multi-zone commercial building architecture configuration."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str = Field(default="Commercial 3-Zone Facility", description="Building facility title")
    total_floor_area_m2: float = Field(default=600.0, gt=0, description="Total building area")
    zones: Dict[str, ZoneConfig] = Field(default_factory=dict, description="Dictionary of zone configurations")
    inter_zone_r_matrix: List[List[float]] = Field(
        default_factory=lambda: [
            [0.0, 0.0250, 0.0600],
            [0.0250, 0.0, 0.0350],
            [0.0600, 0.0350, 0.0]
        ],
        description="Symmetric partition resistance matrix R_ij (K/W)"
    )

    def __init__(self, **data):
        super().__init__(**data)
        if not self.zones:
            self.zones = self._create_default_zones()

    @staticmethod
    def _create_default_zones() -> Dict[str, ZoneConfig]:
        """Creates standard calibrated 3-zone parameters per ASHRAE 90.1 standard."""
        lobby = ZoneConfig(
            zone_id="lobby",
            name="Main Entrance & Lobby",
            floor_area_m2=150.0,
            ceiling_height_m=3.0,
            volume_m3=450.0,
            air_mass_kg=541.8,
            air_heat_capacity_j_k=6.0e6,
            wall_heat_capacity_j_k=6.0e6,
            wall_resistance_k_w=0.0050,
            envelope_resistance_k_w=0.0120,
            infiltration_resistance_k_w=0.0100,
            infiltration_ach=0.60,
            window_area_m2=40.0,
            shgc=0.45,
            orientation_factor=1.00,
            wall_solar_absorption_frac=0.60,
            max_occupancy=15,
            base_equip_power_w=1500.0,
            standby_equip_power_w=200.0,
            nominal_setpoint_c=22.0,
            heating_setpoint_c=20.0,
            cooling_setpoint_c=24.0,
            max_heating_power_w=25000.0,
            max_cooling_power_w=30000.0,
            kp_heating_w_k=25000.0,
            kp_cooling_w_k=30000.0,
            fan_max_power_w=500.0,
            fan_standby_power_w=50.0
        )

        open_office = ZoneConfig(
            zone_id="open_office",
            name="Open Plan Office Space",
            floor_area_m2=300.0,
            ceiling_height_m=3.0,
            volume_m3=900.0,
            air_mass_kg=1083.6,
            air_heat_capacity_j_k=1.3e7,
            wall_heat_capacity_j_k=1.5e7,
            wall_resistance_k_w=0.0030,
            envelope_resistance_k_w=0.0080,
            infiltration_resistance_k_w=0.0200,
            infiltration_ach=0.20,
            window_area_m2=60.0,
            shgc=0.35,
            orientation_factor=0.75,
            wall_solar_absorption_frac=0.60,
            max_occupancy=35,
            base_equip_power_w=4500.0,
            standby_equip_power_w=500.0,
            nominal_setpoint_c=22.0,
            heating_setpoint_c=20.0,
            cooling_setpoint_c=24.0,
            max_heating_power_w=35000.0,
            max_cooling_power_w=40000.0,
            kp_heating_w_k=35000.0,
            kp_cooling_w_k=40000.0,
            fan_max_power_w=1000.0,
            fan_standby_power_w=50.0
        )

        conference_room = ZoneConfig(
            zone_id="conference_room",
            name="Executive Conference Room",
            floor_area_m2=150.0,
            ceiling_height_m=3.0,
            volume_m3=450.0,
            air_mass_kg=541.8,
            air_heat_capacity_j_k=6.0e6,
            wall_heat_capacity_j_k=8.0e6,
            wall_resistance_k_w=0.0060,
            envelope_resistance_k_w=0.0150,
            infiltration_resistance_k_w=0.0350,
            infiltration_ach=0.10,
            window_area_m2=20.0,
            shgc=0.30,
            orientation_factor=0.25,
            wall_solar_absorption_frac=0.60,
            max_occupancy=20,
            base_equip_power_w=1000.0,
            standby_equip_power_w=100.0,
            nominal_setpoint_c=22.0,
            heating_setpoint_c=20.0,
            cooling_setpoint_c=24.0,
            max_heating_power_w=20000.0,
            max_cooling_power_w=25000.0,
            kp_heating_w_k=20000.0,
            kp_cooling_w_k=25000.0,
            fan_max_power_w=500.0,
            fan_standby_power_w=50.0
        )

        return {
            "lobby": lobby,
            "open_office": open_office,
            "conference_room": conference_room
        }

    @property
    def inter_zone_r(self) -> np.ndarray:
        """Returns the numpy array representation of the inter-zone resistance matrix."""
        return np.array(self.inter_zone_r_matrix, dtype=np.float64)

    def get_symmetric_2zone_config(self) -> "BuildingConfig":
        """Creates a perfectly symmetric 2-zone building configuration for reciprocal symmetry tests."""
        z1 = ZoneConfig(
            zone_id="zone_1",
            name="Symmetric Zone 1",
            floor_area_m2=150.0,
            ceiling_height_m=3.0,
            volume_m3=450.0,
            air_mass_kg=540.0,
            air_heat_capacity_j_k=6.0e5,
            wall_heat_capacity_j_k=6.0e6,
            wall_resistance_k_w=0.0050,
            envelope_resistance_k_w=1.0e9,  # Adiabatic boundary
            infiltration_resistance_k_w=1.0e9,  # Adiabatic boundary
            infiltration_ach=0.0,
            window_area_m2=0.0,
            shgc=0.0,
            orientation_factor=0.0,
            max_occupancy=0,
            nominal_setpoint_c=20.0
        )
        z2 = ZoneConfig(
            zone_id="zone_2",
            name="Symmetric Zone 2",
            floor_area_m2=150.0,
            ceiling_height_m=3.0,
            volume_m3=450.0,
            air_mass_kg=540.0,
            air_heat_capacity_j_k=6.0e5,
            wall_heat_capacity_j_k=6.0e6,
            wall_resistance_k_w=0.0050,
            envelope_resistance_k_w=1.0e9,
            infiltration_resistance_k_w=1.0e9,
            infiltration_ach=0.0,
            window_area_m2=0.0,
            shgc=0.0,
            orientation_factor=0.0,
            max_occupancy=0,
            nominal_setpoint_c=20.0
        )
        return BuildingConfig(
            name="Symmetric 2-Zone Facility",
            total_floor_area_m2=300.0,
            zones={"zone_1": z1, "zone_2": z2},
            inter_zone_r_matrix=[
                [0.0, 0.0200],
                [0.0200, 0.0]
            ]
        )


class SimulationConfig(BaseModel):
    """Simulation time-stepping, solver stability, and telemetry parameters."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    dt_step_seconds: float = Field(default=300.0, gt=0, description="Macro simulation step in seconds (5 minutes)")
    dt_sub_seconds: float = Field(default=150.0, gt=0, description="Inner RK4 sub-step in seconds (150 seconds, 29.7x CFL safety margin)")
    episode_length_steps: int = Field(default=288, gt=0, description="Steps per episode (288 steps = 24 hours)")
    telemetry_buffer_capacity: int = Field(default=1000, gt=0, description="Circular buffer size for state telemetry")

    # Thermodynamic COP coefficients
    cop_cooling_rated: float = Field(default=3.6, gt=0, description="Rated cooling COP at 35°C ambient")
    cop_cooling_temp_coeff: float = Field(default=0.018, description="Cooling COP degradation per °C ambient lift")
    cop_heating_rated: float = Field(default=4.0, gt=0, description="Rated heating COP at 7°C ambient")
    cop_heating_temp_coeff: float = Field(default=0.022, description="Heating COP degradation per °C ambient drop")
    
    # Sensible Heat Ratio for cooling coils
    sensible_heat_ratio: float = Field(default=0.80, ge=0.5, le=1.0, description="Cooling sensible heat ratio (SHR)")
    latent_heat_vaporization_j_kg: float = Field(default=2.45e6, gt=0, description="Latent heat of vaporization of water (J/kg)")
    atmospheric_pressure_pa: float = Field(default=101325.0, gt=0, description="Standard atmospheric pressure in Pascals")

    # Property alias
    @property
    def dt_step(self) -> float:
        return self.dt_step_seconds

    @property
    def dt_sub(self) -> float:
        return self.dt_sub_seconds
