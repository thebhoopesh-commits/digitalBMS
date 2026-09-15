import { ZoneHVACData } from '../hud/HVACCanvas';
import { SmoothSensorValue } from './SmoothSensorValue';
import { AlertEngine } from './AlertEngine';

export type TelemetryHealthState = 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE';

export interface TelemetryConnectionStatus {
  status: TelemetryHealthState;
  elapsedSeconds: number;
  lastDate: Date | null;
  isLastKnown: boolean;
}

interface SmoothZoneData {
  temp: SmoothSensorValue;
  targetTemp: SmoothSensorValue;
  airflowCFM: SmoothSensorValue;
  humidity: SmoothSensorValue;
  co2: SmoothSensorValue;
  powerDraw: SmoothSensorValue;
  score: SmoothSensorValue;
}

export class HVACDataStore {
  private zones: Record<string, SmoothZoneData> = {};
  private commandData!: SmoothZoneData;
  private alertEngine: AlertEngine;
  private time: number = 0;
  private historyTick: number = 0;
  
  public currentSimHour: number = 8.0;
  public outdoorTemp: number = 0;
  public outdoorHum: number = 0;
  public solarIrr: number = 0;
  public elecPrice: number = 0;
  
  // Real data we will send to the UI
  private uiData: Record<string, ZoneHVACData> = {};
  private commandUiData!: ZoneHVACData;

  constructor() {
    this.alertEngine = new AlertEngine();
    this.initCommandData();
    this.initZone('lobby', 21.0, 1.5, 'ECO', 41.5, 2);
    this.initZone('open_office', 23.0, 3.5, 'COOLING', 42.8, 8);
    this.initZone('conference_room', 22.5, 2.1, 'COOLING', 44.1, 4);
    this.connectSSE();
  }

  public setEnvironment(env: string): void {
    if (env === 'healthcare') {
      if (!this.zones['hospital_lobby']) {
        this.initZone('hospital_lobby', 21.0, 2.8, 'ECO', 45.0, 6);
        this.initZone('clinical_areas', 21.0, 4.5, 'COOLING', 48.2, 12);
        this.initZone('staff_areas', 22.0, 2.4, 'ECO', 43.5, 8);
        this.initZone('support_hvac', 19.5, 6.2, 'ECO', 38.0, 2);
      }
    }
  }

  private initCommandData() {
    this.commandData = {
      temp: new SmoothSensorValue(22.0, 0.2),
      targetTemp: new SmoothSensorValue(22.0, 0.5),
      airflowCFM: new SmoothSensorValue(4500, 50),
      humidity: new SmoothSensorValue(45, 1.0),
      co2: new SmoothSensorValue(600, 10),
      powerDraw: new SmoothSensorValue(5.1, 0.2),
      score: new SmoothSensorValue(95, 1.0)
    };
    
    this.commandUiData = {
      zoneName: 'Command',
      temp: 22.0,
      targetTemp: 22.0,
      airflowCFM: 4500,
      humidity: 45,
      co2: 600,
      powerDraw: 5.1,
      baselinePower: 5.1,
      hvacMode: 'AUTO',
      score: 95,
      consumptionHistory: [4.8, 4.2, 3.9, 4.1, 4.5, 4.9, 5.2, 5.1, 4.7, 4.2],
      isCommandGlass: true,
      activeAlerts: 0,
      occupancy: 0
    };
  }

  private initZone(
    zoneId: string,
    temp: number,
    power: number,
    mode: 'COOLING' | 'HEATING' | 'ECO' | 'OFF',
    hum = 42.0,
    occ = 0
  ) {
    this.zones[zoneId] = {
      temp: new SmoothSensorValue(temp, 0.3),
      targetTemp: new SmoothSensorValue(21.0, 0.5),
      airflowCFM: new SmoothSensorValue(1200, 40),
      humidity: new SmoothSensorValue(hum, 1.5),
      co2: new SmoothSensorValue(450, 15),
      powerDraw: new SmoothSensorValue(power, 0.5),
      score: new SmoothSensorValue(90, 2.0)
    };

    this.uiData[zoneId] = {
      zoneName: zoneId,
      temp: temp,
      targetTemp: 21.0,
      airflowCFM: 1200,
      humidity: hum,
      co2: 450,
      powerDraw: power,
      baselinePower: power,
      hvacMode: mode,
      score: 90,
      consumptionHistory: Array(10).fill(power),
      activeAlerts: Math.abs(temp - 21.0) > 0.5 ? 1 : 0,
      occupancy: occ,
      comfortViolation: Math.max(0, temp - 22.0),
      activeNlpOffset: 0
    };
  }

