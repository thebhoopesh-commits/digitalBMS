# Architectural Survey & 3D Floorplan Specification Report
**Project:** 3D Corporate Office Web Application (Three.js)  
**Author:** Explorer 1 (`teamwork_preview_explorer_survey_1`)  
**Target Milestone:** Scene Architecture, Procedural Assets, Multi-Zone Floorplan & Lighting  
**Date:** 2026-08-15  

---

## 1. Observation

Direct observations from `ORIGINAL_REQUEST.md`, workspace inspection, and Three.js architectural requirements:

1. **Original Requirements Baseline (`ORIGINAL_REQUEST.md:13-20, 45-48, 59-62`)**:
   - **Multi-Zone Office Floorplan**: Four distinct functional zones:
     - *Reception Zone*: Branded front desk, visitor seating, company logo display, glass entrance partition.
     - *Open Workstations & Cubicles*: Desks equipped with dual monitors, keyboards, ergonomic chairs, desk lamps, workspace props.
     - *Glass-Walled Conference Room*: Central table, ergonomic chairs, presentation screen/whiteboard, transparent glass walls.
     - *Lounge & Breakroom*: Coffee bar/kitchenette, sofa/casual seating, indoor potted greenery.
   - **Atmospheric Lighting**: Ambient light, directional sunlight/shadows through exterior windows, point lights for ceiling fixtures, emissive screen glows, and 3 switchable presets (Day, Sunset, Night).
   - **Execution & Performance**: Web application running at 60 FPS in modern browsers, 100% self-contained with zero broken assets or network latency bottlenecks.

2. **Workspace State**:
   - Current directory `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d` is a clean greenfield project directory containing only `.agents` orchestration metadata and `ORIGINAL_REQUEST.md`.
   - No external GLTF/GLB binary assets exist in the project, which means a procedural geometry & procedural texture generator is the most robust, instant-loading, zero-dependency, and fully customizable design choice.

---

## 2. Logic Chain

1. **Why Procedural 3D Geometry & Canvas-Generated Textures?**
   - Relying on external CDN or remote GLTF models introduces significant risks: network latency, CORS blocks, broken asset URLs, mismatched scales/pivots, unoptimized polycounts, and licensing issues.
   - Procedural geometry built using Three.js native primitives (`BoxGeometry`, `CylinderGeometry`, `TorusGeometry`, `ExtrudeGeometry`, `ShapeGeometry`, `PlaneGeometry`) and merged buffer geometries produces 0-millisecond load times, zero network dependency, deterministic bounding boxes, and perfect material parameter binding.
   - Canvas-generated procedural textures (wood grain, brushed metal, carpet stipple, concrete terrazzo, UI screen dashboards, dry-erase whiteboards, company logos) provide crisp procedural PBR maps with 0 KB asset download footprint.

2. **Why a 40m x 26m x 4m Spatial Dimension?**
   - Standard architectural proportions for a modern tech corporate headquarters: 40m width (X axis: -20 to +20), 26m depth (Z axis: -13 to +13), and 4.0m ceiling height (Y axis: 0 to 4).
   - This provides comfortable clearance for first-person player navigation (player height = 1.7m, eye-level = 1.6m, capsule radius = 0.4m), realistic camera FOV (60°-75°), and balanced panoramic framing in top-down / orbit view (camera at [0, 28, 22] looking at [0, 0, 0]).

3. **Why InstancedMesh & Shared Material Architectures?**
   - An office floor contains dozens of repetitive elements: 16+ workstations with 32 monitors, 16 keyboards, 16 mice, 16 desk lamps, 28 ergonomic chairs, 12 conference chairs, 30 ceiling downlights, and hundreds of plant leaves.
   - Creating individual meshes for each would result in 400+ draw calls, dropping mobile/laptop frame rates below 60 FPS.
   - Utilizing `THREE.InstancedMesh` for chairs, monitors, lamps, and downlights along with `BufferGeometryUtils.mergeGeometries` for static architectural walls/frames reduces total draw calls to under 45, easily achieving locked 60 FPS.

4. **Why PBR (MeshStandardMaterial & MeshPhysicalMaterial)?**
   - Modern Three.js rendering pipelines support realistic dielectric and metal reflection models (Cook-Torrance PBR).
   - Glass partitions and exterior windows utilize `THREE.MeshPhysicalMaterial` with `transmission: 0.92`, `roughness: 0.05`, and `ior: 1.52` for authentic optical refraction.
   - Computer screens, LED lightbars, and downlight fixtures utilize `emissive` channels combined with localized point/spot lights for believable nighttime and sunset illumination.

---

## 3. Caveats

1. **Physical Transmission Cost**:
   - `MeshPhysicalMaterial` with transmission requires an extra render pass for scene texture sampling if rough transmission is enabled. For maximum performance across low-end GPUs, glass walls should use `transparent: true`, `opacity: 0.28`, `roughness: 0.05`, `metalness: 0.1`, and `reflectivity: 0.9` as a high-performance PBR glass fallback, with `MeshPhysicalMaterial` available as a high-quality toggle.
2. **Shadow Map Performance**:
   - Only the primary directional sunlight/moonlight should cast dynamic shadows (`castShadow = true`) with a 2048x2048 shadow map and soft PCF filtering.
   - Interior ceiling point lights and desk lamps should illuminate diffuse surfaces but have `castShadow = false` to avoid quadratic shadow map rendering overhead.
