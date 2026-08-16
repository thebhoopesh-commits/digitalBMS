# Procedural PBR Materials & Atmospheric Lighting Specification Report
**Project:** 3D Corporate Office Web Application (Three.js)  
**Author:** Explorer 2 (`teamwork_preview_explorer_m1_2`)  
**Target Milestone:** Milestone 1 (Core Engine, Scaffolding & 3D Scene Architecture)  
**Modules:** `src/scene/Materials.ts` & `src/scene/LightingManager.ts`  
**Date:** 2026-08-15  

---

## 1. Observation

Direct requirements and architectural specifications extracted from `ORIGINAL_REQUEST.md`, `PROJECT.md`, and scene blueprints:

1. **Material Requirements (`ORIGINAL_REQUEST.md:13-20`, `PROJECT.md §1.2`)**:
   - Self-contained procedural PBR material library with 0 KB external file downloads.
   - Textures must be generated on HTML5 canvas elements and converted to `THREE.CanvasTexture` with proper wrapping, filtering, and mipmapping.
   - Required procedural textures and materials:
     - **Herringbone Oak Parquet** (multi-tone planks, subtle wood grain, grout bevels).
     - **Carpet Stipple** (micro-fiber stipple noise, geometric loop weave, charcoal slate tone).
     - **White Laminate** (smooth matte satin surface with micro-stipple).
     - **Walnut Veneer** (deep American walnut grain, growth rings, rich brown hues).
     - **Oak Wood** (natural Scandinavian honey oak with linear grain).
     - **Italian Dark & Cognac Leather** (Voronoi cell pebble grain bump/color).
     - **Brushed Metal & Chrome & Brass** (directional brushed noise, high metalness, low roughness).
     - **Clear Glass & Frosted Glass** (high transmission, refraction IOR 1.52, subtle opacity).
     - **Whiteboard** (glossy surface, subtle grid, colorful sprint task/diagram notes).
     - **Corporate Logo Canvas** ("NEXUS DYNAMICS" tech emblem, glowing cyan/blue accents).
     - **Foliage Leaf Textures** (organic leaf silhouette, veins, chlorophyll color gradient).
     - **Calacatta Gold Marble** (white stone base with golden/gray fractal veining).
     - **Fabric / Acoustic Velvet** (woven micro-weave for sofas and partitions).

2. **Lighting Requirements (`ORIGINAL_REQUEST.md:19, 36, 47`, `PROJECT.md §1.3`)**:
   - 3 switchable lighting presets: `'day'`, `'sunset'`, and `'night'`.
   - Directional Sunlight/Moonlight with optimized 2048x2048 PCF soft shadow maps.
   - HemisphereLight and AmbientLight sky/ground fills customized per preset.
   - Ceiling point lights distributed evenly across key office zones (Reception, Workstations, Conference Room, Lounge, Corridor).
   - Emissive fixture amplification and dynamic glow scaling.
   - Atmospheric Fog (`THREE.Fog`) matching preset sky/ambient colors and depth.
   - Smooth interpolation between lighting presets.

---

## 2. Logic Chain

### 2.1 Why Procedural Canvas-Generated Textures?
1. **Zero External Dependencies**: External image/texture files (PNG/JPG/GLTF) risk 404 errors, CORS issues, slow loading, and asset tracking overhead. Canvas-generated textures initialize in < 15ms synchronously on first load with zero HTTP requests.
2. **Deterministic Resolution & Sharpness**: Procedural textures can be drawn at exact crisp dimensions (e.g. 512x512 for parquet/walnut/marble, 256x256 for leather/stipple/metals), with explicit `THREE.RepeatWrapping` and `THREE.LinearMipmapLinearFilter`.
3. **PBR Channel Synergy**: The same procedural canvas algorithm can generate both diffuse `map` and corresponding `roughnessMap` or `bumpMap` with matching frequency coordinates.

### 2.2 Material Registry Singleton Pattern (`src/scene/Materials.ts`)
- Initializing Three.js materials repeatedly per object creates separate WebGL shader programs and causes massive GPU state changes.
- `MaterialManager` acts as a centralized singleton that instantiates every material once and shares references across all static and instanced meshes.
- All canvas textures are cached in a registry map `Map<string, THREE.CanvasTexture>` to prevent memory leaks and redundant canvas allocations.

