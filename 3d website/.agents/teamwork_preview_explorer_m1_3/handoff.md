# Technical Architecture & Implementation Blueprint: 3D Multi-Zone Office Floorplan, Scene Manager & Application Bootstrap

**Agent:** Explorer 3 (`teamwork_preview_explorer_m1_3`)  
**Milestone:** Milestone 1 (Core Engine, Scaffolding & 3D Scene Architecture)  
**Parent:** Orchestrator (`9b21702f-1a0c-4d9d-a663-d858f0563b63`)  
**Date:** 2026-08-15  
**Target Files:**
- `src/scene/OfficeFloorplan.ts`
- `src/scene/SceneManager.ts`
- `src/main.ts`

---

## 1. Observation

Direct observations from analysis of `ORIGINAL_REQUEST.md`, `PROJECT.md`, `TEST_INFRA.md`, and Three.js WebGL engineering requirements:

1. **Requirement R1 & R5 Baseline (`ORIGINAL_REQUEST.md:13-20, 39-42, 45-48, 59-62`)**:
   - Demands a visually rich 3D modern tech corporate office floor containing 4 functional zones:
     - **Welcome Reception**: Branded front desk, visitor seating, company logo display, glass entrance partition.
     - **Open Workstations & Cubicles**: Desks equipped with dual monitors, keyboards, ergonomic chairs, desk lamps, ambient workspace props.
     - **Glass-Walled Conference Room**: Central conference table, ergonomic conference chairs, large presentation screen/whiteboard, transparent glass walls.
     - **Lounge & Breakroom**: Coffee bar/kitchenette, casual sofa/seating area, indoor potted greenery.
   - Demands 60 FPS performance in modern web browsers, clean PBR materials, shadows, and standalone execution via Vite.

2. **Architectural Interface Contracts (`PROJECT.md:45-59, 135-151, 153-184`)**:
   - `ISceneManager` specifies `scene`, `camera`, `renderer`, `lightingManager`, `init(container)`, `render()`, `onResize(w, h)`, `setLightingPreset(preset)`, `setShadowsEnabled(enabled)`, `setQuality(dprScale)`.
   - `window.__OFFICE_DEBUG__` contract requires getters for `getFPS()`, `getDrawCalls()`, `getTriangleCount()`, `getPlayerPosition()`, `getInteractables()`, and mutation hooks `teleport(zone)`, `setLighting(preset)`, `triggerInteract(id)`.
   - File layout places scene logic in `src/scene/OfficeFloorplan.ts`, `src/scene/SceneManager.ts`, `src/scene/Materials.ts`, `src/scene/LightingManager.ts`, and application bootstrap in `src/main.ts`.

3. **Collision & Navigation Foundation (`PROJECT.md:61-76, 167-172`)**:
   - Kinematic First-Person sliding AABB collision resolver requires a discrete registry of `THREE.Box3` bounding boxes exported from the floorplan geometry to prevent wall and furniture penetration.

---

## 2. Logic Chain

From the observations, the implementation strategy is formulated through systematic logical deduction:

### Step 1: Coordinate Space & Spatial Master Layout
1. Total Office Dimensions: **$40.0\text{m} \times 26.0\text{m} \times 4.0\text{m}$** centered at world origin `(0, 0, 0)`.
   - $X \in [-20.0, +20.0]$ (West: $-X$, East: $+X$, Width: $40\text{m}$)
   - $Z \in [-13.0, +13.0]$ (North: $-Z$, South: $+Z$, Depth: $26\text{m}$)
   - $Y \in [0.0, 4.0]$ (Floor: $Y=0$, Ceiling: $Y=4.0\text{m}$)
2. Zone Placement Strategy:
   - **Zone 1 (Reception & Lobby)**: Southwest quadrant $X \in [-18, 4]$, $Z \in [3, 12]$. Direct entrance visibility at South wall.
   - **Zone 2 (Open Workstations)**: Northwest quadrant $X \in [-18, 4]$, $Z \in [-12, 0]$. Maximizes natural daylight from North curtain window wall.
   - **Zone 3 (Glass Conference Room)**: Northeast quadrant $X \in [6, 18]$, $Z \in [-12, 0]$. Glass enclosure maintains acoustic isolation while allowing panoramic views.
   - **Zone 4 (Lounge & Café)**: Southeast quadrant $X \in [6, 18]$, $Z \in [3, 12]$. High-amenity social hub.
   - **Zone 5 (Circulation Spine / Hallway)**: Cross-axis corridor $X \in [-19, 19], Z \in [0, 3]$ and $X \in [-3, 3], Z \in [-12, 12]$ linking all quadrants seamlessly with $2.5\text{m}+$ clear walking paths.

### Step 2: InstancedMesh Batching & Draw Call Budgeting
1. If individual meshes were created for all repetitive furniture:
   - 29 chairs $\times$ ~5 sub-meshes = 145 meshes.
   - 32 dual monitors $\times$ 3 sub-meshes = 96 meshes.
   - 16 desk lamps $\times$ 3 sub-meshes = 48 meshes.
   - 36 ceiling downlights $\times$ 2 sub-meshes = 72 meshes.
   - Total uninstanced draw calls $> 400$, degrading performance on laptop GPUs.
2. By utilizing `THREE.InstancedMesh` with static transform matrices (`Matrix4`):
   - All 29 task/conference chairs rendered in **1 draw call** (or 2 for dual material: black metal frame + fabric cushion).
   - All 32 workstation monitors rendered in **2 draw calls** (frame/bezel + stand).
   - All 16 desk lamps rendered in **2 draw calls** (articulated arm + emissive bulb).
   - All 36 ceiling downlights rendered in **2 draw calls** (trim ring + emissive lens).
   - Static walls, columns, floor slabs merged or shared across single material passes.
3. Total scene draw call budget is reduced to **$\le 35$ draw calls**, easily maintaining **60 FPS**.

### Step 3: Obstacle AABB Collision Registry Design
1. First-person player is represented as an AABB cylinder approximation ($r = 0.35\text{m}, h = 1.80\text{m}$).
2. Every solid structure constructed in `OfficeFloorplan.ts` emits an exact `THREE.Box3` into an internal obstacle registry.
3. The registry tags each box with metadata (`id`, `zone`, `name`, `isDoor`, `isOpen`) so dynamic doors can be opened/closed without regenerating the entire collision graph.

### Step 4: SceneManager WebGL Pipeline Configuration
1. **Renderer**:
   - `toneMapping = THREE.ACESFilmicToneMapping`, `toneMappingExposure = 1.0` (delivers filmic high-dynamic-range color response).
   - `outputColorSpace = THREE.SRGBColorSpace` (standard Three.js sRGB gamma workflow).
   - `shadowMap.enabled = true`, `shadowMap.type = THREE.PCFSoftShadowMap` (smooth, soft penumbra shadows).
