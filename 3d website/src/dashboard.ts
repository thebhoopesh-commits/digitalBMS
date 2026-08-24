// Global Control Dashboard Logic
let isRunning = false;
let eventSource: EventSource | null = null;

const ui = {
  dot: document.getElementById('backend-dot'),
  btnToggle: document.getElementById('btn-toggle') as HTMLButtonElement,
  btnReset: document.getElementById('btn-reset') as HTMLButtonElement,
  selSpeed: document.getElementById('sel-speed') as HTMLSelectElement,
  selWeather: document.getElementById('sel-weather') as HTMLSelectElement,
  valSimTime: document.getElementById('val-sim-time'),
  valOutTemp: document.getElementById('val-out-temp'),
  valOutRh: document.getElementById('val-out-rh'),
  valOutSolar: document.getElementById('val-out-solar'),
  valOutPrice: document.getElementById('val-out-price'),
  valRlPower: document.getElementById('val-rl-power'),
  valBasePower: document.getElementById('val-base-power'),
  valCumSavings: document.getElementById('val-cum-savings'),
  valCostSavings: document.getElementById('val-cost-savings'),
  zonesContainer: document.getElementById('zones-container'),
};

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Backend error');
    const data = await res.json();
    if (ui.dot) {
      ui.dot.classList.add('active');
      ui.dot.classList.remove('error');
    }
    isRunning = data.running;
    if (ui.btnToggle) ui.btnToggle.textContent = isRunning ? 'Pause' : 'Start';
    if (ui.selSpeed) ui.selSpeed.value = data.speed.toString();
  } catch (err) {
    if (ui.dot) {
      ui.dot.classList.add('error');
      ui.dot.classList.remove('active');
    }
  }
}

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/stream');
  
  eventSource.addEventListener('telemetry', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateDashboard(data);
    } catch (err) {
      console.error('Failed to parse SSE', err);
    }
  });

  eventSource.onerror = () => {
    if (ui.dot) {
      ui.dot.classList.add('error');
      ui.dot.classList.remove('active');
    }
    setTimeout(connectSSE, 5000);
  };
}

function formatSimTime(decimalHour: number): string {
  const h = Math.floor(decimalHour);
  const m = Math.floor((decimalHour - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function updateDashboard(data: any) {
  if (ui.dot && !ui.dot.classList.contains('active')) {
    ui.dot.classList.add('active');
    ui.dot.classList.remove('error');
  }

  if (ui.valSimTime) ui.valSimTime.textContent = formatSimTime(data.timestamp_sim_hour);
  if (ui.valOutTemp) ui.valOutTemp.textContent = `${data.outdoor_temp_c.toFixed(1)} °C`;
  if (ui.valOutRh) ui.valOutRh.textContent = `${data.outdoor_humidity_pct.toFixed(0)} %`;
  if (ui.valOutSolar) ui.valOutSolar.textContent = `${data.solar_irradiance_w_m2.toFixed(0)} W/m²`;
  if (ui.valOutPrice) ui.valOutPrice.textContent = `$${data.electricity_price_usd_kwh.toFixed(3)}`;
  
  if (ui.valRlPower) ui.valRlPower.textContent = `${data.rl_power_kw.toFixed(2)} kW`;
  if (ui.valBasePower) ui.valBasePower.textContent = `${data.baseline_power_kw.toFixed(2)} kW`;
  if (ui.valCumSavings) ui.valCumSavings.textContent = `${(data.cumulative_baseline_energy_kwh - data.cumulative_rl_energy_kwh).toFixed(1)} kWh`;
  if (ui.valCostSavings) ui.valCostSavings.textContent = `$${data.cumulative_cost_saved_usd.toFixed(2)}`;

  updateZones(data.zones_rl);
}

function updateZones(zones: Record<string, any>) {
  if (!ui.zonesContainer) return;
  
  for (const [zoneId, zone] of Object.entries(zones)) {
    let card = document.getElementById(`zone-card-${zoneId}`);
    
    // Determine HVAC state
    const isHeating = zone.hvac_power_kw > 0 && zone.temperature_c < zone.target_setpoint_c;
    const isCooling = zone.hvac_power_kw > 0 && zone.temperature_c > zone.target_setpoint_c;
    const styleClass = isHeating ? 'heat' : isCooling ? 'cool' : '';
    
    if (!card) {
      card = document.createElement('div');
      card.id = `zone-card-${zoneId}`;
      card.className = 'panel zone-card';
      ui.zonesContainer.appendChild(card);
    }
    
    card.className = `panel zone-card ${styleClass}`;
    
    const formattedId = zoneId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    
    card.innerHTML = `
      <h2>${formattedId}</h2>
      <div class="stat-row">
        <span>Temp</span>
        <span class="stat-val">${zone.temperature_c.toFixed(2)} °C</span>
      </div>
      <div class="stat-row">
        <span>Setpoint</span>
        <span class="stat-val" style="color: var(--text-muted)">${zone.target_setpoint_c.toFixed(1)} °C</span>
      </div>
      <div class="stat-row">
        <span>Occupancy</span>
        <span class="stat-val">${zone.occupancy_count}</span>
      </div>
      <div class="stat-row">
        <span>HVAC Power</span>
        <span class="stat-val">${zone.hvac_power_kw.toFixed(2)} kW</span>
      </div>
      ${zone.active_nlp_offset_c !== 0 ? `
      <div class="stat-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);">
        <span style="color: var(--accent);">Active LLM Offset</span>
        <span class="stat-val" style="color: var(--accent);">${zone.active_nlp_offset_c > 0 ? '+' : ''}${zone.active_nlp_offset_c.toFixed(1)}°C</span>
      </div>
      ` : ''}
    `;
  }
}

async function sendCommand(action: string, extra: any = {}) {
  await fetch('/api/simulation/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
  checkStatus();
}

// Event Listeners
if (ui.btnToggle) {
  ui.btnToggle.addEventListener('click', () => {
    sendCommand(isRunning ? 'pause' : 'start');
  });
}
if (ui.btnReset) {
  ui.btnReset.addEventListener('click', () => {
    sendCommand('reset');
  });
}
if (ui.selSpeed) {
  ui.selSpeed.addEventListener('change', (e) => {
    const val = parseFloat((e.target as HTMLSelectElement).value);
    sendCommand('set_speed', { speed: val });
  });
}
if (ui.selWeather) {
  ui.selWeather.addEventListener('change', (e) => {
    const preset = (e.target as HTMLSelectElement).value;
    sendCommand('set_weather_preset', { preset });
  });
}

// Init
checkStatus();
connectSSE();
setInterval(checkStatus, 10000);
