# Spatial Temperature Estimation for DigitalBMS

**Final research report**  
**Author:** Manus AI  
**Date:** 2026-09-11  
**Repository scope:** one floor, three zones, existing per-zone 3R-2C model

## Executive answer

**Yes, DigitalBMS can estimate a temperature field written as T(x, y, z, t), but only as a model-conditioned estimate over a declared spatial resolution and operating envelope.** A few point sensors cannot uniquely observe a continuous three-dimensional field. A detailed heat map is therefore not automatically more truthful than three room values. Every unmeasured pixel or voxel is supplied by assumptions about smoothness, airflow, boundary conditions, or learned correlations. The system must expose those assumptions and an uncertainty or invalid state.

The defensible first product is a **three-room air-temperature estimator**, not a universal indoor temperature camera. Retain one dynamic air state and one effective thermal-mass state per room in the current 3R-2C model. Correct those states with fixed, shielded air sensors through a Kalman-family filter. Add a small number of named local states, such as occupied height, window side, or supply side, only when commissioning measurements show repeatable gradients. Use interpolation for visualization, computational fluid dynamics for offline design, and thermal or RGB cameras primarily for occupancy and context. Do not use an RGB camera to measure temperature. Do not use an inexpensive thermal camera to measure room-air temperature or core body temperature.

The most important metrology rule is that **temperature is not one interchangeable quantity**. A sensor reports the temperature of its own sensing element. Room air temperature, surface temperature, local skin temperature, mean radiant temperature, and operative temperature are distinct measurands with different heat-transfer paths. ISO 7726 treats them separately, and ASHRAE Standard 55 requires air speed and radiant conditions where relevant to comfort assessment.[1] [2]

The current repository is a strong simulation scaffold, but it is not yet a validated spatial estimator. Its six-state model contains three air states and three wall or effective-mass states. It includes outdoor-envelope exchange, an infiltration-equivalent path, solar gain, internal gain, HVAC power, and symmetric inter-zone coupling. It uses a five-minute macro-step and fourth-order Runge-Kutta integration. Those are useful engineering choices. They do not establish field accuracy. The configured air capacitances are about **11 to 12 times the heat capacity of the listed air mass**, so they should be relabeled as effective fast-zone capacitances or reidentified from data. The configuration also contains both infiltration ACH and infiltration resistance, while the thermal solver uses the resistance. These two representations are not exactly consistent in all three zones.

> **Engineering verdict:** build an uncertainty-aware three-zone estimator around the existing 3R-2C core. Do not promise an exact continuous 3-D field. Add spatial detail only where independent withheld sensors show that it improves a decision.

## 1. What temperature is being estimated?

A credible design begins with a measurement identity card for every channel. Generic labels such as temperature or person temperature are not sufficient.

| Quantity | Symbol | Physical meaning | Suitable measurement | What it is not |
|---|---:|---|---|---|
| Room air temperature | T_a | Local dry-bulb temperature of air around the probe | Low-mass RTD, thermistor, or digital IC in a ventilated radiation shield | Wall temperature, occupant exposure, room average, or comfort by itself |
| Surface temperature | T_s | Temperature at a wall, floor, ceiling, object, clothing, or skin surface | Bonded contact probe or calibrated infrared measurement | Adjacent air temperature |
| Local skin temperature | T_skin | Temperature of the viewed or contacted patch of skin | Thin contact patch or controlled infrared view | Core body temperature or whole-body comfort |
| Mean radiant temperature | T_r | Uniform-equivalent temperature of the surrounding radiant field at a location | Globe thermometer with air speed correction, directional radiometry, or a validated surface/view-factor model | One wall temperature or one thermal-camera pixel |
| Operative temperature | T_o | Combined convective and radiant environmental index | Calculation from T_a, T_r, and air speed | A directly sensed universal temperature |
| Sensor-element temperature | T_sensor | Temperature reached by the package and enclosure under convection, radiation, conduction, and self-heating | What every physical temperature sensor actually reports | Automatically equal to any row above |

For low air speed, a common approximation is

```text
T_o approximately equals (h_c T_a + h_r T_r) / (h_c + h_r)

If h_c approximately equals h_r, then T_o approximately equals 0.5 (T_a + T_r).
```

The half-sum is an engineering approximation for still-air conditions. It is not valid evidence that air and radiant temperatures are equal. ASHRAE guidance says mean radiant temperature should be measured unless it has been shown to be within 1 degree Celsius of air temperature. It also places thermal-environment measurements at occupant-relevant heights; seated air measurements commonly use 0.1, 0.6, and 1.1 m, while operative conditions are assessed near 0.6 m.[2]

A body-worn ID-card sensor is a **personal microclimate channel**. Body heat, clothing, sweat, solar exposure, motion, and card position alter it. A field study of off-the-shelf wearable ambient sensors found reliability depended on placement and local microclimate.[6] There is no defensible universal offset from lanyard temperature to free room air. A correction can be fitted only for the actual card, wearer, mounting, clothing, room, and operating conditions, and it must carry uncertainty.

ISO 7726 class-C comfort-environment targets summarized by REHVA are approximately plus or minus 0.3 degrees Celsius plus 0.005 times the absolute air temperature for air measurement, with response within one minute. These are instrument-class requirements, not guarantees for an inexpensive module inside an arbitrary enclosure.[1] A bare thermistor response specification also excludes shield mass, airflow, mounting, firmware filtering, and radiant loading.

## 2. Can T(x, y, z, t) be estimated?

### 2.1 The physically correct answer

A local air-temperature field obeys an energy-transport equation of the general form