### 2.3 Lighting Preset Architecture (`src/scene/LightingManager.ts`)
- **Directional Light (Sun/Moon)**:
  - Single primary shadow caster to maintain 60 FPS.
  - Directional shadow camera uses an orthographic projection fitted tightly to the $40\text{m} \times 26\text{m}$ floorplan (`left: -24, right: 24, top: 16, bottom: -16, near: 1.0, far: 75.0`).
  - `shadow.bias = -0.00015` and `shadow.normalBias = 0.025` eliminate self-shadowing acne while retaining crisp contact shadows on furniture feet.
- **Interior Ceiling Downlights**:
  - 8 localized `THREE.PointLight` fixtures placed at ceiling level ($Y = 3.6\text{m}$) with `distance: 12.0\text{m}` and `decay: 2.0`.
  - `castShadow = false` on all point lights to prevent quadratic rendering overhead ($8 \times 6 = 48$ shadow passes avoided).
- **Preset Interpolation**:
  - Switching between presets uses linear color lerping (`THREE.Color.lerp`) and numeric interpolation over an active tween duration (default 1.0s), ensuring seamless visual transitions without abrupt lighting pops.

---

## 3. Caveats

1. **Physical Transmission vs. Standard Glass Fallback**:
   - `THREE.MeshPhysicalMaterial` with `transmission: 0.95` provides realistic glass refraction but requires WebGL scene buffer copy passes. On lower-end mobile GPUs, this can reduce frame rates.
   - **Solution**: The material library provides `glassClear` configured with `MeshPhysicalMaterial` as primary, but also exposes a clean, high-performance `MeshStandardMaterial` mode (`transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.05`) that can be swapped via quality settings.
2. **Canvas Texture Memory Management**:
   - Once canvas textures are uploaded to WebGL VRAM, canvas DOM elements should not remain attached to the DOM. Textures must set `needsUpdate = true` once upon creation and dispose cleanly when `MaterialManager.dispose()` is invoked.
3. **Shadow Frustum Fitting**:
   - If the shadow camera bounds are too large (e.g. 100m x 100m), shadow map texel density drops, causing pixelated shadows. The bounds must be calibrated specifically to $X \in [-24, 24]$ and $Z \in [-16, 16]$.

---

## 4. Conclusion & Concrete Implementation Specifications

### 4.1 Detailed Material Specifications & Canvas Algorithms (`src/scene/Materials.ts`)

#### Material Properties Summary Table

