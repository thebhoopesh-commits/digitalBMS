import { HVACDataStore } from '../data/HVACDataStore';
import { ZoneHVACData } from './HVACCanvas';
import { BuildingMeta } from '../types';
import { HEALTHCARE_ZONE_METAS } from '../scene/healthcare/HealthcareScene';
import './operations_view.css';

export type ZoneId = 'open_office' | 'conference_room' | 'lobby' | 'hospital_lobby' | 'clinical_areas' | 'staff_areas' | 'support_hvac' | string;

export interface ZoneMeta {
  id: ZoneId;
  code: string;
  name: string;
  wing: string;
  areaM2: number;
  targetTemp: number;
  measuredTemp: number;
  diff: string;
  humidity: number;
  occupancy: number;
  powerKW: number;
  statusText: string;
  shortStatus: string;
  statusType: 'cooling' | 'warning' | 'normal' | 'offline';
  requiresAttention: boolean;
}

export const ZONE_METAS: Record<ZoneId, ZoneMeta> = {
  open_office: {
    id: 'open_office',
    code: 'Z-02',
    name: 'Open Plan Office',
    wing: 'North-west wing',
    areaM2: 335,
    targetTemp: 21.0,
    measuredTemp: 23.0,
    diff: '+2.0°C',
    humidity: 42.8,
    occupancy: 8,
    powerKW: 3.50,
    statusText: 'Cooling · Attention required',
    shortStatus: 'Cooling / stale',
    statusType: 'warning',
    requiresAttention: true
  },
  conference_room: {
    id: 'conference_room',
    code: 'Z-03',
    name: 'Executive Conference Room',
    wing: 'North-east wing',
    areaM2: 185,
    targetTemp: 21.0,
    measuredTemp: 22.5,
    diff: '+1.5°C',
    humidity: 44.1,
    occupancy: 4,
    powerKW: 2.10,
    statusText: 'Cooling · Attention required',
    shortStatus: 'Cooling / stale',
    statusType: 'warning',
    requiresAttention: true
  },
  lobby: {
    id: 'lobby',
    code: 'Z-01',
    name: 'Main Entrance & Lobby',
    wing: 'South wing',
    areaM2: 520,
    targetTemp: 21.0,
    measuredTemp: 21.0,
    diff: '0.0°C',
    humidity: 41.5,
    occupancy: 2,
    powerKW: 1.50,
    statusText: 'Normal / stale',
    shortStatus: 'Normal / stale',
    statusType: 'normal',
    requiresAttention: false
  }
};

export type TableFilter = 'all' | 'attention' | 'normal';
export type ModalType = 'none' | 'trend' | 'diagnostics' | 'compare' | 'alarms' | 'settings';

export class OperationsView {
  private hvacStore: HVACDataStore;
  private container: HTMLElement | null = null;
  private selectedZone: ZoneId = 'open_office';
  private tableFilter: TableFilter = 'all';
  private activeModal: ModalType = 'none';
  private isRetrying: boolean = false;
  private retryResult: { show: boolean; message: string; success: boolean } | null = null;
  private onTeleportTo3D?: (zoneId: ZoneId) => void;
  private onEnvironmentSwitchRequest?: (env: any) => void;
  public isVisible: boolean = true;
  public activeEnvironment: string = 'corporate';
  public zoneMetas: Record<string, any> = { ...ZONE_METAS };

  constructor(
    hvacStore: HVACDataStore,
    options?: {
      onTeleportTo3D?: (zoneId: ZoneId) => void;
      onEnvironmentSwitchRequest?: (env: any) => void;
    }
  ) {
    this.hvacStore = hvacStore;
    this.onTeleportTo3D = options?.onTeleportTo3D;
    this.onEnvironmentSwitchRequest = options?.onEnvironmentSwitchRequest;
  }