```text
rho c_p (partial T / partial t + u dot grad T)
  = div(k_eff grad T) + S_T
```

Here rho is air density, c_p is specific heat, u is the air-velocity field, k_eff includes molecular and turbulence effects, and S_T represents volumetric or coupled sources. Boundary conditions describe supply air, returns, walls, windows, doors, occupants, equipment, and solar effects. Conservation is physically grounded. A computed solution is still conditional on uncertain geometry, flows, turbulence closure, radiation, material properties, and source histories.[11] [12]

A sensor network instead provides finite observations:

```text
y_k = H_k x_k + b_k + v_k
x_(k+1) = f(x_k, u_k, theta) + w_k
```

The vector x may contain room temperatures, mass temperatures, or grid cells. H maps those states to sensor locations. The terms b, v, and w represent bias, measurement noise, and model discrepancy. If two different internal fields produce the same observations, the field is **unobservable** from those sensors. Adding unmeasured voxels usually worsens observability rather than creating information.[16]

Therefore:

1. **At the three-zone level**, T_r(t) can be estimated credibly after calibration because every room can have a direct air measurement.
2. **At selected local points or named subzones**, T(x_i, y_i, z_i, t) can be estimated when spatial pilot data show stable relationships and held-out validation confirms them.
3. **As a continuous 3-D field**, T(x, y, z, t) can be generated by interpolation, CFD, a reduced model, or machine learning. It must be labeled estimated or simulated, never measured.
4. **During new regimes**, such as a newly opened door, direct solar beam, furniture rearrangement, unusual crowding, or changed diffuser flow, uncertainty must increase and the system may need to abstain.

### 2.2 Resolution must follow information

A 10 cm voxel grid across 600 square metres and 3 m height would contain roughly 1.8 million cells. Three room sensors do not support 1.8 million independently meaningful temperatures. A high-resolution renderer can display a smooth prior, but it cannot establish local truth. For the current project, the useful hierarchy is:

| Product level | State representation | Defensible claim |
|---|---|---|
| Level A | Three air states plus three effective mass states | Calibrated room-level dynamic estimate |
| Level B | A few named local states per room | Estimated occupied-zone, window-side, or supply-side condition with validation |
| Level C | Coarse 2-D slice at a declared height | Model-conditioned visualization with confidence mask |
| Level D | Full 3-D CFD or surrogate field | Offline or bounded-envelope simulation, not direct observation |

Room boundaries must be respected. Inverse-distance interpolation must not blend through a wall or closed door merely because two sensors are geometrically close. Door state, openings, and actual inter-room flow must determine coupling.

## 3. Repository-specific audit of the three-zone 3R-2C model

The implementation in `src/simulation/physics/thermal_model.py` uses the state ordering

```text
x = [T_a,lobby, T_m,lobby,
     T_a,open_office, T_m,open_office,
     T_a,conference, T_m,conference]^T
```

The second state is named wall temperature in code, but its fitted interpretation should be broader: it is an **effective thermal-mass temperature** unless wall construction and surface measurements establish otherwise. For zone i, the implemented equations are equivalent to

```text
C_a,i dT_a,i/dt = (T_m,i - T_a,i) / R_w,i
                 + (T_out - T_a,i) / R_inf,i
                 + sum_j (T_a,j - T_a,i) / R_ij
                 + Q_solar,air,i + Q_int,i + Q_HVAC,i

C_m,i dT_m,i/dt = (T_out - T_m,i) / R_amb,i
                 + (T_a,i - T_m,i) / R_w,i
                 + Q_solar,mass,i
```

The system matrix is built once. Solar gain is split between air and mass. Symmetric inter-zone resistance makes pairwise exchange conservative, and repository tests check directionality, stability, and conservation. The solver advances the linear system with fourth-order Runge-Kutta at a default five-minute macro-step.

### 3.1 What the model estimates

The air state is a well-mixed zone value. It is not a pointwise temperature at every location. The mass state aggregates surfaces and contents. The infiltration resistance aggregates outside-to-air heat exchange. The inter-zone resistance aggregates partition conduction and any exchange represented by the model. It does not separately identify doorway advection, leakage, or wall conduction.

The full room-air balance used in building simulation is more explicit:

```text
C_z dT_z/dt = Q_conv,int
              + sum_s h_s A_s (T_s - T_z)
              + sum_j m_dot_(j to z) c_p (T_j - T_z)
              + m_dot_oa c_p (T_out - T_z)
              + Q_system
```

EnergyPlus documents this coupled surface, mixing, infiltration, and system-output structure.[12] The current 3R-2C equations are a valid low-order approximation of it, but the parameters are effective values and require identification.

### 3.2 Quantitative consistency checks

| Zone | Listed air mass times 1006 J per kg-K | Configured C_air | Ratio | Interpretation |
|---|---:|---:|---:|---|
| Lobby | about 0.545 MJ/K | 6.0 MJ/K | 11.0 | Includes effective contents or is mislabeled |
| Open office | about 1.090 MJ/K | 13.0 MJ/K | 11.9 | Includes effective contents or is mislabeled |
| Conference room | about 0.545 MJ/K | 6.0 MJ/K | 11.0 | Includes effective contents or is mislabeled |

This is not necessarily wrong. Effective zone capacitance often exceeds air-only capacitance because furnishings and near-surface mass respond on the control timescale. The current field description, however, calls it indoor air thermal capacitance. That wording is physically misleading. Either rename it to effective fast capacitance or estimate a genuine air node plus a separate mass node.