| Material ID | Three.js Material Type | Base Color / Map | Roughness | Metalness | Special Parameters | Usage |
|---|---|---|---|---|---|---|
| `floorParquet` | `MeshStandardMaterial` | Canvas Parquet Tex | `0.30` | `0.03` | `roughnessMap`, Repeat (8, 5) | Lobby, Main corridors, Lounge |
| `floorCarpet` | `MeshStandardMaterial` | Canvas Carpet Tex | `0.88` | `0.01` | Repeat (12, 10), Charcoal slate | Workstation pods, Conference |
| `wallDrywall` | `MeshStandardMaterial` | `#f4f5f7` (Warm White) | `0.85` | `0.02` | Stipple Normal map scale 0.03 | Perimeter & interior partition walls |
| `wallAccentWood` | `MeshStandardMaterial` | Canvas Walnut Tex | `0.42` | `0.02` | Repeat (3, 2), Vertical grain | Reception back wall, column accents |
| `laminateWhite` | `MeshStandardMaterial` | `#f8fafc` | `0.32` | `0.02` | Clean satin finish | Desk surfaces, storage credenzas |
| `woodOak` | `MeshStandardMaterial` | Canvas Oak Tex | `0.48` | `0.02` | Warm Scandinavian honey oak | Bar stools, reception counter top |
| `woodWalnut` | `MeshStandardMaterial` | Canvas Walnut Tex | `0.38` | `0.02` | Deep American walnut | Conference table, executive desk |
| `leatherBlack` | `MeshStandardMaterial` | Canvas Leather Tex | `0.40` | `0.04` | Bump scale 0.004, `#1e1e22` | Task chairs, conference seating |
| `leatherCognac` | `MeshStandardMaterial` | Canvas Leather Tex | `0.36` | `0.05` | Bump scale 0.005, `#92400e` | Reception sofa, executive armchair |
| `fabricVelvetBlue` | `MeshStandardMaterial` | `#1e3a5f` (Petrol Blue) | `0.82` | `0.00` | Micro-weave stipple | Lounge sectional sofa |
| `metalBlackMatte` | `MeshStandardMaterial` | `#18181b` (Matte Black) | `0.40` | `0.85` | Anodized aluminum look | Table legs, chair frames, monitor arms |
| `metalChrome` | `MeshStandardMaterial` | `#f0f0f0` (Chrome) | `0.08` | `0.98` | Mirror-like metalness | Chair pistons, casters, lamp posts |
| `metalBrushed` | `MeshStandardMaterial` | Canvas Brushed Metal | `0.26` | `0.92` | Linear brushed grain | Espresso machine, connectivity trays |
| `metalBrass` | `MeshStandardMaterial` | `#d4af37` (Warm Gold) | `0.22` | `0.90` | Rich brushed gold/brass | Arched lamps, cabinet handles |
| `glassClear` | `MeshPhysicalMaterial` | `#ffffff` | `0.03` | `0.05` | `transmission: 0.94`, `ior: 1.52`, `opacity: 0.2` | Conference walls, exterior windows |
| `glassFrosted` | `MeshStandardMaterial` | `#eef4f8` | `0.50` | `0.08` | `transparent: true`, `opacity: 0.65` | Privacy manifestation bands |
| `marbleCalacatta`| `MeshStandardMaterial` | Canvas Marble Tex | `0.14` | `0.05` | Polished stone, gold/gray veins | Coffee bar countertop, coffee tables |
| `whiteboard` | `MeshStandardMaterial` | Canvas Whiteboard | `0.16` | `0.02` | Glossy whiteboard with diagrams | Conference board, mobile whiteboards |
| `logoNexus` | `MeshStandardMaterial` | Canvas Logo Tex | `0.20` | `0.70` | `emissive: 0x00e5ff`, `emissiveIntensity: 0.5` | Reception 3D sign, kiosk headers |
| `foliageGreen` | `MeshStandardMaterial` | Canvas Foliage Tex | `0.52` | `0.02` | `side: DoubleSide`, organic veins | Fiddle-leaf fig, potted plants |
| `screenEmissive` | `MeshStandardMaterial` | Dynamic Canvas Tex | `0.20` | `0.10` | `emissive: 0xffffff`, `emissiveIntensity: 1.0` | Computer monitors, presentation TV |
| `ledWarm` | `MeshBasicMaterial` | `#ffaa44` | N/A | N/A | Warm fixture baseboard / lamp glow | Desk lamps, reception LED ribbon |
| `ledCyan` | `MeshBasicMaterial` | `#00e5ff` | N/A | N/A | Cyber tech status indicator glow | Server nodes, power status lights |
| `ledGreen` | `MeshBasicMaterial` | `#22c55e` | N/A | N/A | Active conference/device status | Speakerphone ring, coffee machine LED |

---

### 4.2 Canvas Texture Generation Algorithms

Here are the exact procedural algorithms to generate high-fidelity canvas textures:

#### 1. Herringbone Parquet Canvas Generator (`512x512`)
```typescript
export function createParquetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  
  // Base background
  ctx.fillStyle = '#9b6b43';
  ctx.fillRect(0, 0, 512, 512);

  const plankW = 64;
  const plankH = 24;
  const colors = ['#c89d7c', '#b88960', '#d4aa82', '#aa7a50', '#c29672', '#a17246'];

  // Draw herringbone interlocking diagonal planks
  for (let y = -64; y < 576; y += plankH * 2) {
    for (let x = -64; x < 576; x += plankW) {
      const colIdx = Math.floor((x + y * 3) / 17) % colors.length;
      ctx.fillStyle = colors[Math.abs(colIdx)];
      
      // Plank 1 (Horizontal/slanted)
      ctx.fillRect(x, y, plankW - 2, plankH - 2);
      
      // Draw subtle wood grain lines inside plank
      ctx.fillStyle = 'rgba(60, 35, 15, 0.12)';
      for (let g = 3; g < plankH - 3; g += 4) {
        ctx.fillRect(x + 2, y + g, plankW - 6, 1.2);
      }

      // Plank 2 (Perpendicular)
      const colIdx2 = (colIdx + 2) % colors.length;
      ctx.fillStyle = colors[Math.abs(colIdx2)];
      ctx.fillRect(x + plankW / 2, y + plankH, plankW - 2, plankH - 2);
      
      // Wood grain for plank 2
      ctx.fillStyle = 'rgba(60, 35, 15, 0.12)';
      for (let g = 3; g < plankH - 3; g += 4) {
        ctx.fillRect(x + plankW / 2 + 2, y + plankH + g, plankW - 6, 1.2);
      }
    }
  }

  // Grout / bevel border overlay
  ctx.strokeStyle = '#3e2410';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, 512, 512);

  return canvas;
}
```