3. **Collision Precision**:
   - Collision detection in first-person mode should use discrete Axis-Aligned Bounding Boxes (AABB) with cylinder/capsule sweeps or 8-ray radial raycasting rather than mesh-level polygon collision, keeping collision checks virtually zero-cost (<0.2ms per frame).

---

## 4. Conclusion

The 3D Scene Architecture for the Corporate Office is fully specified and mapped into 4 distinct functional zones plus circulation spines. Complete procedural asset generation blueprints, PBR material parameters, lighting preset matrices, coordinate systems, and collision bounds are established in Section 6 below, ready for direct execution by Milestone Workers.

---

## 5. Verification Method

To verify the scene architecture upon implementation:
1. **Visual Multi-Zone Inspection**: Verify all 4 zones (Reception, Open Workstations, Glass Conference Room, Lounge/Breakroom) render at their designated coordinates with accurate materials and props.
2. **Performance Profile**: Open Chrome DevTools Performance/Console tab, verify `renderer.info.render.calls` is under 60 draw calls, `renderer.info.render.triangles` is under 150,000 polygons, and frame rate remains steady at 60 FPS.
3. **Lighting Presets Toggle**: Switch between Day, Sunset, and Night presets and confirm directional light color/position, ambient light intensity, fog color, and emissive screen glows update smoothly.
4. **Collision Verification**: Walk through all doors, corridors, and around furniture in first-person mode; confirm player cannot penetrate walls, desks, counters, or glass partitions.

---

## 6. Detailed Architectural Specification & Implementation Blueprints

### 6.1 Master Floorplan & Coordinate System

- **World Coordinate Frame**:
  - Origin `(0, 0, 0)` is at the geometric center of the office floor.
  - **X Axis (Width)**: `[-20.0m, +20.0m]` (Total Width = 40.0m). West is `-X`, East is `+X`.
  - **Y Axis (Height)**: `[0.0m, 4.0m]` (Floor = `Y: 0`, Ceiling = `Y: 4.0m`).
  - **Z Axis (Depth)**: `[-13.0m, +13.0m]` (Total Depth = 26.0m). North is `-Z`, South is `+Z`.

```
========================================================================================
                                 NORTH (Exterior Windows) [-Z]
  [-20, -13]                                 [0, -13]                               [+20, -13]
  +---------------------------------------------+------------------------------------+
  |                                             |                                    |
  |       ZONE 2: OPEN WORKSTATIONS & PODS      |   ZONE 3: GLASS CONFERENCE ROOM    |
  |       Coordinates: X: [-18 to +4]           |   Coordinates: X: [+6 to +18]      |
  |                    Z: [-12 to 0]            |                Z: [-12 to 0]       |
  |       - 4x Pod Clusters (16 Desks)          |   - 10-12 Seat Walnut Table        |
  |       - Dual Curved Monitors & Ergonomics   |   - 85" Interactive Presentation   |
  |       - Whiteboards & Storage Lockers       |   - Rolling Whiteboard & Glass Wall|
  |                                             |                                    |
  + - - - - - - - - - - - - - - - - - - - - - - + - - - - - - - - - - - - - - - - - -+
  |                   CENTRAL CIRCULATION SPINE / WAYFINDING CORRIDOR                |
  |                   X: [-19 to +19], Z: [0 to +3]                                  |
  + - - - - - - - - - - - - - - - - - - - - - - + - - - - - - - - - - - - - - - - - -+
  |                                             |                                    |
  |       ZONE 1: WELCOME RECEPTION & LOBBY     |   ZONE 4: LOUNGE & BREAKROOM/CAFÉ  |
  |       Coordinates: X: [-18 to +4]           |   Coordinates: X: [+6 to +18]      |
  |                    Z: [+3 to +12]           |                Z: [+3 to +12]      |
  |       - Branded Curved Counter & Backlight  |   - Quartz Coffee Bar & Espresso   |
  |       - 3D Corporate Logo Plaque            |   - Velvet Sectional Sofa & Tables |
  |       - Visitor Lounge & Green Feature Wall |   - Bookshelves, Plants & TV       |
  |       - Entrance Glass Partition & Kiosk    |                                    |
  +---------------------------------------------+------------------------------------+
  [-20, +13]                             ENTRANCE [0, +13]                          [+20, +13]
                                 SOUTH (Main Entrance) [+Z]
========================================================================================
```

---

### 6.2 Zone-by-Zone Asset, Furniture & Prop Inventory

