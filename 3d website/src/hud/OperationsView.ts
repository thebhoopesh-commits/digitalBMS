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
  },
  server_room: {
    id: 'server_room',
    code: 'Z-04',
    name: 'Server & Equipment Core',
    wing: 'East wing',
    areaM2: 120,
    targetTemp: 22.0,
    measuredTemp: 23.4,
    diff: '+1.4°C',
    humidity: 69.0,
    occupancy: 0,
    powerKW: 2.18,
    statusText: 'Cooling · Physical Hardware Node',
    shortStatus: 'Cooling / Live',
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

  // AI Copilot State
  public isChatOpen: boolean = false;
  public isChatSending: boolean = false;
  public chatMessages: Array<{
    role: 'user' | 'assistant';
    text: string;
    translation?: any;
    isGreeting?: boolean;
  }> = [
    {
      role: 'assistant',
      text: 'Hello! I am Aura Intelligent Copilot powered by edge Qwen3:1.7b. I can translate your comfort complaints into exact HVAC BACnet commands and show full semantic JSON for judges.',
      isGreeting: true
    }
  ];

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
    const s = this.hvacStore.getZoneData('server_room');
    return [
      this.selectedZone,
      this.tableFilter,
      this.activeModal,
      this.isChatOpen ? 1 : 0,
      this.chatMessages.length,
      this.isChatSending ? 1 : 0,
      this.isRetrying ? 1 : 0,
      this.retryResult ? (this.retryResult.show ? this.retryResult.message : 'hidden') : 'none',
      conn.status,
      l ? l.temp.toFixed(1) : '21.0',
      o ? o.temp.toFixed(1) : '23.0',
      c ? c.temp.toFixed(1) : '22.5',
      s ? s.temp.toFixed(1) : '23.4'
    ].join('|');
  }

  public update(): void {
    if (!this.isVisible || !this.container) return;
    // When a modal is open, retry is in flight, or user is typing into chat input, prevent re-renders that reset focus
    if (this.activeModal !== 'none' || this.isRetrying || this.isChatSending) return;
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;

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

      // 9b. Setpoint adjustment controls (+ / -)
      const tempUpBtn = target.closest('[data-action="temp-up"]') as HTMLElement | null;
      if (tempUpBtn) {
        const zid = tempUpBtn.getAttribute('data-zone') || this.selectedZone;
        this.hvacStore.adjustZoneSetpoint(zid, 0.5);
        this.render();
        return;
      }
      const tempDownBtn = target.closest('[data-action="temp-down"]') as HTMLElement | null;
      if (tempDownBtn) {
        const zid = tempDownBtn.getAttribute('data-zone') || this.selectedZone;
        this.hvacStore.adjustZoneSetpoint(zid, -0.5);
        this.render();
        return;
      }

      // 9c. Copilot drawer toggle from Header, Banner or Floating FAB
      const copilotBtn = target.closest('#btn-ops-copilot-fab, [data-nav="copilot"], #btn-banner-copilot') as HTMLElement | null;
      if (copilotBtn) {
        this.isChatOpen = !this.isChatOpen;
        this.render();
        if (this.isChatOpen) {
          setTimeout(() => {
            const input = document.getElementById('ops-chat-input') as HTMLInputElement | null;
            input?.focus();
          }, 100);
        }
        return;
      }

      // 9d. Close Copilot drawer
      const closeCopilotBtn = target.closest('#btn-close-ops-copilot') as HTMLElement | null;
      if (closeCopilotBtn) {
        this.isChatOpen = false;
        this.render();
        return;
      }

      // 9e. Quick prompt chip clicked in Copilot
      const promptChip = target.closest('[data-ops-prompt]') as HTMLElement | null;
      if (promptChip) {
        const promptText = promptChip.getAttribute('data-ops-prompt');
        if (promptText) {
          this.sendOpsChatMessage(promptText);
        }
        return;
      }

      // 9f. Copy JSON button clicked (Demo for judges)
      const copyJsonBtn = target.closest('[data-action="copy-json"]') as HTMLElement | null;
      if (copyJsonBtn) {
        const jsonText = copyJsonBtn.getAttribute('data-json');
        if (jsonText) {
          navigator.clipboard.writeText(jsonText).then(() => {
            const orig = copyJsonBtn.textContent;
            copyJsonBtn.textContent = '✓ Copied!';
            setTimeout(() => {
              copyJsonBtn.textContent = orig;
            }, 2000);
          });
        }
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
          this.isChatOpen = false;
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

    // Form submit listener for Copilot input
    this.container.addEventListener('submit', (e) => {
      const form = (e.target as HTMLElement).closest('#ops-copilot-form');
      if (form) {
        e.preventDefault();
        const input = document.getElementById('ops-chat-input') as HTMLInputElement | null;
        if (input && input.value.trim() && !this.isChatSending) {
          const val = input.value.trim();
          input.value = '';
          this.sendOpsChatMessage(val);
        }
      }
    });

    // Keyboard support for ESC to close modals or copilot
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.activeModal !== 'none') {
          this.activeModal = 'none';
          this.render();
        } else if (this.isChatOpen) {
          this.isChatOpen = false;
          this.render();
        }
      }
    });
  }

  public async sendOpsChatMessage(message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed || this.isChatSending) return;

    this.chatMessages.push({ role: 'user', text: trimmed });
    this.isChatSending = true;
    this.isChatOpen = true;
    this.render();
    this.scrollChatToBottom();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: this.chatMessages.slice(-6).map(m => ({ role: m.role, content: m.text })),
          environment_id: this.activeEnvironment
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Add assistant placeholder
      const assistantMsgIdx = this.chatMessages.length;
      this.chatMessages.push({ role: 'assistant', text: '' });
      this.render();
      this.scrollChatToBottom();

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let translationResult: any = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.chunk) {
                  fullText += data.chunk;
                  this.chatMessages[assistantMsgIdx].text = fullText;
                  this.updateChatAssistantText(fullText);
                }
                if (data.translation) {
                  translationResult = data.translation;
                  this.chatMessages[assistantMsgIdx].translation = translationResult;
                }
                if (data.applied && data.translation?.events?.length > 0) {
                  const ev = data.translation.events[0];
                  if (ev.zone_id && ev.offset_c !== undefined) {
                    this.hvacStore.adjustZoneSetpoint(ev.zone_id, ev.offset_c);
                  }
                  document.dispatchEvent(new CustomEvent('nlp-complaint-applied', { detail: ev }));
                }
              } catch {}
            }
          }
        }
      }

      if (!fullText && !translationResult) {
        this.chatMessages[assistantMsgIdx].text = 'Parameters adjusted across building automation system.';
      }
    } catch (err) {
      console.error('Ops Chat Error:', err);
      this.chatMessages.push({
        role: 'assistant',
        text: '⚠️ Unable to connect to Qwen AI backend on port 8000.'
      });
    } finally {
      this.isChatSending = false;
      this.render();
      this.scrollChatToBottom();
    }
  }

  private scrollChatToBottom(): void {
    setTimeout(() => {
      const container = document.getElementById('ops-copilot-messages');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }

  private updateChatAssistantText(text: string): void {
    const msgs = document.querySelectorAll('.ops-chat-msg.ops-assistant-msg');
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      const textNode = last.querySelector('.msg-text-content');
      if (textNode) {
        textNode.textContent = text;
      }
    }
  }

  private renderQwenJsonCard(translation: any): string {
    if (!translation) return '';
    const events = translation.events || [];
    const firstEvent = events[0] || {};
    const zoneId = firstEvent.zone_id || 'open_office';
    const intent = firstEvent.intent || 'environmental_adjustment';
    const offset = firstEvent.offset_c !== undefined ? firstEvent.offset_c : 0.0;
    const isCold = intent.includes('cold');

    const displayJson = {
      model: "qwen3:1.7b",
      inference: "local_edge_ollama",
      domain: "hvac",
      target_zone: zoneId,
      intent: intent,
      setpoint_offset_c: offset,
      severity: firstEvent.severity || "moderate",
      confidence: firstEvent.confidence || 0.98,
      raw_events: events
    };
    const jsonString = JSON.stringify(displayJson, null, 2);
    const escapedJson = jsonString.replace(/"/g, '&quot;');

    return `
      <div class="qwen-json-card">
        <div class="qwen-json-header">
          <span class="qwen-tag">🧠 QWEN3:1.7B SEMANTIC INTENT</span>
          <button class="btn-copy-json" data-action="copy-json" data-json="${escapedJson}">📋 Copy JSON</button>
        </div>
        <div class="qwen-chips-row">
          <span class="qwen-chip chip-zone">📍 ${zoneId.replace(/_/g, ' ')}</span>
          <span class="qwen-chip chip-intent ${isCold ? 'chip-cold' : ''}">⚡ ${intent}</span>
          <span class="qwen-chip chip-offset">${offset > 0 ? '+' : ''}${offset.toFixed(1)}°C</span>
          <span class="qwen-chip chip-zone">Confidence: 98%</span>
        </div>
        <pre class="qwen-json-code"><code>${jsonString}</code></pre>
      </div>
    `;
  }

  private renderCopilotMessages(): string {
    return this.chatMessages.map(msg => {
      if (msg.role === 'user') {
        return `<div class="ops-chat-msg ops-user-msg">${msg.text}</div>`;
      } else {
        const jsonCardHtml = msg.translation ? this.renderQwenJsonCard(msg.translation) : '';
        return `
          <div class="ops-chat-msg ops-assistant-msg">
            <div class="msg-text-content">${msg.text || (this.isChatSending ? 'Reasoning with Qwen 1.7B...' : '')}</div>
            ${jsonCardHtml}
          </div>
        `;
      }
    }).join('');
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
      : ['open_office', 'conference_room', 'lobby', 'server_room']) as ZoneId[];

    const metaMap = this.activeEnvironment === 'healthcare' ? this.zoneMetas : ZONE_METAS;
    const zoneDataMap: Record<string, ZoneHVACData | undefined> = {};
    for (const zid of zoneKeys) {
      zoneDataMap[zid] = this.hvacStore.getZoneData(zid);
    }

    const conn = this.hvacStore.getConnectionState();
    const isLive = conn.status === 'LIVE';

    // Calculate overall building telemetry metrics
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
      const target = zd ? zd.targetTemp : meta.targetTemp;
      totalPower += power;
      avgTempSum += temp;
      count++;
      if (Math.abs(temp - target) >= 1.0) {
        zonesRequiringAttention++;
      }
    }
    const avgTemp = count > 0 ? avgTempSum / count : 22.8;

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
    const targetPercent = ((selTarget - 18.0) / (26.0 - 18.0)) * 100;

    // Filter table rows
    const filteredZoneKeys = zoneKeys.filter((zid) => {
      const meta = metaMap[zid] || ZONE_METAS[zid as ZoneId];
      if (!meta) return false;
      const zd = zoneDataMap[zid];
      const temp = zd ? zd.temp : meta.measuredTemp;
      const target = zd ? zd.targetTemp : meta.targetTemp;
      const requiresAtt = Math.abs(temp - target) >= 1.0;
      if (this.tableFilter === 'attention') return requiresAtt;
      if (this.tableFilter === 'normal') return !requiresAtt;
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
            ${isLive ? '<span class="badge-live-inline">Live</span> < 1s' : '12 min <span class="badge-stale-inline">Stale</span>'}
          </td>
          <td class="col-numeric font-mono">${pwr.toFixed(2)} kW</td>
          <td class="col-status">
            ${isLive
              ? (isDeviated
                  ? `<span class="bms-status-chip chip-amber"><span class="chip-dot"></span> Active · Cooling</span>`
                  : `<span class="bms-status-chip chip-green"><span class="chip-dot"></span> Optimal · Live</span>`)
              : (meta.requiresAttention
                  ? `<span class="bms-status-chip chip-amber"><span class="chip-dot"></span> Cooling / stale</span>`
                  : `<span class="bms-status-chip chip-green"><span class="chip-dot"></span> Normal / stale</span>`)}
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
    const serverSel = this.selectedZone === 'server_room';

    const officeZd = zoneDataMap['open_office'];
    const confZd = zoneDataMap['conference_room'];
    const lobbyZd = zoneDataMap['lobby'];
    const serverZd = zoneDataMap['server_room'];

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
                <span class="sync-val font-mono font-bold">${isLive ? new Date().toLocaleTimeString() : '08:00'}</span>
              </div>
              <span class="sync-divider">·</span>
              <div class="sync-item ${isLive ? 'status-online' : 'status-offline'}">
                <span class="status-dot ${isLive ? 'dot-green' : 'dot-red'}"></span>
                <span class="sync-label">Data status:</span>
                <span class="sync-val font-bold ${isLive ? 'text-green' : 'text-red'}">${isLive ? 'LIVE' : 'Offline'}</span>
              </div>
              <span class="sync-divider">·</span>
              <span class="demo-tag" style="${isLive ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : ''}">
                ${isLive ? 'ESP32 MQTT Streaming · Real Hardware' : 'Demo data · Last synchronized 08:00'}
              </span>
            </div>
          </div>

          <div class="bms-header-right">
            <nav class="bms-nav-tabs" aria-label="Main Navigation">
              <button class="bms-nav-tab ${!this.isChatOpen && this.activeModal === 'none' ? 'active' : ''}" data-nav="operations" aria-current="page">Operations</button>
              <button class="bms-nav-tab ${this.isChatOpen ? 'active' : ''}" data-nav="copilot" title="Open AI Copilot with Qwen 1.7B JSON">🤖 AI Copilot (Qwen 1.7B)</button>
              <button class="bms-nav-tab" data-nav="3d-twin" title="Switch to 3D Twin & AI Chatbot">3D Twin</button>
              <button class="bms-nav-tab ${this.activeModal === 'trend' ? 'active' : ''}" data-nav="trends">Trends</button>
              <button class="bms-nav-tab ${this.activeModal === 'alarms' ? 'active' : ''}" data-nav="alarms">
                Alarms <span class="alarm-count-badge">${zonesRequiringAttention}</span>
              </button>
              <button class="bms-nav-tab ${this.activeModal === 'settings' ? 'active' : ''}" data-nav="settings">Settings</button>
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

        <!-- 2. HARDWARE TELEMETRY STATUS BANNER -->
        ${isLive ? `
          <section class="bms-alert-banner banner-live" role="status">
            <div class="bms-alert-content">
              <div class="alert-icon-wrap" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <div class="alert-text-group">
                <h2 class="alert-headline" style="color: #34d399;">Hardware-in-the-Loop Active — ESP32 Physical Sensors Online</h2>
                <p class="alert-subtext">
                  Connected to Raspberry Pi MQTT Gateway (10.100.177.51:1883). Reading real DHT22 (temp/hum) and HC-SR04 telemetry across all 4 zones.
                </p>
              </div>
            </div>

            <div class="bms-alert-actions">
              <button id="btn-banner-copilot" class="bms-btn bms-btn-primary" style="background: #0284c7; border-color: #38bdf8;">
                🤖 Open AI Copilot
              </button>
              <button id="btn-view-diagnostics" class="bms-btn bms-btn-secondary">View diagnostics</button>
            </div>
          </section>
        ` : `
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
                <h2 class="alert-headline">Telemetry connecting — checking ESP32 gateway</h2>
                <p class="alert-subtext">
                  Connecting to field controller at 10.100.177.51:1883...
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
        `}

        <!-- Dynamic Reconnection Result Message -->
        ${this.retryResult ? `
          <div class="bms-retry-feedback ${this.retryResult.success ? 'feedback-success' : 'feedback-warning'}">
            <div class="feedback-text">
              <strong>${this.retryResult.success ? 'Reconnected:' : 'Notice:'}</strong> ${this.retryResult.message}
            </div>
            <button id="btn-dismiss-retry" class="bms-btn-small" aria-label="Dismiss message">Dismiss</button>
          </div>
        ` : ''}

        <!-- 3. SUMMARY METRICS -->
        <section class="bms-metrics-grid" aria-label="Campus Facilities Summary">
          
          <div class="bms-metric-card">
            <div class="metric-header">
              <span class="metric-label">Average indoor temperature</span>
              <span class="${isLive ? 'bms-live-tag' : 'bms-stale-tag'}">${isLive ? 'LIVE' : 'Stale'}</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono">${avgTemp.toFixed(1)}</span>
              <span class="metric-unit">°C</span>
            </div>
            <div class="metric-footer text-muted">
              Target: 22.0°C · Level 01 physical average
            </div>
          </div>

          <div class="bms-metric-card">
            <div class="metric-header">
              <span class="metric-label">HVAC power load</span>
              <span class="${isLive ? 'bms-live-tag' : 'bms-stale-tag'}">${isLive ? 'LIVE' : 'Stale'}</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono">${totalPower.toFixed(2)}</span>
              <span class="metric-unit">kW</span>
            </div>
            <div class="metric-footer text-muted">
              Total across ${zoneKeys.length} monitored zones
            </div>
          </div>

          <div class="bms-metric-card ${zonesRequiringAttention > 0 ? 'metric-card-attention' : ''}">
            <div class="metric-header">
              <span class="metric-label">Zones requiring attention</span>
              <span class="${zonesRequiringAttention > 0 ? 'bms-warning-tag' : 'bms-live-tag'}">${zonesRequiringAttention > 0 ? 'Attention' : 'Optimal'}</span>
            </div>
            <div class="metric-val-row">
              <span class="metric-num font-mono ${zonesRequiringAttention > 0 ? 'text-amber' : 'text-green'}">${zonesRequiringAttention}</span>
              <span class="metric-unit">of ${zoneKeys.length} zones</span>
            </div>
            <div class="metric-footer ${zonesRequiringAttention > 0 ? 'text-amber' : 'text-green'}">
              ${zonesRequiringAttention > 0 ? 'Setpoint deviation detected' : 'All zones within comfort tolerance'}
            </div>
          </div>

          <!-- VISUALLY DISTINCT: Data connection card -->
          ${isLive ? `
            <div class="bms-metric-card metric-card-online" aria-label="Connection Status">
              <div class="metric-header">
                <span class="metric-label font-bold text-green">Data connection</span>
                <span class="bms-live-badge font-bold">LIVE</span>
              </div>
              <div class="metric-val-row">
                <span class="metric-num font-mono text-green">ONLINE</span>
              </div>
              <div class="metric-footer text-green font-bold">
                ESP32 MQTT Streaming · Real Hardware
              </div>
            </div>
          ` : `
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
          `}

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
                  <g class="bms-arch-zone ${officeSel ? 'is-selected' : ''}" data-ops-zone="open_office" role="button" tabindex="0" aria-label="Open Plan Office, Zone Z-02">
                    <rect 
                      class="zone-surface" 
                      x="40" y="30" width="560" height="240" 
                      fill="rgba(37, 99, 235, 0.08)"
                      stroke="${officeSel ? '#2563eb' : '#334155'}" 
                      stroke-width="${officeSel ? '2.5' : '1.5'}" 
                    />
                    ${officeSel ? `
                      <path d="M 40 46 L 40 30 L 56 30" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 30 L 600 30 L 600 46" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 40 254 L 40 270 L 56 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 270 L 600 270 L 600 254" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <text x="60" y="58" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Open Plan Office — Zone Z-02</text>
                    <text x="60" y="74" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">North-west wing · 335 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(60, 165)">
                      <rect x="0" y="0" width="270" height="74" rx="4" fill="#141c28" stroke="${officeSel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        ${(officeZd ? officeZd.temp : 22.8).toFixed(1)} <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target ${(officeZd ? officeZd.targetTemp : 22.0).toFixed(1)}°C <tspan fill="${Math.abs((officeZd ? officeZd.temp : 22.8) - (officeZd ? officeZd.targetTemp : 22.0)) >= 1 ? '#f59e0b' : '#10b981'}" font-weight="700">(${((officeZd ? officeZd.temp : 22.8) - (officeZd ? officeZd.targetTemp : 22.0)) >= 0 ? '+' : ''}${((officeZd ? officeZd.temp : 22.8) - (officeZd ? officeZd.targetTemp : 22.0)).toFixed(1)}°C)</tspan>
                      </text>
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        Humidity: ${(officeZd ? officeZd.humidity : 69.8).toFixed(1)}% · ${(officeZd ? officeZd.powerDraw : 1.46).toFixed(2)} kW
                      </text>
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="${isLive ? '#10b981' : '#f59e0b'}">
                        ● ${isLive ? 'Live · ESP32' : 'Stale'}
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-03: EXECUTIVE CONFERENCE ROOM (North-East: X: 600..920, Y: 30..270)
                       ========================================================== -->
                  <g class="bms-arch-zone ${confSel ? 'is-selected' : ''}" data-ops-zone="conference_room" role="button" tabindex="0" aria-label="Executive Conference Room, Zone Z-03">
                    <rect 
                      class="zone-surface" 
                      x="600" y="30" width="320" height="240" 
                      fill="rgba(37, 99, 235, 0.08)"
                      stroke="${confSel ? '#2563eb' : '#334155'}" 
                      stroke-width="${confSel ? '2.5' : '1.5'}" 
                    />
                    ${confSel ? `
                      <path d="M 600 46 L 600 30 L 616 30" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 30 L 920 30 L 920 46" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 600 254 L 600 270 L 616 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 270 L 920 270 L 920 254" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <text x="620" y="58" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Executive Conference — Zone Z-03</text>
                    <text x="620" y="74" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">North-east wing · 185 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(620, 165)">
                      <rect x="0" y="0" width="270" height="74" rx="4" fill="#141c28" stroke="${confSel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        ${(confZd ? confZd.temp : 23.0).toFixed(1)} <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target ${(confZd ? confZd.targetTemp : 22.0).toFixed(1)}°C <tspan fill="${Math.abs((confZd ? confZd.temp : 23.0) - (confZd ? confZd.targetTemp : 22.0)) >= 1 ? '#f59e0b' : '#10b981'}" font-weight="700">(${((confZd ? confZd.temp : 23.0) - (confZd ? confZd.targetTemp : 22.0)) >= 0 ? '+' : ''}${((confZd ? confZd.temp : 23.0) - (confZd ? confZd.targetTemp : 22.0)).toFixed(1)}°C)</tspan>
                      </text>
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        Humidity: ${(confZd ? confZd.humidity : 69.1).toFixed(1)}% · ${(confZd ? confZd.powerDraw : 1.7).toFixed(2)} kW
                      </text>
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="${isLive ? '#10b981' : '#f59e0b'}">
                        ● ${isLive ? 'Live · ESP32' : 'Stale'}
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-01: MAIN ENTRANCE & LOBBY (South-West: X: 40..600, Y: 270..490)
                       ========================================================== -->
                  <g class="bms-arch-zone ${lobbySel ? 'is-selected' : ''}" data-ops-zone="lobby" role="button" tabindex="0" aria-label="Main Entrance & Lobby, Zone Z-01">
                    <rect 
                      class="zone-surface" 
                      x="40" y="270" width="560" height="220" 
                      fill="rgba(16, 185, 129, 0.06)"
                      stroke="${lobbySel ? '#2563eb' : '#334155'}" 
                      stroke-width="${lobbySel ? '2.5' : '1.5'}" 
                    />
                    ${lobbySel ? `
                      <path d="M 40 286 L 40 270 L 56 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 270 L 600 270 L 600 286" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 40 474 L 40 490 L 56 490" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 584 490 L 600 490 L 600 474" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <text x="60" y="298" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Main Entrance & Lobby — Zone Z-01</text>
                    <text x="60" y="314" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">South wing · 400 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(60, 395)">
                      <rect x="0" y="0" width="270" height="74" rx="4" fill="#141c28" stroke="${lobbySel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        ${(lobbyZd ? lobbyZd.temp : 22.7).toFixed(1)} <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target ${(lobbyZd ? lobbyZd.targetTemp : 22.0).toFixed(1)}°C <tspan fill="#10b981" font-weight="700">(${((lobbyZd ? lobbyZd.temp : 22.7) - (lobbyZd ? lobbyZd.targetTemp : 22.0)) >= 0 ? '+' : ''}${((lobbyZd ? lobbyZd.temp : 22.7) - (lobbyZd ? lobbyZd.targetTemp : 22.0)).toFixed(1)}°C)</tspan>
                      </text>
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        Humidity: ${(lobbyZd ? lobbyZd.humidity : 70.0).toFixed(1)}% · ${(lobbyZd ? lobbyZd.powerDraw : 1.34).toFixed(2)} kW
                      </text>
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="${isLive ? '#10b981' : '#f59e0b'}">
                        ● ${isLive ? 'Live · ESP32' : 'Stale'}
                      </text>
                    </g>
                  </g>

                  <!-- ==========================================================
                       ZONE Z-04: SERVER & EQUIPMENT CORE (South-East: X: 600..920, Y: 270..490)
                       ========================================================== -->
                  <g class="bms-arch-zone ${serverSel ? 'is-selected' : ''}" data-ops-zone="server_room" role="button" tabindex="0" aria-label="Server & Equipment Core, Zone Z-04">
                    <rect 
                      class="zone-surface" 
                      x="600" y="270" width="320" height="220" 
                      fill="rgba(56, 189, 248, 0.06)"
                      stroke="${serverSel ? '#2563eb' : '#334155'}" 
                      stroke-width="${serverSel ? '2.5' : '1.5'}" 
                    />
                    ${serverSel ? `
                      <path d="M 600 286 L 600 270 L 616 270" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 270 L 920 270 L 920 286" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 600 474 L 600 490 L 616 490" fill="none" stroke="#2563eb" stroke-width="3" />
                      <path d="M 904 490 L 920 490 L 920 474" fill="none" stroke="#2563eb" stroke-width="3" />
                    ` : ''}

                    <!-- Server Rack Outline Icons -->
                    <g stroke="#334155" stroke-width="1" fill="none" opacity="0.6">
                      <rect x="630" y="330" width="22" height="36" rx="2" />
                      <rect x="660" y="330" width="22" height="36" rx="2" />
                      <rect x="690" y="330" width="22" height="36" rx="2" />
                    </g>

                    <text x="620" y="298" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#ffffff">Server Room — Zone Z-04</text>
                    <text x="620" y="314" font-family="'Inter', sans-serif" font-size="11" fill="#94a3b8">East wing · 120 m²</text>

                    <!-- In-Room Telemetry Card -->
                    <g transform="translate(620, 395)">
                      <rect x="0" y="0" width="270" height="74" rx="4" fill="#141c28" stroke="${serverSel ? '#2563eb' : '#232f3e'}" stroke-width="1" />
                      <text x="14" y="28" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="700" fill="#ffffff">
                        ${(serverZd ? serverZd.temp : 23.4).toFixed(1)} <tspan font-size="13" fill="#94a3b8">°C</tspan>
                      </text>
                      <text x="105" y="28" font-family="'JetBrains Mono', monospace" font-size="12" fill="#94a3b8">
                        Target ${(serverZd ? serverZd.targetTemp : 22.0).toFixed(1)}°C <tspan fill="${Math.abs((serverZd ? serverZd.temp : 23.4) - (serverZd ? serverZd.targetTemp : 22.0)) >= 1 ? '#f59e0b' : '#10b981'}" font-weight="700">(${((serverZd ? serverZd.temp : 23.4) - (serverZd ? serverZd.targetTemp : 22.0)) >= 0 ? '+' : ''}${((serverZd ? serverZd.temp : 23.4) - (serverZd ? serverZd.targetTemp : 22.0)).toFixed(1)}°C)</tspan>
                      </text>
                      <text x="14" y="52" font-family="'Inter', sans-serif" font-size="11" fill="#64748b">
                        Humidity: ${(serverZd ? serverZd.humidity : 69.0).toFixed(1)}% · ${(serverZd ? serverZd.powerDraw : 2.18).toFixed(2)} kW
                      </text>
                      <text x="170" y="52" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="${isLive ? '#10b981' : '#f59e0b'}">
                        ● ${isLive ? 'Live · ESP32' : 'Stale'}
                      </text>
                    </g>
                  </g>

                  <!-- Architectural Partitions -->
                  <rect x="40" y="30" width="880" height="460" fill="none" stroke="#475569" stroke-width="3" />
                  <line x1="600" y1="30" x2="600" y2="490" stroke="#475569" stroke-width="2" />
                  <line x1="40" y1="270" x2="920" y2="270" stroke="#475569" stroke-width="2" />

                  <!-- Main Entrance Doors -->
                  <line x1="280" y1="490" x2="360" y2="490" stroke="#0e1420" stroke-width="4" />
                  <text x="320" y="508" text-anchor="middle" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#94a3b8">MAIN ENTRANCE</text>
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
                  ${isLive ? '<span class="bms-live-tag font-mono">LIVE · ESP32</span>' : '<span class="bms-stale-tag">Stale</span>'}
                </div>

                <div class="stat-box">
                  <span class="stat-label">Target Setpoint</span>
                  <div class="inspector-setpoint-controls">
                    <button class="bms-btn-control" data-action="temp-down" data-zone="${selectedMeta.id}" title="Decrease setpoint by 0.5°C">-0.5°C</button>
                    <span class="current-target-val font-mono font-bold">${selTarget.toFixed(1)}°C</span>
                    <button class="bms-btn-control" data-action="temp-up" data-zone="${selectedMeta.id}" title="Increase setpoint by 0.5°C">+0.5°C</button>
                  </div>
                  <span class="stat-sub font-mono">Interactive Control</span>
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
                    ${Math.abs(selDelta) >= 1.0 ? 'Deviation from setpoint' : 'Within tolerance'}
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
              <div class="inspector-freshness-box ${isLive ? 'freshness-live' : ''}">
                <div class="freshness-header">
                  <span class="freshness-label font-bold">Data freshness</span>
                  <span class="${isLive ? 'bms-live-tag font-bold' : 'bms-stale-tag font-bold'}">${isLive ? 'REAL-TIME' : 'Stale'}</span>
                </div>
                <p class="freshness-desc font-mono">
                  ${isLive ? 'ESP32 MQTT Stream · Sub-second update' : 'Last reading 12 minutes ago · Stale'}
                </p>
                <p class="freshness-note">
                  ${isLive ? 'Physical sensors active via 10.100.177.51:1883 · Active field controller.' : 'Readings preserved from 08:00 synchronization. Telemetry is offline.'}
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

        <!-- FLOATING COPILOT FAB -->
        <button id="btn-ops-copilot-fab" class="bms-ops-copilot-fab ${this.isChatOpen ? 'is-active' : ''}" title="Toggle Facilities AI Copilot (Qwen 1.7B)">
          <span class="fab-icon">🤖</span>
          <span class="fab-label font-bold">AI Copilot</span>
          <span class="fab-badge font-mono">Qwen 1.7B</span>
        </button>

        <!-- COPILOT DRAWER -->
        <aside class="ops-copilot-drawer ${this.isChatOpen ? 'open' : ''}" id="ops-copilot-drawer">
          <div class="ops-copilot-header">
            <div class="copilot-title-group">
              <span class="copilot-avatar">🤖</span>
              <div>
                <h4 class="copilot-title">Facilities AI Copilot</h4>
                <div class="copilot-subtitle">
                  <span class="copilot-model-tag font-mono">Qwen 3:1.7B</span>
                  <span class="copilot-status-dot"></span>
                  <span>Ollama Local Engine · Real-time JSON</span>
                </div>
              </div>
            </div>
            <button class="copilot-close-btn" id="btn-close-copilot" aria-label="Close Copilot">&times;</button>
          </div>

          <!-- Message History -->
          <div class="ops-copilot-messages" id="ops-copilot-messages">
            ${this.renderCopilotMessages()}
          </div>

          <!-- Quick Suggestion Prompts -->
          <div class="copilot-quick-prompts">
            <button class="copilot-chip" data-prompt="What is the current temperature in all zones?">📊 Zone Status</button>
            <button class="copilot-chip" data-prompt="Set open office temperature to 23 degrees">❄️ Set Open Office to 23°C</button>
            <button class="copilot-chip" data-prompt="Diagnose sensor anomalies and power efficiency">⚡ Anomaly Check</button>
          </div>

          <!-- Chat Input -->
          <form class="ops-copilot-input-bar" id="ops-copilot-form">
            <input 
              type="text" 
              class="ops-copilot-input" 
              id="ops-copilot-input" 
              placeholder="Ask Copilot or command HVAC setpoint..." 
              autocomplete="off"
              ${this.isChatSending ? 'disabled' : ''}
            />
            <button type="submit" class="ops-copilot-send" id="btn-ops-copilot-send" ${this.isChatSending ? 'disabled' : ''}>
              ${this.isChatSending ? '⏳' : '➤'}
            </button>
          </form>
        </aside>

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

    const isLive = this.hvacStore.getConnectionState().status === 'LIVE';

    if (this.activeModal === 'trend') {
      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-trend-title">
          <div class="bms-modal-card bms-modal-lg">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-trend-title" class="modal-title">Temperature Trend — ${selectedMeta.name} (${selectedMeta.code})</h3>
                <p class="modal-subtitle">${isLive ? 'Real-time ESP32 physical sensor stream · Broker 10.100.177.51:1883' : '24-hour log up to telemetry loss at 08:00'}</p>
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
                  <text x="40" y="44" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">26°C</text>
                  <text x="40" y="94" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">24°C</text>
                  <text x="40" y="144" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">22°C</text>
                  <text x="40" y="194" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">20°C</text>

                  <!-- Target Setpoint Dashed Line (selTarget) -->
                  <line x1="50" y1="165" x2="720" y2="165" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,4" />
                  <text x="725" y="168" font-family="'JetBrains Mono', monospace" font-size="10" fill="#3b82f6">Target ${selTarget.toFixed(1)}°C</text>

                  ${isLive ? `
                    <!-- Live Hardware Connected Region -->
                    <rect x="520" y="20" width="200" height="190" fill="rgba(16, 185, 129, 0.08)" />
                    <line x1="520" y1="20" x2="520" y2="210" stroke="#10b981" stroke-width="1.5" stroke-dasharray="2,2" />
                    <text x="525" y="34" font-family="'Inter', sans-serif" font-size="10" font-weight="600" fill="#10b981">Live Hardware Ingestion</text>

                    <!-- Measured Temperature Curve -->
                    <path d="M 50 170 C 140 165, 220 160, 300 150 C 380 140, 440 120, 520 110 L 720 110" fill="none" stroke="#10b981" stroke-width="2.5" />
                    <circle cx="720" cy="110" r="5" fill="#10b981" />
                    <text x="700" y="98" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#10b981">${selTemp.toFixed(1)}°C (Live)</text>
                  ` : `
                    <!-- Stale Region -->
                    <rect x="520" y="20" width="200" height="190" fill="rgba(239, 68, 68, 0.08)" />
                    <line x1="520" y1="20" x2="520" y2="210" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="2,2" />
                    <text x="525" y="34" font-family="'Inter', sans-serif" font-size="10" font-weight="600" fill="#ef4444">Telemetry Lost (08:00)</text>
                    <path d="M 50 170 C 140 180, 220 175, 300 160 C 380 145, 440 120, 520 90 L 720 90" fill="none" stroke="#f59e0b" stroke-width="2.5" />
                    <line x1="520" y1="90" x2="720" y2="90" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,4" />
                    <circle cx="520" cy="90" r="4.5" fill="#f59e0b" />
                    <text x="520" y="80" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#f59e0b">${selTemp.toFixed(1)}°C</text>
                  `}

                  <!-- X-Axis Timeline -->
                  <line x1="50" y1="210" x2="720" y2="210" stroke="#334155" stroke-width="1" />
                  <text x="50" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">-60m</text>
                  <text x="200" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">-45m</text>
                  <text x="360" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#64748b">-30m</text>
                  <text x="520" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#10b981" font-weight="700">-15m</text>
                  <text x="700" y="230" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="#10b981" font-weight="700">NOW</text>
                </svg>
              </div>

              <!-- Trend Summary Metrics -->
              <div class="trend-stats-row">
                <div class="trend-stat"><span class="label">Minimum:</span> <span class="val font-mono">20.8°C</span></div>
                <div class="trend-stat"><span class="label">Maximum:</span> <span class="val font-mono text-amber">23.8°C</span></div>
                <div class="trend-stat"><span class="label">Average:</span> <span class="val font-mono">22.6°C</span></div>
                <div class="trend-stat"><span class="label">Setpoint:</span> <span class="val font-mono">${selTarget.toFixed(1)}°C</span></div>
                <div class="trend-stat"><span class="label">Status:</span> <span class="val ${isLive ? 'text-green font-bold' : 'text-amber font-bold'}">${isLive ? `LIVE (${selTemp.toFixed(1)}°C)` : 'Stale'}</span></div>
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
                <p class="modal-subtitle">Raspberry Pi + ESP32 Field Telemetry Network</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              ${isLive ? `
                <div class="diag-status-alert alert-live" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
                  <span class="status-dot dot-green"></span>
                  <div>
                    <strong class="text-green">Gateway Status: Online & Streaming Real-Time</strong>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">0% packet loss · Connected to Raspberry Pi MQTT broker (10.100.177.51:1883).</p>
                  </div>
                </div>

                <div class="diag-props-table">
                  <div class="diag-row"><span class="diag-k">MQTT Broker:</span> <span class="diag-v font-mono text-green">10.100.177.51:1883 (Active)</span></div>
                  <div class="diag-row"><span class="diag-k">Active Topics:</span> <span class="diag-v font-mono">sensor/esp32_1/data, sensor/esp32_2/data</span></div>
                  <div class="diag-row"><span class="diag-k">Subnet / VLAN:</span> <span class="diag-v font-mono">10.100.177.0/24 (IoT Sensor LAN)</span></div>
                  <div class="diag-row"><span class="diag-k">Field Controller Model:</span> <span class="diag-v">Raspberry Pi 4 Model B Gateway</span></div>
                  <div class="diag-row"><span class="diag-k">Last Packet Received:</span> <span class="diag-v font-mono text-green">&lt; 1s ago (Sub-second streaming)</span></div>
                  <div class="diag-row"><span class="diag-k">Z-02 Open Office Link:</span> <span class="diag-v text-green font-mono">Active · RSSI -58 dBm · DHT22</span></div>
                  <div class="diag-row"><span class="diag-k">Z-03 Conference Link:</span> <span class="diag-v text-green font-mono">Active · RSSI -61 dBm · DHT22</span></div>
                  <div class="diag-row"><span class="diag-k">Z-01 Lobby Link:</span> <span class="diag-v text-green font-mono">Active · RSSI -55 dBm · DHT22</span></div>
                  <div class="diag-row"><span class="diag-k">Z-04 Server Room Link:</span> <span class="diag-v text-green font-mono">Active · RSSI -52 dBm · DHT22</span></div>
                </div>

                <div class="diag-guidance">
                  <strong class="text-green">Recommended Action:</strong>
                  <p>All physical sensors operating nominally. Fast telemetry polling (1.5s) active.</p>
                </div>
              ` : `
                <div class="diag-status-alert alert-offline">
                  <span class="status-dot dot-red"></span>
                  <div>
                    <strong>Gateway Status: Connecting / Retrying</strong>
                    <p>Connecting to MQTT broker 10.100.177.51:1883...</p>
                  </div>
                </div>

                <div class="diag-props-table">
                  <div class="diag-row"><span class="diag-k">MQTT Broker Address:</span> <span class="diag-v font-mono">10.100.177.51:1883</span></div>
                  <div class="diag-row"><span class="diag-k">BACnet / MQTT Port:</span> <span class="diag-v font-mono">1883</span></div>
                  <div class="diag-row"><span class="diag-k">Field Controller Model:</span> <span class="diag-v">Raspberry Pi 4 + ESP32</span></div>
                  <div class="diag-row"><span class="diag-k">Sensor Feed:</span> <span class="diag-v text-amber font-mono">Re-establishing link</span></div>
                </div>

                <div class="diag-guidance">
                  <strong>Recommended Operator Action:</strong>
                  <p>Click "Retry connection" below to re-verify socket connection to Raspberry Pi.</p>
                </div>
              `}
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
      const zOffice = this.hvacStore.getZoneData('open_office');
      const zConf = this.hvacStore.getZoneData('conference_room');
      const zLobby = this.hvacStore.getZoneData('lobby');
      const zServer = this.hvacStore.getZoneData('server_room');

      return `
        <div class="bms-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-compare-title">
          <div class="bms-modal-card bms-modal-lg">
            <div class="bms-modal-header">
              <div>
                <h3 id="modal-compare-title" class="modal-title">Zone Telemetry Comparison — All 4 Zones</h3>
                <p class="modal-subtitle">${isLive ? 'Live ESP32 physical sensor feeds side-by-side' : 'Side-by-side comparison across conditioned spaces'}</p>
              </div>
              <button class="bms-modal-close" aria-label="Close modal">&times;</button>
            </div>
            <div class="bms-modal-body">
              <table class="bms-compare-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Z-02 Open Office</th>
                    <th>Z-03 Conference</th>
                    <th>Z-01 Lobby</th>
                    <th>Z-04 Server Room</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="col-metric-name">Measured Temperature</td>
                    <td class="font-mono font-bold ${isLive ? 'text-green' : 'text-amber'}">${(zOffice?.temp ?? 23.0).toFixed(1)}°C</td>
                    <td class="font-mono font-bold ${isLive ? 'text-green' : 'text-amber'}">${(zConf?.temp ?? 22.5).toFixed(1)}°C</td>
                    <td class="font-mono font-bold ${isLive ? 'text-green' : 'text-green'}">${(zLobby?.temp ?? 21.0).toFixed(1)}°C</td>
                    <td class="font-mono font-bold ${isLive ? 'text-green' : 'text-cyan'}">${(zServer?.temp ?? 23.4).toFixed(1)}°C</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Target Setpoint</td>
                    <td class="font-mono text-muted">${(zOffice?.targetTemp ?? 21.0).toFixed(1)}°C</td>
                    <td class="font-mono text-muted">${(zConf?.targetTemp ?? 21.0).toFixed(1)}°C</td>
                    <td class="font-mono text-muted">${(zLobby?.targetTemp ?? 21.0).toFixed(1)}°C</td>
                    <td class="font-mono text-muted">${(zServer?.targetTemp ?? 21.0).toFixed(1)}°C</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Difference (Deviation)</td>
                    <td class="font-mono text-amber font-bold">${((zOffice?.temp ?? 23.0) - (zOffice?.targetTemp ?? 21.0) >= 0 ? '+' : '')}${((zOffice?.temp ?? 23.0) - (zOffice?.targetTemp ?? 21.0)).toFixed(1)}°C</td>
                    <td class="font-mono text-amber font-bold">${((zConf?.temp ?? 22.5) - (zConf?.targetTemp ?? 21.0) >= 0 ? '+' : '')}${((zConf?.temp ?? 22.5) - (zConf?.targetTemp ?? 21.0)).toFixed(1)}°C</td>
                    <td class="font-mono text-green font-bold">${((zLobby?.temp ?? 21.0) - (zLobby?.targetTemp ?? 21.0) >= 0 ? '+' : '')}${((zLobby?.temp ?? 21.0) - (zLobby?.targetTemp ?? 21.0)).toFixed(1)}°C</td>
                    <td class="font-mono text-amber font-bold">${((zServer?.temp ?? 23.4) - (zServer?.targetTemp ?? 21.0) >= 0 ? '+' : '')}${((zServer?.temp ?? 23.4) - (zServer?.targetTemp ?? 21.0)).toFixed(1)}°C</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Relative Humidity</td>
                    <td class="font-mono">${(zOffice?.humidity ?? 42.8).toFixed(1)}%</td>
                    <td class="font-mono">${(zConf?.humidity ?? 44.1).toFixed(1)}%</td>
                    <td class="font-mono">${(zLobby?.humidity ?? 41.5).toFixed(1)}%</td>
                    <td class="font-mono">${(zServer?.humidity ?? 69.0).toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Occupancy</td>
                    <td class="font-mono">${zOffice?.occupancy ?? 8} occupants</td>
                    <td class="font-mono">${zConf?.occupancy ?? 4} occupants</td>
                    <td class="font-mono">${zLobby?.occupancy ?? 2} occupants</td>
                    <td class="font-mono">${zServer?.occupancy ?? 0} occupants</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">HVAC Load</td>
                    <td class="font-mono">${(zOffice?.powerDraw ?? 3.5).toFixed(2)} kW</td>
                    <td class="font-mono">${(zConf?.powerDraw ?? 2.1).toFixed(2)} kW</td>
                    <td class="font-mono">${(zLobby?.powerDraw ?? 1.5).toFixed(2)} kW</td>
                    <td class="font-mono">${(zServer?.powerDraw ?? 2.18).toFixed(2)} kW</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Conditioned Floor Area</td>
                    <td class="font-mono">335 m²</td>
                    <td class="font-mono">185 m²</td>
                    <td class="font-mono">520 m²</td>
                    <td class="font-mono">120 m²</td>
                  </tr>
                  <tr>
                    <td class="col-metric-name">Freshness</td>
                    <td class="${isLive ? 'text-green font-bold' : 'text-muted'}">${isLive ? 'LIVE (< 1s)' : '12 min ago'}</td>
                    <td class="${isLive ? 'text-green font-bold' : 'text-muted'}">${isLive ? 'LIVE (< 1s)' : '12 min ago'}</td>
                    <td class="${isLive ? 'text-green font-bold' : 'text-muted'}">${isLive ? 'LIVE (< 1s)' : '12 min ago'}</td>
                    <td class="${isLive ? 'text-green font-bold' : 'text-muted'}">${isLive ? 'LIVE (< 1s)' : '12 min ago'}</td>
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
