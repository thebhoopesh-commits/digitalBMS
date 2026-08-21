import * as THREE from 'three';

/**
 * Procedural Canvas Texture Generators
 * Pure standard Web APIs - 0 KB external downloads, instantaneous deterministic generation.
 */

export function createParquetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base background
  ctx.fillStyle = '#8e5e38';
  ctx.fillRect(0, 0, 512, 512);

  const plankW = 64;
  const plankH = 24;
  const colors = ['#c89d7c', '#b88960', '#d4aa82', '#aa7a50', '#c29672', '#a17246'];

  // Interlocking herringbone planks
  for (let y = -64; y < 576; y += plankH * 2) {
    for (let x = -64; x < 576; x += plankW) {
      const colIdx = Math.floor((x + y * 3) / 17) % colors.length;
      ctx.fillStyle = colors[Math.abs(colIdx)];
      ctx.fillRect(x, y, plankW - 2, plankH - 2);

      // Wood grain lines
      ctx.fillStyle = 'rgba(60, 35, 15, 0.15)';
      for (let g = 3; g < plankH - 3; g += 4) {
        ctx.fillRect(x + 2, y + g, plankW - 6, 1.2);
      }

      // Perpendicular plank
      const colIdx2 = (colIdx + 2) % colors.length;
      ctx.fillStyle = colors[Math.abs(colIdx2)];
      ctx.fillRect(x + plankW / 2, y + plankH, plankW - 2, plankH - 2);

      ctx.fillStyle = 'rgba(60, 35, 15, 0.15)';
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

export function createCarpetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#232832';
  ctx.fillRect(0, 0, 256, 256);

  const imgData = ctx.getImageData(0, 0, 256, 256);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 36;
    data[i] = Math.min(255, Math.max(0, 35 + noise));
    data[i + 1] = Math.min(255, Math.max(0, 40 + noise));
    data[i + 2] = Math.min(255, Math.max(0, 50 + noise));
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Subtle geometric weave loops
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

export function createWalnutWoodCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#422817';
  ctx.fillRect(0, 0, 512, 512);

  const bands = 28;
  for (let i = 0; i < bands; i++) {
    const y = (i / bands) * 512;
    const bandHeight = 512 / bands;
    const tone = i % 2 === 0 ? 'rgba(30, 16, 8, 0.45)' : 'rgba(88, 52, 28, 0.35)';
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

  // Fine longitudinal fibers
  ctx.fillStyle = 'rgba(20, 10, 4, 0.22)';
  for (let j = 0; j < 90; j++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 2;
    ctx.fillRect(x, 0, w, 512);
  }

  return canvas;
}

export function createOakWoodCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d4aa7d';
  ctx.fillRect(0, 0, 512, 512);

  const bands = 24;
  for (let i = 0; i < bands; i++) {
    const y = (i / bands) * 512;
    const bandHeight = 512 / bands;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(170, 125, 80, 0.28)' : 'rgba(240, 205, 160, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) {
      const wave = Math.sin((x / 512) * Math.PI * 2.5 + i * 0.6) * 6;
      ctx.lineTo(x, y + wave + bandHeight * 0.5);
    }
    ctx.lineTo(512, y + bandHeight);
    ctx.lineTo(0, y + bandHeight);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(120, 80, 45, 0.15)';
  for (let j = 0; j < 60; j++) {
    const x = Math.random() * 512;
    const w = 1 + Math.random() * 1.5;
    ctx.fillRect(x, 0, w, 512);
  }

  return canvas;
}

export function createMarbleCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8f7f4';
  ctx.fillRect(0, 0, 512, 512);

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

export function createLeatherCanvas(baseHex = '#1e1e22', highlightHex = '#2c2c32'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

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
  ctx.fillText('DIGITAL TWIN HVAC ARCHITECTURE', 24, 38);

  // Components Columns
  const cols = [
    { title: 'INTERFACE', x: 24, color: '#64748b' },
    { title: 'CORE ENGINE', x: 184, color: '#2563eb' },
    { title: 'SIMULATION', x: 344, color: '#16a34a' }
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

  drawSticky(24, 90, '#fef08a', '• 3D WebGL UI');
  drawSticky(24, 156, '#fef08a', '• NLP Feedback Chat');
  drawSticky(184, 90, '#bbf7d0', '• Fast Tabular RL Agent');
  drawSticky(184, 156, '#fed7aa', '• Reward Engine');
  drawSticky(344, 90, '#bae6fd', '• 3R2C Thermal Model');
  drawSticky(344, 156, '#bae6fd', '• Psychrometrics');

  // Architecture Diagram on lower half
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Control Loop Architecture', 24, 250);

  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 270, 110, 45);
  ctx.fillStyle = '#1e293b';
  ctx.font = '12px sans-serif';
  ctx.fillText('Digital Twin', 62, 298);

  ctx.beginPath();
  ctx.moveTo(150, 292); ctx.lineTo(210, 292);
  ctx.stroke();

  ctx.strokeRect(210, 270, 110, 45);
  ctx.fillText('RL Agent', 238, 298);

  ctx.beginPath();
  ctx.moveTo(320, 292); ctx.lineTo(380, 292);
  ctx.stroke();

  ctx.strokeRect(380, 270, 100, 45);
  ctx.fillText('Zone HVAC', 396, 298);

  // Bottom Line Metrics
  ctx.fillStyle = '#16a34a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('✓ 5-Min Timesteps | Server-Sent Events', 24, 470);

  return canvas;
}

export function createCompanyLogoCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const bgGrad = ctx.createLinearGradient(0, 0, 512, 256);
  bgGrad.addColorStop(0, '#090d16');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 256);

  // Glowing Hexagonal Nexus Logo Icon
  const cx = 100;
  const cy = 128;
  const r = 50;

  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 16;
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

  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Typography "NEXUS DYNAMICS"
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "Inter", "Segoe UI", sans-serif';
  ctx.fillText('NEXUS', 180, 120);

  ctx.fillStyle = '#38bdf8';
  ctx.fillText('DYNAMICS', 315, 120);

  // Subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 12px "Inter", sans-serif';
  ctx.fillText('INTELLIGENT ENTERPRISE WORKSPACE', 182, 148);

  return canvas;
}

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

  const grad = ctx.createLinearGradient(128, 10, 128, 250);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.4)');
  grad.addColorStop(0.5, 'rgba(46, 125, 50, 0.2)');
  grad.addColorStop(1, 'rgba(27, 94, 32, 0.6)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Central Vein
  ctx.strokeStyle = '#81c784';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 15);
  ctx.lineTo(128, 245);
  ctx.stroke();

  // Lateral branching veins
  ctx.lineWidth = 1.5;
  for (let y = 40; y < 220; y += 22) {
    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.quadraticCurveTo(170, y - 5, 215, y - 20);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.quadraticCurveTo(86, y - 5, 41, y - 20);
    ctx.stroke();
  }

  return canvas;
}