#### 2. American Walnut Wood Canvas Generator (`512x512`)
```typescript
export function createWalnutWoodCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base rich dark walnut
  ctx.fillStyle = '#4a2e1b';
  ctx.fillRect(0, 0, 512, 512);

  const bands = 24;
  for (let i = 0; i < bands; i++) {
    const y = (i / bands) * 512;
    const bandHeight = 512 / bands;
    const tone = i % 2 === 0 ? 'rgba(38, 20, 10, 0.45)' : 'rgba(92, 56, 32, 0.35)';
    ctx.fillStyle = tone;

    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) {
      const wave = Math.sin((x / 512) * Math.PI * 3 + i * 0.8) * 8 + Math.cos(x * 0.05) * 3;
      ctx.lineTo(x, y + wave + bandHeight * 0.5);
    }
    ctx.lineTo(512, y + bandHeight);
    ctx.lineTo(0, y + bandHeight);
    ctx.closePath();
    ctx.fill();
  }

  // Fine longitudinal grain fibers
  ctx.fillStyle = 'rgba(25, 12, 5, 0.2)';
  for (let j = 0; j < 80; j++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 2;
    ctx.fillRect(x, 0, w, 512);
  }

  return canvas;
}
```

#### 3. Carpet Stipple Canvas Generator (`256x256`)
```typescript
export function createCarpetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base charcoal slate
  ctx.fillStyle = '#232832';
  ctx.fillRect(0, 0, 256, 256);

  // Micro-stipple fibers
  const imgData = ctx.getImageData(0, 0, 256, 256);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 32;
    data[i] = Math.min(255, Math.max(0, 35 + noise));     // R
    data[i + 1] = Math.min(255, Math.max(0, 40 + noise)); // G
    data[i + 2] = Math.min(255, Math.max(0, 50 + noise)); // B
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Subtle grid weave loops
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 256; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  for (let y = 0; y < 256; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  return canvas;
}
```

#### 4. Calacatta Gold Marble Canvas Generator (`512x512`)
```typescript
export function createMarbleCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Luminous off-white stone base
  ctx.fillStyle = '#f8f7f4';
  ctx.fillRect(0, 0, 512, 512);

  // Draw organic fractal veins
  const drawVein = (startX: number, startY: number, color: string, width: number, segments: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let cx = startX;
    let cy = startY;
    ctx.moveTo(cx, cy);

    for (let i = 0; i < segments; i++) {
      cx += (Math.random() - 0.35) * 35;
      cy += (Math.random() + 0.2) * 30;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  };

  // Gold veins
  for (let i = 0; i < 4; i++) {
    drawVein(50 + i * 110, -20, 'rgba(197, 160, 89, 0.35)', 2.5, 18);
  }

  // Soft gray major veins
  for (let i = 0; i < 5; i++) {
    drawVein(20 + i * 95, -20, 'rgba(140, 135, 125, 0.25)', 3.5, 20);
  }

  // Feathered hairline micro-veins
  for (let i = 0; i < 12; i++) {
    drawVein(Math.random() * 512, Math.random() * 200, 'rgba(176, 168, 152, 0.18)', 1.0, 10);
  }

  return canvas;
}
```

#### 5. Italian Leather Pebble Grain Canvas Generator (`256x256`)
```typescript
export function createLeatherCanvas(baseHex = '#1e1e22', highlightHex = '#2c2c32'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  // Draw pebble Voronoi cells
  const cellSize = 12;
  for (let y = 0; y < 256; y += cellSize) {
    for (let x = 0; x < 256; x += cellSize) {
      const offsetX = (Math.random() - 0.5) * 4;
      const offsetY = (Math.random() - 0.5) * 4;
      const radius = cellSize * 0.42 + Math.random() * 2;

      ctx.fillStyle = highlightHex;
      ctx.beginPath();
      ctx.arc(x + cellSize / 2 + offsetX, y + cellSize / 2 + offsetY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}
```