The configured infiltration resistance implies conductance G_inf = 1 / R_inf. A nominal ACH implies approximately

```text
G_ACH = rho V c_p ACH / 3600
R_ACH = 1 / G_ACH
```

Using the listed volumes, rho near 1.204 kg per cubic metre, and c_p near 1006 J per kg-K gives:

| Zone | Conductance from R_inf | Conductance from listed ACH | Difference |
|---|---:|---:|---:|
| Lobby | 100 W/K | about 91 W/K | close at engineering level |
| Open office | 50 W/K | about 61 W/K | about 18% lower in the solver |
| Conference room | 28.6 W/K | about 15.1 W/K | about 89% higher in the solver |

The solver uses R_inf, not `infiltration_ach`. One representation should be authoritative, or the code should derive one from the other. Otherwise dashboards and equations can disagree. Infiltration also varies with wind, stack effect, leakage, doors, and fan balance; a fixed resistance is a calibration parameter, not a measured airflow.[13]

### 3.3 Recommended model correction

Keep the current six-state structure for the first field deployment, but make four changes.

1. Rename `wall_temp_c` to `effective_mass_temp_c` in the estimator API while retaining a compatibility alias.
2. Store a parameter provenance field with values such as design, prior, fitted, or locked, plus units and confidence bounds.
3. Derive infiltration heat conductance from measured or fitted mass flow, or clearly declare R_inf as the sole thermal parameter and remove ACH from calculations.
4. Add a measurement equation and state covariance rather than replacing simulated state directly with a sensor value.

## 4. Heat, temperature, and source attribution

**Temperature** is a thermodynamic state variable. **Heat** is energy transferred because of a temperature difference. Heat is measured in joules. Heat-transfer rate is measured in watts. A thermal camera maps apparent surface radiance to a surface-temperature estimate; it does not image heat flowing through the room.

For a surface-air path,

```text
Q_dot_conv = h A (T_s - T_a)
```

For a lumped conductive path,

```text
Q_dot_cond = (T_1 - T_2) / R
```

For supply air,

```text
Q_dot_HVAC = m_dot_supply c_p (T_supply - T_zone)
```

For direct outdoor-air sensible exchange,

```text
Q_dot_oa = m_dot_oa c_p (T_out - T_zone)
```

These relations describe rates, not temperatures. The temperature response also depends on capacitance and all simultaneous fluxes. A 1 kW heater will cause a faster rise in a low-capacitance room than in a high-capacitance room.

### 4.1 Can DigitalBMS say what caused a temperature change?

Only conditionally. In a calibrated linear model with measured inputs, contribution states can be propagated separately:

```text
dx_s/dt = A x_s + B_s u_s
x_total = x_initial + sum_s x_s
```

This supports an **accounting attribution** to modeled channels such as outdoor exchange, solar, HVAC, and internal gains. It is exact only for the declared linear model with fixed parameters and known inputs. It is not automatically causal attribution in the real building.

Unknown occupancy heat, plug loads, solar shading, infiltration, and HVAC delivery can produce similar temperature traces. From one room-air sensor, those causes can be structurally confounded. The safe output is therefore:

| Output label | Meaning |
|---|---|
| Measured HVAC contribution | Uses measured supply flow and supply temperature |
| Estimated solar contribution | Uses irradiance, glazing, shading, and calibrated split |
| Estimated inter-zone contribution | Uses calibrated coupling and measured or estimated room states |
| Unmodeled heat residual | Energy-balance mismatch; not automatically occupancy or a fault |
| Suspected cause | Diagnostic hypothesis requiring corroboration |

Prevent double counting. If measured supply air already includes mixed outdoor air, do not add that same outdoor-air load again. Use an energy residual as a health metric:

```text
r_Q = C_a Delta T_a / Delta t - sum of modeled heat-rate terms
```

A persistent residual signals bias, an omitted source, or a wrong parameter. It does not identify which one without an independent signal.

## 5. Comparison of estimation approaches

| Approach | Output | Strength | Main assumption or failure | Recommended role in DigitalBMS |
|---|---|---|---|---|
| Nearest neighbour or inverse-distance weighting | Smooth map from point sensors | Transparent, cheap, deterministic | Smoothness; smears jets and solar plumes; weak extrapolation | Dashboard baseline within each room only |
| Spline or bilinear interpolation | Smooth 2-D or 3-D surface | Visually stable | Geometry-driven, not physics-driven; overshoot possible | Visualization after barrier constraints |
| Kriging or Gaussian process | Mean map plus conditional variance | Learns spatial covariance and reports uncertainty | Kernel and stationarity may fail across HVAC regimes | Compare with IDW by held-out sensors |
| Three-zone RC physics | Dynamic room and mass states | Fast, conservative, interpretable, control-ready | Well-mixed zones and identifiable effective parameters | Runtime core |
| Multi-node or reduced-order model | Selected vertical or local states | Adds decision-relevant detail at low cost | More states can become unobservable | Add only after gradient evidence |
| Full CFD | Velocity and thermal fields | Resolves jets, buoyancy, stratification, doors | Boundary, mesh, turbulence, and validation burden | Offline design and sensor placement |
| POD or CFD-derived surrogate | Fast approximation of CFD outputs | Runtime spatial indicators | Valid only inside snapshot envelope | Optional bounded spatial layer |
| Pure machine learning | Forecast or map | Captures repeatable nonlinear correlations | Domain shift, leakage, poor extrapolation, no conservation guarantee | Benchmark or bounded residual only |
| Physics-informed neural network | Learned prediction with physics loss | Can regularize sparse data | Low loss does not prove identifiability or correct physics | Research track, not first deployment |
| Kalman or ensemble sensor fusion | State estimate plus covariance | Combines dynamics and noisy measurements | Wrong bias or noise model can be confidently wrong | Runtime state correction |
| Hybrid RC plus fusion plus residual ML | State, forecast, uncertainty, bounded correction | Best balance of speed, interpretability, and adaptation | Requires disciplined validation and fallback | Recommended architecture |

