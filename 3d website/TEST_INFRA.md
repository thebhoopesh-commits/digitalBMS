# E2E Test Infra: 3D Corporate Office Web Application

## Test Philosophy
- Opaque-box, requirement-driven. Derived from `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing.
- Execution Harness: Playwright / Headless Browser test runner interacting via DOM events and `window.__OFFICE_DEBUG__` automation contract.

## Feature Inventory & Test Mapping
| # | Feature | Requirement | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Scenario) |
|---|---------|-------------|:----------------:|:-----------------:|:-----------------:|:-----------------:|
| 1 | Multi-Zone Floorplan Rendering | R1 | 5 | 5 | ✓ | ✓ |
| 2 | Procedural PBR Asset Materials | R1 | 5 | 5 | ✓ | ✓ |
| 3 | Atmospheric Lighting Presets | R1 | 5 | 5 | ✓ | ✓ |
| 4 | First-Person Controller | R2 | 5 | 5 | ✓ | ✓ |
| 5 | Sliding AABB Collision Engine | R2 | 5 | 5 | ✓ | ✓ |
| 6 | Orbit Overview Mode | R2 | 5 | 5 | ✓ | ✓ |
| 7 | Smooth Camera Transitions | R2 | 5 | 5 | ✓ | ✓ |
| 8 | Raycasting Hotspots & Hover | R3 | 5 | 5 | ✓ | ✓ |
| 9 | Dynamic Canvas Screen Displays | R3 | 5 | 5 | ✓ | ✓ |
| 10 | Interactive Office Objects | R3 | 5 | 5 | ✓ | ✓ |
| 11 | Procedural Web Audio Engine | R3 | 5 | 5 | ✓ | ✓ |
| 12 | 2D Dynamic Minimap & FOV | R4 | 5 | 5 | ✓ | ✓ |
| 13 | Quick-Teleport System | R4 | 5 | 5 | ✓ | ✓ |
| 14 | Settings & Quality Controls | R4 | 5 | 5 | ✓ | ✓ |
| 15 | Controls & Help Overlay | R4 | 5 | 5 | ✓ | ✓ |
| 16 | 60 FPS Performance Target | R5 | 5 | 5 | ✓ | ✓ |
| 17 | Standalone Local Execution | R5 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Test Runner**: Playwright / Node.js test runner with headless Chromium WebGL hardware acceleration (`--use-gl=angle` / `--use-gl=swiftshader`).
- **Test Case Format**: TypeScript / JavaScript test specs executing in parallel or sequence, asserting visual elements, DOM state, WebGL render metrics, player coordinates, and collision responses.
- **Directory Layout**:
  - `tests/e2e/tier1-feature.spec.ts`: Feature unit smoke tests verifying each individual module and component.
  - `tests/e2e/tier2-boundary.spec.ts`: Boundary value analysis (extreme coords, obstacle boundaries, pitch limits, rapid inputs).
  - `tests/e2e/tier3-combination.spec.ts`: Cross-feature pairwise interactions (sprint + collision, teleport + lighting switch, modal + pointer lock release).
  - `tests/e2e/tier4-scenario.spec.ts`: Real-world end-user workflow journeys, grand tour across all 4 zones, and 60 FPS soak test.

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (17 features × 5 = 85 test assertions).
- **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (17 features × 5 = 85 boundary assertions).
- **Tier 3 (Cross-Feature Combinations)**: ≥17 cross-feature interaction scenarios.
- **Tier 4 (Real-World Application Scenarios)**: ≥9 realistic multi-zone exploration and performance soak scenarios.
- **Total Minimum Target**: ~196 test assertions across 4 tiers.
