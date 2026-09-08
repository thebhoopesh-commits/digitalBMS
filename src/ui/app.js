document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const statusInd = document.getElementById("sim-status");
    const simTime = document.getElementById("sim-time");
    
    // Controls
    const btnStart = document.getElementById("btn-start");
    const btnPause = document.getElementById("btn-pause");
    const btnReset = document.getElementById("btn-reset");
    const speedSlider = document.getElementById("speed-slider");
    const speedVal = document.getElementById("speed-val");

    // Metrics
    const mPBase = document.getElementById("m-p-base");
    const mCBase = document.getElementById("m-c-base");
    const mPRl = document.getElementById("m-p-rl");
    const mCRl = document.getElementById("m-c-rl");
    const mPctSave = document.getElementById("m-pct-save");
    const mCSave = document.getElementById("m-c-save");
    const mWTemp = document.getElementById("m-w-temp");
    const mWRh = document.getElementById("m-w-rh");
    const mWSolar = document.getElementById("m-w-solar");

    const zonesContainer = document.getElementById("zones-container");
    
    // Chat
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const chatHistory = document.getElementById("chat-history");

    let eventSource = null;

    // API Handlers
    async function sendControl(action, extra = {}) {
        try {
            const res = await fetch("/api/simulation/control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra })
            });
            return await res.json();
        } catch (e) {
            console.error("Control API Error:", e);
        }
    }

    // Event Listeners
    btnStart.addEventListener("click", () => sendControl("start"));
    btnPause.addEventListener("click", () => sendControl("pause"));
    btnReset.addEventListener("click", () => sendControl("reset"));
    
    speedSlider.addEventListener("input", (e) => {
        const speed = parseFloat(e.target.value);
        speedVal.textContent = speed.toFixed(1) + "x";
    });

    speedSlider.addEventListener("change", (e) => {
        const speed = parseFloat(e.target.value);
        sendControl("set_speed", { speed });
    });

    let chatHistoryContext = [];

    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (!msg) return;

        appendChat(msg, "user");
        chatInput.value = "";

        // Add to dialogue history (Layer 4)
        chatHistoryContext.push({ role: "user", content: msg });
        if (chatHistoryContext.length > 5) chatHistoryContext.shift();

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: msg, history: chatHistoryContext })
            });
            
            if (!res.ok) {
                appendChat("Error communicating with NLP engine.", "system");
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            
            const botMsgDiv = document.createElement("div");
            botMsgDiv.className = "chat-msg chat-bot";
            chatHistory.appendChild(botMsgDiv);
            chatHistory.scrollTop = chatHistory.scrollHeight;

            let fullText = "";
            let finalData = null;

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
                                botMsgDiv.textContent = fullText;
                            }
                            if (data.applied !== undefined) {
                                finalData = data;
                            }
                        } catch (e) {}
                    }
                }
            }

            if (finalData) {
                if (!fullText) {
                    let replyText = "Message received, but no actionable constraints were identified.";
                    if (finalData.translation && finalData.translation.response_text) {
                        replyText = finalData.translation.response_text;
                    } else if (finalData.is_applicable && finalData.applied) {
                        replyText = `Adjusted setpoints based on: "${msg}"`;
                    }
                    botMsgDiv.textContent = replyText;
                    fullText = replyText;
                }
                
                if (!finalData.is_applicable || !finalData.applied) {
                    botMsgDiv.className = "chat-msg chat-system";
                }
            }

            // Save bot reply to dialogue history
            chatHistoryContext.push({ role: "assistant", content: fullText });
            if (chatHistoryContext.length > 5) chatHistoryContext.shift();

        } catch (err) {
            appendChat("Error communicating with NLP engine.", "system");
        }
    });

    function appendChat(text, type) {
        const div = document.createElement("div");
        div.className = `chat-msg chat-${type}`;
        div.textContent = text;
        chatHistory.appendChild(div);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function formatTime(hourFloat) {
        let h = Math.floor(hourFloat) % 24;
        const m = Math.floor((hourFloat % 1) * 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12; // the hour '0' should be '12'
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    }

    function updateUI(data) {
        // Status & Time
        simTime.textContent = formatTime(data.timestamp_sim_hour);
        
        // Metrics
        mPBase.textContent = data.baseline_power_kw.toFixed(2);
        mCBase.textContent = data.cumulative_baseline_energy_kwh.toFixed(2);
        mPRl.textContent = data.rl_power_kw.toFixed(2);
        mCRl.textContent = data.cumulative_rl_energy_kwh.toFixed(2);
        mPctSave.textContent = data.cumulative_savings_pct.toFixed(1);
        mCSave.textContent = data.cumulative_cost_saved_usd.toFixed(2);
        
        mWTemp.textContent = data.outdoor_temp_c.toFixed(1);
        mWRh.textContent = data.outdoor_humidity_pct.toFixed(0);
        mWSolar.textContent = data.solar_irradiance_w_m2.toFixed(0);

        // Zones
        renderZones(data.zones_rl);
    }

    function renderZones(zonesObj) {
        zonesContainer.innerHTML = "";
        for (const [zoneId, z] of Object.entries(zonesObj)) {
            const card = document.createElement("div");
            card.className = "zone-card";
            
            const isViolating = z.comfort_violation_c > 0;
            const borderStyle = isViolating ? "border: 1px solid var(--accent-red);" : "";

            card.innerHTML = `
                <div class="zone-header" style="${borderStyle}">
                    <span class="zone-name">${zoneId.replace('_', ' ')}</span>
                    <span class="zone-temp">${z.temperature_c.toFixed(1)}°C</span>
                </div>
                <div class="zone-details">
                    <div>SP: ${z.target_setpoint_c.toFixed(1)}°C</div>
                    <div>RH: ${z.humidity_pct.toFixed(0)}%</div>
                    <div>Occ: ${z.occupancy_count}</div>
                    <div>HVAC: ${z.hvac_power_kw.toFixed(2)} kW</div>
                </div>
            `;
            zonesContainer.appendChild(card);
        }
    }

    // Connect SSE
    function connectSSE() {
        if (eventSource) eventSource.close();
        
        eventSource = new EventSource("/api/stream");

        const handleTelemetry = (e) => {
            try {
                const data = JSON.parse(e.data);
                updateUI(data);
                
                statusInd.textContent = "Running";
                statusInd.className = "status-indicator running";
            } catch (err) {
                console.error("SSE Parse Error", err);
            }
        };
        
        eventSource.onmessage = handleTelemetry;
        eventSource.addEventListener("telemetry", handleTelemetry);
        
        eventSource.addEventListener("hello", (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.running) {
                    statusInd.textContent = "Running";
                    statusInd.className = "status-indicator running";
                }
            } catch (err) {}
        });

        eventSource.onerror = () => {
            statusInd.textContent = "Disconnected";
            statusInd.className = "status-indicator stopped";
        };
    }

    // Initial Fetch
    async function loadInitialState() {
        try {
            const mRes = await fetch("/api/metrics");
            if (mRes.ok) {
                const data = await mRes.json();
                if (data && data.step !== undefined) {
                    updateUI(data);
                }
            }
            const sRes = await fetch("/api/status");
            if (sRes.ok) {
                const status = await sRes.json();
                statusInd.textContent = status.running ? "Running" : "Paused";
                statusInd.className = status.running ? "status-indicator running" : "status-indicator stopped";
            }
        } catch (e) {
            console.error("Failed to load initial state:", e);
        }
    }

    // Init
    loadInitialState();
    connectSSE();
    
    // Poll status periodically to update UI when not receiving SSE updates (paused)
    setInterval(async () => {
        try {
            const res = await fetch("/api/status");
            const status = await res.json();
            if (!status.running) {
                statusInd.textContent = "Paused";
                statusInd.className = "status-indicator stopped";
            } else if (eventSource && eventSource.readyState === EventSource.OPEN) {
                statusInd.textContent = "Running";
                statusInd.className = "status-indicator running";
            }
        } catch (e) {}
    }, 2000);
});