Experimental evidence supports the direction but not a universal accuracy number. In cold-logistics datasets, kriging improved RMSE by about 20% over inverse-distance weighting in one set of tests and offered little advantage in another, showing that spatial correlation is regime-dependent.[14] A building sensor-compensation study reported Gaussian-process RMSE of 0.17 to 0.32 degrees Celsius for its office datasets, but that was missing-sensor compensation, not proof of full-field accuracy.[15]

A 2R2C identification study reported 0.3572 degrees Celsius validation RMSE in its active-regime case and about 0.99 degrees Celsius for a simpler passive model with omitted disturbances.[21] A controlled two-room physics-informed model reported 0.25 degrees Celsius temperature MAE.[23] These numbers establish feasibility in those studies. They are not targets guaranteed for this building.

**Recommendation:** compare all advanced methods against persistence, room-center measurement, IDW, and the fixed 3R-2C model. If a more complex method does not improve blocked-time and withheld-location performance with calibrated uncertainty, do not deploy it.


## 6. RGB, thermal, and localization choices

### 6.1 RGB and thermal cameras answer different questions

An RGB camera measures visible-light intensity in colour channels. It is useful for occupancy, person detection, posture, motion, and scene context. It cannot measure temperature. Its main failure modes are darkness, backlight, glare, motion blur, occlusion, changing appearance, model domain shift, and privacy exposure.[7]

A long-wave infrared camera measures received radiance. The signal includes target emission, reflected surroundings, and atmospheric emission:

```text
L_received approximately equals tau [epsilon L_bb(T_surface)
                              + (1 - epsilon) L_reflected]
                              + (1 - tau) L_atmosphere
```

The terms epsilon and tau are emissivity and atmospheric transmittance. The output is an estimate of the **viewed surface temperature** after correction. It is not room-air temperature. Low-emissivity metal and glass can act as thermal mirrors. Clothing reveals its outer-surface temperature, not the covered skin or core body temperature.[8] [9]

| Camera | Representative specification | Credible task | Non-credible inference |
|---|---|---|---|
| Raspberry Pi Camera Module 3 | 4608 by 2592 pixels; standard and wide fields of view | Occupancy, tracking, room and lighting context | Temperature from RGB intensity |
| MLX90640 thermal array | 32 by 24 pixels; 0.5 to 64 Hz options; 55 by 35 or 110 by 75 degree field of view | Presence, direction, coarse zone occupancy at short distance | Fine person separation or clinical temperature |
| FLIR Lepton 3.5 class | 160 by 120; 57 degree horizontal field of view; effective 8.7 Hz export; radiometric model available | Coarse thermal patterns and better person separation | Datasheet NETD as absolute field accuracy |

FLIR specifies Lepton high-gain radiometric accuracy as the greater of plus or minus 5 degrees Celsius or 5% under its stated calibration setup, despite a noise-equivalent temperature difference below 50 mK.[9] **NETD is sensitivity to small contrast, not absolute accuracy.** The MLX90640 has only 768 pixels. Interpolation can make it look smoother but cannot create measured detail.[10]

A controlled thermography study found absolute errors below 0.97 degrees Celsius for two imagers and below 0.12 degrees Celsius with an external reference source over tested ambient and humidity ranges. Broader reported ranges included simulation. The experiment did not validate drafty, sunlit rooms or arbitrary clothing.[5] A purpose-built screening system claiming plus or minus 0.3 degrees Celsius uses a stable reference and controlled conditions; that does not transfer to a bare hobbyist module.

### 6.2 Recommended camera deployment

Use **one paired RGB and thermal station per room as the initial coverage baseline** if visual occupancy is required. Reduce the count only after a site survey proves that one view has adequate pixels per person and no critical occlusion. Use the Lepton class when separation or thermal-pattern detail matters. Use MLX90640 when the task is coarse occupied, empty, or direction at short range. Exact mounting height and lens choice require room geometry.

Calibrate RGB-to-thermal extrinsics and timestamps. Process locally. Store occupancy events or tracks rather than raw RGB wherever feasible. Publish `occupied`, `empty`, `uncertain`, and `invalid` states. Do not enable identity recognition unless it is necessary, legally justified, and independently governed.

Thermal cameras can improve **MRT-related** sensing only through a validated surface or whole-radiant-field method. A 2025 study using a 32 by 32 infrared array reported agreement within plus or minus 0.5 degrees Celsius against a net-radiometer over an MRT range of 18 to 26.8 degrees Celsius in four environments.[27] This is promising method-specific evidence, not a guarantee for a generic thermal occupancy camera.

### 6.3 Three-dimensional person localization

Localization and temperature estimation should be separate services. Person coordinates can select which local estimate applies to an occupant, but a coordinate does not reveal temperature or comfort.

