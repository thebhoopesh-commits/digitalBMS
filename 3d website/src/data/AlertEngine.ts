import { ZoneHVACData } from '../hud/HVACCanvas';

export interface AlertEvent {
  id: string;
  type: 'WARNING' | 'CRITICAL' | 'INFO';
  message: string;
  zone: string;
  timestamp: number;
}

export class AlertEngine {
  private alerts: AlertEvent[] = [];
  
  public update(globalTime: number, zones: Record<string, ZoneHVACData>, commandGlass: ZoneHVACData) {
    // Clear old alerts (keep for history if needed, but for now we reset and re-evaluate active)
    this.alerts = [];

    // Calculate overall building health (Electricity Saver Score)
    let totalScore = 0;
    let zoneCount = 0;

    for (const [zoneId, data] of Object.entries(zones)) {
      this.evaluateZone(globalTime, zoneId, data);
      totalScore += data.score;
      zoneCount++;
    }

    if (zoneCount > 0) {
      commandGlass.score = totalScore / zoneCount;
    }
  }

  private evaluateZone(globalTime: number, zoneId: string, data: ZoneHVACData) {
    // 1. Check for consumption spikes
    if (data.powerDraw > data.baselinePower * 1.25) {
      this.alerts.push({
        id: `spike-${zoneId}-${globalTime}`,
        type: 'WARNING',
        message: 'High Consumption Anomaly',
        zone: zoneId,
        timestamp: globalTime
      });
      data.score = Math.max(0, data.score - 5);
    }

    // 2. Simultaneous Heating and Cooling (Phantom Load) - simulated via mode check
    if (data.hvacMode === 'HEATING' && data.temp > data.targetTemp + 1.5) {
      this.alerts.push({
        id: `conflict-${zoneId}-${globalTime}`,
        type: 'CRITICAL',
        message: 'Overheating / Phantom Load',
        zone: zoneId,
        timestamp: globalTime
      });
      data.score = Math.max(0, data.score - 10);
    }

    // Assign warnings if active
    if (this.alerts.some(a => a.zone === zoneId && a.type === 'CRITICAL')) {
      data.activeAlerts = 2; // Represents critical visually
    } else if (this.alerts.some(a => a.zone === zoneId && a.type === 'WARNING')) {
      data.activeAlerts = 1; // Represents warning visually
    } else {
      data.activeAlerts = 0;
    }
  }

  public getActiveAlerts(): AlertEvent[] {
    return this.alerts;
  }
}