#### Zone 1: Welcome Reception & Executive Lobby
- **Center Coordinate**: `X: -7.0, Y: 0.0, Z: 7.5`
- **Key Assets**:
  1. **Branded Reception Desk**:
     - Dimensions: `Width: 4.2m, Depth: 1.4m, Height: 1.15m`
     - Position: `[-7.0, 0.0, 6.0]`
     - Structure: Dual-tier architectural counter. Lower reception desk at `Y: 0.75m`, elevated transaction top with frosted glass accent and warm LED ribbon along the recessed baseboard (`emissive: 0xffaa44`, `emissiveIntensity: 0.8`).
     - Back wall feature: Fluted walnut wood slat panel (`Width: 6.0m, Height: 3.6m`) with 3D extruded metallic logo lettering **"NEXUS DYNAMICS"** (`metalness: 0.95`, `roughness: 0.15`, illuminated by overhead directional spotlight).
  2. **Receptionist Workstation**:
     - Position: Behind desk `[-7.0, 0.0, 5.4]`
     - Equipment: High-back ergonomic task chair, 34" ultrawide curved monitor (`CanvasTexture` with guest check-in terminal), slim mechanical keyboard, desk phone, desk succulent.
  3. **Visitor Waiting Lounge**:
     - Position: `[-13.5, 0.0, 8.0]`
     - Furniture: 3-seater contemporary Italian leather sofa in warm cognac (`Width: 2.4m, Depth: 0.9m`) and 2 matching armchairs facing an elliptical tempered glass & black steel coffee table (`1.2m x 0.6m`).
     - Accessories: Large geometric area rug (`3.5m x 2.8m`), architectural arched brass floor lamp with warm glow (`[-15.0, 0.0, 9.5]`), company brochures and architecture magazines on table.
  4. **Interactive Welcome / Directory Kiosk**:
     - Position: `[-1.5, 0.0, 9.0]`
     - Dimensions: `Width: 0.6m, Depth: 0.4m, Height: 1.5m`
     - Freestanding angled capacitive touchscreen stand displaying interactive office map, company directory, and weather widget (clickable hotspot).
  5. **Lush Living Green Wall / Architectural Planter**:
     - Position: `[-18.5, 0.0, 7.5]` (mounted along West wall)
     - Multi-tiered vertical botanical wall with clustered procedural fern and pothos leaves and integrated uplighting.

---

#### Zone 2: Open Workstations & Cubicle Pods
- **Center Coordinate**: `X: -7.0, Y: 0.0, Z: -6.0`
- **Layout Structure**: 4 Quad-Desk Pods (16 fully appointed workstations total):
  - **Pod 1**: Center `[-12.5, 0.0, -8.5]` (4 desks, 2x2 facing)
  - **Pod 2**: Center `[-4.0, 0.0, -8.5]` (4 desks, 2x2 facing)
  - **Pod 3**: Center `[-12.5, 0.0, -3.5]` (4 desks, 2x2 facing)
  - **Pod 4**: Center `[-4.0, 0.0, -3.5]` (4 desks, 2x2 facing)
- **Single Workstation Specification** (`1.6m x 0.8m` desk surface):
  - **Desktop**: Matte white oak with beveled edge and chamfered steel legs (`Y: 0.74m`).
  - **Privacy Acoustic Divider**: Dark felt acoustic panel (`Height: 0.4m`) between facing desks.
  - **Dual Monitor Array**: Two 27" thin-bezel monitors on articulating dual-arm gas-spring desk clamp mount. One landscape, one portrait/code editor or both landscape angled at 15°.
  - **Screen Content (CanvasTexture)**: Dynamic procedural canvas textures displaying:
    - Real-time animated terminal logs with scrolling green/cyan text.
    - Financial candlestick stock charts and trading metrics.
    - Cloud infrastructure server topology graphs with pulsing status nodes.
    - VS Code-style IDE with syntax-highlighted TypeScript/Three.js code.
  - **Ergonomic Task Chair**: 5-star wheeled base with chrome casters, pneumatic cylinder, breathable contoured mesh backrest, adjustable 3D armrests, swiveled at varied natural angles (`rotation.y`).
  - **Desk Props**:
    - RGB mechanical keyboard with glowing keycap rows (`emissive: 0x38bdf8`).
    - Precision optical mouse and stitched edge desk pad (`0.9m x 0.4m`).
    - Articulated architect LED desk lamp with touch switch (clickable hotspot to toggle local light).
    - Ceramic coffee mugs (branded logos), sticky notes, pen cups, aluminum headphones stand.
  - **Peripheral Office Elements**:
    - Mobile magnetic glass whiteboard with Kanban sprint columns (`[-17.5, 0.0, -6.0]`).
    - Modular credenza storage lockers with matte black finish (`[-18.0, 0.0, -11.0]`).

---

#### Zone 3: Glass-Walled Executive Conference Room
- **Center Coordinate**: `X: 12.0, Y: 0.0, Z: -6.0`
- **Room Dimensions**: `Width: 12.0m (X: 6.0 to 18.0), Depth: 12.0m (Z: -12.0 to 0.0), Height: 4.0m`
- **Glass Enclosure**:
  - West Wall (`X: 6.0, Z: [-12.0 to 0.0]`): Floor-to-ceiling double-glazed clear glass panels with black anodized aluminum framing and a 1.2m sliding glass door (`Z: -2.0 to -3.2`).
  - South Wall (`Z: 0.0, X: [6.0 to 18.0]`): Floor-to-ceiling glass wall with frosted privacy manifestation band (`Y: 1.0m to 1.6m`).
  - North & East Walls: Exterior panoramic floor-to-ceiling curtain wall windows overlooking the skyline.