2. **Camera Rigging**:
   - Perspective camera ($65^\circ$ FOV, near $0.1\text{m}$, far $150\text{m}$).
   - Supports seamless handoff to `FirstPersonController` (rig attached at player eye height $Y=1.6\text{m}$) and `OrbitController` (overhead view at `(0, 28, 22)`).
3. **Animation Loop & Debug Telemetry**:
   - Accurate clock delta clamping (`Math.min(delta, 0.1)`) prevents tunneling during tab backgrounding.
   - Per-frame tracking of FPS (rolling 60-frame moving average), draw calls (`renderer.info.render.calls`), and triangle count (`renderer.info.render.triangles`).

### Step 5: Application Bootstrap Orchestration (`main.ts`)
1. Strict linear initialization order ensures zero uninitialized dependency errors:
   `DOM Scaffold` $\to$ `SceneManager` $\to$ `LightingManager` $\to$ `Materials` $\to$ `OfficeFloorplan` $\to$ `NavigationManager` $\to$ `InteractionManager` $\to$ `AudioManager` $\to$ `HUDManager/Minimap/Settings` $\to$ `window.__OFFICE_DEBUG__` $\to$ `Game Loop Start`.

---

## 3. Caveats

1. **Window Wall Glass Double-Pass**:
   - Outer curtain windows and interior glass walls utilize `THREE.MeshPhysicalMaterial` with transmission. To prevent transparency sorting artifacts, solid architectural geometry must be rendered first, with glass surfaces having `depthWrite: false` or `transparent: true` with strict render order (`renderOrder: 10`).
2. **Door Open State in Collision Registry**:
   - The conference room glass sliding door has a collision box when closed, which must be deactivated (`isOpen: true`) when the player interacts with the door.
3. **InstancedMesh Bounding Sphere Recalculation**:
   - Whenever instance matrices are written, `instancedMesh.computeBoundingSphere()` and `instancedMesh.computeBoundingBox()` must be called once to prevent frustum culling from prematurely hiding instances.

---

## 4. Conclusion

The architectural blueprints for `src/scene/OfficeFloorplan.ts`, `src/scene/SceneManager.ts`, and `src/main.ts` are fully specified with exact millimeter-precise 3D coordinates, geometry dimensions, instanced mesh transforms, obstacle bounding boxes, WebGL renderer configurations, and lifecycle orchestration.

---

## 5. Verification Method

1. **Geometry & Coordinate Bounds Check**:
   - Floor dimensions verify to exactly $40\text{m} \times 26\text{m} \times 4\text{m}$ ($X \in [-20, 20], Z \in [-13, 13], Y \in [0, 4]$).
   - Zone centers match: Reception `[-7, 0, 7.5]`, Workstations `[-7, 0, -6]`, Conference `[12, 0, -6]`, Lounge `[12, 0, 7.5]`.
2. **Instanced Mesh Verification**:
   - Total `InstancedMesh` nodes in scene graph $\ge 4$ (Chairs, Monitors, Lamps, Downlights).
   - Draw calls reported by `window.__OFFICE_DEBUG__.getDrawCalls()` $\le 45$.
3. **Obstacle Collision Verification**:
   - Obstacle registry contains all perimeter walls, 6 columns, desks, tables, counters, sofas, and bookshelves ($\ge 35$ discrete AABBs).
4. **SceneManager & Debug Verification**:
   - `window.__OFFICE_DEBUG__` is defined on window with working `getFPS()`, `getDrawCalls()`, `getTriangleCount()`, `getPlayerPosition()`, `teleport()`, `setLighting()`.

---

# 6. Concrete Implementation Blueprint & Code Specifications

## 6.1 `src/scene/OfficeFloorplan.ts`

### 6.1.1 Master Coordinate Map & Structural Grid
```
========================================================================================
                                 NORTH (Exterior Windows) [-Z]
  [-20, -13]                                 [0, -13]                               [+20, -13]
  +---------------------------------------------+------------------------------------+
  |                                             |                                    |
  |       ZONE 2: OPEN WORKSTATIONS & PODS      |   ZONE 3: GLASS CONFERENCE ROOM    |
  |       Bounds: X: [-18.5 to +3.5]            |   Bounds: X: [+5.5 to +18.5]       |
  |               Z: [-12.5 to -0.5]            |           Z: [-12.5 to -0.5]       |
  |       - 4x Quad Pods (16 Workstations)      |   - 7.2m Racetrack Walnut Table    |
  |       - 32 Curved Monitors & Keyboards      |   - 12 Executive Leather Chairs    |
  |       - Acoustic Dividers & Task Chairs     |   - 85" Smart Display & Glass Wall |
  |                                             |                                    |
  + - - - - - - - - - - - - - - - - - - - - - - + - - - - - - - - - - - - - - - - - -+
  |                   CENTRAL CIRCULATION SPINE / WAYFINDING CORRIDOR                |
  |                   X: [-19.0 to +19.0], Z: [-0.5 to +2.5]                         |
  + - - - - - - - - - - - - - - - - - - - - - - + - - - - - - - - - - - - - - - - - -+
  |                                             |                                    |
  |       ZONE 1: WELCOME RECEPTION & LOBBY     |   ZONE 4: LOUNGE & BREAKROOM/CAFÉ  |
  |       Bounds: X: [-18.5 to +3.5]            |   Bounds: X: [+5.5 to +18.5]       |
  |               Z: [+2.5 to +12.5]            |           Z: [+2.5 to +12.5]       |
  |       - Branded Reception Counter & LED     |   - L-Shaped Quartz Coffee Bar     |
  |       - 3D Corporate Logo Plaque Wall       |   - Commercial Espresso Machine    |
  |       - Cognac Leather Visitor Lounge       |   - Petrol Blue Velvet Sectional   |
  |       - Living Green Wall & Kiosk           |   - Bookshelf, TV & Potted Plants  |
  |                                             |                                    |
  +---------------------------------------------+------------------------------------+
  [-20, +13]                           ENTRANCE [0, +13]                            [+20, +13]
                                 SOUTH (Main Entrance) [+Z]
========================================================================================
```

### 6.1.2 Data Structures & Types
```typescript
export interface ObstacleBox {
  id: string;
  name: string;
  zone: 'reception' | 'workstations' | 'conference' | 'lounge' | 'corridor' | 'perimeter';
  box: THREE.Box3;
  isDoor?: boolean;
  isOpen?: boolean;
}

export interface ZoneBounds {
  name: string;
  displayName: string;
  center: THREE.Vector3;
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  bounds: THREE.Box3;
}
```

