import { HVACDataStore } from '../data/HVACDataStore';

export type MascotState = 
  | 'luma_reaction_activity.glb'
  | 'luma_reaction_air_quality.glb'
  | 'luma_reaction_alert.glb'
  | 'luma_reaction_comfortable.glb'
  | 'luma_reaction_curious.glb'
  | 'luma_reaction_energy.glb'
  | 'luma_reaction_excited.glb'
  | 'luma_reaction_focused.glb'
  | 'luma_reaction_happy.glb'
  | 'luma_reaction_occupancy.glb'
  | 'luma_reaction_sleepy.glb'
  | 'luma_reaction_temperature.glb'
  | 'luma_reaction_worried.glb';

export class EmotionEngine {
  private hvacStore: HVACDataStore;
  
  public currentState: MascotState = 'luma_reaction_happy.glb';
  private stateCooldown: number = 0;
  private minStateDuration: number = 3.0; // seconds
  
  private temporaryState: MascotState | null = null;
  private temporaryStateTime: number = 0;
  
  private lastOccupancy: number = 0;
  private occupancyChangeTime: number = 0;
  
  constructor(hvacStore: HVACDataStore) {
    this.hvacStore = hvacStore;
  }

  public setTemporaryState(state: MascotState, duration: number = 5.0): void {
    this.temporaryState = state;
    this.temporaryStateTime = duration;
  }
  
  public handleUserComplaint(intent: string, sensation: string): void {
    let reaction: MascotState = 'luma_reaction_worried.glb';
    
    const s = sensation.toLowerCase();
    const i = intent.toLowerCase();
    
    if (s.includes('cold') || s.includes('warm') || s.includes('hot') || i.includes('cold') || i.includes('warm')) {
      reaction = 'luma_reaction_temperature.glb';
    } else if (s.includes('stuffy') || s.includes('quality') || i.includes('stuffy')) {
      reaction = 'luma_reaction_air_quality.glb';
    } else {
      reaction = 'luma_reaction_curious.glb';
    }
    
    this.setTemporaryState(reaction, 8.0);
  }
  
  public update(delta: number): MascotState {
    if (this.temporaryStateTime > 0) {
      this.temporaryStateTime -= delta;
      if (this.temporaryStateTime <= 0) {
        this.temporaryState = null;
      } else {
        return this.temporaryState!;
      }
    }
    
    this.stateCooldown -= delta;
    if (this.stateCooldown > 0) {
      return this.currentState;
    }
    
    // Determine persistent state from DigitalBMS data
    const commandData = this.hvacStore.getCommandData();
    if (!commandData) return this.currentState;
    
    let hasAlert = commandData.activeAlerts > 0;
    let hasTempIssue = false;
    let hasAirIssue = false;
    
    let totalOccupancy = 0;
    let totalPower = 0;
    let totalScore = 0;
    let zoneCount = 0;
    
    // Check zones
    const zones = ['lobby', 'open_office', 'conference_room'];
    for (const z of zones) {
      const data = this.hvacStore.getZoneData(z);
      if (!data) continue;
      
      totalOccupancy += data.occupancy;
      totalPower += data.powerDraw;
      totalScore += data.score;
      zoneCount++;
      
      if (Math.abs(data.temp - data.targetTemp) > 1.5) {
        hasTempIssue = true;
      }
      if (data.co2 > 800) {
        hasAirIssue = true;
      }
    }
    
    let avgComfort = zoneCount > 0 ? totalScore / zoneCount : 100;
    
    if (totalOccupancy !== this.lastOccupancy) {
        this.lastOccupancy = totalOccupancy;
        this.occupancyChangeTime = 5.0; // 5 seconds of occupancy change state
    }
    if (this.occupancyChangeTime > 0) {
        this.occupancyChangeTime -= delta;
    }
    
    let newState: MascotState = 'luma_reaction_comfortable.glb';
    
    // Priority / Conflict resolution
    if (hasAlert) {
      newState = 'luma_reaction_alert.glb';
    } else if (hasTempIssue) {
      newState = 'luma_reaction_temperature.glb';
    } else if (hasAirIssue) {
      newState = 'luma_reaction_air_quality.glb';
    } else if (totalPower > 15.0) { 
      newState = 'luma_reaction_energy.glb';
    } else if (totalPower < 8.0 && avgComfort > 90) { // high energy savings while comfortable
      newState = 'luma_reaction_excited.glb';
    } else if (avgComfort < 85) {
      newState = 'luma_reaction_worried.glb';
    } else if (this.occupancyChangeTime > 0) {
      newState = 'luma_reaction_occupancy.glb';
    } else if (totalOccupancy > 15) { // High physical activity
      newState = 'luma_reaction_activity.glb';
    } else if (totalOccupancy == 0) {
      newState = 'luma_reaction_sleepy.glb';
    } else if (avgComfort > 92 && !hasTempIssue && !hasAirIssue) {
      newState = 'luma_reaction_happy.glb';
    } else {
      newState = 'luma_reaction_comfortable.glb';
    }
    
    if (newState !== this.currentState) {
      this.currentState = newState;
      this.stateCooldown = this.minStateDuration;
    }
    
    return this.currentState;
  }
}