- **Key Assets**:
  1. **Executive Racetrack Conference Table**:
     - Dimensions: `Length: 7.2m, Width: 2.0m, Height: 0.75m`
     - Position: Center `[12.0, 0.0, -6.0]`
     - Finish: Bookmatched American walnut with chamfered perimeter edge, central brushed aluminum connectivity troughs with pop-up AC/USB/HDMI modules.
  2. **Executive Conference Chairs (12 Seats)**:
     - 5 chairs along North side, 5 chairs along South side, 1 captain chair at East head, 1 captain chair at West head.
     - Design: Mid-century high-back ribbed leather chairs on polished chrome 5-star swivel bases (`metalness: 0.95`, `roughness: 0.12`, leather `roughness: 0.35`).
  3. **85" Ultra-HD Smart Presentation Display**:
     - Dimensions: `Width: 2.1m, Height: 1.2m, Depth: 0.06m`
     - Position: Mounted on North wall `[12.0, 2.2, -11.85]`
     - Interaction: Clickable interactive screen hotspot with switchable presentation slide decks:
       - *Slide 1: Q3 Global Revenue & Performance Metrics*
       - *Slide 2: Autonomous AI Multi-Agent Architecture Diagram*
       - *Slide 3: Real-Time Cloud Infrastructure & Latency Heatmap*
       - *Slide 4: Interactive Video Conference Call Grid (Remote Team)*
  4. **Conference Props & Acoustics**:
     - Polycom-style triangular conference speakerphone puck at table center with glowing LED status ring (`emissive: 0x22c55e`).
     - Glass carafes with crystal drinking tumblers.
     - Acoustic ceiling cloud baffles suspended at `Y: 3.5m` with integrated recessed linear warm LED light bars (`emissive: 0xfff0dd`, `intensity: 1.2`).
     - Freestanding rolling glass whiteboard `[7.5, 0.0, -10.0]` with architectural system diagrams.

---

#### Zone 4: Executive Lounge, Breakroom & Café
- **Center Coordinate**: `X: 12.0, Y: 0.0, Z: 7.5`
- **Room Dimensions**: `Width: 12.0m (X: 6.0 to 18.0), Depth: 9.0m (Z: 3.0 to 12.0)`
- **Key Assets**:
  1. **L-Shaped Gourmet Coffee Bar & Kitchenette**:
     - Counter Dimensions: Long run `6.0m` along East wall (`X: 16.5, Z: [4.0 to 10.0]`), Return island `3.0m` (`Z: 4.0, X: [13.5 to 16.5]`), `Height: 0.92m`.
     - Materials: Calacatta gold white marble countertop with waterfall edge, matte black cabinetry with brass bar pulls.
     - Commercial Dual-Group Espresso Machine:
       - Position: `[16.5, 0.92, 6.0]`
       - Features: Chrome boilers, pressure dials, portafilters, steam wands, ceramic espresso cup stack on top warmer tray.
       - Interaction: Clickable hotspot that plays espresso brewing audio and triggers steam particle animation.
     - Stainless Steel Double Refrigerator, built-in microwave, under-mount sink with gooseneck faucet, glass display case with pastries.
  2. **Breakfast & Casual Bar Stools**:
     - 4 tall Scandinavian minimalist bar stools (`Height: 0.72m`) along the return island with black iron legs and curved oak seats.
  3. **Casual Lounge Relaxation Zone**:
     - Position: `[9.5, 0.0, 8.5]`
     - Furniture: Deep L-shaped modular sectional sofa in petrol blue velvet (`3.2m x 2.4m x 0.78m`) with plush accent pillows (ochre and cream).
     - Low round marble & brass nesting coffee tables (`Diameter: 0.8m` and `0.5m`).
     - 2 contemporary mustard-yellow velvet swivel club chairs.
     - Plush high-pile round area rug (`Diameter: 3.6m`).
  4. **Media & Entertainment Feature**:
     - 65" Wall-mounted ambient TV display on South wall `[9.5, 2.0, 11.85]` showing tech news, ambient nature visuals, or company announcements.
     - Floor-to-ceiling architectural open bookshelf unit (`X: 6.2, Z: [6.0 to 10.0]`) filled with art books, design awards, trailing pothos plants in pots, and decorative stoneware ceramics.
  5. **Large Indoor Greenery & Potted Plants**:
     - Large Fiddle Leaf Fig (Ficus Lyrata) tree in a 0.6m white ceramic fluted cylinder pot `[6.5, 0.0, 3.5]`.
     - Clustered Monstera Deliciosa and Snake Plants (Sansevieria) in terracotta and brass pots `[17.0, 0.0, 11.0]`.

---

#### Zone 5: Central Circulation Corridor & Structural Grid
- **Center Coordinate**: `X: 0.0, Y: 0.0, Z: 1.5` (Connecting all zones)
- **Key Assets**:
  1. **Structural Architectural Columns**:
     - 6 reinforced concrete columns clad in vertical fluted oak paneling (`0.6m x 0.6m x 4.0m`):
       - Column 1: `[-6.0, 0.0, 1.5]`
       - Column 2: `[6.0, 0.0, 1.5]`
       - Column 3: `[-6.0, 0.0, -11.5]`
       - Column 4: `[6.0, 0.0, -11.5]`
       - Column 5: `[-6.0, 0.0, 11.5]`
       - Column 6: `[6.0, 0.0, 11.5]`
  2. **Wayfinding Signage Totem**:
     - Sleek floor-standing monolith at `[0.0, 0.0, 4.0]` with backlit directory arrows:
       - `⬅ Reception & Lobby`
       - `⬆ Open Workstations & Labs`
       - `➡ Executive Boardroom & Café`
  3. **Ceiling Recessed Linear Lighting Grid**:
     - Modular suspended architectural ceiling grid (`2m x 2m` tiles) with flush LED diffusers along the main hallway.