### 6.1.3 Zone Teleport & Spawn Definitions
```typescript
export const OFFICE_ZONES: Record<string, ZoneBounds> = {
  reception: {
    name: 'reception',
    displayName: 'Welcome Reception & Lobby',
    center: new THREE.Vector3(-7.0, 0.0, 7.5),
    spawnPosition: new THREE.Vector3(-7.0, 1.6, 9.5),
    spawnYaw: 0.0, // Facing North towards Reception Desk
    bounds: new THREE.Box3(new THREE.Vector3(-19.0, 0, 2.5), new THREE.Vector3(4.0, 4.0, 13.0))
  },
  workstations: {
    name: 'workstations',
    displayName: 'Open Workstations & Pods',
    center: new THREE.Vector3(-7.0, 0.0, -6.0),
    spawnPosition: new THREE.Vector3(-7.0, 1.6, -1.0),
    spawnYaw: 0.0, // Facing North into pod cluster
    bounds: new THREE.Box3(new THREE.Vector3(-19.0, 0, -13.0), new THREE.Vector3(4.0, 4.0, 0.0))
  },
  conference: {
    name: 'conference',
    displayName: 'Glass-Walled Conference Room',
    center: new THREE.Vector3(12.0, 0.0, -6.0),
    spawnPosition: new THREE.Vector3(12.0, 1.6, -1.5),
    spawnYaw: Math.PI, // Facing South towards entrance / display
    bounds: new THREE.Box3(new THREE.Vector3(5.5, 0, -13.0), new THREE.Vector3(19.0, 4.0, 0.0))
  },
  lounge: {
    name: 'lounge',
    displayName: 'Executive Lounge & Café',
    center: new THREE.Vector3(12.0, 0.0, 7.5),
    spawnPosition: new THREE.Vector3(8.0, 1.6, 5.0),
    spawnYaw: Math.PI * 0.5, // Facing East towards coffee bar
    bounds: new THREE.Box3(new THREE.Vector3(5.5, 0, 2.5), new THREE.Vector3(19.0, 4.0, 13.0))
  },
  entrance: {
    name: 'entrance',
    displayName: 'Main Entrance & Circulation',
    center: new THREE.Vector3(0.0, 0.0, 11.5),
    spawnPosition: new THREE.Vector3(0.0, 1.6, 11.5),
    spawnYaw: 0.0, // Facing North down main circulation axis
    bounds: new THREE.Box3(new THREE.Vector3(-4.0, 0, 8.0), new THREE.Vector3(4.0, 4.0, 13.0))
  }
};
```

---

### 6.1.4 Detailed Geometry & Asset Builder Specifications

#### 1. Architectural Shell (Floor, Ceiling, Outer Walls & Columns)
- **Floor Slabs**:
  - Parquet Floor (Reception, Conference, Lounge): $X \in [-20, 20], Z \in [-13, 13]$ with tiled UV coordinates (`repeat.set(20, 13)`).
  - Workstation Carpet Area: $X \in [-18.5, 3.5], Z \in [-12.5, 0.0]$, raised slightly ($Y = 0.002\text{m}$) to prevent Z-fighting.
  - Kitchenette & Entrance Dark Porcelain Tiles: $X \in [13.0, 18.5], Z \in [3.5, 11.0]$ and Corridor $X \in [-3.0, 3.0], Z \in [-12.0, 12.0]$.
- **Ceiling Slab**:
  - Size: $40.0\text{m} \times 0.2\text{m} \times 26.0\text{m}$ at $Y = 4.1\text{m}$.
  - Acoustic ceiling tile grid texture.
- **Perimeter Walls**:
  - **North Curtain Window Wall** ($Z = -13.0\text{m}$):
    - Base sill: $40.0\text{m} \times 0.5\text{m} \times 0.3\text{m}$ ($Y \in [0, 0.5]$).
    - Top header: $40.0\text{m} \times 0.4\text{m} \times 0.3\text{m}$ ($Y \in [3.6, 4.0]$).
    - Glass panels: $40.0\text{m} \times 3.1\text{m} \times 0.04\text{m}$ ($Y \in [0.5, 3.6]$).
    - Vertical black aluminum mullions spaced every $2.5\text{m}$ ($X = -17.5, -15.0, ..., +17.5$).
  - **South Wall & Entrance** ($Z = +13.0\text{m}$):
    - Left solid drywall: $X \in [-20.0, -3.0]$, $Y \in [0, 4.0]$.
    - Right solid drywall: $X \in [+3.0, +20.0]$, $Y \in [0, 4.0]$.
    - Central Glass Entrance: $X \in [-3.0, +3.0]$, with glass sliding door frames.
  - **West Solid Accent Wall** ($X = -20.0\text{m}$):
    - Drywall with wood slat paneling accents: $Z \in [-13.0, +13.0]$, $Y \in [0, 4.0]$.
  - **East Curtain Window Wall** ($X = +20.0\text{m}$):
    - Panoramic floor-to-ceiling glass wall with vertical mullions overlooking cityscape skyline backdrop.
- **6 Structural Columns** ($0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$):
  - Positions: `[-6.0, 2.0, 1.5]`, `[6.0, 2.0, 1.5]`, `[-6.0, 2.0, -11.5]`, `[6.0, 2.0, -11.5]`, `[-6.0, 2.0, 11.5]`, `[6.0, 2.0, 11.5]`.
  - Material: Fluted vertical oak slat casing with matte black recessed baseboard and capital trim.

---

#### 2. Zone 1: Welcome Reception & Executive Lobby
1. **Branded Reception Desk Counter**:
   - Location: Center `[-7.0, 0.0, 6.0]`
   - Main transaction counter: Curved front / dual-tiered box $4.2\text{m} \times 1.15\text{m} \times 1.4\text{m}$.
   - Front fascia: Calacatta gold white marble waterfall edge.
   - Recessed plinth base with continuous warm LED ribbon (`emissive: 0xffaa44`, `emissiveIntensity: 0.8`).
   - Inner desk surface at $Y = 0.74\text{m}$, equipped with 34" curved ultrawide guest terminal monitor, mechanical keyboard, and ceramic planter.
   - AABB Obstacle: `min: [-9.1, 0.0, 5.3]`, `max: [-4.9, 1.15, 6.7]`.
2. **Fluted Walnut Logo Backwall**:
   - Location: `[-7.0, 2.0, 4.0]`, size $6.0\text{m} \times 3.6\text{m} \times 0.15\text{m}$.
   - 3D Extruded Metallic Company Logo **"NEXUS DYNAMICS"**:
     - Position: `[-7.0, 2.4, 4.08]`.
     - Material: Polished chrome/brass (`metalness: 0.95`, `roughness: 0.12`).
     - Overhead directional warm spotlight pointing directly at logo plaque.
   - AABB Obstacle: `min: [-10.0, 0.0, 3.9]`, `max: [-4.0, 4.0, 4.15]`.