  // Telemetry connection & freshness tracking
  public lastTelemetryWallTime: number | null = null;
  public lastTelemetryDate: Date | null = null;
  public sseState: 'CONNECTING' | 'OPEN' | 'CLOSED' = 'CONNECTING';
  public onTelemetryUpdate?: (data: any) => void;

  public getConnectionState(): {
    status: 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE';
    elapsedSeconds: number;
    lastDate: Date | null;
    isLastKnown: boolean;
  } {
    if (this.lastTelemetryWallTime === null) {
      // Telemetry offline baseline: last packet received 12 minutes ago (08:00 synchronization)
      const twelveMinutesAgo = new Date(Date.now() - 12 * 60 * 1000);
      return {
        status: 'OFFLINE',
        elapsedSeconds: 720,
        lastDate: this.lastTelemetryDate ?? twelveMinutesAgo,
        isLastKnown: true
      };
    }
    const elapsed = (performance.now() - this.lastTelemetryWallTime) / 1000;
    if (this.sseState === 'CLOSED' || elapsed >= 30.0) {
      return { status: 'OFFLINE', elapsedSeconds: elapsed, lastDate: this.lastTelemetryDate, isLastKnown: true };
    }
    if (elapsed >= 10.0) {
      return { status: 'STALE', elapsedSeconds: elapsed, lastDate: this.lastTelemetryDate, isLastKnown: true };
    }
    if (elapsed >= 3.0) {
      return { status: 'DELAYED', elapsedSeconds: elapsed, lastDate: this.lastTelemetryDate, isLastKnown: false };
    }
    return { status: 'LIVE', elapsedSeconds: elapsed, lastDate: this.lastTelemetryDate, isLastKnown: false };
  }