---

### 6.3 PBR & Physical Material Registry

All materials are instantiated once and shared across geometries to optimize GPU state changes:

```typescript
// Shared PBR Material Registry
export interface MaterialLibrary {
  floorParquet: THREE.MeshStandardMaterial;
  floorTile: THREE.MeshStandardMaterial;
  wallDrywall: THREE.MeshStandardMaterial;
  wallAccentWood: THREE.MeshStandardMaterial;
  glassClear: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  glassFrosted: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  metalBlackMatte: THREE.MeshStandardMaterial;
  metalChrome: THREE.MeshStandardMaterial;
  metalBrass: THREE.MeshStandardMaterial;
  woodOak: THREE.MeshStandardMaterial;
  woodWalnut: THREE.MeshStandardMaterial;
  leatherCognac: THREE.MeshStandardMaterial;
  leatherBlack: THREE.MeshStandardMaterial;
  fabricVelvetBlue: THREE.MeshStandardMaterial;
  marbleWhite: THREE.MeshStandardMaterial;
  screenEmissive: THREE.MeshStandardMaterial;
  ledGlowWarm: THREE.MeshBasicMaterial;
  ledGlowCyan: THREE.MeshBasicMaterial;
  foliageGreen: THREE.MeshStandardMaterial;
}

export function createMaterialLibrary(): MaterialLibrary {
  // 1. Procedural Texture Generators (Canvas-backed)
  const parquetTex = createParquetTexture();
  const woodOakTex = createWoodGrainTexture('#c89d7c', '#9b6b43');
  const woodWalnutTex = createWoodGrainTexture('#5a3d28', '#382214');
  const marbleTex = createMarbleTexture();
  const drywallNormalTex = createStippleNormalTexture();
  
  return {
    floorParquet: new THREE.MeshStandardMaterial({
      map: parquetTex,
      roughness: 0.28,
      metalness: 0.05,
      roughnessMap: parquetTex,
      envMapIntensity: 0.8
    }),
    floorTile: new THREE.MeshStandardMaterial({
      color: 0x22252a,
      roughness: 0.2,
      metalness: 0.15,
      clearcoat: 0.3,
      clearcoatRoughness: 0.1
    }),
    wallDrywall: new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.88,
      metalness: 0.02,
      normalMap: drywallNormalTex,
      normalScale: new THREE.Vector2(0.04, 0.04)
    }),
    wallAccentWood: new THREE.MeshStandardMaterial({
      map: woodWalnutTex,
      roughness: 0.45,
      metalness: 0.05
    }),
    glassClear: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      roughness: 0.04,
      metalness: 0.05,
      transmission: 0.94,
      ior: 1.52,
      thickness: 0.05,
      reflectivity: 0.6,
      envMapIntensity: 1.5
    }),
    glassFrosted: new THREE.MeshStandardMaterial({
      color: 0xeef4f8,
      transparent: true,
      opacity: 0.65,
      roughness: 0.45,
      metalness: 0.1
    }),
    metalBlackMatte: new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.35,
      metalness: 0.85
    }),
    metalChrome: new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      roughness: 0.12,
      metalness: 0.95,
      envMapIntensity: 1.8
    }),
    metalBrass: new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.25,
      metalness: 0.88
    }),
    woodOak: new THREE.MeshStandardMaterial({
      map: woodOakTex,
      roughness: 0.5,
      metalness: 0.02
    }),
    woodWalnut: new THREE.MeshStandardMaterial({
      map: woodWalnutTex,
      roughness: 0.42,
      metalness: 0.02
    }),
    leatherCognac: new THREE.MeshStandardMaterial({
      color: 0x9a4d27,
      roughness: 0.38,
      metalness: 0.05
    }),
    leatherBlack: new THREE.MeshStandardMaterial({
      color: 0x202022,
      roughness: 0.4,
      metalness: 0.05
    }),
    fabricVelvetBlue: new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.82,
      metalness: 0.0
    }),
    marbleWhite: new THREE.MeshStandardMaterial({
      map: marbleTex,
      roughness: 0.15,
      metalness: 0.08,
      clearcoat: 0.5
    }),
    screenEmissive: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1,
      emissive: 0xffffff,
      emissiveIntensity: 1.0
    }),
    ledGlowWarm: new THREE.MeshBasicMaterial({
      color: 0xffb366
    }),
    ledGlowCyan: new THREE.MeshBasicMaterial({
      color: 0x38bdf8
    }),
    foliageGreen: new THREE.MeshStandardMaterial({
      color: 0x23532b,
      roughness: 0.55,
      metalness: 0.02,
      side: THREE.DoubleSide
    })
  };
}
```

---

### 6.4 Lighting Architecture & Day/Sunset/Night Presets

The lighting rig consists of 4 tiers:
1. **Primary Directional Sun/Moon Light** (`castShadow: true`, `shadow.mapSize: 2048x2048`, `shadow.bias: -0.0001`).
2. **Hemisphere / Ambient Sky Light** for soft indirect illumination and shadow lift.
3. **Interior Recessed Downlight Grid** (Grid of 8 localized point lights distributed over zones).
4. **Accent Emissive / Localized Lamps** (Desk lamps, under-counter LED, screen glows).

#### Lighting Configuration Matrix