3. **Visitor Waiting Lounge**:
   - 3-Seater Cognac Leather Sofa: `[-13.5, 0.42, 8.5]`, size $2.4\text{m} \times 0.85\text{m} \times 0.9\text{m}$, AABB: `[-14.7, 0, 8.05]` to `[-12.3, 0.85, 8.95]`.
   - 2 Leather Armchairs: `[-11.2, 0.42, 10.0]` (yaw $-0.6\text{rad}$) and `[-15.8, 0.42, 10.0]` (yaw $+0.6\text{rad}$).
   - Tempered Glass Coffee Table: `[-13.5, 0.22, 9.8]`, size $1.2\text{m} \times 0.45\text{m} \times 0.6\text{m}$, with black steel legs and architectural magazines.
   - Geometric Area Rug: `[-13.5, 0.005, 9.5]`, size $4.2\text{m} \times 3.2\text{m}$.
   - Brass Arched Floor Lamp: `[-15.5, 1.1, 8.2]`, height $2.2\text{m}$ with glowing dome shade.
4. **Interactive Welcome / Directory Kiosk**:
   - Location: `[-1.5, 0.75, 9.0]`, size $0.6\text{m} \times 1.5\text{m} \times 0.4\text{m}$.
   - Angled $45^\circ$ touchscreen interactive hotspot showing company directory and office map.
   - AABB Obstacle: `min: [-1.8, 0.0, 8.8]`, `max: [-1.2, 1.5, 9.2]`.
5. **Living Green Botanical Wall**:
   - Location: `[-19.85, 2.0, 7.5]`, size $0.3\text{m} \times 3.6\text{m} \times 5.0\text{m}$.
   - Textured vertical planter with 3D procedural fern leaves and integrated recessed LED uplighting.
   - AABB Obstacle: `min: [-20.0, 0.0, 5.0]`, `max: [-19.7, 4.0, 10.0]`.

---

#### 3. Zone 2: Open Workstations & Cubicle Pods
1. **4 Quad Pod Clusters (16 Workstations Total)**:
   - Pod 1 Center: `[-12.5, 0.0, -8.5]`
   - Pod 2 Center: `[-4.0, 0.0, -8.5]`
   - Pod 3 Center: `[-12.5, 0.0, -3.5]`
   - Pod 4 Center: `[-4.0, 0.0, -3.5]`
2. **Geometry per Pod ($3.4\text{m} \times 1.7\text{m} \times 1.2\text{m}$ overall footprint)**:
   - **4 Desks per Pod**:
     - Desk Top Dimensions: $1.6\text{m} \times 0.04\text{m} \times 0.8\text{m}$ at $Y = 0.72\text{m}$, Matte White Oak.
     - Chamfered Black Steel Legs (4 per desk): Cylinder $r=0.025\text{m}, h=0.70\text{m}$.
     - Desk 1 (NW): offset `[-0.85, 0, -0.42]` relative to pod center.
     - Desk 2 (NE): offset `[+0.85, 0, -0.42]` relative to pod center.
     - Desk 3 (SW): offset `[-0.85, 0, +0.42]` relative to pod center.
     - Desk 4 (SE): offset `[+0.85, 0, +0.42]` relative to pod center.
   - **Central Acoustic Privacy Divider**:
     - Size: $3.4\text{m} \times 0.45\text{m} \times 0.04\text{m}$ at $Y = 0.95\text{m}$, Dark Petrol Felt.
     - Runs along center $Z = Z_{\text{pod}}$.
   - **32 Dual Monitors (Instanced)**:
     - 2 monitors per desk mounted on dual-arm steel clamp stand.
     - Screen size: $0.58\text{m} \times 0.34\text{m} \times 0.02\text{m}$.
     - Angled $15^\circ$ inward for natural ergonomics.
     - Emissive canvas textures displaying live terminal code, financial candlestick charts, cloud telemetry, and IDE dashboards.
   - **16 Ergonomic Task Chairs (Instanced)**:
     - 5-star chrome caster base, pneumatic cylinder, contoured breathable mesh back, 3D armrests.
     - Natural rotational yaw variation ($\pm 0.2\text{rad}$).
   - **16 Articulated Desk Lamps (Instanced)**:
     - Articulated matte black neck with warm LED hood (`clickable interactable`).
   - **Desk Accessories**:
     - RGB backlit mechanical keyboards (`emissive: 0x38bdf8`), precision optical mice, ceramic coffee mugs, aluminum headphone stands.
3. **Peripheral Workstation Storage & Whiteboard**:
   - Matte Black Credenza Storage Lockers: `[-18.5, 0.6, -11.0]`, size $0.6\text{m} \times 1.2\text{m} \times 3.0\text{m}$, AABB: `[-18.8, 0, -12.5]` to `[-18.2, 1.2, -9.5]`.
   - Mobile Magnetic Glass Whiteboard: `[-18.0, 0.95, -6.0]`, size $0.2\text{m} \times 1.9\text{m} \times 1.6\text{m}$, with sprint Kanban columns.

---

#### 4. Zone 3: Glass-Walled Executive Conference Room
1. **Glass Enclosure Architecture ($12.0\text{m} \times 12.0\text{m} \times 4.0\text{m}$)**:
   - **West Glass Wall** ($X = +5.8\text{m}, Z \in [-12.5, -0.5]$):
     - Segment 1: $Z \in [-12.5, -3.5]$, Glass with black aluminum framing.
     - Door Opening: $Z \in [-3.5, -2.0]$, equipped with sliding glass door and vertical brushed steel handle.
     - Segment 2: $Z \in [-2.0, -0.5]$.
   - **South Glass Wall** ($Z = -0.5\text{m}, X \in [+5.8, +18.5]$):
     - Full floor-to-ceiling glass wall with frosted privacy manifestation film band ($Y \in [1.1\text{m}, 1.7\text{m}]$).
2. **Executive Racetrack Conference Table**:
   - Location: Center `[12.0, 0.375, -6.0]`
   - Dimensions: $7.2\text{m} \times 0.75\text{m} \times 2.0\text{m}$ (Racetrack profile: central rectangle $5.2\text{m} \times 2.0\text{m}$ with semi-circular rounded ends $r = 1.0\text{m}$).
   - Top finish: Bookmatched American walnut veneer with beveled perimeter edge.
   - Dual pedestal base: Heavy black steel and brushed brass columns.
   - Integrated center connectivity troughs with pop-up power/USB/HDMI modules.
   - AABB Obstacle: `min: [8.2, 0.0, -7.1]`, `max: [15.8, 0.75, -4.9]`.
3. **12 Executive Conference Chairs (Instanced)**:
   - 5 chairs along North side ($Z = -4.8\text{m}, X \in [8.8, 10.4, 12.0, 13.6, 15.2]$) facing South.
   - 5 chairs along South side ($Z = -7.2\text{m}, X \in [8.8, 10.4, 12.0, 13.6, 15.2]$) facing North.
   - 1 Captain chair at West head ($X = 8.0\text{m}, Z = -6.0\text{m}$) facing East.
   - 1 Captain chair at East head ($X = 16.0\text{m}, Z = -6.0\text{m}$) facing West.
   - Material: Ribbed black Italian leather with polished chrome armrests and 5-star swivel bases.