export function createBrushedMetalCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c5c8cf';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * 256;
    const h = 1 + Math.random() * 2;
    ctx.fillRect(0, y, 256, h);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * 256;
    const h = 1 + Math.random() * 2;
    ctx.fillRect(0, y, 256, h);
  }

  return canvas;
}

export function createCeilingTileCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(0, 0, 256, 256);

  // Micro-perforations
  ctx.fillStyle = 'rgba(180, 185, 195, 0.4)';
  for (let y = 8; y < 256; y += 12) {
    for (let x = 8; x < 256; x += 12) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Border frame
  ctx.strokeStyle = '#d0d4dc';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);

  return canvas;
}

export function createCityWindowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base building concrete/glass
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, 512, 512);

  // Draw windows
  const rows = 12;
  const cols = 8;
  const windowW = 40;
  const windowH = 30;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 16 + c * (windowW + 20);
      const y = 16 + r * (windowH + 10);
      
      // Randomly determine if window is lit
      const isLit = Math.random() > 0.7;
      
      if (isLit) {
        // Warm interior light
        ctx.fillStyle = Math.random() > 0.5 ? '#fcd34d' : '#fef3c7'; // Amber or warm white
      } else {
        // Dark reflection
        ctx.fillStyle = '#1e293b';
      }
      
      ctx.fillRect(x, y, windowW, windowH);
    }
  }

  return canvas;
}

/**
 * Central Material Library Singleton
 */
export class Materials {
  private static instance: Materials | null = null;
  private textures: Map<string, THREE.CanvasTexture> = new Map();