  public init(containerId = 'operations-view'): void {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`[OperationsView] Container #${containerId} not found in DOM.`);
      return;
    }

    this.bindEvents();
    this.render();
  }

  public setEnvironment(envId: string, zoneMetas?: Record<string, any>): void {
    this.activeEnvironment = envId;
    if (zoneMetas) {
      this.zoneMetas = { ...zoneMetas };
    } else {
      this.zoneMetas = { ...ZONE_METAS };
    }
    if (!this.zoneMetas[this.selectedZone]) {
      this.selectedZone = (Object.keys(this.zoneMetas)[0] as ZoneId) || 'open_office';
    }
    if (this.activeModal !== 'none' && this.activeModal !== 'settings') {
      this.activeModal = 'none';
    }
    this.render();
  }

  public setSelectedZone(zone: ZoneId): void {
    if (this.selectedZone !== zone && (zone in this.zoneMetas || zone in ZONE_METAS)) {
      this.selectedZone = zone;
      this.render();
    }
  }

  public getSelectedZone(): ZoneId {
    return this.selectedZone;
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (this.container) {
      if (visible) {
        this.container.classList.remove('hidden');
        this.render();
      } else {
        this.container.classList.add('hidden');
      }
    }
  }

  private lastRenderHash: string = '';

  private getRenderHash(): string {
    const conn = this.hvacStore.getConnectionState();
    const l = this.hvacStore.getZoneData('lobby');
    const o = this.hvacStore.getZoneData('open_office');
    const c = this.hvacStore.getZoneData('conference_room');
    return [
      this.selectedZone,
      this.tableFilter,
      this.activeModal,
      this.isRetrying ? 1 : 0,
      this.retryResult ? (this.retryResult.show ? this.retryResult.message : 'hidden') : 'none',
      conn.status,
      l ? l.temp.toFixed(1) : '21.0',
      o ? o.temp.toFixed(1) : '23.0',
      c ? c.temp.toFixed(1) : '22.5'
    ].join('|');
  }

  public update(): void {
    if (!this.isVisible || !this.container) return;
    // When a modal is open or connection retry is in flight, prevent re-renders that reset input focus
    if (this.activeModal !== 'none' || this.isRetrying) return;
    const currentHash = this.getRenderHash();
    if (currentHash !== this.lastRenderHash) {
      this.render();
    }
  }

  private bindEvents(): void {
    if (!this.container) return;

    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // 0. Facility environment switcher
      const envBtn = target.closest('.bms-env-btn') as HTMLElement | null;
      if (envBtn) {
        const env = envBtn.getAttribute('data-env');
        if (env && this.onEnvironmentSwitchRequest) {
          this.onEnvironmentSwitchRequest(env as any);
          return;
        }
      }

      // 1. Zone selection from map or table
      const zoneEl = target.closest('[data-ops-zone]') as HTMLElement | null;
      if (zoneEl) {
        const zoneId = zoneEl.getAttribute('data-ops-zone') as ZoneId;
        if (zoneId && (zoneId in this.zoneMetas || zoneId in ZONE_METAS)) {
          this.setSelectedZone(zoneId);
          return;
        }
      }

      // 2. Filter tabs on Exceptions Table
      const filterBtn = target.closest('[data-table-filter]') as HTMLElement | null;
      if (filterBtn) {
        const filter = filterBtn.getAttribute('data-table-filter') as TableFilter;
        if (filter) {
          this.tableFilter = filter;
          this.render();
          return;
        }
      }

      // 3. Retry connection button
      const retryBtn = target.closest('#btn-retry-conn') as HTMLElement | null;
      if (retryBtn && !this.isRetrying) {
        this.handleRetryConnection();
        return;
      }

      // 4. View diagnostics button (Banner or Selected Room Panel)
      const diagBtn = target.closest('#btn-view-diagnostics, #btn-action-diagnostics') as HTMLElement | null;
      if (diagBtn) {
        this.activeModal = 'diagnostics';
        this.render();
        return;
      }

      // 5. Dismiss retry banner
      const dismissRetryBtn = target.closest('#btn-dismiss-retry') as HTMLElement | null;
      if (dismissRetryBtn) {
        this.retryResult = null;
        this.render();
        return;
      }

      // 6. View temperature trend button
      const trendBtn = target.closest('#btn-action-trend, [data-action="trend"]') as HTMLElement | null;
      if (trendBtn) {
        const zoneId = trendBtn.getAttribute('data-zone') as ZoneId | null;
        if (zoneId && (zoneId in this.zoneMetas || zoneId in ZONE_METAS)) {
          this.selectedZone = zoneId;
        }
        this.activeModal = 'trend';
        this.render();
        return;
      }

      // 7. Check sensor connection from table
      const tableDiagBtn = target.closest('[data-action="diagnostics"]') as HTMLElement | null;
      if (tableDiagBtn) {
        const zoneId = tableDiagBtn.getAttribute('data-zone') as ZoneId | null;
        if (zoneId && (zoneId in this.zoneMetas || zoneId in ZONE_METAS)) {
          this.selectedZone = zoneId;
        }
        this.activeModal = 'diagnostics';
        this.render();
        return;
      }

      // 8. Open camera view / contextual 3D inspection
      const cameraBtn = target.closest('#btn-action-camera') as HTMLElement | null;
      if (cameraBtn) {
        if (this.onTeleportTo3D) {
          this.onTeleportTo3D(this.selectedZone);
        }
        return;
      }

      // 9. Compare with neighboring zones button
      const compareBtn = target.closest('#btn-action-compare') as HTMLElement | null;
      if (compareBtn) {
        this.activeModal = 'compare';
        this.render();
        return;
      }

      // 10. Header Navigation buttons
      const navBtn = target.closest('[data-nav]') as HTMLElement | null;
      if (navBtn) {
        const nav = navBtn.getAttribute('data-nav');
        if (nav === 'trends') {
          this.activeModal = 'trend';
          this.render();
        } else if (nav === 'alarms') {
          this.activeModal = 'alarms';
          this.render();
        } else if (nav === 'settings') {
          this.activeModal = 'settings';
          this.render();
        } else if (nav === 'operations') {
          this.activeModal = 'none';
          this.render();
        } else if (nav === '3d-twin') {
          if (this.onTeleportTo3D) {
            this.onTeleportTo3D(this.selectedZone);
          }
        }
        return;
      }

      // 11. Close active modal / drawer
      const closeBtn = target.closest('.bms-modal-close, .bms-modal-backdrop, #btn-modal-close') as HTMLElement | null;
      if (closeBtn) {
        // If clicking inside modal content, do not close unless clicking close button
        if (closeBtn.classList.contains('bms-modal-backdrop') && target !== closeBtn) {
          return;
        }
        this.activeModal = 'none';
        this.render();
        return;
      }
    });

    // Keyboard support for ESC to close modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal !== 'none') {
        this.activeModal = 'none';
        this.render();
      }
    });
  }

  private async handleRetryConnection(): Promise<void> {
    this.isRetrying = true;
    this.render();

    try {
      const result = await this.hvacStore.retryConnection();
      this.retryResult = {
        show: true,
        message: result.message,
        success: result.success
      };
    } catch {
      this.retryResult = {
        show: true,
        message: 'Connection attempt failed. BACnet IP Gateway (192.168.12.1:47808) unreachable.',
        success: false
      };
    } finally {
      this.isRetrying = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.container) return;
    this.lastRenderHash = this.getRenderHash();

    const zoneKeys: ZoneId[] = (this.activeEnvironment === 'healthcare'
      ? Object.keys(this.zoneMetas)
      : ['open_office', 'conference_room', 'lobby']) as ZoneId[];

    const metaMap = this.activeEnvironment === 'healthcare' ? this.zoneMetas : ZONE_METAS;
    const zoneDataMap: Record<string, ZoneHVACData | undefined> = {};
    for (const zid of zoneKeys) {
      zoneDataMap[zid] = this.hvacStore.getZoneData(zid);
    }

    // Calculate overall building telemetry metrics (accurate to sample data: avg 22.2°C, 7.10 kW, 2 zones attention)
    let totalPower = 0;
    let avgTempSum = 0;
    let count = 0;
    let zonesRequiringAttention = 0;

    for (const zid of zoneKeys) {
      const meta = metaMap[zid] || ZONE_METAS[zid as ZoneId];
      if (!meta) continue;
      const zd = zoneDataMap[zid];
      const temp = zd ? zd.temp : meta.measuredTemp;
      const power = zd ? zd.powerDraw : meta.powerKW;
      totalPower += power;
      avgTempSum += temp;
      count++;
      if (meta.requiresAttention) {
        zonesRequiringAttention++;
      }
    }
    const avgTemp = count > 0 ? avgTempSum / count : 22.2;

    // Selected zone details
    const selectedMeta = metaMap[this.selectedZone] || this.zoneMetas[this.selectedZone] || ZONE_METAS[this.selectedZone as ZoneId] || ZONE_METAS.open_office;
    const selectedZd = zoneDataMap[this.selectedZone];
    const selTemp = selectedZd ? selectedZd.temp : selectedMeta.measuredTemp;
    const selTarget = selectedZd ? selectedZd.targetTemp : selectedMeta.targetTemp;
    const selHum = selectedZd ? selectedZd.humidity : selectedMeta.humidity;
    const selOcc = selectedZd ? selectedZd.occupancy : selectedMeta.occupancy;
    const selPwr = selectedZd ? selectedZd.powerDraw : selectedMeta.powerKW;
    const selDelta = selTemp - selTarget;
    const selDeltaSign = selDelta > 0 ? '+' : '';

    // Calculate delta percentage for the linear gauge (range 18.0°C - 26.0°C -> 0% - 100%)
    const gaugePercent = Math.min(96, Math.max(4, ((selTemp - 18.0) / (26.0 - 18.0)) * 100));
    const targetPercent = ((selTarget - 18.0) / (26.0 - 18.0)) * 100; // 37.5% for 21.0°C

    // Filter table rows
    const filteredZoneKeys = zoneKeys.filter((zid) => {
      const meta = metaMap[zid] || ZONE_METAS[zid as ZoneId];
      if (!meta) return false;
      if (this.tableFilter === 'attention') return meta.requiresAttention;
      if (this.tableFilter === 'normal') return !meta.requiresAttention;
      return true;
    });

    const tableRowsHtml = filteredZoneKeys.map((zid) => {
      const meta = metaMap[zid] || ZONE_METAS[zid as ZoneId];
      if (!meta) return '';
      const zd = zoneDataMap[zid];
      const isSelected = zid === this.selectedZone;

      const temp = zd ? zd.temp : meta.measuredTemp;
      const target = zd ? zd.targetTemp : meta.targetTemp;
      const pwr = zd ? zd.powerDraw : meta.powerKW;
      const delta = temp - target;
      const deltaSign = delta > 0 ? '+' : '';
      const isDeviated = Math.abs(delta) >= 1.0;

      return `
        <tr class="bms-table-row ${isSelected ? 'row-selected' : ''}" data-ops-zone="${zid}" tabindex="0" role="button" aria-label="Select ${meta.name}">
          <td class="col-zone font-mono font-bold">${meta.code}</td>
          <td class="col-room">
            <span class="room-primary-name">${meta.name}</span>
            <span class="room-sub-wing text-muted">${meta.wing}</span>
          </td>
          <td class="col-numeric font-mono font-bold">${temp.toFixed(1)}°C</td>
          <td class="col-numeric font-mono text-muted">${target.toFixed(1)}°C</td>
          <td class="col-numeric font-mono ${isDeviated ? 'text-amber font-bold' : 'text-green'}">
            ${deltaSign}${delta.toFixed(1)}°C
          </td>
          <td class="col-numeric font-mono text-muted">
            12 min <span class="badge-stale-inline">Stale</span>
          </td>
          <td class="col-numeric font-mono">${pwr.toFixed(2)} kW</td>
          <td class="col-status">
            ${meta.requiresAttention
              ? `<span class="bms-status-chip chip-amber"><span class="chip-dot"></span> Cooling / stale</span>`
              : `<span class="bms-status-chip chip-green"><span class="chip-dot"></span> Normal / stale</span>`}
          </td>
          <td class="col-action" onclick="event.stopPropagation()">
            <div class="row-action-group">
              <button class="bms-btn-small" data-ops-zone="${zid}" title="Select zone">Inspect</button>
              <button class="bms-btn-small" data-action="trend" data-zone="${zid}" title="View temperature trend">Trend</button>
              <button class="bms-btn-small" data-action="diagnostics" data-zone="${zid}" title="Check sensor diagnostics">Diagnostics</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Floor plan zone selection states
    const officeSel = this.selectedZone === 'open_office';
    const confSel = this.selectedZone === 'conference_room';
    const lobbySel = this.selectedZone === 'lobby';

    // Modals markup
    const modalHtml = this.renderActiveModal(selectedMeta, selTemp, selTarget, selPwr, selHum, selOcc);

    this.container.innerHTML = `
      <div class="bms-shell">

        <!-- 1. RESTRAINED OPERATIONAL HEADER -->
        <header class="bms-header" role="banner">
          <div class="bms-header-left">
            <div class="bms-brand-identity">
              <h1 class="bms-product-name">Building Management</h1>
              <span class="bms-location-breadcrumb" id="ops-location-breadcrumb">${this.activeEnvironment === 'healthcare' ? 'St. Jude Healthcare Facility / Clinical Core' : 'Main Corporate Campus / Level 01'}</span>
            </div>

            <!-- Operations View Facility Switcher -->
            <div class="bms-env-switcher" role="tablist" aria-label="Facility Switcher">
              <button class="bms-env-btn ${this.activeEnvironment === 'corporate' ? 'active' : ''}" data-env="corporate" role="tab" aria-selected="${this.activeEnvironment === 'corporate'}">
                <span class="env-icon">🏢</span>
                <span class="env-label">Corporate HQ</span>
              </button>
              <button class="bms-env-btn ${this.activeEnvironment === 'healthcare' ? 'active' : ''}" data-env="healthcare" role="tab" aria-selected="${this.activeEnvironment === 'healthcare'}">
                <span class="env-icon">🏥</span>
                <span class="env-label">Healthcare Center</span>
              </button>
            </div>
          </div>

          <div class="bms-header-center">
            <div class="bms-sync-meta">
              <div class="sync-item">
                <span class="sync-label">Last updated:</span>
                <span class="sync-val font-mono font-bold">08:00</span>
              </div>
              <span class="sync-divider">·</span>
              <div class="sync-item status-offline">
                <span class="status-dot dot-red"></span>
                <span class="sync-label">Data status:</span>
                <span class="sync-val font-bold text-red">Offline</span>
              </div>
              <span class="sync-divider">·</span>
              <span class="demo-tag">Demo data · Last synchronized 08:00</span>
            </div>
          </div>

          <div class="bms-header-right">
            <nav class="bms-nav-tabs" aria-label="Main Navigation">
              <button class="bms-nav-tab active" data-nav="operations" aria-current="page">Operations</button>
              <button class="bms-nav-tab" data-nav="3d-twin" title="Switch to 3D Twin & AI Chatbot">3D Twin &amp; Chatbot</button>
              <button class="bms-nav-tab" data-nav="trends">Trends</button>
              <button class="bms-nav-tab" data-nav="alarms">
                Alarms <span class="alarm-count-badge">2</span>
              </button>
              <button class="bms-nav-tab" data-nav="settings">Settings</button>
            </nav>
            <div class="bms-user-profile" title="Signed in as J. Martinez (Facilities Engineer)">
              <div class="user-avatar font-mono">JM</div>
              <div class="user-meta">
                <span class="user-name">J. Martinez</span>
                <span class="user-role">Facilities Eng</span>
              </div>
            </div>
          </div>
        </header>

        <!-- 2. PROMINENT OFFLINE TELEMETRY ALERT BANNER -->
        <section class="bms-alert-banner" role="alert" aria-live="polite">
          <div class="bms-alert-content">
            <div class="alert-icon-wrap" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="alert-text-group">
              <h2 class="alert-headline">Telemetry offline — readings may be stale</h2>
              <p class="alert-subtext">
                Last packet received: 12 minutes ago. Verify sensor connectivity before taking action.
              </p>
            </div>
          </div>

          <div class="bms-alert-actions">
            <button id="btn-retry-conn" class="bms-btn bms-btn-primary ${this.isRetrying ? 'is-loading' : ''}" ${this.isRetrying ? 'disabled' : ''}>
              ${this.isRetrying ? '<span class="spinner"></span> Attempting reconnection...' : 'Retry connection'}
            </button>
            <button id="btn-view-diagnostics" class="bms-btn bms-btn-secondary">View diagnostics</button>
          </div>
        </section>

        <!-- Dynamic Reconnection Result Message -->
        ${this.retryResult ? `
          <div class="bms-retry-feedback ${this.retryResult.success ? 'feedback-success' : 'feedback-warning'}">
            <div class="feedback-text">
              <strong>${this.retryResult.success ? 'Reconnected:' : 'Notice:'}</strong> ${this.retryResult.message}
            </div>
            <button id="btn-dismiss-retry" class="bms-btn-small" aria-label="Dismiss message">Dismiss</button>
          </div>
        ` : ''}

        <!-- 3. SUMMARY METRICS (Data connection visually distinct) -->
        <section class="bms-metrics-grid" aria-label="Campus Facilities Summary">
          
          <div class="bms-metric-card">
            <div class="metric-header">
              <span class="metric-label">Average indoor temperature</span>
              <span class="bms-stale-tag">Stale</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono">${avgTemp.toFixed(1)}</span>
              <span class="metric-unit">°C</span>
            </div>
            <div class="metric-footer text-muted">
              Target: 21.0°C · Level 01 average
            </div>
          </div>

          <div class="bms-metric-card">
            <div class="metric-header">
              <span class="metric-label">HVAC power load</span>
              <span class="bms-stale-tag">Stale</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono">${totalPower.toFixed(2)}</span>
              <span class="metric-unit">kW</span>
            </div>
            <div class="metric-footer text-muted">
              Total across 3 monitored zones
            </div>
          </div>

          <div class="bms-metric-card ${zonesRequiringAttention > 0 ? 'metric-card-attention' : ''}">
            <div class="metric-header">
              <span class="metric-label">Zones requiring attention</span>
              <span class="bms-warning-tag">Attention</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono text-amber">${zonesRequiringAttention}</span>
              <span class="metric-unit">of 3 zones</span>
            </div>
            <div class="metric-footer text-amber">
              Z-02 (+2.0°C) and Z-03 (+1.5°C) above setpoint
            </div>
          </div>

          <!-- VISUALLY DISTINCT: Data connection card highlighted prominently -->
          <div class="bms-metric-card metric-card-offline" aria-label="Connection Status Warning">
            <div class="metric-header">
              <span class="metric-label font-bold text-red">Data connection</span>
              <span class="bms-offline-badge font-bold">OFFLINE</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono text-red">Offline</span>
            </div>
            <div class="metric-footer text-red">
              Last packet 12 min ago · Unreliable
            </div>
          </div>

        </section>

        <!-- 4. MAIN WORKSPACE (Two-column layout: 65% Left, 35% Right) -->
        <div class="bms-workspace-layout">
          
          <!-- LEFT COLUMN (~65%): Floor Plan & Exceptions Table -->
          <div class="bms-column-left">
            
            <!-- Floor Plan Panel -->
            <section class="bms-panel bms-floorplan-panel">
              <div class="bms-panel-header">
                <div class="panel-heading">
                  <h2 class="panel-title">Floor plan — Level 01</h2>
                  <p class="panel-subtitle">HVAC thermal zones and current operational status. Select a room to inspect.</p>
                </div>
                <!-- Clean, non-distracting Legend -->
                <div class="bms-legend" aria-label="Status Legend">
                  <span class="legend-item"><span class="swatch swatch-cooling"></span> Cooling (Blue)</span>
                  <span class="legend-item"><span class="swatch swatch-warning"></span> Warning / Heating (Amber)</span>
                  <span class="legend-item"><span class="swatch swatch-normal"></span> Normal (Green)</span>
                  <span class="legend-item"><span class="swatch swatch-offline"></span> Critical / Offline (Red)</span>
                </div>
              </div>

              <!-- Vector Architectural Floor Plan -->
              <div class="bms-floorplan-container">
                <svg class="bms-floorplan-svg" viewBox="0 0 960 520" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floor plan for Level 01 showing 3 thermal zones">
                  <defs>
                    <pattern id="archGrid" width="24" height="24" patternUnits="userSpaceOnUse">
                      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(51, 65, 85, 0.25)" stroke-width="0.5" />
                    </pattern>
                  </defs>

                  <!-- Architectural Canvas Background -->
                  <rect x="0" y="0" width="960" height="520" fill="#0e1420" />
                  <rect x="30" y="20" width="900" height="480" fill="url(#archGrid)" stroke="#1e293b" stroke-width="1" />

                  <!-- Orientation Compass & Scale -->
                  <g class="arch-indicators" aria-hidden="true">
                    <!-- North Arrow -->
                    <g transform="translate(56, 46)">
                      <circle cx="0" cy="0" r="13" fill="#141c28" stroke="#334155" stroke-width="1" />
                      <polygon points="0,-9 3,3 0,1 -3,3" fill="#3b82f6" />
                      <text x="0" y="-13" text-anchor="middle" font-size="9" font-family="'JetBrains Mono', monospace" fill="#94a3b8" font-weight="700">N</text>
                    </g>
                    <!-- Metric Scale Bar (20m total) -->
                    <g transform="translate(800, 485)">
                      <line x1="0" y1="0" x2="110" y2="0" stroke="#475569" stroke-width="1.5" />
                      <line x1="0" y1="-3" x2="0" y2="3" stroke="#475569" stroke-width="1.5" />
                      <line x1="55" y1="-2" x2="55" y2="2" stroke="#475569" stroke-width="1" />
                      <line x1="110" y1="-3" x2="110" y2="3" stroke="#475569" stroke-width="1.5" />
                      <text x="0" y="-5" text-anchor="start" font-size="9" font-family="'JetBrains Mono', monospace" fill="#64748b">0m</text>
                      <text x="55" y="-5" text-anchor="middle" font-size="9" font-family="'JetBrains Mono', monospace" fill="#64748b">10m</text>
                      <text x="110" y="-5" text-anchor="end" font-size="9" font-family="'JetBrains Mono', monospace" fill="#64748b">20m</text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-02: OPEN PLAN OFFICE (North-West: X: 40..600, Y: 30..270)
                       ========================================================== -->
                  <g class="bms-arch-zone ${officeSel ? 'is-selected' : ''}" data-ops-zone="open_office" role="button" tabindex="0" aria-label="Open Plan Office, Zone Z-02, 23.0°C, cooling, attention required">
                    <!-- Zone Surface Fill -->
                    <rect 
                      class="zone-surface" 
                      x="40" y="30" width="560" height="240" 
                      fill="rgba(37, 99, 235, 0.08)"
                      stroke="${officeSel ? '#2563eb' : '#334155'}" 
                      stroke-width="${officeSel ? '2.5' : '1.5'}" 
                    />

                    <!-- Selection Indicator Corners -->
                    ${officeSel ? `
                      <path d="M 40 46 L 40 30 L 56 30" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 30 L 600 30 L 600 46" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 40 254 L 40 270 L 56 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 270 L 600 270 L 600 254" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <!-- Simple Architectural Furniture (Workstation Desks) -->
                    <g class="arch-furniture" stroke="#334155" stroke-width="1" fill="none" opacity="0.6">
                      <!-- Pod 1 -->
                      <rect x="130" y="90" width="70" height="48" rx="2" />
                      <line x1="165" y1="90" x2="165" y2="138" stroke-dasharray="2,2" />
                      <circle cx="148" cy="80" r="5.5" />
                      <circle cx="148" cy="148" r="5.5" />
                      <circle cx="182" cy="80" r="5.5" />
                      <circle cx="182" cy="148" r="5.5" />
                      <!-- Pod 2 -->
                      <rect x="245" y="90" width="70" height="48" rx="2" />
                      <line x1="280" y1="90" x2="280" y2="138" stroke-dasharray="2,2" />
                      <circle cx="263" cy="80" r="5.5" />
                      <circle cx="263" cy="148" r="5.5" />
                      <circle cx="297" cy="80" r="5.5" />
                      <circle cx="297" cy="148" r="5.5" />
                      <!-- Pod 3 -->
                      <rect x="360" y="90" width="70" height="48" rx="2" />
                      <line x1="395" y1="90" x2="395" y2="138" stroke-dasharray="2,2" />
                      <circle cx="378" cy="80" r="5.5" />
                      <circle cx="378" cy="148" r="5.5" />
                      <circle cx="412" cy="80" r="5.5" />
                      <circle cx="412" cy="148" r="5.5" />
                    </g>

                    <!-- Room Header Text -->
                    <text x="60" y="58" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Open Plan Office — Zone Z-02</text>
                    <text x="60" y="74" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">North-west wing · 335 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(60, 180)">
                      <rect x="0" y="0" width="260" height="72" rx="4" fill="#141c28" stroke="${officeSel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <!-- Measured Temp -->
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        23.0 <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <!-- Target & Difference -->
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target 21.0°C <tspan fill="#f59e0b" font-weight="700">(+2.0°C)</tspan>
                      </text>
                      <!-- Secondary Data -->
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        8 occupants · 3.50 kW load
                      </text>
                      <!-- Status Chip -->
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="#f59e0b">
                        ● Cooling / stale
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-03: EXECUTIVE CONFERENCE ROOM (North-East: X: 600..920, Y: 30..270)
                       ========================================================== -->
                  <g class="bms-arch-zone ${confSel ? 'is-selected' : ''}" data-ops-zone="conference_room" role="button" tabindex="0" aria-label="Executive Conference Room, Zone Z-03, 22.5°C, cooling, attention required">
                    <!-- Zone Surface Fill -->
                    <rect 
                      class="zone-surface" 
                      x="600" y="30" width="320" height="240" 
                      fill="rgba(37, 99, 235, 0.08)"
                      stroke="${confSel ? '#2563eb' : '#334155'}" 
                      stroke-width="${confSel ? '2.5' : '1.5'}" 
                    />

                    <!-- Selection Indicator Corners -->
                    ${confSel ? `
                      <path d="M 600 46 L 600 30 L 616 30" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 30 L 920 30 L 920 46" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 600 254 L 600 270 L 616 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 270 L 920 270 L 920 254" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <!-- Simple Architectural Furniture (Conference Table & Chairs) -->
                    <g class="arch-furniture" stroke="#334155" stroke-width="1" fill="none" opacity="0.6">
                      <!-- Central Table -->
                      <rect x="700" y="95" width="120" height="44" rx="14" />
                      <!-- Chairs -->
                      <circle cx="725" cy="85" r="5" />
                      <circle cx="760" cy="85" r="5" />
                      <circle cx="795" cy="85" r="5" />
                      <circle cx="725" cy="149" r="5" />
                      <circle cx="760" cy="149" r="5" />
                      <circle cx="795" cy="149" r="5" />
                      <circle cx="688" cy="117" r="5" />
                      <circle cx="832" cy="117" r="5" />
                      <!-- Presentation Screen on East Wall -->
                      <line x1="905" y1="90" x2="905" y2="145" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.8" />
                    </g>

                    <!-- Room Header Text -->
                    <text x="620" y="58" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Executive Conference — Zone Z-03</text>
                    <text x="620" y="74" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">North-east wing · 185 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(620, 180)">
                      <rect x="0" y="0" width="260" height="72" rx="4" fill="#141c28" stroke="${confSel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <!-- Measured Temp -->
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        22.5 <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <!-- Target & Difference -->
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target 21.0°C <tspan fill="#f59e0b" font-weight="700">(+1.5°C)</tspan>
                      </text>
                      <!-- Secondary Data -->
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        4 occupants · 2.10 kW load
                      </text>
                      <!-- Status Chip -->
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="#f59e0b">
                        ● Cooling / stale
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-01: MAIN ENTRANCE & LOBBY (South Wing: X: 40..920, Y: 270..490)
                       ========================================================== -->
                  <g class="bms-arch-zone ${lobbySel ? 'is-selected' : ''}" data-ops-zone="lobby" role="button" tabindex="0" aria-label="Main Entrance & Lobby, Zone Z-01, 21.0°C, normal, stale">
                    <!-- Zone Surface Fill -->
                    <rect 
                      class="zone-surface" 
                      x="40" y="270" width="880" height="220" 
                      fill="rgba(16, 185, 129, 0.06)"
                      stroke="${lobbySel ? '#2563eb' : '#334155'}" 
                      stroke-width="${lobbySel ? '2.5' : '1.5'}" 
                    />

                    <!-- Selection Indicator Corners -->
                    ${lobbySel ? `
                      <path d="M 40 286 L 40 270 L 56 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 270 L 920 270 L 920 286" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 40 474 L 40 490 L 56 490" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 490 L 920 490 L 920 474" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <!-- Simple Architectural Furniture (Reception Counter & Lounge) -->
                    <g class="arch-furniture" stroke="#334155" stroke-width="1" fill="none" opacity="0.6">
                      <!-- Central Reception Counter -->
                      <rect x="420" y="320" width="120" height="28" rx="4" />
                      <circle cx="480" cy="308" r="5" />
                      <!-- West Lounge -->
                      <rect x="160" y="370" width="70" height="30" rx="3" />
                      <circle cx="195" cy="355" r="5" />
                      <!-- East Lounge -->
                      <rect x="730" y="370" width="70" height="30" rx="3" />
                      <circle cx="765" cy="355" r="5" />
                    </g>

                    <!-- Room Header Text -->
                    <text x="60" y="298" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Main Entrance & Lobby — Zone Z-01</text>
                    <text x="60" y="314" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">South wing · 520 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(60, 395)">
                      <rect x="0" y="0" width="260" height="72" rx="4" fill="#141c28" stroke="${lobbySel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <!-- Measured Temp -->
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        21.0 <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <!-- Target & Difference -->
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target 21.0°C <tspan fill="#10b981" font-weight="700">(0.0°C)</tspan>
                      </text>
                      <!-- Secondary Data -->
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        2 occupants · 1.50 kW load
                      </text>
                      <!-- Status Chip -->
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="#10b981">
                        ● Normal / stale
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ARCHITECTURAL WALLS, PARTITIONS & DOORS
                       ========================================================== -->
                  <!-- Structural Outer Concrete Walls -->
                  <rect x="40" y="30" width="880" height="460" fill="none" stroke="#475569" stroke-width="3" />

                  <!-- Interior Glass Partition between Office and Conference (X=600, Y=30..270) -->
                  <line x1="600" y1="30" x2="600" y2="190" stroke="#475569" stroke-width="2" />
                  <!-- Sliding Glass Door Opening in Conference (X=600, Y=190..240) -->
                  <line x1="600" y1="190" x2="600" y2="240" stroke="#2563eb" stroke-width="1" stroke-dasharray="2,2" />
                  <line x1="597" y1="190" x2="597" y2="240" stroke="#2563eb" stroke-width="2" />
                  <text x="590" y="218" text-anchor="end" font-size="8" font-family="'JetBrains Mono', monospace" fill="#94a3b8">SLIDING DOOR</text>
                  <line x1="600" y1="240" x2="600" y2="270" stroke="#475569" stroke-width="2" />

                  <!-- Interior Partition between North Wing and South Lobby (Y=270, X=40..920) -->
                  <line x1="40" y1="270" x2="600" y2="270" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,4" />
                  <line x1="600" y1="270" x2="920" y2="270" stroke="#475569" stroke-width="2.5" />

                  <!-- Main Entrance Double Swing Doors (South Wall: X: 440..520, Y: 490) -->
                  <line x1="440" y1="490" x2="520" y2="490" stroke="#0e1420" stroke-width="4" />
                  <path d="M 440 490 A 40 40 0 0 0 480 450" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,2" />
                  <path d="M 520 490 A 40 40 0 0 1 480 450" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,2" />
                  <line x1="440" y1="490" x2="468" y2="462" stroke="#ffffff" stroke-width="2" />
                  <line x1="520" y1="490" x2="492" y2="462" stroke="#ffffff" stroke-width="2" />
                  <text x="480" y="508" text-anchor="middle" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#94a3b8">MAIN ENTRANCE</text>

                </svg>
              </div>
            </section>

            <!-- Exceptions Table Panel -->
            <section class="bms-panel bms-table-panel">
              <div class="bms-panel-header">
                <div class="panel-heading">
                  <h2 class="panel-title">Zones requiring attention</h2>
                  <p class="panel-subtitle">HVAC setpoint deviations and sensor status across Level 01</p>
                </div>
                <!-- Filter Tabs -->
                <div class="bms-filter-tabs" role="tablist" aria-label="Zone Filter">
                  <button class="bms-filter-btn ${this.tableFilter === 'all' ? 'active' : ''}" data-table-filter="all" role="tab" aria-selected="${this.tableFilter === 'all'}">
                    ${this.activeEnvironment === 'healthcare' ? `All zones (${zoneKeys.length})` : 'All zones (3)'}
                  </button>
                  <button class="bms-filter-btn ${this.tableFilter === 'attention' ? 'active' : ''}" data-table-filter="attention" role="tab" aria-selected="${this.tableFilter === 'attention'}">
                    ${this.activeEnvironment === 'healthcare' ? `Attention required (${zonesRequiringAttention})` : 'Attention required (2)'}
                  </button>
                  <button class="bms-filter-btn ${this.tableFilter === 'normal' ? 'active' : ''}" data-table-filter="normal" role="tab" aria-selected="${this.tableFilter === 'normal'}">
                    ${this.activeEnvironment === 'healthcare' ? `Normal (${zoneKeys.length - zonesRequiringAttention})` : 'Normal (1)'}
                  </button>
                </div>
              </div>

              <!-- Table Content -->
              <div class="bms-table-wrap">
                <table class="bms-data-table" role="table">
                  <thead>
                    <tr>
                      <th class="th-zone">Zone</th>
                      <th class="th-room">Room</th>
                      <th class="th-numeric">Temperature</th>
                      <th class="th-numeric">Target</th>
                      <th class="th-numeric">Difference</th>
                      <th class="th-numeric">Data age</th>
                      <th class="th-numeric">HVAC load</th>
                      <th class="th-status">Status</th>
                      <th class="th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRowsHtml}
                  </tbody>
                </table>
              </div>
            </section>

          </div>

          <!-- RIGHT COLUMN (~35%): Selected Room Details & Concrete Actions -->
          <aside class="bms-column-right">
            <div class="bms-panel bms-inspector-panel">
              
              <!-- Inspector Header -->
              <div class="inspector-header">
                <div class="inspector-badge-row">
                  <span class="inspector-tag font-mono">${selectedMeta.code}</span>
                  <span class="inspector-wing">${selectedMeta.wing}</span>
                </div>
                <h3 class="inspector-room-name">${selectedMeta.name}</h3>
                <div class="inspector-status-badge">
                  <span class="status-dot ${selectedMeta.requiresAttention ? 'dot-amber' : 'dot-green'}"></span>
                  <span class="status-label ${selectedMeta.requiresAttention ? 'text-amber font-bold' : 'text-green font-bold'}">
                    ${selectedMeta.statusText}
                  </span>
                </div>
              </div>

              <!-- Primary Metric Callouts -->
              <div class="inspector-primary-stats">
                <div class="stat-box">
                  <span class="stat-label">Temperature</span>
                  <div class="stat-val-row">
                    <span class="stat-num font-mono font-bold">${selTemp.toFixed(1)}</span>
                    <span class="stat-unit">°C</span>
                  </div>
                  <span class="bms-stale-tag">Stale</span>
                </div>

                <div class="stat-box">
                  <span class="stat-label">Target Setpoint</span>
                  <div class="stat-val-row">
                    <span class="stat-num font-mono text-muted">${selTarget.toFixed(1)}</span>
                    <span class="stat-unit">°C</span>
                  </div>
                  <span class="stat-sub">Nominal</span>
                </div>

                <div class="stat-box ${Math.abs(selDelta) >= 1.0 ? 'box-warning' : ''}">
                  <span class="stat-label">Difference</span>
                  <div class="stat-val-row">
                    <span class="stat-num font-mono ${Math.abs(selDelta) >= 1.0 ? 'text-amber font-bold' : 'text-green'}">
                      ${selDeltaSign}${selDelta.toFixed(1)}
                    </span>
                    <span class="stat-unit">°C</span>
                  </div>
                  <span class="stat-sub ${Math.abs(selDelta) >= 1.0 ? 'text-amber' : ''}">
                    ${Math.abs(selDelta) >= 1.0 ? 'Overcooling target' : 'Within tolerance'}
                  </span>
                </div>
              </div>

              <!-- Compact Temperature vs Target Linear Visualization -->
              <div class="inspector-gauge-block">
                <div class="gauge-label-row">
                  <span class="gauge-title">Temperature vs Target</span>
                  <span class="gauge-reading font-mono font-bold ${Math.abs(selDelta) >= 1.0 ? 'text-amber' : 'text-green'}">
                    Δ ${selDeltaSign}${selDelta.toFixed(1)}°C
                  </span>
                </div>
                <div class="linear-gauge-container">
                  <!-- Comfort Band 20.0°C - 22.0°C (25% to 50% on 18-26 scale) -->
                  <div class="gauge-comfort-band" style="left: 25%; width: 25%;" title="Acceptable comfort tolerance: 20.0°C – 22.0°C"></div>
                  <!-- Setpoint vertical reference line (21.0°C -> 37.5%) -->
                  <div class="gauge-setpoint-line" style="left: ${targetPercent}%;" title="Target Setpoint: ${selTarget.toFixed(1)}°C"></div>
                  <!-- Current measured indicator needle -->
                  <div class="gauge-needle" style="left: ${gaugePercent}%;" title="Current: ${selTemp.toFixed(1)}°C"></div>
                </div>
                <div class="gauge-axis-ticks font-mono text-muted">
                  <span>18.0°C</span>
                  <span class="tick-target">Target ${selTarget.toFixed(1)}°C</span>
                  <span>26.0°C</span>
                </div>
              </div>

              <!-- Secondary Properties List -->
              <div class="inspector-properties-table">
                <div class="prop-row">
                  <span class="prop-label">Relative Humidity</span>
                  <span class="prop-val font-mono">${selHum.toFixed(1)}%</span>
                </div>
                <div class="prop-row">
                  <span class="prop-label">Occupancy</span>
                  <span class="prop-val font-mono">${selOcc} occupants</span>
                </div>
                <div class="prop-row">
                  <span class="prop-label">HVAC Power</span>
                  <span class="prop-val font-mono font-bold">${selPwr.toFixed(2)} kW</span>
                </div>
                <div class="prop-row">
                  <span class="prop-label">Conditioned Area</span>
                  <span class="prop-val font-mono">${selectedMeta.areaM2} m²</span>
                </div>
              </div>

              <!-- Data Freshness Box -->
              <div class="inspector-freshness-box">
                <div class="freshness-header">
                  <span class="freshness-label font-bold">Data freshness</span>
                  <span class="bms-stale-tag font-bold">Stale</span>
                </div>
                <p class="freshness-desc font-mono">
                  Last reading 12 minutes ago · Stale
                </p>
                <p class="freshness-note">
                  Readings preserved from 08:00 synchronization. Telemetry is offline.
                </p>
              </div>

              <!-- Concrete Operator Actions -->
              <div class="inspector-actions-section">
                <span class="actions-heading">Operator Actions</span>
                <div class="actions-grid">
                  <button id="btn-action-trend" class="bms-action-btn" data-zone="${selectedMeta.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                    View temperature trend
                  </button>
                  <button id="btn-action-diagnostics" class="bms-action-btn" data-zone="${selectedMeta.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    Check sensor connection
                  </button>
                  <button id="btn-action-camera" class="bms-action-btn" data-zone="${selectedMeta.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                    Open camera view
                  </button>
                  <button id="btn-action-compare" class="bms-action-btn" data-zone="${selectedMeta.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="18" x="3" y="3" rx="1"/><rect width="7" height="18" x="14" y="3" rx="1"/></svg>
                    Compare with neighboring zones
                  </button>
                </div>
              </div>

            </div>
          </aside>

        </div>

        <!-- MODALS / DRAWERS OVERLAY -->
        ${modalHtml}

      </div>
    `;
  }

  private renderActiveModal(
    selectedMeta: ZoneMeta,
    selTemp: number,
    selTarget: number,
    selPwr: number,
    selHum: number,
    selOcc: number
  ): string {
    if (this.activeModal === 'none') return '';

    if (this.activeModal === 'trend') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-trend-title">
          <div class="bms-modal-card bms-modal-lg">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-trend-title" class="modal-title">Temperature Trend — ${selectedMeta.name} (${selectedMeta.code})</h3>
                <p class="modal-subtitle">24-hour log up to telemetry loss at 08:00</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <!-- SVG Trend Chart -->
              <div class="trend-chart-wrap">
                <svg class="trend-svg" viewBox="0 0 760 260" preserveAspectRatio="none">
                  <!-- Grid Lines -->
                  <line x1="50" y1="40" x2="720" y2="40" stroke="#1e293b" stroke-width="1" />
                  <line x1="50" y1="90" x2="720" y2="90" stroke="#1e293b" stroke-width="1" />
                  <line x1="50" y1="140" x2="720" y2="140" stroke="#1e293b" stroke-width="1" />
                  <line x1="50" y1="190" x2="720" y2="190" stroke="#1e293b" stroke-width="1" />

                  <!-- Y-Axis Labels -->
                  <text x="40" y="44" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">24°C</text>
                  <text x="40" y="94" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">23°C</text>
                  <text x="40" y="144" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">22°C</text>
                  <text x="40" y="194" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">21°C</text>

                  <!-- Target Setpoint Dashed Line (21.0°C at Y=190) -->
                  <line x1="50" y1="190" x2="720" y2="190" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,4" />
                  <text x="725" y="193" font-family="'JetBrains Mono', monospace" font-size="10" fill="#3b82f6">Target 21.0°C</text>

                  <!-- Stale Shaded Region (From 08:00 to Right Edge) -->
                  <rect x="520" y="20" width="200" height="190" fill="rgba(239, 68, 68, 0.08)" />
                  <line x1="520" y1="20" x2="520" y2="210" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="2,2" />
                  <text x="525" y="34" font-family="'Inter', sans-serif" font-size="10" font-weight="600" fill="#ef4444">Telemetry Lost (08:00)</text>

                  <!-- Measured Temperature Curve -->
                  <path d="M 50 170 C 140 180, 220 175, 300 160 C 380 145, 440 120, 520 90 L 720 90" fill="none" stroke="#f59e0b" stroke-width="2.5" />
                  
                  <!-- Stale dashed extension after 08:00 -->
                  <line x1="520" y1="90" x2="720" y2="90" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,4" />
                  <circle cx="520" cy="90" r="4.5" fill="#f59e0b" />
                  <text x="520" y="80" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#f59e0b">23.0°C</text>

                  <!-- X-Axis Timeline -->
                  <line x1="50" y1="210" x2="720" y2="210" stroke="#334155" stroke-width="1" />
                  <text x="50" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">00:00</text>
                  <text x="200" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">03:00</text>
                  <text x="360" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">06:00</text>
                  <text x="520" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#ef4444" font-weight="700">08:00</text>
                  <text x="620" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">08:12 (Now)</text>
                </svg>
              </div>

              <!-- Trend Summary Metrics -->
              <div class="trend-stats-row">
                <div class="trend-stat"><span class="label">Minimum:</span> <span class="val font-mono">20.8°C</span></div>
                <div class="trend-stat"><span class="label">Maximum:</span> <span class="val font-mono text-amber">23.1°C</span></div>
                <div class="trend-stat"><span class="label">Average:</span> <span class="val font-mono">21.8°C</span></div>
                <div class="trend-stat"><span class="label">Setpoint:</span> <span class="val font-mono">21.0°C</span></div>
                <div class="trend-stat"><span class="label">Status:</span> <span class="val text-amber font-bold">Stale (+2.0°C)</span></div>
              </div>
            </div>
            <div class="bms-modal-footer">
              <button class="bms-btn bms-btn-secondary bms-modal-close">Close</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'diagnostics') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-diag-title">
          <div class="bms-modal-card">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-diag-title" class="modal-title">Sensor & Gateway Diagnostics</h3>
                <p class="modal-subtitle">Field Controller B-01 — Level 01 Network Segment</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <div class="diag-status-alert alert-offline">
                <span class="status-dot dot-red"></span>
                <div>
                  <strong>Gateway Status: Unresponsive</strong>
                  <p>100% packet loss for the last 12 minutes (72 consecutive polling cycles timed out).</p>
                </div>
              </div>

              <div class="diag-props-table">
                <div class="diag-row"><span class="diag-k">Gateway IP Address:</span> <span class="diag-v font-mono">192.168.12.1</span></div>
                <div class="diag-row"><span class="diag-k">BACnet UDP Port:</span> <span class="diag-v font-mono">47808</span></div>
                <div class="diag-row"><span class="diag-k">Subnet / VLAN:</span> <span class="diag-v font-mono">VLAN 12 (Facilities IoT)</span></div>
                <div class="diag-row"><span class="diag-k">Last Packet Received:</span> <span class="diag-v font-mono">08:00:14 AM (12 min ago)</span></div>
                <div class="diag-row"><span class="diag-k">Field Controller Model:</span> <span class="diag-v">JCI Metasys FEC2611-0</span></div>
                <div class="diag-row"><span class="diag-k">Z-02 Sensor Link:</span> <span class="diag-v text-amber">Last confirmed 08:00 · RSSI -74 dBm</span></div>
                <div class="diag-row"><span class="diag-k">Z-03 Sensor Link:</span> <span class="diag-v text-amber">Last confirmed 08:00 · RSSI -68 dBm</span></div>
                <div class="diag-row"><span class="diag-k">Z-01 Sensor Link:</span> <span class="diag-v text-amber">Last confirmed 08:00 · RSSI -62 dBm</span></div>
              </div>

              <div class="diag-guidance">
                <strong>Recommended Operator Action:</strong>
                <p>Verify that Field Controller B-01 in Electrical Closet 1-E has active 24VAC power and that network switch port 14 has link activity.</p>
              </div>
            </div>
            <div class="bms-modal-footer">
              <button id="btn-retry-conn" class="bms-btn bms-btn-primary ${this.isRetrying ? 'is-loading' : ''}">Retry connection</button>
              <button class="bms-btn bms-btn-secondary bms-modal-close">Close</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'compare') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-compare-title">
          <div class="bms-modal-card bms-modal-lg">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-compare-title" class="modal-title">Zone Telemetry Comparison — Level 01</h3>
                <p class="modal-subtitle">Side-by-side comparison across conditioned spaces</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <table class="bms-compare-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Z-02 Open Plan Office</th>
                    <th>Z-03 Executive Conference</th>
                    <th>Z-01 Main Entrance & Lobby</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="col-metric-name">Measured Temperature</td>
                    <td class="font-mono font-bold text-amber">23.0°C (Stale)</td>
                    <td class="font-mono font-bold text-amber">22.5°C (Stale)</td>
                    <td class="font-mono font-bold text-green">21.0°C (Stale)</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Target Setpoint</td>
                    <td class="font-mono text-muted">21.0°C</td>
                    <td class="font-mono text-muted">21.0°C</td>
                    <td class="font-mono text-muted">21.0°C</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Difference (Deviation)</td>
                    <td class="font-mono text-amber font-bold">+2.0°C</td>
                    <td class="font-mono text-amber font-bold">+1.5°C</td>
                    <td class="font-mono text-green">0.0°C</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Relative Humidity</td>
                    <td class="font-mono">42.8%</td>
                    <td class="font-mono">44.1%</td>
                    <td class="font-mono">41.5%</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Headcount Occupancy</td>
                    <td class="font-mono">8 occupants</td>
                    <td class="font-mono">4 occupants</td>
                    <td class="font-mono">2 occupants</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">HVAC Electrical Load</td>
                    <td class="font-mono">3.50 kW</td>
                    <td class="font-mono">2.10 kW</td>
                    <td class="font-mono">1.50 kW</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Conditioned Floor Area</td>
                    <td class="font-mono">335 m²</td>
                    <td class="font-mono">185 m²</td>
                    <td class="font-mono">520 m²</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Freshness</td>
                    <td class="text-muted">12 min ago</td>
                    <td class="text-muted">12 min ago</td>
                    <td class="text-muted">12 min ago</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bms-modal-footer">
              <button class="bms-btn bms-btn-secondary bms-modal-close">Close</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'alarms') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-alarms-title">
          <div class="bms-modal-card">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-alarms-title" class="modal-title">Active Alarms (2)</h3>
                <p class="modal-subtitle">Condition violations requiring operator review</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <div class="bms-alarm-item">
                <div class="alarm-header-row">
                  <span class="chip-dot dot-amber"></span>
                  <strong class="text-amber">Z-02 Open Plan Office — Setpoint Deviation (+2.0°C)</strong>
                </div>
                <p class="alarm-desc">Indoor temp reached 23.0°C vs 21.0°C target. Reading is stale (12 min old).</p>
              </div>

              <div class="bms-alarm-item">
                <div class="alarm-header-row">
                  <span class="chip-dot dot-amber"></span>
                  <strong class="text-amber">Z-03 Executive Conference — Setpoint Deviation (+1.5°C)</strong>
                </div>
                <p class="alarm-desc">Indoor temp reached 22.5°C vs 21.0°C target. Reading is stale (12 min old).</p>
              </div>
            </div>
            <div class="bms-modal-footer">
              <button class="bms-btn bms-btn-secondary bms-modal-close">Close</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'settings') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-settings-title">
          <div class="bms-modal-card">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-settings-title" class="modal-title">Operator Settings</h3>
                <p class="modal-subtitle">Facilities operations preferences</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <div class="settings-group">
                <label class="settings-label">Temperature Units</label>
                <div class="settings-radio-row">
                  <label><input type="radio" name="tempUnit" value="C" checked> Celsius (°C)</label>
                  <label><input type="radio" name="tempUnit" value="F"> Fahrenheit (°F)</label>
                </div>
              </div>
              <div class="settings-group">
                <label class="settings-label">Telemetry Polling Interval</label>
                <select class="settings-select">
                  <option value="5">5 seconds (Normal)</option>
                  <option value="15">15 seconds (Conservative)</option>
                  <option value="60">60 seconds (Low Bandwidth)</option>
                </select>
              </div>
              <div class="settings-group">
                <label class="settings-label">Deviation Alert Threshold</label>
                <div class="font-mono text-muted">±1.0°C (Default tolerance)</div>
              </div>
            </div>
            <div class="bms-modal-footer">
              <button class="bms-btn bms-btn-primary bms-modal-close">Save Preferences</button>
              <button class="bms-btn bms-btn-secondary bms-modal-close">Cancel</button>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }
}