| Modality | Representative evidence | Advantages | Limits | Preferred use |
|---|---|---|---|---|
| RGB-D or stereo | RealSense D455 class: ideal range 0.6 to 6 m and manufacturer depth error below 2% at 4 m | Direct metric depth and person association | Occlusion, stereo texture, reflective or transparent surfaces, privacy | Most direct untagged 3-D route per room |
| UWB tags | DWM3001C claims below 15 cm 2-D and below 30 cm 3-D under product conditions | Metric, privacy-compatible coordinates when tags are accepted | Requires worn tags, anchors, calibration; non-line-of-sight bias | Best robust metric alternative |
| Ultrasound | Published systems report centimetre-to-decimetre errors in specific beacon setups | Low cost, privacy-preserving range cue | Multipath, cross-talk, wide beam, clothing absorption, HVAC effects; no identity | Complementary range or presence only |
| Monocular RGB depth | Model-dependent | Lowest hardware cost | Scale ambiguity and learned domain shift | Coarse tracking with explicit uncertainty |
| LiDAR | Product-class centimetre ranging | Lighting-independent geometry | Cost, sparse returns, glass, weaker identity association | Geometry or high-budget tracking |

Three-dimensional multilateration generally needs at least four well-spread range constraints. One ultrasonic sensor returns a range to an accepted reflector, not a unique body centroid or identity. A six-sensor low-cost experiment reported average errors from 6.08 to 16.39 cm and maximum errors from 16.01 to 29.50 cm, with multi-second recovery under its setup.[30] Those values do not validate untagged, clothed multi-person tracking in these rooms. If continuous coordinates are required, choose RGB-D per room where privacy permits, or UWB with at least four surveyed anchors where tags are acceptable. Use ultrasound only as a redundant cue.

## 7. Thermal comfort is not an air-temperature heat map

Thermal comfort is a subjective response. The DigitalBMS target should ultimately be occupant preference or reported sensation. Air temperature and model indices are control variables, not ground truth.

The predicted mean vote model uses six principal inputs:

```text
PMV = f(T_a, T_r, v_a, humidity, metabolic_rate, clothing_insulation)

PPD = 100 - 95 exp[-0.03353 PMV^4 - 0.2179 PMV^2]
```

PMV predicts a group-average thermal sensation. PPD is derived from PMV and reaches a minimum near 5%, which reflects that a group is not expected to be unanimously satisfied even at modeled neutrality.[25] A commonly used ASHRAE analytical criterion is PMV between -0.5 and +0.5, with PPD below 10%, under the method's applicability limits. Air speed above 0.20 m/s requires elevated-air-speed treatment in the cited ASHRAE material.[2]

For each room, maintain two distinct outputs:

| Output | Inputs | Interpretation |
|---|---|---|
| Environmental state | T_a, T_r, air speed, humidity | Measured or estimated local environment |
| Comfort model | Environment plus clothing and metabolic-rate assumptions | Group or person-specific prediction with quality flag |

Do not compute PMV from the thermostat temperature alone. Do not infer clothing, metabolic rate, or individual preference from occupancy count. A six-month personal-comfort study of 20 people reported median micro-F1 around 0.78 and a learning plateau around 250 to 300 labeled points per participant.[28] That is evidence that voluntary feedback can improve person-specific predictions. It is not universal performance. Begin with explicit clothing and activity presets, then learn a bounded personal bias after enough held-out data. Keep temperature, humidity, ventilation, condensation, and equipment safety constraints independent of comfort optimization.


## 8. Thermodynamic model and heat-transfer equations

The minimum deployable model is a calibrated state-space model per room. For room i, use an air node and an effective-mass node:

```text
C_a,i dT_a,i/dt = G_w,i(T_m,i - T_a,i)
                  + G_oa,i(T_out - T_a,i)
                  + Σ_j G_ij(T_a,j - T_a,i)
                  + Q_solar,a,i + Q_internal,i + Q_HVAC,i

C_m,i dT_m,i/dt = G_w,i(T_a,i - T_m,i)
                  + G_env,i(T_out - T_m,i)
                  + Q_solar,m,i
```

The terms are effective conductances and heat rates, not direct measurements unless the associated airflow, surface, or HVAC instrumentation exists. The physical building model can be refined with:

* **Conduction:** `q_dot = -k A grad(T)` or `Q_dot = (T_1-T_2)/R` for a lumped path.
* **Convection:** `Q_dot_conv = h A (T_surface-T_air)`.
* **Radiation:** `Q_dot_rad = epsilon sigma A (T_surface^4-T_surroundings^4)`; linearized resistance is acceptable over ordinary indoor ranges.
* **Advection:** `rho c_p u dot grad(T)` in the air-energy equation.
* **Ventilation/infiltration:** `Q_dot_oa = m_dot_oa c_p (T_out-T_zone)`.
* **HVAC sensible exchange:** `Q_dot_HVAC = m_dot_supply c_p (T_supply-T_zone)`.

For real-time use, begin with the existing 3R-2C equations and add humidity, supply-air temperature/flow, door state, outdoor temperature, solar irradiance, and occupancy as inputs. A CFD-scale velocity and radiation field is not required for a useful first estimator. Use measured data to identify effective parameters such as capacitances, wall conductances, inter-zone coupling, infiltration, solar split, and HVAC gain.

A person standing at `(x,y,z)` should query a **local-state model** only if the site has demonstrated that the point differs systematically from its room state. Otherwise return the room state plus an uncertainty interval and a location-quality flag. Localization does not create thermal observability.

## 9. CFD, reduced-order models, and spatial fields

CFD can calculate air velocity, temperature, buoyant plumes, supply jets, surface heat transfer, and sometimes comfort indices. It requires a defensible mesh, geometry, material properties, supply and return boundary conditions, wall temperatures or heat-transfer coefficients, solar/internal gains, turbulence treatment, and validation. A three-room transient CFD model is not a sensible continuously running controller on hobbyist hardware.

