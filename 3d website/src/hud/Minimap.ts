/**
 * Minimap — Real-time 2D top-down spatial radar renderer
 *
 * Draws a simplified floorplan of the office on a <canvas> element
 * and overlays the player position + facing direction every frame.
 *
 * Canvas size: 220 × 143 px  (matches .minimap-canvas-wrapper)
 *
 * World coordinate mapping (from OfficeFloorplan OFFICE_ZONES):
 *   X: -20 … +20   →  canvas 0 … 220
 *   Z: -13 … +13   →  canvas 0 … 143
 *   (Z is inverted so "south" / +Z in Three.js maps to canvas-top)
 */

import { MinimapRoom, WorldBounds } from '../types';

// ---------- colour palette (dark-theme) ----------
const COL_BG       = '#090d16';
const COL_ROOM     = '#1e293b';
const COL_OUTLINE  = '#334155';
const COL_PLAYER   = '#38bdf8';
const COL_LABEL    = '#94a3b8';
const COL_CORRIDOR = '#141c2b';

const ROOMS: MinimapRoom[] = [
  { label: 'Lobby',         bounds: [-20.0,   0.0,  20.0,  13.0] },
  { label: 'Open Office',   bounds: [-20.0, -13.0,   5.0,   0.0] },
  { label: 'Conference',    bounds: [  5.0, -13.0,  20.0,   0.0] }
];

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  // World-space bounds that the canvas covers
  private worldMinX = -20;
  private worldMaxX =  20;
  private worldMinZ = -13;
  private worldMaxZ =  13;
  private rooms: MinimapRoom[] = [...ROOMS];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.width  = canvas.width;   // 220
    this.height = canvas.height;  // 143

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[Minimap] Canvas 2D context unavailable');
    this.ctx = ctx;

    // Draw the static background once on construction
    this.drawStaticFloorplan();
  }

  // ===== public API =====

  public setEnvironment(
    bounds: WorldBounds,
    rooms?: MinimapRoom[]
  ): void {
    this.worldMinX = bounds.minX;
    this.worldMaxX = bounds.maxX;
    this.worldMinZ = bounds.minZ;
    this.worldMaxZ = bounds.maxZ;
    if (rooms && rooms.length > 0) {
      this.rooms = [...rooms];
    }
    this.drawStaticFloorplan();
  }

  /**
   * Called every frame from the render loop.
   * @param playerX  world X position
   * @param playerZ  world Z position
   * @param playerYaw  yaw in radians (0 = looking along -Z in Three.js)
   */
  public update(playerX: number, playerZ: number, playerYaw: number): void {
    // Redraw full frame (static bg + dynamic player marker)
    this.drawStaticFloorplan();
    this.drawPlayer(playerX, playerZ, playerYaw);
  }

  // ===== private drawing helpers =====

  /** Convert world X → canvas X */
  private worldToCanvasX(wx: number): number {
    return ((wx - this.worldMinX) / (this.worldMaxX - this.worldMinX)) * this.width;
  }

  /** Convert world Z → canvas Y  (Z is flipped so +Z is top) */
  private worldToCanvasY(wz: number): number {
    return ((this.worldMaxZ - wz) / (this.worldMaxZ - this.worldMinZ)) * this.height;
  }

  private drawStaticFloorplan(): void {
    const ctx = this.ctx;

    // Background fill
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw each room
    for (const room of this.rooms) {
      const [minX, minZ, maxX, maxZ] = room.bounds;

      const x = this.worldToCanvasX(minX);
      const y = this.worldToCanvasY(maxZ); // maxZ maps to lower Y on canvas (flipped)
      const w = this.worldToCanvasX(maxX) - x;
      const h = this.worldToCanvasY(minZ) - y;

      // Fill
      ctx.fillStyle = room.label === 'Corridor' ? COL_CORRIDOR : COL_ROOM;
      ctx.fillRect(x, y, w, h);

      // Outline
      ctx.strokeStyle = COL_OUTLINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // Label (skip corridor — too narrow)
      if (room.label !== 'Corridor') {
        ctx.fillStyle = COL_LABEL;
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.label, x + w / 2, y + h / 2);
      }
    }
  }

  private drawPlayer(wx: number, wz: number, yaw: number): void {
    const ctx = this.ctx;
    const cx = this.worldToCanvasX(wx);
    const cy = this.worldToCanvasY(wz);

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.fill();

    // Inner solid dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = COL_PLAYER;
    ctx.fill();

    // Direction triangle (points in the facing direction)
    // In Three.js default, yaw 0 looks along -Z, which on our canvas maps to "down"
    // Canvas angle: 0 = right, π/2 = down.  We need canvasAngle = yaw + π (so 0 yaw → down)
    // Actually: yaw 0 → -Z world → +canvasY (bottom). Canvas "down" = π/2.
    // Mapping: canvasAngle = -yaw + π/2  ... but let's derive carefully.
    //   world facing direction vector for yaw:  dx = -sin(yaw), dz = -cos(yaw)
    //   canvas dx' = dx scaled (same sign), canvas dy' = -dz scaled (Z flipped)
    //   So canvas direction = (-sin(yaw), cos(yaw))
    //   canvas angle = atan2(cos(yaw), -sin(yaw)) = atan2(cos(yaw), -sin(yaw))
    // Simpler: just compute the tip point directly.

    const dirCanvasX = -Math.sin(yaw);
    const dirCanvasY =  Math.cos(yaw);
    const arrowLen = 9;
    const arrowHalf = 3;

    const tipX = cx + dirCanvasX * arrowLen;
    const tipY = cy + dirCanvasY * arrowLen;

    // Perpendicular for the base corners
    const perpX = -dirCanvasY;
    const perpY =  dirCanvasX;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(cx + perpX * arrowHalf, cy + perpY * arrowHalf);
    ctx.lineTo(cx - perpX * arrowHalf, cy - perpY * arrowHalf);
    ctx.closePath();
    ctx.fillStyle = COL_PLAYER;
    ctx.fill();
  }
}