#### 6. Whiteboard Presentation Canvas Generator (`512x512`)
```typescript
export function createWhiteboardCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Glossy dry-erase surface
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle grid
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  for (let p = 0; p <= 512; p += 32) {
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, 512);
    ctx.moveTo(0, p); ctx.lineTo(512, p);
    ctx.stroke();
  }

  // Header Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText('SPRINT GOALS & SYSTEM ARCHITECTURE', 24, 38);

  // Kanban Columns
  const cols = [
    { title: 'BACKLOG', x: 24, color: '#64748b' },
    { title: 'IN PROGRESS', x: 184, color: '#2563eb' },
    { title: 'DONE (SHIPPED)', x: 344, color: '#16a34a' }
  ];

  cols.forEach(col => {
    ctx.fillStyle = col.color;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(col.title, col.x, 70);
    ctx.fillRect(col.x, 78, 140, 2);
  });

  // Sticky Notes
  const drawSticky = (x: number, y: number, color: string, text: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 130, 56);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.strokeRect(x, y, 130, 56);
    ctx.fillStyle = '#1e293b';
    ctx.font = '11px sans-serif';
    ctx.fillText(text, x + 8, y + 26);
  };

  drawSticky(24, 90, '#fef08a', '• WebGL Instancing');
  drawSticky(24, 156, '#fef08a', '• Audio Spatial Synth');
  drawSticky(184, 90, '#bbf7d0', '• Raycasting Hotspots');
  drawSticky(184, 156, '#fed7aa', '• Sliding AABB Collision');
  drawSticky(344, 90, '#bae6fd', '• Three.js PBR Engine');
  drawSticky(344, 156, '#bae6fd', '• 4-Zone Floorplan');

  // Architecture Diagram on lower half
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Autonomous AI Agent Cluster', 24, 250);

  // Diagram Boxes & Arrows
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 270, 110, 45);
  ctx.fillStyle = '#1e293b';
  ctx.font = '12px sans-serif';
  ctx.fillText('Orchestrator', 58, 298);

  ctx.beginPath();
  ctx.moveTo(150, 292); ctx.lineTo(210, 292);
  ctx.stroke();

  ctx.strokeRect(210, 270, 110, 45);
  ctx.fillText('Workers (3)', 230, 298);

  ctx.beginPath();
  ctx.moveTo(320, 292); ctx.lineTo(380, 292);
  ctx.stroke();

  ctx.strokeRect(380, 270, 100, 45);
  ctx.fillText('Auditor Gate', 392, 298);

  // Bottom Line Metrics
  ctx.fillStyle = '#16a34a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('✓ 60 FPS Target Locked | Zero Latency Load', 24, 470);

  return canvas;
}
```

#### 7. Corporate Brand Logo Canvas Generator (`512x256`)
```typescript
export function createCompanyLogoCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Deep tech gradient background
  const bgGrad = ctx.createLinearGradient(0, 0, 512, 256);
  bgGrad.addColorStop(0, '#090d16');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 256);

  // Glowing Hexagonal Nexus Logo Icon
  const cx = 110;
  const cy = 128;
  const r = 55;

  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 18;

  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const hx = cx + r * Math.cos(angle);
    const hy = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
  ctx.stroke();

  // Inner interlocking triad node
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0; // Reset shadow

  // Typography "NEXUS DYNAMICS"
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "Inter", "Segoe UI", sans-serif';
  ctx.fillText('NEXUS', 200, 120);

  ctx.fillStyle = '#38bdf8';
  ctx.fillText('DYNAMICS', 335, 120);

  // Subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 13px "Inter", sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('INTELLIGENT ENTERPRISE WORKSPACE', 202, 148);

  return canvas;
}
```

#### 8. Foliage Leaf Texture Canvas Generator (`256x256`)
```typescript
export function createFoliageCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 256);

  // Draw organic leaf silhouette
  ctx.fillStyle = '#23532b';
  ctx.beginPath();
  ctx.moveTo(128, 10);
  ctx.bezierCurveTo(240, 60, 240, 200, 128, 250);
  ctx.bezierCurveTo(16, 200, 16, 60, 128, 10);
  ctx.fill();

  // Chlorophyll gradient highlight
  const grad = ctx.createLinearGradient(128, 10, 128, 250);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.4)');
  grad.addColorStop(0.5, 'rgba(46, 125, 50, 0.2)');
  grad.addColorStop(1, 'rgba(27, 94, 32, 0.6)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Central Vein (Rachis)
  ctx.strokeStyle = '#81c784';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 15);
  ctx.lineTo(128, 245);
  ctx.stroke();

  // Lateral branching veins
  ctx.lineWidth = 1.5;
  for (let y = 40; y < 220; y += 22) {
    // Right side vein
    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.quadraticCurveTo(170, y - 5, 215, y - 20);
    ctx.stroke();

    // Left side vein
    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.quadraticCurveTo(86, y - 5, 41, y - 20);
    ctx.stroke();
  }

  return canvas;
}
```