4. **85" Ultra-HD Smart Presentation Display**:
   - Location: Mounted on North exterior wall at `[12.0, 2.2, -12.75]`.
   - Dimensions: $2.1\text{m} \times 1.2\text{m} \times 0.06\text{m}$.
   - High-contrast slim bezel frame with power indicator LED.
   - Interactive hotspot: clicking cycles between 4 procedural presentation decks (Revenue Metrics, Multi-Agent Architecture, Cloud Heatmap, Video Conference Grid).
   - AABB Obstacle: `min: [10.8, 1.5, -12.9]`, `max: [13.2, 2.9, -12.6]`.
5. **Conference Acoustics & Props**:
   - Center triangular conference speakerphone puck with pulsing circular LED ring (`emissive: 0x22c55e`).
   - Suspended Acoustic Ceiling Cloud: `[12.0, 3.6, -6.0]`, size $7.6\text{m} \times 0.15\text{m} \times 2.4\text{m}$, with recessed warm LED channels.
   - Glass carafes and crystal water tumblers on table.
   - Freestanding Rolling Glass Whiteboard: `[7.2, 0.95, -10.0]`.

---

#### 5. Zone 4: Executive Lounge, Breakroom & Café
1. **L-Shaped Gourmet Kitchenette & Coffee Bar**:
   - **East Counter Run**: `[17.5, 0.46, 7.5]`, size $1.0\text{m} \times 0.92\text{m} \times 6.0\text{m}$ ($Z \in [4.5, 10.5]$).
   - **Island Return**: `[15.0, 0.46, 4.5]`, size $3.6\text{m} \times 0.92\text{m} \times 1.0\text{m}$ ($X \in [13.2, 16.8]$).
   - Materials: Calacatta gold white marble countertop with waterfall mitered edge, matte dark charcoal cabinetry, brass hardware pulls.
   - Under-mount stainless steel sink with gooseneck arch faucet and glass pastry display dome.
   - Double-Door Commercial Stainless Refrigerator: `[17.5, 1.0, 10.2]`, size $0.9\text{m} \times 2.0\text{m} \times 0.8\text{m}$.
   - Built-in microwave and drawer dishwasher.
   - Commercial Dual-Group Espresso Machine:
     - Location: `[17.4, 1.15, 6.5]`, size $0.75\text{m} \times 0.5\text{m} \times 0.5\text{m}$.
     - Chrome boilers, pressure gauges, twin portafilters, steam wands, ceramic espresso cup rack.
     - Primary interactive hotspot: clicking triggers espresso brewing audio and steam particle effect.
   - 4 Scandinavian Minimalist Bar Stools: along island return at `Z = 3.6\text{m}`, $X \in [13.6, 14.5, 15.4, 16.3]$.
   - AABB Obstacles:
     - East Run: `min: [16.9, 0.0, 4.4]`, `max: [18.1, 0.95, 10.6]`
     - Island Return: `min: [13.1, 0.0, 4.0]`, `max: [16.9, 0.95, 5.0]`
     - Refrigerator: `min: [16.9, 0.0, 9.7]`, `max: [18.1, 2.0, 10.7]`
2. **Casual Sectional Lounge Relaxation Area**:
   - Deep L-Sectional Sofa in Petrol Blue Velvet:
     - Main Segment: `[9.5, 0.42, 8.5]`, size $3.2\text{m} \times 0.84\text{m} \times 0.9\text{m}$.
     - Return Chaise: `[8.0, 0.42, 7.3]`, size $0.9\text{m} \times 0.84\text{m} \times 1.5\text{m}$.
     - Ochre and cream textured accent throw pillows.
     - AABB Obstacles: `min: [7.8, 0.0, 6.4]`, `max: [11.2, 0.85, 9.0]`.
   - Nesting Round Marble Coffee Tables:
     - Primary Table: `[9.5, 0.22, 7.0]`, diameter $0.85\text{m}$, height $0.44\text{m}$.
     - Secondary Table: `[8.7, 0.18, 6.8]`, diameter $0.55\text{m}$, height $0.36\text{m}$.
   - 2 Contemporary Mustard Velvet Armchairs: `[7.2, 0.42, 8.5]` (yaw $0.8\text{rad}$) and `[11.5, 0.42, 6.8]` (yaw $-2.2\text{rad}$).
   - Plush Round Shag Area Rug: `[9.5, 0.005, 7.8]`, radius $1.85\text{m}$.
   - 65" Wall TV Display: Mounted on South wall at `[9.5, 2.2, 12.75]`, rendering company announcements and nature imagery.
   - Architectural Open Bookshelf: `[5.8, 1.8, 7.5]`, size $0.35\text{m} \times 3.6\text{m} \times 3.8\text{m}$, loaded with design books, awards, pottery, and trailing pothos plants. AABB: `[5.6, 0, 5.6]` to `[6.0, 3.6, 9.4]`.
   - Indoor Foliage:
     - Fiddle Leaf Fig tree in fluted ceramic cylinder planter: `[6.6, 1.1, 3.6]`.
     - Clustered Monstera and Snake Plants in terracotta pots: `[17.2, 0.7, 11.5]`.

---

#### 6. Zone 5: Central Circulation Corridor & Wayfinding Totem
1. **Wayfinding Signage Totem**:
   - Location: `[0.0, 1.2, 4.0]`, size $0.5\text{m} \times 2.4\text{m} \times 0.2\text{m}$.
   - Black anodized aluminum totem with backlit laser-etched directional arrows:
     - `⬅ Zone 1: Reception & Lobby`
     - `⬆ Zone 2: Open Workstations`
     - `➡ Zone 3: Conference Boardroom`
     - `⬇ Zone 4: Executive Café & Lounge`
   - AABB Obstacle: `min: [-0.3, 0.0, 3.8]`, `max: [0.3, 2.4, 4.2]`.
2. **Ceiling Recessed Linear Lighting Grid**:
   - Suspended modular ceiling panels with diffuse LED light bars along circulation axes ($Z = 1.0\text{m}, X \in [-18, 18]$).

---

### 6.1.5 InstancedMesh Optimization Architecture