| Parameter | Day Preset (Productive Morning) | Sunset Preset (Golden Hour) | Night Preset (Cyberpunk Tech) |
|---|---|---|---|
| **Sun / Directional Light** | `Color: 0xfff6e5` | `Color: 0xff6a22` | `Color: 0x3b82f6` |
| Intensity | `1.8` | `2.4` | `0.35` |
| Position `[X, Y, Z]` | `[22.0, 28.0, 18.0]` | `[35.0, 9.0, 12.0]` (Low Angle) | `[-20.0, 25.0, -15.0]` |
| **Hemisphere Sky / Ground** | Sky: `0xe2e8f0`, Ground: `0x94a3b8` | Sky: `0x7c2d12`, Ground: `0x1e1b4b` | Sky: `0x0f172a`, Ground: `0x020617` |
| Ambient Intensity | `0.75` | `0.45` | `0.25` |
| **Ceiling Downlights** | `Color: 0xfff4e6`, Intensity: `0.35` | `Color: 0xffaa55`, Intensity: `0.85` | `Color: 0x60a5fa`, Intensity: `1.4` |
| **Background / ClearColor** | `0xdbeafe` (Soft Sky Blue) | `0x31101e` (Dusk Amber/Rose) | `0x05070c` (Obsidian Night) |
| **Fog** | `LinearFog(0xdbeafe, 25m, 70m)` | `LinearFog(0x31101e, 20m, 60m)` | `LinearFog(0x05070c, 18m, 55m)` |
| **Screen & LED Glows** | Emissive Intensity: `0.8` | Emissive Intensity: `1.2` | Emissive Intensity: `1.8` |
| **Window Blind Shadows** | Crisp diagonal sunlight slats | Dramatic long warm shadows | Subtle cool moonlight silhouette |

---

### 6.5 Procedural 3D Geometry Strategy & Code Patterns

#### 1. Procedural Desk & Dual Monitor Generator Pattern
```typescript
export function createWorkstationDesk(materials: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  
  // 1. Tabletop
  const topGeo = new THREE.BoxGeometry(1.6, 0.04, 0.8);
  const topMesh = new THREE.Mesh(topGeo, materials.woodOak);
  topMesh.position.set(0, 0.72, 0);
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  group.add(topMesh);
  
  // 2. Steel Legs (Merged)
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.70, 12);
  const leg1 = new THREE.Mesh(legGeo, materials.metalBlackMatte);
  leg1.position.set(-0.72, 0.35, -0.32);
  const leg2 = leg1.clone(); leg2.position.set(0.72, 0.35, -0.32);
  const leg3 = leg1.clone(); leg3.position.set(-0.72, 0.35, 0.32);
  const leg4 = leg1.clone(); leg4.position.set(0.72, 0.35, 0.32);
  group.add(leg1, leg2, leg3, leg4);
  
  // 3. Acoustic Divider
  const dividerGeo = new THREE.BoxGeometry(1.6, 0.38, 0.03);
  const divider = new THREE.Mesh(dividerGeo, materials.fabricVelvetBlue);
  divider.position.set(0, 0.91, -0.39);
  group.add(divider);
  
  // 4. Dual Monitors
  const standGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 12);
  const stand = new THREE.Mesh(standGeo, materials.metalBlackMatte);
  stand.position.set(0, 0.915, -0.2);
  group.add(stand);
  
  const screenBezelGeo = new THREE.BoxGeometry(0.58, 0.34, 0.02);
  const screenPanelGeo = new THREE.PlaneGeometry(0.56, 0.32);
  
  // Left Monitor (Landscape angled)
  const monLeft = new THREE.Group();
  monLeft.position.set(-0.30, 1.02, -0.18);
  monLeft.rotation.y = Math.PI * 0.08;
  const bezelL = new THREE.Mesh(screenBezelGeo, materials.metalBlackMatte);
  const panelL = new THREE.Mesh(screenPanelGeo, materials.screenEmissive);
  panelL.position.z = 0.011;
  monLeft.add(bezelL, panelL);
  
  // Right Monitor (Landscape angled)
  const monRight = new THREE.Group();
  monRight.position.set(0.30, 1.02, -0.18);
  monRight.rotation.y = -Math.PI * 0.08;
  const bezelR = new THREE.Mesh(screenBezelGeo, materials.metalBlackMatte);
  const panelR = new THREE.Mesh(screenPanelGeo, materials.screenEmissive);
  panelR.position.z = 0.011;
  monRight.add(bezelR, panelR);
  
  group.add(monLeft, monRight);
  
  // 5. Mechanical Keyboard & Mouse
  const kbGeo = new THREE.BoxGeometry(0.42, 0.015, 0.14);
  const kb = new THREE.Mesh(kbGeo, materials.metalBlackMatte);
  kb.position.set(-0.05, 0.748, 0.12);
  
  const mouseGeo = new THREE.BoxGeometry(0.06, 0.025, 0.10);
  const mouse = new THREE.Mesh(mouseGeo, materials.metalBlackMatte);
  mouse.position.set(0.25, 0.752, 0.12);
  group.add(kb, mouse);
  
  return group;
}
```