The practical uses of CFD are:

1. **Offline design:** identify likely stratification, diffuser short-circuiting, sensor placement, and regions where a well-mixed assumption fails.
2. **Snapshot generation:** simulate representative HVAC, occupancy, door, and weather regimes.
3. **Reduced-order extraction:** fit a small multi-node model or a bounded surrogate to those snapshots.
4. **Validation:** compare predicted gradients with temporary sensor arrays and anemometry.

Use a vertical three-node model only when measurements show stratification: lower/occupied/upper air coupled to surface mass. Use a 2-D grid only for a declared height such as 0.6 m seated or 1.1 m standing. A 3-D voxel renderer is a visualization layer, not a measurement layer. Respect walls and closed doors as barriers; never use unconstrained inverse-distance interpolation across them.

Gaussian processes or kriging are valuable baselines because they provide a mean and variance. Their spatial kernel must be conditioned on room boundaries and operating regime. Pure neural maps can look plausible while violating conservation or extrapolating badly after furniture, diffuser, or control changes. Any spatial model must be evaluated by removing known sensors and predicting them as if they were unsensed.

## 10. AI and physics-guided hybrid architecture

The strongest architecture is not a black-box temperature predictor. It is:

```text
Sensors and metadata
  -> timestamp/quality checks and calibration
  -> room/occupancy localization
  -> 3R-2C prediction
  -> Kalman-family correction from physical sensors
  -> bounded spatial interpolation or local reduced-order model
  -> residual ML correction only inside validated envelope
  -> estimate + confidence + abstention state
  -> dashboard, comfort calculation, and control constraints
```

AI has four defensible roles:

| Role | Use | Risk control |
|---|---|---|
| Forecast | Predict near-term room temperature | Compare against persistence and RC baseline |
| Parameter estimation | Fit capacitance, conductance, infiltration, HVAC gain | Bound parameters and re-identify after changes |
| Residual correction | Learn model error from occupancy, solar, and airflow features | Clip correction and monitor drift |
| Sensor fusion | Combine sparse measurements and dynamics | Maintain bias/noise models and covariance |

Physics-informed neural networks and CFD surrogates are research options, not prerequisites. A physics loss cannot repair unobserved states, wrong boundary conditions, or biased sensors. A hybrid model should preserve the physical state as the primary estimate, expose residual magnitude, and abstain when inputs fall outside the commissioning envelope.

Use a Kalman filter, extended/unscented Kalman filter, or ensemble filter for the runtime state estimate. The measurement model should explicitly represent each sensor’s location, bias, lag, and noise. Do not overwrite the simulated state with a single reading; that discards dynamics and can destabilize the estimate.

## 11. Human location and the correct occupant target

A coordinate such as `(2.1, 3.4, 1.2)` can select an occupied-zone estimate, but the physically relevant environmental output is normally a local vector:

```text
{ air_temperature, mean_radiant_temperature, air_speed,
  relative_humidity, height, timestamp, uncertainty }
```

For a person, “temperature experienced” is usually better represented by operative temperature or a comfort index than by air temperature alone. A seated occupant may require measurements near 0.1, 0.6, and 1.1 m to detect vertical discomfort; a standing occupant changes the relevant height. Draft risk depends strongly on local air speed. A sunlit window can make mean radiant temperature high while air temperature remains near the room average.

Return separate fields:

```text
estimated_local_air_temperature_c
estimated_mean_radiant_temperature_c_or_null
operative_temperature_c_or_null
comfort_index_or_null
uncertainty_c
quality = measured | estimated | extrapolated | invalid
```

Never present a comfort prediction as a measured temperature. A thermal image of clothing is not skin temperature, and neither is a proxy for core temperature.

## 12. Calibration, experiment, and ground truth

Deploy temporary reference instruments before claiming spatial accuracy. In each room, use at least four calibrated, low-mass, shielded air-temperature probes: near the occupied zone, supply side, window/exterior-wall side, and return/door side. Add a fifth mobile reference probe for traverses. Log humidity at the same locations, supply-air temperature and flow where possible, outdoor conditions, solar irradiance, HVAC command and actual state, doors/windows, occupancy, camera tracks, and sensor health.

Sample air temperature and humidity at 1 Hz or 0.1 Hz locally, aggregate estimator inputs at 10–60 s, and retain one-minute and five-minute features. Log raw and filtered values, timestamps, calibration version, missingness, and operating regime. Cameras should publish tracks and quality metadata rather than raw imagery when privacy permits.

Run blocked experiments rather than random train/test splits:

1. HVAC off and free drift.
2. HVAC on at steady setpoint.
3. Step changes in setpoint and fan mode.
4. Door opening and window opening.
5. Person entry, exit, stationary occupancy, and movement.
6. One and multiple occupants.
7. Solar and shade changes.
8. Different outdoor temperatures and humidity.
9. Furniture or diffuser configuration changes.

Use leave-one-sensor-out and leave-one-location-out tests. Report MAE, RMSE, bias, 95th-percentile absolute error, maximum error, coverage of prediction intervals, spatial error by zone, temporal error during transients, and failure/abstention rate. MAPE is inappropriate near temperatures close to zero and is not a primary indoor-temperature metric.

A reasonable initial engineering acceptance criterion is **room-level MAE around 0.3–0.5 °C in the commissioned envelope**, with worse performance during transients. A named local point may be acceptable at **about 0.5–1.0 °C** only after held-out validation. Claims of ±0.1 °C for an unsensed point are not credible without exceptional instrumentation and a very stable environment. A system that cannot beat the nearest calibrated reference sensor or persistence baseline should not be made more complex.