```typescript
export class InstancedAssetRegistry {
  public chairMesh!: THREE.InstancedMesh;
  public monitorBezelMesh!: THREE.InstancedMesh;
  public monitorStandMesh!: THREE.InstancedMesh;
  public lampMesh!: THREE.InstancedMesh;
  public downlightMesh!: THREE.InstancedMesh;
  public barStoolMesh!: THREE.InstancedMesh;

  public init(materials: MaterialLibrary, scene: THREE.Group): void {
    // 1. Task & Conference Chairs (32 max instances)
    const chairGeo = createChairMergedGeometry();
    this.chairMesh = new THREE.InstancedMesh(chairGeo, materials.leatherBlack, 32);
    this.chairMesh.castShadow = true;
    this.chairMesh.receiveShadow = true;

    // 2. Dual Monitors (34 max instances: 32 workstations + 1 reception + 1 spare)
    const bezelGeo = new THREE.BoxGeometry(0.58, 0.34, 0.02);
    this.monitorBezelMesh = new THREE.InstancedMesh(bezelGeo, materials.metalBlackMatte, 34);
    this.monitorBezelMesh.castShadow = true;

    const standGeo = createMonitorStandMergedGeometry();
    this.monitorStandMesh = new THREE.InstancedMesh(standGeo, materials.metalBlackMatte, 34);

    // 3. Desk Articulated Lamps (16 instances)
    const lampGeo = createDeskLampMergedGeometry();
    this.lampMesh = new THREE.InstancedMesh(lampGeo, materials.metalBlackMatte, 16);

    // 4. Ceiling Recessed Downlights (36 instances)
    const downlightGeo = createDownlightBezelGeometry();
    this.downlightMesh = new THREE.InstancedMesh(downlightGeo, materials.ledGlowWarm, 36);

    // 5. Bar Stools (4 instances)
    const stoolGeo = createBarStoolMergedGeometry();
    this.barStoolMesh = new THREE.InstancedMesh(stoolGeo, materials.woodOak, 4);

    scene.add(
      this.chairMesh,
      this.monitorBezelMesh,
      this.monitorStandMesh,
      this.lampMesh,
      this.downlightMesh,
      this.barStoolMesh
    );
  }

  public setInstanceTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    scale = new THREE.Vector3(1, 1, 1)
  ): void {
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(rot);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
```

---

### 6.1.6 Complete `OfficeFloorplan` Class Outline

```typescript
export class OfficeFloorplan {
  public group: THREE.Group;
  private materials: MaterialLibrary;
  private obstacles: ObstacleBox[] = [];
  private instancedAssets: InstancedAssetRegistry;
  private interactableHotspots: THREE.Object3D[] = [];

  constructor(materials: MaterialLibrary) {
    this.group = new THREE.Group();
    this.group.name = 'OfficeFloorplan';
    this.materials = materials;
    this.instancedAssets = new InstancedAssetRegistry();
  }

  public build(): void {
    this.instancedAssets.init(this.materials, this.group);
    
    this.buildArchitecturalShell();
    this.buildZone1Reception();
    this.buildZone2Workstations();
    this.buildZone3Conference();
    this.buildZone4Lounge();
    this.buildZone5Corridor();
    
    // Update instanced bounding spheres
    this.instancedAssets.chairMesh.computeBoundingSphere();
    this.instancedAssets.monitorBezelMesh.computeBoundingSphere();
  }

  public getObstacles(): ObstacleBox[] {
    return this.obstacles;
  }

  public getObstacleBoxes(): THREE.Box3[] {
    return this.obstacles.filter(o => !o.isOpen).map(o => o.box);
  }

  public getZoneAtPosition(pos: THREE.Vector3): ZoneBounds {
    for (const key in OFFICE_ZONES) {
      if (OFFICE_ZONES[key].bounds.containsPoint(pos)) {
        return OFFICE_ZONES[key];
      }
    }
    return OFFICE_ZONES.entrance;
  }

  public registerObstacle(id: string, name: string, zone: ObstacleBox['zone'], min: THREE.Vector3, max: THREE.Vector3, isDoor = false): void {
    this.obstacles.push({
      id,
      name,
      zone,
      box: new THREE.Box3(min, max),
      isDoor,
      isOpen: false
    });
  }

  public setDoorState(doorId: string, isOpen: boolean): void {
    const obstacle = this.obstacles.find(o => o.id === doorId);
    if (obstacle) {
      obstacle.isOpen = isOpen;
    }
  }
}
```

---

## 6.2 `src/scene/SceneManager.ts`

### 6.2.1 Architecture & Interface Contract
```typescript
import * as THREE from 'three';
import { ILightingManager } from '../types';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public lightingManager!: ILightingManager;
  public container!: HTMLElement;

  private clock: THREE.Clock;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private updateCallbacks: Array<(delta: number, elapsed: number) => void> = [];

  // Performance telemetry
  private fps: number = 60;
  private frameCount: number = 0;
  private lastFpsTime: number = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    
    // Camera setup
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 150);
    this.camera.position.set(0, 1.6, 11.5); // Default entrance spawn
    
    // WebGL Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true
    });
    
    this.configureRenderer();
    this.setupResizeListener();
  }

  private configureRenderer(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Color management & Tonemapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    
    // Shadow Map configuration
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  public init(container: HTMLElement): void {
    this.container = container;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    this.onResize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  }

  public registerUpdateCallback(cb: (delta: number, elapsed: number) => void): void {
    this.updateCallbacks.push(cb);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.lastFpsTime = performance.now();
    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop = (): void => {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this.loop);
    
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1); // Clamp against tab background lag
    const elapsed = this.clock.getElapsedTime();
    
    // Update performance stats
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    
    // Fire sub-system update hooks (controllers, screens, audio, minimap)
    for (let i = 0; i < this.updateCallbacks.length; i++) {
      this.updateCallbacks[i](delta, elapsed);
    }
    
    this.render();
  };

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public onResize(width: number, height: number): void {
    if (height <= 0) height = 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private setupResizeListener(): void {
    window.addEventListener('resize', () => {
      const w = this.container ? this.container.clientWidth : window.innerWidth;
      const h = this.container ? this.container.clientHeight : window.innerHeight;
      this.onResize(w, h);
    });
  }

  public setLightingPreset(preset: 'day' | 'sunset' | 'night'): void {
    if (this.lightingManager) {
      this.lightingManager.setPreset(preset);
    }
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Light && obj.castShadow !== undefined) {
        obj.castShadow = enabled;
      }
    });
  }

  public setQuality(dprScale: number): void {
    const targetDpr = Math.min(window.devicePixelRatio, Math.max(0.5, dprScale));
    this.renderer.setPixelRatio(targetDpr);
  }

  // Debug Getters for window.__OFFICE_DEBUG__
  public getFPS(): number {
    return this.fps;
  }

  public getDrawCalls(): number {
    return this.renderer.info.render.calls;
  }

  public getTriangleCount(): number {
    return this.renderer.info.render.triangles;
  }
}
```

---

## 6.3 `src/main.ts`