#### 2. Procedural Ergonomic Mesh Chair Generator
```typescript
export function createErgonomicChair(materials: MaterialLibrary): THREE.Group {
  const chair = new THREE.Group();
  
  // 5-Star Base Spokes
  const baseCenter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16),
    materials.metalChrome
  );
  baseCenter.position.y = 0.12;
  chair.add(baseCenter);
  
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.025, 0.03),
      materials.metalChrome
    );
    spoke.position.set(Math.cos(angle) * 0.16, 0.10, Math.sin(angle) * 0.16);
    spoke.rotation.y = -angle;
    
    // Caster Wheel
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12),
      materials.metalBlackMatte
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(Math.cos(angle) * 0.32, 0.03, Math.sin(angle) * 0.32);
    chair.add(spoke, wheel);
  }
  
  // Hydraulic Cylinder
  const piston = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.34, 16),
    materials.metalChrome
  );
  piston.position.y = 0.28;
  chair.add(piston);
  
  // Contoured Seat Cushion
  const seatGeo = new THREE.BoxGeometry(0.50, 0.07, 0.48);
  const seat = new THREE.Mesh(seatGeo, materials.leatherBlack);
  seat.position.set(0, 0.47, 0);
  seat.castShadow = true;
  chair.add(seat);
  
  // Breathable Mesh Curved Backrest
  const backGeo = new THREE.BoxGeometry(0.46, 0.58, 0.04);
  const back = new THREE.Mesh(backGeo, materials.leatherBlack);
  back.position.set(0, 0.78, -0.22);
  back.rotation.x = -0.12;
  chair.add(back);
  
  // Lumbar Support Spine
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.45, 0.06),
    materials.metalBlackMatte
  );
  spine.position.set(0, 0.68, -0.26);
  chair.add(spine);
  
  // 3D Armrests
  const armL = createArmrest(materials, -0.26);
  const armR = createArmrest(materials, 0.26);
  chair.add(armL, armR);
  
  return chair;
}

function createArmrest(materials: MaterialLibrary, xPos: number): THREE.Group {
  const arm = new THREE.Group();
  arm.position.set(xPos, 0.48, 0);
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.22, 0.04),
    materials.metalBlackMatte
  );
  post.position.y = 0.11;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.025, 0.24),
    materials.metalBlackMatte
  );
  pad.position.set(0, 0.22, 0);
  arm.add(post, pad);
  return arm;
}
```

---

### 6.6 Performance Optimization, Instancing & Draw Call Budget

#### Performance Budget Target:
- **Target Frame Rate**: 60 FPS locked (16.6ms / frame).
- **Maximum Draw Calls**: < 50 draw calls per frame.
- **Maximum Triangle Count**: < 120,000 polygons.
- **Memory Footprint**: < 85 MB GPU VRAM.

#### Optimization Implementations:
1. **Instancing Strategy (`THREE.InstancedMesh`)**:
   - `chairBaseInstancedMesh`: 28 instances (Workstations + Conference).
   - `monitorInstancedMesh`: 32 instances.
   - `deskLampInstancedMesh`: 16 instances.
   - `downlightFixtureInstancedMesh`: 30 instances.
   - `pottedLeafInstancedMesh`: 200+ leaf instances with randomized transforms.
2. **Buffer Geometry Merging**:
   - All outer perimeter drywall walls, window mullions, baseboards, and ceiling tiles merged via `BufferGeometryUtils.mergeGeometries()` into 4 unified static meshes (one per shared material).
3. **Frustum & Occlusion Culling**:
   - Automatic frustum culling enabled on all meshes.
   - Zone-based visibility toggles or bounding box optimizations when inspecting specific rooms.

---

### 6.7 AABB Collision Boundaries for Navigation

To provide instant zero-cost collision checking for the First-Person Navigation Controller, the exact world-space Axis-Aligned Bounding Boxes (`THREE.Box3`) are defined below:

```typescript
export interface BoundingBoxDef {
  id: string;
  name: string;
  min: [number, number, number]; // [minX, minY, minZ]
  max: [number, number, number]; // [maxX, maxY, maxZ]
}

export const OFFICE_COLLISION_BOUNDS: BoundingBoxDef[] = [
  // 1. Outer Perimeter Walls
  { id: 'wall_north', name: 'North Exterior Window Wall', min: [-20.5, 0, -13.5], max: [20.5, 4.0, -12.8] },
  { id: 'wall_south', name: 'South Entrance Wall', min: [-20.5, 0, 12.8], max: [20.5, 4.0, 13.5] },
  { id: 'wall_west', name: 'West Perimeter Wall', min: [-20.5, 0, -13.5], max: [-19.8, 4.0, 13.5] },
  { id: 'wall_east', name: 'East Exterior Window Wall', min: [19.8, 0, -13.5], max: [20.5, 4.0, 13.5] },

  // 2. Zone Partitions & Structural Columns
  { id: 'conf_glass_west', name: 'Conference Room Glass Partition', min: [5.8, 0, -13.0], max: [6.2, 4.0, -3.2] }, // with door gap at Z: -2.0 to -3.2
  { id: 'conf_glass_south', name: 'Conference Room South Glass Wall', min: [5.8, 0, -0.2], max: [18.5, 4.0, 0.2] },
  { id: 'col_1', name: 'Structural Column West 1', min: [-6.4, 0, 1.1], max: [-5.6, 4.0, 1.9] },
  { id: 'col_2', name: 'Structural Column East 1', min: [5.6, 0, 1.1], max: [6.4, 4.0, 1.9] },
  { id: 'col_3', name: 'Structural Column North West', min: [-6.4, 0, -11.9], max: [-5.6, 4.0, -11.1] },
  { id: 'col_4', name: 'Structural Column North East', min: [5.6, 0, -11.9], max: [6.4, 4.0, -11.1] },

  // 3. Reception Zone Furniture
  { id: 'reception_desk', name: 'Reception Front Counter', min: [-9.5, 0, 5.2], max: [-4.5, 1.2, 7.2] },
  { id: 'reception_sofa_main', name: 'Visitor Lounge Leather Sofa', min: [-15.0, 0, 7.2], max: [-12.2, 0.85, 8.4] },
  { id: 'reception_coffee_table', name: 'Visitor Glass Coffee Table', min: [-14.5, 0, 8.8], max: [-12.8, 0.5, 9.8] },
  { id: 'reception_kiosk', name: 'Welcome Directory Kiosk', min: [-1.8, 0, 8.7], max: [-1.2, 1.5, 9.3] },

  // 4. Open Workstation Pods
  { id: 'workstation_pod_1', name: 'Desk Pod 1 (North-West)', min: [-14.5, 0, -10.5], max: [-10.5, 1.2, -6.5] },
  { id: 'workstation_pod_2', name: 'Desk Pod 2 (North-Mid)', min: [-6.0, 0, -10.5], max: [-2.0, 1.2, -6.5] },
  { id: 'workstation_pod_3', name: 'Desk Pod 3 (South-West)', min: [-14.5, 0, -5.5], max: [-10.5, 1.2, -1.5] },
  { id: 'workstation_pod_4', name: 'Desk Pod 4 (South-Mid)', min: [-6.0, 0, -5.5], max: [-2.0, 1.2, -1.5] },
  { id: 'whiteboard_mobile', name: 'Mobile Magnetic Whiteboard', min: [-17.8, 0, -7.0], max: [-17.2, 1.9, -5.0] },

  // 5. Executive Conference Room
  { id: 'conference_table', name: 'Racetrack Executive Table & Chairs', min: [8.0, 0, -7.5], max: [16.0, 0.95, -4.5] },
  { id: 'conference_screen_wall', name: 'Presentation Display Stand', min: [10.8, 0, -12.2], max: [13.2, 2.8, -11.7] },

  // 6. Lounge & Breakroom
  { id: 'coffee_bar_main', name: 'Kitchenette Counter Long Run', min: [15.8, 0, 3.5], max: [17.5, 1.1, 10.5] },
  { id: 'coffee_bar_island', name: 'Kitchenette Bar Island', min: [13.0, 0, 3.5], max: [16.0, 1.1, 4.5] },
  { id: 'lounge_sectional_sofa', name: 'L-Shaped Velvet Sectional', min: [7.8, 0, 7.0], max: [11.5, 0.85, 10.2] },
  { id: 'lounge_coffee_table', name: 'Lounge Marble Coffee Tables', min: [8.5, 0, 7.8], max: [10.5, 0.5, 9.2] },
  { id: 'bookshelf_unit', name: 'Architectural Bookshelf Display', min: [5.8, 0, 6.0], max: [6.4, 2.6, 10.0] }
];
```

---

### 6.8 Teleportation & Camera Waypoints

For the Quick-Teleport menu and automated cinematic camera transitions:

```typescript
export interface CameraWaypoint {
  zoneId: string;
  name: string;
  fpsPosition: [number, number, number];
  fpsLookAt: [number, number, number];
  orbitPosition: [number, number, number];
  orbitTarget: [number, number, number];
}

export const OFFICE_WAYPOINTS: Record<string, CameraWaypoint> = {
  reception: {
    zoneId: 'reception',
    name: 'Welcome Reception',
    fpsPosition: [-7.0, 1.6, 10.5],
    fpsLookAt: [-7.0, 1.5, 6.0],
    orbitPosition: [-7.0, 14.0, 15.0],
    orbitTarget: [-7.0, 0.0, 7.5]
  },
  workstations: {
    zoneId: 'workstations',
    name: 'Open Workstations',
    fpsPosition: [-8.0, 1.6, 0.5],
    fpsLookAt: [-8.0, 1.4, -6.0],
    orbitPosition: [-8.0, 18.0, 4.0],
    orbitTarget: [-8.0, 0.0, -6.0]
  },
  conference: {
    zoneId: 'conference',
    name: 'Executive Conference Room',
    fpsPosition: [7.5, 1.6, -2.5],
    fpsLookAt: [12.0, 1.4, -6.0],
    orbitPosition: [12.0, 15.0, 3.0],
    orbitTarget: [12.0, 0.0, -6.0]
  },
  lounge: {
    zoneId: 'lounge',
    name: 'Lounge & Breakroom',
    fpsPosition: [10.0, 1.6, 4.5],
    fpsLookAt: [13.0, 1.4, 8.0],
    orbitPosition: [12.0, 14.0, 14.0],
    orbitTarget: [12.0, 0.0, 7.5]
  },
  overview: {
    zoneId: 'overview',
    name: 'Entire Floorplan Overview',
    fpsPosition: [0.0, 1.6, 11.0],
    fpsLookAt: [0.0, 1.5, 0.0],
    orbitPosition: [0.0, 32.0, 24.0],
    orbitTarget: [0.0, 0.0, 0.0]
  }
};
```

---
*End of Architectural Survey Report.*