## 13. Hardware recommendation

### Simplest useful version

Use one calibrated shielded air-temperature/humidity sensor in each room, one outdoor sensor, HVAC supply/return temperature if accessible, door/window contacts, occupancy from an RGB camera or PIR, and the existing 3R-2C model. Add one temporary multi-sensor kit during commissioning. Do not buy a thermal camera or ultrasonic sensor until a measured use case requires it.

### Recommended practical version

Use two permanent air sensors per room: occupied-zone and a gradient-sensitive location such as window/supply/return side. Add supply-air temperature and, if feasible, airflow or fan state. Use RGB-D per room for metric occupant location where privacy permits. Otherwise use RGB occupancy with coarse zone assignment. Add a small thermal camera only for surface/radiant diagnostics or occupancy, not air temperature.

### Advanced research version

Use four to six reference probes per room during campaigns, calibrated surface/radiant measurements, air-speed sensing, RGB-D or surveyed UWB, supply/return flow, irradiance, and a CFD-derived reduced-order model. Use a radiometric thermal camera only with emissivity, reference-target, and view-factor calibration.

One ultrasonic sensor plus one camera is not a reliable general 3-D tracker. It can provide a useful range cue or detect presence. For untagged metric depth, RGB-D/stereo is simpler. For privacy-compatible metric coordinates, UWB tags and at least four well-surveyed anchors are more defensible. The choice is a localization requirement, not a temperature-measurement requirement.

## 14. Failure modes and uncertainty communication

Increase uncertainty or return `invalid` for direct sunlight, reflective metal/glass, open doors/windows, strong supply jets, rapid HVAC changes, multiple overlapping people, camera occlusion, sensor enclosure heating, sensor drift, unknown plug loads, changed furniture, uncalibrated thermal cameras, missing timestamps, and operation outside the training envelope.

The UI should show the estimate, timestamp, confidence interval, source state, and reason code. Examples include `measured_room_state`, `interpolated_within_room`, `model_extrapolation`, `camera_occluded`, `thermal_camera_surface_only`, and `insufficient_observability`. Never hide uncertainty behind a high-resolution colored heat map.

## 15. Novelty and contribution assessment

The component ideas are established individually: RC building models, thermal comfort indices, occupancy sensing, indoor localization, CFD, sensor fusion, data assimilation, Gaussian-process interpolation, digital twins, and physics-guided learning all have substantial prior art. Combining them in a working three-room system is useful engineering, but it is not by itself proof of scientific novelty.

A potentially interesting contribution would require a precise claim and reproducible evaluation, for example: an uncertainty-aware occupant-location query that combines a calibrated 3R-2C model with withheld-sensor assimilation and demonstrably improves local prediction under HVAC transients, while preserving a safe fallback. The novelty would be in the formulation, data, ablation study, uncertainty calibration, and evidence—not in saying “AI estimates temperature.” Compare against room-average, IDW, Gaussian process, fixed RC, pure ML, and hybrid ablations. Publish the operating envelope and negative results.

## 16. Recommended implementation roadmap

**Phase 1 — Instrumentation and naming.** Add permanent room sensors, outdoor temperature, humidity, door state, HVAC telemetry, sensor IDs, units, calibration metadata, and quality flags. Rename the repository’s effective wall state to effective mass in the estimator-facing model.

**Phase 2 — State estimation.** Add a measurement equation and covariance-aware filter around the existing 3R-2C simulator. Reconcile the duplicate infiltration ACH and resistance representations. Add parameter provenance and bounded online/offline identification.

**Phase 3 — Validation.** Run the withheld-sensor experiments above. Establish room-level error and transient error before adding a spatial heat map. Use the measured gradient to decide whether each room needs a vertical or horizontal submodel.

**Phase 4 — Occupancy and localization.** Add RGB occupancy first. Add RGB-D or UWB only if the product requires a point query rather than room/zone comfort. Keep localization and thermal state as separate services.

**Phase 5 — Spatial query.** Implement room-constrained interpolation or a small local reduced-order model. Return `T_a`, optional `T_r`, operative temperature only when inputs support it, uncertainty, quality, and timestamp.

**Phase 6 — Hybrid learning.** Train a bounded residual model using blocked time splits. Add drift detection, out-of-distribution checks, correction clipping, and automatic fallback to the physics estimator.

**Phase 7 — CFD research.** Use CFD offline for the rooms and HVAC configurations that matter. Convert useful patterns to low-order states or a validated surrogate; do not put continuous CFD in the control loop unless measured compute and validation justify it.

## 17. Final engineering verdict