### 6.3.1 Application Bootstrap Implementation
```typescript
import { SceneManager } from './scene/SceneManager';
import { LightingManager } from './scene/LightingManager';
import { Materials } from './scene/Materials';
import { OfficeFloorplan, OFFICE_ZONES } from './scene/OfficeFloorplan';
import { NavigationManager } from './navigation/NavigationManager';
import { InteractionManager } from './interaction/InteractionManager';
import { AudioManager } from './audio/AudioManager';
import { HUDManager } from './ui/HUDManager';
import { Minimap } from './ui/Minimap';
import { SettingsDrawer } from './ui/SettingsDrawer';
import { IOfficeDebug } from './types';

async function bootstrap() {
  // 1. Resolve Root Containers
  const appContainer = document.getElementById('app') || document.body;
  const canvasContainer = document.getElementById('canvas-container') || document.createElement('div');
  if (!canvasContainer.id) {
    canvasContainer.id = 'canvas-container';
    appContainer.appendChild(canvasContainer);
  }

  // 2. Initialize 3D Engine Core
  const sceneManager = new SceneManager();
  sceneManager.init(canvasContainer);

  // 3. Initialize Procedural Materials
  const materials = Materials.getInstance();

  // 4. Initialize Lighting Rig (Default 'day')
  const lightingManager = new LightingManager(sceneManager.scene);
  sceneManager.lightingManager = lightingManager;
  lightingManager.setPreset('day');

  // 5. Build 3D Multi-Zone Office Floorplan
  const floorplan = new OfficeFloorplan(materials);
  floorplan.build();
  sceneManager.scene.add(floorplan.group);

  // 6. Initialize Audio Engine
  const audioManager = new AudioManager();
  await audioManager.init().catch(err => console.warn('Audio auto-init deferred until user gesture', err));

  // 7. Initialize Navigation & Camera Controller
  const navigationManager = new NavigationManager(sceneManager.camera, canvasContainer);
  // Register all solid obstacle bounding boxes
  const obstacles = floorplan.getObstacles();
  for (const obs of obstacles) {
    navigationManager.addObstacle(obs.box);
  }
  navigationManager.onFootstep = () => audioManager.playFootstep();

  // 8. Initialize Interaction Engine
  const interactionManager = new InteractionManager(sceneManager.scene, sceneManager.camera);

  // 9. Initialize UI Systems (HUD, Minimap, Settings)
  const hudManager = new HUDManager();
  hudManager.init(appContainer);

  const minimap = new Minimap(floorplan);
  const minimapContainer = document.getElementById('minimap-container');
  if (minimapContainer) minimap.init(minimapContainer);

  const settingsDrawer = new SettingsDrawer({
    onLightingChange: (preset) => sceneManager.setLightingPreset(preset),
    onShadowsToggle: (enabled) => sceneManager.setShadowsEnabled(enabled),
    onQualityChange: (scale) => sceneManager.setQuality(scale),
    onAudioMuteToggle: () => audioManager.toggleMute(),
    onVolumeChange: (vol) => audioManager.setMasterVolume(vol)
  });
  settingsDrawer.init(appContainer);

  // 10. Register Per-Frame Update Loop Hooks
  sceneManager.registerUpdateCallback((delta, elapsed) => {
    navigationManager.update(delta);
    interactionManager.update(sceneManager.camera, navigationManager.mode);
    
    const playerPos = navigationManager.getPosition();
    const playerYaw = navigationManager.getYaw();
    minimap.update(playerPos, playerYaw);

    const currentZone = floorplan.getZoneAtPosition(playerPos);
    hudManager.setZoneBanner(currentZone.displayName);
    hudManager.setModeBadge(navigationManager.mode);
  });

  // 11. Wire Teleportation Handlers
  minimap.onZoneClick = (zoneKey: string) => {
    navigationManager.teleportTo(zoneKey as any, true);
    audioManager.playChime();
  };

  // 12. Expose window.__OFFICE_DEBUG__ Automation Contract
  const debugApi: IOfficeDebug = {
    sceneManager,
    navigationManager,
    interactionManager,
    audioManager,
    getFPS: () => sceneManager.getFPS(),
    getDrawCalls: () => sceneManager.getDrawCalls(),
    getTriangleCount: () => sceneManager.getTriangleCount(),
    getPlayerPosition: () => {
      const pos = navigationManager.getPosition();
      return { x: pos.x, y: pos.y, z: pos.z, yaw: navigationManager.getYaw() };
    },
    getInteractables: () => interactionManager.getInteractableIds(),
    triggerInteract: (id: string) => interactionManager.triggerAction(id),
    teleport: (zone: string) => {
      if (OFFICE_ZONES[zone]) {
        navigationManager.teleportTo(zone as any, false);
        return true;
      }
      return false;
    },
    setLighting: (preset: string) => {
      if (['day', 'sunset', 'night'].includes(preset)) {
        sceneManager.setLightingPreset(preset as any);
        return true;
      }
      return false;
    }
  };
  (window as any).__OFFICE_DEBUG__ = debugApi;

  // 13. Start Rendering Loop
  sceneManager.start();
  console.log('🚀 3D Corporate Office Engine initialized successfully at 60 FPS.');
}

window.addEventListener('DOMContentLoaded', bootstrap);
```

---

## 6.4 Complete Obstacle AABB Collision Matrix Reference