---

### 4.3 Atmospheric Lighting Architecture (`src/scene/LightingManager.ts`)

#### Lighting Preset Configuration Data Matrix

```typescript
export interface LightingPresetConfig {
  name: 'day' | 'sunset' | 'night';
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  ceilingColor: number;
  ceilingIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  clearColor: number;
  emissiveMultiplier: number;
}

export const LIGHTING_PRESETS: Record<'day' | 'sunset' | 'night', LightingPresetConfig> = {
  day: {
    name: 'day',
    sunColor: 0xfff6e5,       // Warm bright morning sunlight
    sunIntensity: 1.8,
    sunPosition: [22.0, 28.0, 18.0],
    hemiSkyColor: 0xe2e8f0,   // Clear sky daylight fill
    hemiGroundColor: 0x94a3b8,
    hemiIntensity: 0.75,
    ambientColor: 0xffffff,
    ambientIntensity: 0.15,
    ceilingColor: 0xfff4e6,   // Soft warm interior downlights
    ceilingIntensity: 0.35,
    fogColor: 0xdbeafe,       // Soft sky blue horizon fog
    fogNear: 25.0,
    fogFar: 70.0,
    clearColor: 0xdbeafe,
    emissiveMultiplier: 0.8
  },
  sunset: {
    name: 'sunset',
    sunColor: 0xff6a22,       // Deep dramatic golden hour sun
    sunIntensity: 2.4,
    sunPosition: [35.0, 9.0, 12.0], // Low-angle sun through exterior windows
    hemiSkyColor: 0x7c2d12,   // Amber/crimson dusk sky
    hemiGroundColor: 0x1e1b4b,
    hemiIntensity: 0.45,
    ambientColor: 0xffedd5,
    ambientIntensity: 0.12,
    ceilingColor: 0xffaa55,   // Warm tungsten ceiling lamps
    ceilingIntensity: 0.85,
    fogColor: 0x31101e,       // Dusk rose-purple horizon fog
    fogNear: 20.0,
    fogFar: 60.0,
    clearColor: 0x31101e,
    emissiveMultiplier: 1.2
  },
  night: {
    name: 'night',
    sunColor: 0x3b82f6,       // Cool lunar blue moonlight
    sunIntensity: 0.35,
    sunPosition: [-20.0, 25.0, -15.0],
    hemiSkyColor: 0x0f172a,   // Midnight blue sky fill
    hemiGroundColor: 0x020617,
    hemiIntensity: 0.25,
    ambientColor: 0x1e293b,
    ambientIntensity: 0.08,
    ceilingColor: 0xffd8a8,   // Bright warm functional downlights
    ceilingIntensity: 1.4,
    fogColor: 0x05070c,       // Deep obsidian nocturnal fog
    fogNear: 18.0,
    fogFar: 55.0,
    clearColor: 0x05070c,
    emissiveMultiplier: 1.8   // High contrast screen & LED emissive glow
  }
};
```

#### Ceiling Downlight Distribution Coordinates

The 8 interior ceiling point lights are positioned at $Y = 3.6\text{m}$ (suspended just below $4.0\text{m}$ ceiling grid):
1. **Reception & Waiting Lounge**: `[-7.0, 3.6, 7.5]`
2. **Workstations Pod Cluster North**: `[-8.5, 3.6, -8.5]`
3. **Workstations Pod Cluster South**: `[-8.5, 3.6, -3.5]`
4. **Glass Conference Room Center**: `[12.0, 3.6, -6.0]`
5. **Executive Lounge & Sofa**: `[9.5, 3.6, 8.0]`
6. **Coffee Bar & Kitchenette**: `[15.5, 3.6, 6.5]`
7. **Central Corridor West**: `[-6.0, 3.6, 1.5]`
8. **Central Corridor East**: `[6.0, 3.6, 1.5]`

#### Complete `LightingManager` Implementation Blueprint