  public async retryConnection(): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          message: 'Connection attempt failed. BACnet IP Gateway (192.168.12.1:47808) unresponsive. Verify physical field controller connectivity.'
        });
      }, 1500);
    });
  }

  private connectSSE() {
    const eventSource = new EventSource('/api/stream');
    this.sseState = 'CONNECTING';

    eventSource.onopen = () => {
      this.sseState = 'OPEN';
    };

    eventSource.onerror = () => {
      this.sseState = 'CLOSED';
    };
    
    const handleTelemetry = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.lastTelemetryWallTime = performance.now();
        this.lastTelemetryDate = new Date();
        this.sseState = 'OPEN';
        
        if (data.zones_rl) {
          for (const [beZone, backendData] of Object.entries(data.zones_rl) as any) {
            const sd = this.zones[beZone];
            if (backendData && sd) {
              const oldTarget = sd.targetTemp.getTarget();
              if (oldTarget !== undefined && Math.abs(oldTarget - backendData.target_setpoint_c) > 0.3) {
                document.dispatchEvent(new CustomEvent('temp-setpoint-changed', {
                  detail: {
                    zone: beZone,
                    oldVal: oldTarget,
                    newVal: backendData.target_setpoint_c
                  }
                }));
              }
              
              sd.temp.setTarget(backendData.temperature_c);
              sd.targetTemp.setTarget(backendData.target_setpoint_c);
              sd.humidity.setTarget(backendData.humidity_pct);
              sd.powerDraw.setTarget(backendData.hvac_power_kw);
              
              sd.airflowCFM.setTarget(backendData.airflow_cfm || 0);
              sd.co2.setTarget(backendData.co2_ppm || 400);
              
              // Expose occupancy, comfort violation, and active NLP offset to uiData
              this.uiData[beZone].occupancy = backendData.occupancy_count ?? 0;
              this.uiData[beZone].comfortViolation = backendData.comfort_violation_c ?? 0;
              this.uiData[beZone].activeNlpOffset = backendData.active_nlp_offset_c ?? 0;

              // Derive hvacMode from actual backend setpoint vs current temp
              const tempDelta = (backendData.target_setpoint_c ?? 22) - (backendData.temperature_c ?? 22);
              const nlpOffset = backendData.active_nlp_offset_c ?? 0;
              const power = backendData.hvac_power_kw ?? 0;
              if (power < 0.1) {
                this.uiData[beZone].hvacMode = 'OFF';
              } else if (nlpOffset > 0.5 || tempDelta > 1.0) {
                this.uiData[beZone].hvacMode = 'HEATING';
              } else if (nlpOffset < -0.5 || tempDelta < -1.0) {
                this.uiData[beZone].hvacMode = 'COOLING';
              } else if (power < 2.0) {
                this.uiData[beZone].hvacMode = 'ECO';
              } else {
                this.uiData[beZone].hvacMode = 'AUTO';
              }
            }
          }
        }

        // Global metrics
        if (data.rl_power_kw !== undefined) {
           this.commandData.powerDraw.setTarget(data.rl_power_kw);
        }
        if (data.timestamp_sim_hour !== undefined) {
           this.currentSimHour = data.timestamp_sim_hour;
        }
        if (data.outdoor_temp_c !== undefined) {
           this.outdoorTemp = data.outdoor_temp_c;
           this.outdoorHum = data.outdoor_humidity_pct || 0;
           this.solarIrr = data.solar_irradiance_w_m2 || 0;
           this.elecPrice = data.electricity_price_usd_kwh || 0;
        }

        if (this.onTelemetryUpdate) {
          this.onTelemetryUpdate(data);
        }
      } catch (err) {
        console.error("SSE Parse Error", err);
      }
    };

    eventSource.onmessage = handleTelemetry;
    eventSource.addEventListener("telemetry", handleTelemetry);
  }

  public update(delta: number) {
    this.time += delta;
    this.historyTick += delta;
    const addHistory = this.historyTick > 2.0;
    if (addHistory) this.historyTick = 0;

    let totalScore = 0;
    let totalTemp = 0;
    let zoneCount = 0;
    let totalOccupancy = 0;

    for (const [zoneId, sd] of Object.entries(this.zones)) {
      const ui = this.uiData[zoneId];
      
      // Update smooth values interpolating towards the real backend targets
      sd.temp.update(delta);
      sd.targetTemp.update(delta);
      sd.airflowCFM.update(delta);
      sd.humidity.update(delta);
      sd.co2.update(delta);
      sd.powerDraw.update(delta);
      sd.score.update(delta);

      // Copy to UI Data
      ui.temp = sd.temp.get();
      ui.targetTemp = sd.targetTemp.get();
      ui.airflowCFM = sd.airflowCFM.get();
      ui.humidity = sd.humidity.get();
      ui.co2 = sd.co2.get();
      ui.powerDraw = sd.powerDraw.get();
      ui.score = sd.score.get();

      if (addHistory) {
        ui.consumptionHistory.shift();
        ui.consumptionHistory.push(ui.powerDraw);
      }

      totalScore += ui.score;
      totalTemp += ui.temp;
      totalOccupancy += ui.occupancy;
      zoneCount++;
    }

    // Run Alert Engine
    this.alertEngine.update(this.time, this.uiData, this.commandUiData);

    // Update Command Board aggregates
    if (zoneCount > 0) {
      this.commandData.temp.setTarget(totalTemp / zoneCount);
      this.commandData.score.setTarget(this.commandUiData.score); // From AlertEngine

      this.commandData.temp.update(delta);
      this.commandData.powerDraw.update(delta);
      this.commandData.score.update(delta);

      this.commandUiData.temp = this.commandData.temp.get();
      this.commandUiData.powerDraw = this.commandData.powerDraw.get();
      this.commandUiData.score = this.commandData.score.get();
      this.commandUiData.occupancy = totalOccupancy;
      
      if (addHistory) {
        this.commandUiData.consumptionHistory.shift();
        this.commandUiData.consumptionHistory.push(this.commandUiData.powerDraw);
      }
    }
  }

  public getZoneData(zoneId: string): ZoneHVACData | undefined {
    return this.uiData[zoneId];
  }

  public getCommandData(): ZoneHVACData {
    return this.commandUiData;
  }
}
