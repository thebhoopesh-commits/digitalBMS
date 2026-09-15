import * as THREE from 'three';

export interface ZoneHVACData {
  zoneName: string;
  temp: number;
  targetTemp: number;
  airflowCFM: number;
  humidity: number;
  co2: number;
  powerDraw: number;
  baselinePower: number;
  hvacMode: 'AUTO' | 'COOLING' | 'HEATING' | 'FAN_ONLY' | 'ECO' | 'OFF';
  score: number;
  consumptionHistory: number[];
  activeAlerts: number;
  isCommandGlass?: boolean;
  occupancy: number;
  comfortViolation?: number;
  activeNlpOffset?: number;
}

export class HVACCanvas {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public texture: THREE.CanvasTexture;

  constructor(width = 1024, height = 576) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  public drawZoneData(data: ZoneHVACData) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Semi-translucent dark backdrop for readability on glass
    ctx.fillStyle = 'rgba(10, 25, 45, 0.45)';
    this.roundRect(ctx, 20, 20, canvas.width - 40, canvas.height - 40, 24);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (data.isCommandGlass) {
      this.drawCommandGlass(data);
    } else {
      this.drawStandardZone(data);
    }
    
    this.texture.needsUpdate = true;
  }

  private drawCommandGlass(data: ZoneHVACData) {
    const { ctx } = this;

    // Header
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px "Segoe UI", sans-serif';
    ctx.fillText('BUILDING COMMAND', 60, 90);

    // Main Score
    ctx.fillStyle = data.score >= 90 ? '#00e676' : data.score >= 70 ? '#00b4d8' : data.score >= 50 ? '#ffb703' : '#ff3b30';
    ctx.font = 'bold 120px "Segoe UI", sans-serif';
    ctx.fillText(Math.round(data.score).toString(), 80, 240);
    
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '24px "Segoe UI", sans-serif';
    ctx.fillText('ELECTRICITY SAVER SCORE', 70, 280);

    // Global Stats
    this.drawStatBox(420, 100, 'Total Draw', `${data.powerDraw.toFixed(1)} kW`, '#00f0ff');
    this.drawStatBox(650, 100, 'Avg Temp', `${data.temp.toFixed(1)}°C`, '#00f0ff');
    this.drawStatBox(420, 220, 'Baseline', `${data.baselinePower.toFixed(1)} kW`, '#aaaaaa');
    
    // Alerts — driven from real AlertEngine data
    if (data.activeAlerts > 0) {
      const alertColor = data.activeAlerts >= 2 ? '#ff3b30' : '#ffb703';
      const alertLabel = data.activeAlerts >= 2 ? '🚨 CRITICAL ALERT' : '⚠ ACTIVE ALERT';
      ctx.fillStyle = alertColor;
      ctx.font = 'bold 24px "Segoe UI", sans-serif';
      ctx.fillText(`${alertLabel}  (${data.activeAlerts} zone${data.activeAlerts > 1 ? 's' : ''})`, 60, 420);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px "Segoe UI", sans-serif';
      ctx.fillText('Thermal anomaly detected — review zone dashboards', 60, 460);
    } else {
      ctx.fillStyle = '#00e676';
      ctx.font = 'bold 22px "Segoe UI", sans-serif';
      ctx.fillText('✓ All zones nominal — no active alerts', 60, 420);
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '18px "Segoe UI", sans-serif';
      ctx.fillText('System operating within comfort and energy bounds', 60, 455);
    }
    
    // Footer
    ctx.fillStyle = '#00e676';
    ctx.fillText('✓ Eco mode active in Conference Room', 60, 500);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px "Segoe UI", sans-serif';
    ctx.fillText(`Occupants: ${data.occupancy}`, 950, 500);
    ctx.textAlign = 'left';
  }

  private drawStandardZone(data: ZoneHVACData) {
    const { ctx } = this;

    // Header
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Segoe UI", sans-serif';
    ctx.fillText(data.zoneName.toUpperCase(), 50, 80);

    // Status Pill
    ctx.fillStyle = data.hvacMode === 'COOLING' ? 'rgba(0, 240, 255, 0.2)' : 
                    data.hvacMode === 'ECO' ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 87, 34, 0.2)';
    this.roundRect(ctx, 420, 45, 160, 45, 22);
    ctx.fill();
    ctx.fillStyle = data.hvacMode === 'COOLING' ? '#00f0ff' : 
                    data.hvacMode === 'ECO' ? '#00e676' : '#ff5722';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText(`● ${data.hvacMode}`, 440, 75);

    // Radial Gauge for Temp
    this.drawRadialGauge(150, 240, 80, data.temp, 15, 35, '°C');
    
    // Target Temp
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillText(`TARGET: ${data.targetTemp.toFixed(1)}°C`, 90, 360);

    // KPI list
    const startX = 350;
    let currY = 160;
    this.drawProgressBar(startX, currY, 'AIRFLOW', `${Math.round(data.airflowCFM)} CFM`, data.airflowCFM / 2000);
    currY += 70;
    this.drawProgressBar(startX, currY, 'HUMIDITY', `${Math.round(data.humidity)}%`, data.humidity / 100);
    currY += 70;
    this.drawProgressBar(startX, currY, 'POWER', `${data.powerDraw.toFixed(2)} kW`, Math.min(data.powerDraw / (data.baselinePower * 1.5), 1));
    
    // Sparkline
    this.drawSparkline(startX, currY + 40, data.consumptionHistory);

    // Footer
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(`CO2: ${Math.round(data.co2)} ppm   |   Score: ${Math.round(data.score)}`, 50, 520);
    
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px "Segoe UI", sans-serif';
    ctx.fillText(`Occupants: ${data.occupancy}`, 950, 520);
    ctx.textAlign = 'left';
  }

  private drawProgressBar(x: number, y: number, label: string, value: string, percent: number) {
    const { ctx } = this;
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(label, x, y);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText(value, x + 120, y);

    const barWidth = 300;
    // bg
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 240, y - 15, barWidth, 12);
    // fg
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(x + 240, y - 15, barWidth * percent, 12);
  }

  private drawStatBox(x: number, y: number, label: string, value: string, color: string) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    this.roundRect(ctx, x, y, 200, 100, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();

    ctx.fillStyle = '#aaaaaa';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(label, x + 20, y + 35);
    
    ctx.fillStyle = color;
    ctx.font = 'bold 36px "Segoe UI", sans-serif';
    ctx.fillText(value, x + 20, y + 80);
  }

  private drawRadialGauge(x: number, y: number, radius: number, value: number, min: number, max: number, unit: string) {
    const { ctx } = this;
    const startAngle = 0.75 * Math.PI;
    const endAngle = 2.25 * Math.PI;
    const range = endAngle - startAngle;
    
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const valAngle = startAngle + (range * pct);

    // Track
    ctx.beginPath();
    ctx.arc(x, y, radius, startAngle, endAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    // Fill
    ctx.beginPath();
    ctx.arc(x, y, radius, startAngle, valAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#00f0ff';
    ctx.stroke();

    // Value text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px "Segoe UI", sans-serif';
    ctx.fillText(value.toFixed(1), x, y + 10);
    
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(`ACTUAL ${unit}`, x, y + 40);
    ctx.textAlign = 'left';
  }

  private drawSparkline(x: number, y: number, data: number[]) {
    if (!data || data.length === 0) return;
    const { ctx } = this;
    const width = 500;
    const height = 80;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    this.roundRect(ctx, x, y, width, height, 8);
    ctx.fill();

    const min = Math.min(...data) * 0.9;
    const max = Math.max(...data) * 1.1;
    const range = max - min || 1;

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const px = x + (i / (data.length - 1)) * width;
      const py = y + height - ((data[i] - min) / range) * height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#00e676';
    ctx.stroke();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