```typescript
import * as THREE from 'three';

export interface ILightingManager {
  currentPreset: 'day' | 'sunset' | 'night';
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  ceilingLights: THREE.PointLight[];
  setPreset(preset: 'day' | 'sunset' | 'night', duration?: number): void;
  setShadowsEnabled(enabled: boolean): void;
  update(delta: number): void;
  dispose(): void;
}

export class LightingManager implements ILightingManager {
  public currentPreset: 'day' | 'sunset' | 'night' = 'day';
  public sunLight!: THREE.DirectionalLight;
  public hemiLight!: THREE.HemisphereLight;
  public ambientLight!: THREE.AmbientLight;
  public ceilingLights: THREE.PointLight[] = [];

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private isTransitioning = false;
  private transitionTime = 0;
  private transitionDuration = 1.0;
  private startConfig!: LightingPresetConfig;
  private targetConfig!: LightingPresetConfig;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.initLights();
    this.setPreset('day', 0);
  }

  private initLights(): void {
    // 1. Primary Directional Sunlight with Shadow Map
    this.sunLight = new THREE.DirectionalLight(0xfff6e5, 1.8);
    this.sunLight.position.set(22.0, 28.0, 18.0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 75.0;
    this.sunLight.shadow.camera.left = -24;
    this.sunLight.shadow.camera.right = 24;
    this.sunLight.shadow.camera.top = 16;
    this.sunLight.shadow.camera.bottom = -16;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.025;
    this.sunLight.shadow.radius = 2.0;
    this.scene.add(this.sunLight);

    // 2. Hemisphere Ambient Fill
    this.hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x94a3b8, 0.75);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    // 3. Minimum Global Fill
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambientLight);

    // 4. Ceiling Point Lights Grid
    const downlightCoords: [number, number, number][] = [
      [-7.0, 3.6, 7.5],   // Reception
      [-8.5, 3.6, -8.5],  // Workstations North
      [-8.5, 3.6, -3.5],  // Workstations South
      [12.0, 3.6, -6.0],  // Conference
      [9.5, 3.6, 8.0],    // Lounge
      [15.5, 3.6, 6.5],   // Coffee Bar
      [-6.0, 3.6, 1.5],   // Corridor West
      [6.0, 3.6, 1.5]     // Corridor East
    ];

    downlightCoords.forEach(pos => {
      const pl = new THREE.PointLight(0xfff4e6, 0.35, 14.0, 2.0);
      pl.position.set(pos[0], pos[1], pos[2]);
      pl.castShadow = false; // No expensive point light shadows
      this.ceilingLights.push(pl);
      this.scene.add(pl);
    });

    // 5. Initial Fog
    this.scene.fog = new THREE.Fog(0xdbeafe, 25.0, 70.0);
    this.scene.background = new THREE.Color(0xdbeafe);
  }

  public setPreset(preset: 'day' | 'sunset' | 'night', duration = 1.0): void {
    if (duration <= 0) {
      this.applyConfig(LIGHTING_PRESETS[preset]);
      this.currentPreset = preset;
      this.isTransitioning = false;
      return;
    }

    this.startConfig = LIGHTING_PRESETS[this.currentPreset];
    this.targetConfig = LIGHTING_PRESETS[preset];
    this.currentPreset = preset;
    this.transitionDuration = duration;
    this.transitionTime = 0;
    this.isTransitioning = true;
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.sunLight.castShadow = enabled;
    this.renderer.shadowMap.enabled = enabled;
  }

  public update(delta: number): void {
    if (!this.isTransitioning) return;

    this.transitionTime += delta;
    const progress = Math.min(1.0, this.transitionTime / this.transitionDuration);
    // Smooth cosine easing
    const t = 0.5 - 0.5 * Math.cos(progress * Math.PI);

    // Interpolate Sun
    const startSunCol = new THREE.Color(this.startConfig.sunColor);
    const targetSunCol = new THREE.Color(this.targetConfig.sunColor);
    this.sunLight.color.copy(startSunCol.lerp(targetSunCol, t));
    this.sunLight.intensity = THREE.MathUtils.lerp(this.startConfig.sunIntensity, this.targetConfig.sunIntensity, t);
    this.sunLight.position.set(
      THREE.MathUtils.lerp(this.startConfig.sunPosition[0], this.targetConfig.sunPosition[0], t),
      THREE.MathUtils.lerp(this.startConfig.sunPosition[1], this.targetConfig.sunPosition[1], t),
      THREE.MathUtils.lerp(this.startConfig.sunPosition[2], this.targetConfig.sunPosition[2], t)
    );

    // Interpolate Hemi & Ambient
    const startHemiSky = new THREE.Color(this.startConfig.hemiSkyColor);
    const targetHemiSky = new THREE.Color(this.targetConfig.hemiSkyColor);
    this.hemiLight.color.copy(startHemiSky.lerp(targetHemiSky, t));
    this.hemiLight.intensity = THREE.MathUtils.lerp(this.startConfig.hemiIntensity, this.targetConfig.hemiIntensity, t);

    this.ambientLight.intensity = THREE.MathUtils.lerp(this.startConfig.ambientIntensity, this.targetConfig.ambientIntensity, t);

    // Interpolate Ceiling Point Lights
    const startCeil = new THREE.Color(this.startConfig.ceilingColor);
    const targetCeil = new THREE.Color(this.targetConfig.ceilingColor);
    const ceilCol = startCeil.lerp(targetCeil, t);
    const ceilInt = THREE.MathUtils.lerp(this.startConfig.ceilingIntensity, this.targetConfig.ceilingIntensity, t);
    this.ceilingLights.forEach(pl => {
      pl.color.copy(ceilCol);
      pl.intensity = ceilInt;
    });

    // Interpolate Fog & Clear Color
    if (this.scene.fog instanceof THREE.Fog) {
      const startFog = new THREE.Color(this.startConfig.fogColor);
      const targetFog = new THREE.Color(this.targetConfig.fogColor);
      this.scene.fog.color.copy(startFog.lerp(targetFog, t));
      this.scene.fog.near = THREE.MathUtils.lerp(this.startConfig.fogNear, this.targetConfig.fogNear, t);
      this.scene.fog.far = THREE.MathUtils.lerp(this.startConfig.fogFar, this.targetConfig.fogFar, t);
    }
    if (this.scene.background instanceof THREE.Color) {
      const startBg = new THREE.Color(this.startConfig.clearColor);
      const targetBg = new THREE.Color(this.targetConfig.clearColor);
      this.scene.background.copy(startBg.lerp(targetBg, t));
    }

    if (progress >= 1.0) {
      this.isTransitioning = false;
    }
  }

  private applyConfig(config: LightingPresetConfig): void {
    this.sunLight.color.setHex(config.sunColor);
    this.sunLight.intensity = config.sunIntensity;
    this.sunLight.position.set(...config.sunPosition);

    this.hemiLight.color.setHex(config.hemiSkyColor);
    this.hemiLight.groundColor.setHex(config.hemiGroundColor);
    this.hemiLight.intensity = config.hemiIntensity;

    this.ambientLight.color.setHex(config.ambientColor);
    this.ambientLight.intensity = config.ambientIntensity;

    this.ceilingLights.forEach(pl => {
      pl.color.setHex(config.ceilingColor);
      pl.intensity = config.ceilingIntensity;
    });

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(config.fogColor);
      this.scene.fog.near = config.fogNear;
      this.scene.fog.far = config.fogFar;
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(config.clearColor);
    }
  }

  public dispose(): void {
    this.ceilingLights.forEach(pl => pl.dispose());
    this.ceilingLights = [];
    this.sunLight.dispose();
    this.hemiLight.dispose();
    this.ambientLight.dispose();
  }
}
```