  // Architectural Materials
  public floorParquet!: THREE.MeshStandardMaterial;
  public floorCarpet!: THREE.MeshStandardMaterial;
  public floorTile!: THREE.MeshStandardMaterial;
  public ceilingAcoustic!: THREE.MeshStandardMaterial;
  public wallDrywall!: THREE.MeshStandardMaterial;
  public wallAccentWood!: THREE.MeshStandardMaterial;
  public cityBuilding!: THREE.MeshStandardMaterial;
  public cityGround!: THREE.MeshStandardMaterial;

  // Wood & Laminate
  public laminateWhite!: THREE.MeshStandardMaterial;
  public woodOak!: THREE.MeshStandardMaterial;
  public woodWalnut!: THREE.MeshStandardMaterial;

  // Leather & Fabrics
  public leatherBlack!: THREE.MeshStandardMaterial;
  public leatherCognac!: THREE.MeshStandardMaterial;
  public fabricVelvetBlue!: THREE.MeshStandardMaterial;
  public fabricMustard!: THREE.MeshStandardMaterial;
  public fabricFeltGrey!: THREE.MeshStandardMaterial;

  // Metals
  public metalBlackMatte!: THREE.MeshStandardMaterial;
  public metalChrome!: THREE.MeshStandardMaterial;
  public metalBrushed!: THREE.MeshStandardMaterial;
  public metalBrass!: THREE.MeshStandardMaterial;

  // Glass & Stone
  public glassClear!: THREE.MeshPhysicalMaterial;
  public glassFrosted!: THREE.MeshStandardMaterial;
  public marbleCalacatta!: THREE.MeshStandardMaterial;

  // Signage & Graphics
  public whiteboard!: THREE.MeshStandardMaterial;
  public logoNexus!: THREE.MeshStandardMaterial;
  public foliageGreen!: THREE.MeshStandardMaterial;
  public screenEmissive!: THREE.MeshStandardMaterial;

  // LEDs & Basic Glows
  public ledGlowWarm!: THREE.MeshBasicMaterial;
  public ledGlowCyan!: THREE.MeshBasicMaterial;
  public ledGlowGreen!: THREE.MeshBasicMaterial;
  public keyboardRGB!: THREE.MeshStandardMaterial;

  private constructor() {
    this.initTexturesAndMaterials();
  }

  public static getInstance(): Materials {
    if (!Materials.instance) {
      Materials.instance = new Materials();
    }
    return Materials.instance;
  }

  private getOrCreateTexture(key: string, generator: () => HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
    if (!this.textures.has(key)) {
      const canvas = generator();
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.textures.set(key, texture);
    }
    return this.textures.get(key)!;
  }