| Question | Verdict |
|---|---|
| Is this possible? | **Yes, conditionally:** a calibrated room/local estimator can answer a point query with uncertainty. A sparse network cannot directly observe an arbitrary continuous 3-D field. |
| What exactly can be measured? | Sensor-element temperature, local air temperature, selected surface temperatures, humidity, air speed, occupancy, position, and HVAC telemetry—provided the instruments are calibrated and correctly mounted. |
| What must be estimated? | Unsensed air temperature, mean radiant temperature, effective thermal states, airflow effects, parameters, and uncertainty. Comfort is modeled, not directly measured. |
| Is an RGB camera enough? | **For localization/occupancy, often yes. For temperature, no.** RGB intensity is not a thermometer. |
| Do I need ultrasonic/depth sensing? | **Not for temperature estimation.** Use depth or UWB only when a metric occupant coordinate is a product requirement; ultrasound is a supplemental range cue. |
| Do I need a thermal camera? | **No for room-air temperature.** It is optional for surface/radiant diagnostics, occupancy, or research, with emissivity and calibration controls. |
| Can thermodynamics estimate a spatial temperature? | **Yes as a conditional model** at a declared resolution and operating envelope. It does not turn sparse measurements into ground truth everywhere. |
| Can AI improve the estimate? | Yes, especially for parameter fitting, sensor fusion, and bounded residual correction. Keep physics, uncertainty, and fallback behavior. |
| Can HVAC versus outdoor influence be calculated? | Use heat-rate accounting, sensitivities, and counterfactual simulations. Do not report arbitrary percentages of temperature. Clearly label modeled attribution versus causal proof. |
| Realistic accuracy? | Approximately 0.3–0.5 °C room-level in a commissioned envelope; approximately 0.5–1.0 °C for validated local estimates. Expect larger errors during transients and abnormal conditions. These are engineering targets, not guarantees. |
| Simplest build? | Three calibrated room sensors plus outdoor/HVAC telemetry, the existing 3R-2C model, and a Kalman-family filter; use RGB only for occupancy. |
| Advanced research build? | Multi-point campaigns, RGB-D or UWB, radiant/air-speed sensing, CFD-informed reduced-order states, uncertainty-calibrated data assimilation, and bounded residual ML. |
| Interesting contribution? | A reproducible, uncertainty-aware occupant-location estimator validated by withheld sensors and transient experiments, with honest abstention and ablation against simpler baselines. |

**Bottom line:** build “temperature here” as a query over a calibrated thermal state model, not as a promise that a camera sees air temperature. The safest product language is: “estimated local air temperature: 24.7 °C, 95% interval ±0.4 °C, model-conditioned, confidence high,” with a separate comfort result only when radiant temperature, air speed, humidity, clothing, and activity assumptions are available.

## Sources

[1]: https://www.iso.org/standard/14562.html "ISO 7726: Ergonomics of the thermal environment"
[2]: https://www.ashrae.org/technical-resources/bookstore/standard-55-thermal-environmental-conditions-for-human-occupancy "ASHRAE Standard 55"
[3]: https://www.ashrae.org/technical-resources/ashrae-handbook "ASHRAE Handbook"
[4]: https://www.nist.gov/pml/owm/thermometry "NIST thermometry resources"
[5]: https://doi.org/10.3390/s22062239 "Infrared thermography accuracy study"
[6]: https://doi.org/10.3390/s20164489 "Wearable ambient sensing study"
[7]: https://www.raspberrypi.com/products/camera-module-3/ "Raspberry Pi Camera Module 3 specifications"
[8]: https://www.flir.com/discover/industrial/thermography-basics/ "FLIR thermography basics"
[9]: https://www.flir.com/products/lepton/ "FLIR Lepton specifications"
[10]: https://www.melexis.com/en/product/MLX90640/Far-Infrared-Thermal-Sensor-Array "MLX90640 official specifications"
[11]: https://www.nist.gov/publications/energyplus-engine-program-overview "EnergyPlus engineering program overview"
[12]: https://bigladdersoftware.com/epx/docs/24-1/engineering-reference/inside-heat-balance.html "EnergyPlus engineering reference"
[13]: https://www.ashrae.org/technical-resources/ashrae-handbook "ASHRAE air infiltration and heat-balance guidance"
[14]: https://doi.org/10.1016/j.buildenv.2020.106691 "Spatial indoor temperature estimation literature"
[15]: https://doi.org/10.1016/j.enbuild.2021.111389 "Gaussian-process sensor compensation in buildings"
[16]: https://www.control.utoronto.ca/Downloads/ISL/Observability.pdf "State observability reference"
[17]: https://doi.org/10.1016/j.enbuild.2019.109490 "Data-driven building thermal modeling review"
[18]: https://doi.org/10.1016/j.apenergy.2020.114465 "Physics-informed building modeling review"
[19]: https://www.nrel.gov/docs/fy18osti/70412.pdf "Reduced-order building modeling context"
[20]: https://www.energy.gov/eere/buildings/building-energy-modeling "U.S. DOE building energy modeling resources"
[21]: https://doi.org/10.1016/j.enbuild.2022.112330 "RC model identification and validation example"
[22]: https://doi.org/10.1016/j.buildenv.2021.108132 "CFD and reduced-order indoor airflow modeling"
[23]: https://doi.org/10.1016/j.enbuild.2023.113271 "Physics-informed building temperature prediction example"
[24]: https://www.ashrae.org/technical-resources/ashrae-handbook "ASHRAE thermal comfort resources"
[25]: https://www.ashrae.org/file%20library/technical%20resources/standards%20and%20guidelines/standards%20addenda/55_2017_a_20200731.pdf "ASHRAE comfort calculation guidance"
[26]: https://www.iso.org/standard/39155.html "ISO 7730 thermal comfort"
[27]: https://doi.org/10.1016/j.buildenv.2025.112345 "Infrared-array mean radiant temperature method"
[28]: https://doi.org/10.1016/j.buildenv.2022.109054 "Personal thermal comfort learning study"
[29]: https://www.intelrealsense.com/depth-camera-d455/ "Intel RealSense D455 specifications"
[30]: https://doi.org/10.3390/s21186365 "Multi-sensor ultrasonic localization experiment"
[31]: https://www.qorvo.com/products/p/DWM3001C "Qorvo DWM3001C UWB specifications"
[32]: https://www.energy.gov/eere/buildings/articles/advanced-building-construction "Building digital-twin and controls context"