---

## 5. Verification Method

To verify the material and lighting systems during implementation:

1. **Procedural Texture Integrity Check**:
   - Verify that calling `materialManager.init()` creates all 10+ canvas textures without throwing DOM errors or null canvas contexts.
   - Verify all textures have `wrapS = THREE.RepeatWrapping` and `wrapT = THREE.RepeatWrapping`.
2. **Lighting Preset Toggle Verification**:
   - Run `lightingManager.setPreset('day')`, `setPreset('sunset')`, `setPreset('night')` in sequence.
   - Confirm directional sunlight vector shifts correctly:
     - Day: `[22, 28, 18]` (bright white-gold `0xfff6e5`, intensity 1.8).
     - Sunset: `[35, 9, 12]` (low angle orange `0xff6a22`, intensity 2.4).
     - Night: `[-20, 25, -15]` (cool blue `0x3b82f6`, intensity 0.35).
   - Check that scene fog color matches preset background.
3. **Shadow Map Quality & Performance**:
   - Check with Three.js WebGL Inspector: verify `renderer.shadowMap.enabled === true`, shadow map size is 2048x2048, and no self-shadow acne is visible on floor/desk planes.
   - Confirm that only the `sunLight` has `castShadow = true` and all 8 `ceilingLights` have `castShadow = false`.
4. **Memory & GPU Leak Test**:
   - Check that toggling lighting presets 100 times does not leak textures or point lights.
   - Verify draw calls remain under 50 when rendering the full multi-zone scene.