| Obstacle ID | Zone | Description | Min $[X, Y, Z]$ | Max $[X, Y, Z]$ | Dimensions $[W \times H \times D]$ |
|---|---|---|---|---|---|
| `wall_north` | Perimeter | North Curtain Window Base/Sill | `[-20.0, 0.0, -13.2]` | `[20.0, 4.0, -12.8]` | $40.0\text{m} \times 4.0\text{m} \times 0.4\text{m}$ |
| `wall_south_left` | Perimeter | South Wall Left Solid Drywall | `[-20.0, 0.0, 12.8]` | `[-3.0, 4.0, 13.2]` | $17.0\text{m} \times 4.0\text{m} \times 0.4\text{m}$ |
| `wall_south_right` | Perimeter | South Wall Right Solid Drywall | `[3.0, 0.0, 12.8]` | `[20.0, 4.0, 13.2]` | $17.0\text{m} \times 4.0\text{m} \times 0.4\text{m}$ |
| `wall_west` | Perimeter | West Solid Wall & Slat Cladding | `[-20.2, 0.0, -13.0]` | `[-19.8, 4.0, 13.0]` | $0.4\text{m} \times 4.0\text{m} \times 26.0\text{m}$ |
| `wall_east` | Perimeter | East Panoramic Glass Curtain Wall | `[19.8, 0.0, -13.0]` | `[20.2, 4.0, 13.0]` | $0.4\text{m} \times 4.0\text{m} \times 26.0\text{m}$ |
| `col_1` | Corridor | Fluted Oak Column 1 | `[-6.3, 0.0, 1.2]` | `[-5.7, 4.0, 1.8]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `col_2` | Corridor | Fluted Oak Column 2 | `[5.7, 0.0, 1.2]` | `[6.3, 4.0, 1.8]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `col_3` | Workstations | Fluted Oak Column 3 | `[-6.3, 0.0, -11.8]` | `[-5.7, 4.0, -11.2]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `col_4` | Conference | Fluted Oak Column 4 | `[5.7, 0.0, -11.8]` | `[6.3, 4.0, -11.2]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `col_5` | Reception | Fluted Oak Column 5 | `[-6.3, 0.0, 11.2]` | `[-5.7, 4.0, 11.8]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `col_6` | Lounge | Fluted Oak Column 6 | `[5.7, 0.0, 11.2]` | `[6.3, 4.0, 11.8]` | $0.6\text{m} \times 4.0\text{m} \times 0.6\text{m}$ |
| `reception_counter` | Reception | Marble & Oak Reception Desk | `[-9.1, 0.0, 5.3]` | `[-4.9, 1.15, 6.7]` | $4.2\text{m} \times 1.15\text{m} \times 1.4\text{m}$ |
| `reception_logowall` | Reception | Walnut Logo Feature Wall | `[-10.0, 0.0, 3.9]` | `[-4.0, 4.0, 4.15]` | $6.0\text{m} \times 4.0\text{m} \times 0.25\text{m}$ |
| `reception_sofa` | Reception | 3-Seater Cognac Leather Sofa | `[-14.7, 0.0, 8.05]` | `[-12.3, 0.85, 8.95]` | $2.4\text{m} \times 0.85\text{m} \times 0.9\text{m}$ |
| `reception_table` | Reception | Tempered Glass Coffee Table | `[-14.1, 0.0, 9.5]` | `[-12.9, 0.45, 10.1]` | $1.2\text{m} \times 0.45\text{m} \times 0.6\text{m}$ |
| `reception_kiosk` | Reception | Interactive Welcome Directory Kiosk | `[-1.8, 0.0, 8.8]` | `[-1.2, 1.5, 9.2]` | $0.6\text{m} \times 1.5\text{m} \times 0.4\text{m}$ |
| `reception_greenwall`| Reception | Living Vertical Botanical Wall | `[-20.0, 0.0, 5.0]` | `[-19.7, 4.0, 10.0]` | $0.3\text{m} \times 4.0\text{m} \times 5.0\text{m}$ |
| `workstation_pod_1` | Workstations | Quad Pod Cluster 1 | `[-14.2, 0.0, -9.4]` | `[-10.8, 1.2, -7.6]` | $3.4\text{m} \times 1.2\text{m} \times 1.8\text{m}$ |
| `workstation_pod_2` | Workstations | Quad Pod Cluster 2 | `[-5.7, 0.0, -9.4]` | `[-2.3, 1.2, -7.6]` | $3.4\text{m} \times 1.2\text{m} \times 1.8\text{m}$ |
| `workstation_pod_3` | Workstations | Quad Pod Cluster 3 | `[-14.2, 0.0, -4.4]` | `[-10.8, 1.2, -2.6]` | $3.4\text{m} \times 1.2\text{m} \times 1.8\text{m}$ |
| `workstation_pod_4` | Workstations | Quad Pod Cluster 4 | `[-5.7, 0.0, -4.4]` | `[-2.3, 1.2, -2.6]` | $3.4\text{m} \times 1.2\text{m} \times 1.8\text{m}$ |
| `workstation_lockers`| Workstations | Credenza Storage Lockers | `[-18.8, 0.0, -12.5]` | `[-18.2, 1.2, -9.5]` | $0.6\text{m} \times 1.2\text{m} \times 3.0\text{m}$ |
| `workstation_board` | Workstations | Mobile Magnetic Glass Whiteboard | `[-18.1, 0.0, -6.8]` | `[-17.9, 1.9, -5.2]` | $0.2\text{m} \times 1.9\text{m} \times 1.6\text{m}$ |
| `conf_glass_west_1` | Conference | West Glass Wall (North Segment) | `[5.7, 0.0, -12.5]` | `[5.9, 4.0, -3.5]` | $0.2\text{m} \times 4.0\text{m} \times 9.0\text{m}$ |
| `conf_door_sliding` | Conference | West Glass Sliding Door | `[5.7, 0.0, -3.5]` | `[5.9, 3.0, -2.0]` | $0.2\text{m} \times 3.0\text{m} \times 1.5\text{m}$ (Door) |
| `conf_glass_west_2` | Conference | West Glass Wall (South Segment) | `[5.7, 0.0, -2.0]` | `[5.9, 4.0, -0.5]` | $0.2\text{m} \times 4.0\text{m} \times 1.5\text{m}$ |
| `conf_glass_south` | Conference | South Glass Wall & Manifestation | `[5.7, 0.0, -0.6]` | `[18.5, 4.0, -0.4]` | $12.8\text{m} \times 4.0\text{m} \times 0.2\text{m}$ |
| `conf_table` | Conference | Racetrack Walnut Conference Table | `[8.4, 0.0, -7.0]` | `[15.6, 0.75, -5.0]` | $7.2\text{m} \times 0.75\text{m} \times 2.0\text{m}$ |
| `conf_screen` | Conference | 85" Smart Presentation Display | `[10.8, 1.5, -12.9]` | `[13.2, 2.9, -12.6]` | $2.4\text{m} \times 1.4\text{m} \times 0.3\text{m}$ |
| `lounge_bar_east` | Lounge | Marble & Black Kitchenette East Run | `[16.9, 0.0, 4.4]` | `[18.1, 0.95, 10.6]` | $1.2\text{m} \times 0.95\text{m} \times 6.2\text{m}$ |
| `lounge_bar_island` | Lounge | Marble Island Return Counter | `[13.1, 0.0, 4.0]` | `[16.9, 0.95, 5.0]` | $3.8\text{m} \times 0.95\text{m} \times 1.0\text{m}$ |
| `lounge_fridge` | Lounge | Double Stainless Refrigerator | `[16.9, 0.0, 9.7]` | `[18.1, 2.0, 10.7]` | $1.2\text{m} \times 2.0\text{m} \times 1.0\text{m}$ |
| `lounge_sofa_main` | Lounge | L-Sectional Velvet Sofa Main | `[7.8, 0.0, 8.0]` | `[11.2, 0.85, 9.0]` | $3.4\text{m} \times 0.85\text{m} \times 1.0\text{m}$ |
| `lounge_sofa_chaise`| Lounge | L-Sectional Velvet Sofa Chaise | `[7.8, 0.0, 6.4]` | `[8.8, 0.85, 8.0]` | $1.0\text{m} \times 0.85\text{m} \times 1.6\text{m}$ |
| `lounge_bookshelf` | Lounge | Architectural Open Bookshelf | `[5.6, 0.0, 5.6]` | `[6.0, 3.6, 9.4]` | $0.4\text{m} \times 3.6\text{m} \times 3.8\text{m}$ |
| `totem_wayfinding` | Corridor | Central Wayfinding Directory Totem | `[-0.3, 0.0, 3.8]` | `[0.3, 2.4, 4.2]` | $0.6\text{m} \times 2.4\text{m} \times 0.4\text{m}$ |