  private initTexturesAndMaterials(): void {
    // 1. Textures
    const parquetTex = this.getOrCreateTexture('parquet', createParquetCanvas, 8, 5);
    const carpetTex = this.getOrCreateTexture('carpet', createCarpetCanvas, 12, 10);
    const walnutTex = this.getOrCreateTexture('walnut', createWalnutWoodCanvas, 3, 2);
    const oakTex = this.getOrCreateTexture('oak', createOakWoodCanvas, 2, 2);
    const marbleTex = this.getOrCreateTexture('marble', createMarbleCanvas, 2, 2);
    const leatherBlackTex = this.getOrCreateTexture('leather_black', () => createLeatherCanvas('#1e1e22', '#2c2c32'), 4, 4);
    const leatherCognacTex = this.getOrCreateTexture('leather_cognac', () => createLeatherCanvas('#8a4316', '#a75520'), 4, 4);
    const whiteboardTex = this.getOrCreateTexture('whiteboard', createWhiteboardCanvas, 1, 1);
    const logoTex = this.getOrCreateTexture('logo', createCompanyLogoCanvas, 1, 1);
    const foliageTex = this.getOrCreateTexture('foliage', createFoliageCanvas, 1, 1);
    const brushedMetalTex = this.getOrCreateTexture('brushed_metal', createBrushedMetalCanvas, 2, 2);
    const ceilingTex = this.getOrCreateTexture('ceiling', createCeilingTileCanvas, 20, 13);
    const cityWindowTex = this.getOrCreateTexture('city_windows', createCityWindowCanvas, 4, 8);

    // 2. Architectural Floors & Walls
    this.floorParquet = new THREE.MeshStandardMaterial({
      map: parquetTex,
      roughness: 0.30,
      metalness: 0.03
    });

    this.cityGround = new THREE.MeshStandardMaterial({
      color: 0x0f1218,
      roughness: 0.95,
      metalness: 0.05
    });

    this.cityBuilding = new THREE.MeshStandardMaterial({
      map: cityWindowTex,
      roughness: 0.2,
      metalness: 0.8,
      emissiveMap: cityWindowTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.0 // Managed by LightingManager
    });

    this.floorCarpet = new THREE.MeshStandardMaterial({
      map: carpetTex,
      roughness: 0.88,
      metalness: 0.01
    });

    this.floorTile = new THREE.MeshStandardMaterial({
      color: 0x1e232a,
      roughness: 0.45,
      metalness: 0.05
    });

    this.ceilingAcoustic = new THREE.MeshStandardMaterial({
      map: ceilingTex,
      roughness: 0.90,
      metalness: 0.01
    });

    this.wallDrywall = new THREE.MeshStandardMaterial({
      color: 0xf4f5f7,
      roughness: 0.85,
      metalness: 0.02
    });

    this.wallAccentWood = new THREE.MeshStandardMaterial({
      map: walnutTex,
      roughness: 0.42,
      metalness: 0.02
    });

    // 3. Furniture Materials
    this.laminateWhite = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.32,
      metalness: 0.02
    });

    this.woodOak = new THREE.MeshStandardMaterial({
      map: oakTex,
      roughness: 0.48,
      metalness: 0.02
    });

    this.woodWalnut = new THREE.MeshStandardMaterial({
      map: walnutTex,
      roughness: 0.38,
      metalness: 0.02
    });

    // 4. Leather & Fabrics
    this.leatherBlack = new THREE.MeshStandardMaterial({
      map: leatherBlackTex,
      roughness: 0.40,
      metalness: 0.04
    });

    this.leatherCognac = new THREE.MeshStandardMaterial({
      map: leatherCognacTex,
      roughness: 0.36,
      metalness: 0.05
    });

    this.fabricVelvetBlue = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.82,
      metalness: 0.0
    });

    this.fabricMustard = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.82,
      metalness: 0.0
    });

    this.fabricFeltGrey = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.95,
      metalness: 0.0
    });

    // 5. Metals
    this.metalBlackMatte = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.40,
      metalness: 0.85
    });

    this.metalChrome = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.08,
      metalness: 0.98
    });

    this.metalBrushed = new THREE.MeshStandardMaterial({
      map: brushedMetalTex,
      roughness: 0.26,
      metalness: 0.92
    });

    this.metalBrass = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.22,
      metalness: 0.90
    });

    // 6. Glass & Stone
    this.glassClear = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.94,
      opacity: 0.25,
      transparent: true,
      roughness: 0.03,
      ior: 1.52,
      metalness: 0.05,
      depthWrite: false
    });

    this.glassFrosted = new THREE.MeshStandardMaterial({
      color: 0xeef4f8,
      roughness: 0.50,
      metalness: 0.08,
      transparent: true,
      opacity: 0.65
    });

    this.marbleCalacatta = new THREE.MeshStandardMaterial({
      map: marbleTex,
      roughness: 0.14,
      metalness: 0.05
    });

    // 7. Graphics & Tech
    this.whiteboard = new THREE.MeshStandardMaterial({
      map: whiteboardTex,
      roughness: 0.16,
      metalness: 0.02
    });

    this.logoNexus = new THREE.MeshStandardMaterial({
      map: logoTex,
      roughness: 0.20,
      metalness: 0.70,
      emissive: new THREE.Color(0x00e5ff),
      emissiveIntensity: 0.5
    });

    this.foliageGreen = new THREE.MeshStandardMaterial({
      map: foliageTex,
      roughness: 0.52,
      metalness: 0.02,
      side: THREE.DoubleSide,
      alphaTest: 0.1,
      transparent: true
    });

    this.screenEmissive = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 0.8,
      roughness: 0.2
    });

    this.keyboardRGB = new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: new THREE.Color(0x0284c7),
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.5
    });

    // 8. Glowing LEDs
    this.ledGlowWarm = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
    this.ledGlowCyan = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    this.ledGlowGreen = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  }

  public dispose(): void {
    this.textures.forEach(t => t.dispose());
    this.textures.clear();
  }
}
