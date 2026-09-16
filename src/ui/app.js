document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const statusInd = document.getElementById("sim-status");
    const mqttStatus = document.getElementById("mqtt-status");
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

            const botTextDiv = document.createElement("div");
            botTextDiv.className = "bot-text";
            botMsgDiv.appendChild(botTextDiv);

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
                                botTextDiv.textContent = fullText;
                                chatHistory.scrollTop = chatHistory.scrollHeight;
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
                    botTextDiv.textContent = replyText;
                    fullText = replyText;
                }
                
                if (!finalData.is_applicable || !finalData.applied) {
                    botMsgDiv.classList.add("chat-notice");
                }

                // Render complete Qwen3:1.7b JSON Output Card for judges
                const jsonCard = renderLlmJsonCard(finalData);
                if (jsonCard) {
                    botMsgDiv.appendChild(jsonCard);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }
            }

            // Save bot reply to dialogue history
            chatHistoryContext.push({ role: "assistant", content: fullText });
            if (chatHistoryContext.length > 5) chatHistoryContext.shift();

        } catch (err) {
            appendChat("Error communicating with NLP engine.", "system");
        }
    });

    // Wire quick demo prompts for hackathon judges
    document.querySelectorAll(".quick-prompt-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const promptText = btn.getAttribute("data-msg");
            if (promptText && chatInput) {
                chatInput.value = promptText;
                chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
            }
        });
    });

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function syntaxHighlightJson(json) {
        if (typeof json !== 'string') {
            json = JSON.stringify(json, null, 2);
        }
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'json-num';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-str';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-bool';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    function renderLlmJsonCard(data) {
        const jsonPayload = data.llm_json || (data.translation && data.translation.events && data.translation.events[0]) || data.translation;
        if (!jsonPayload) return null;

        const card = document.createElement("div");
        card.className = "llm-json-card";

        const modelName = data.model || "qwen3:1.7b";
        const isApplied = !!data.applied;

        // Extract key chips for quick scanning by judges
        const domain = jsonPayload.domain || (data.translation && data.translation.is_applicable ? "thermal" : "telemetry");
        const location = jsonPayload.location || data.zone_id || "Unspecified";
        const sensation = jsonPayload.sensation || (jsonPayload.intent || "other");
        const intensity = jsonPayload.intensity !== undefined ? `${jsonPayload.intensity}/5` : null;
        const confidence = jsonPayload.confidence !== undefined ? `${Math.round(jsonPayload.confidence * 100)}%` : null;

        const prettyJson = JSON.stringify(jsonPayload, null, 2);

        card.innerHTML = `
            <div class="json-card-header">
                <div class="json-card-title">
                    <span class="json-icon">⚡</span>
                    <span class="json-title-text">${escapeHtml(modelName)} Semantic JSON</span>
                </div>
                <div class="json-actions">
                    <button type="button" class="btn-copy-json" title="Copy JSON payload">📋 Copy JSON</button>
                    <button type="button" class="btn-toggle-json" title="Toggle full JSON code">▾ Collapse</button>
                </div>
            </div>
            <div class="json-chips">
                <span class="json-chip chip-domain">Domain: <strong>${escapeHtml(domain)}</strong></span>
                <span class="json-chip chip-loc">Zone: <strong>${escapeHtml(location)}</strong></span>
                <span class="json-chip chip-sens">Sensation: <strong>${escapeHtml(sensation)}</strong></span>
                ${intensity ? `<span class="json-chip chip-int">Intensity: <strong>${escapeHtml(intensity)}</strong></span>` : ''}
                ${confidence ? `<span class="json-chip chip-conf">Confidence: <strong>${escapeHtml(confidence)}</strong></span>` : ''}
            </div>
            <div class="json-body">
                <pre class="json-code-block"><code>${syntaxHighlightJson(prettyJson)}</code></pre>
            </div>
            <div class="json-card-footer ${isApplied ? 'success' : 'info'}">
                <span class="footer-icon">${isApplied ? '✓' : 'ℹ'}</span>
                <span class="footer-text">${escapeHtml(data.action_summary || (isApplied ? "Injected into Digital Twin RL Setpoint" : "No actuator constraint injected"))}</span>
            </div>
        `;

        // Wire Copy button
        const copyBtn = card.querySelector(".btn-copy-json");
        copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(prettyJson).then(() => {
                copyBtn.textContent = "✓ Copied!";
                setTimeout(() => { copyBtn.textContent = "📋 Copy JSON"; }, 2000);
            }).catch(() => {
                copyBtn.textContent = "Copied";
            });
        });

        // Wire Toggle button
        const toggleBtn = card.querySelector(".btn-toggle-json");
        const jsonBody = card.querySelector(".json-body");
        toggleBtn.addEventListener("click", () => {
            if (jsonBody.style.display === "none") {
                jsonBody.style.display = "block";
                toggleBtn.textContent = "▾ Collapse";
            } else {
                jsonBody.style.display = "none";
                toggleBtn.textContent = "▸ Expand JSON";
            }
        });

        return card;
    }

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
        const savingsPct = (data.cumulative_savings_pct > 0.05)
            ? data.cumulative_savings_pct
            : (data.instantaneous_savings_pct > 0.0 ? data.instantaneous_savings_pct : 0.0);
        mPctSave.textContent = savingsPct.toFixed(1);
        mCSave.textContent = data.cumulative_cost_saved_usd.toFixed(2);
        
        mWTemp.textContent = data.outdoor_temp_c.toFixed(1);
        mWRh.textContent = data.outdoor_humidity_pct.toFixed(0);
        mWSolar.textContent = data.solar_irradiance_w_m2.toFixed(0);

        // Zones
        if (data.zones_rl && Object.keys(data.zones_rl).length > 0) {
            renderZones(data.zones_rl);
        } else {
            fetchAndRenderZones();
        }
    }

    const ZONE_META = {
        "lobby": { name: "Lobby", tag: "zone_01 (ESP32)" },
        "open_office": { name: "Open Office", tag: "zone_02 (ESP32)" },
        "conference_room": { name: "Conference Room", tag: "zone_03 (ESP32)" },
        "server_room": { name: "Server Room", tag: "zone_04 (ESP32)" },
    };

    function renderZones(zonesObj) {
        if (!zonesObj || Object.keys(zonesObj).length === 0) return;
        zonesContainer.innerHTML = "";
        for (const [zoneId, z] of Object.entries(zonesObj)) {
            const card = document.createElement("div");
            card.className = "zone-card";
            
            const isViolating = z.comfort_violation_c > 0;
            const borderStyle = isViolating ? "border: 1px solid var(--accent-red);" : "";
            const meta = ZONE_META[zoneId] || { name: zoneId.replace('_', ' '), tag: "ESP32 MQTT" };

            card.innerHTML = `
                <div class="zone-header" style="${borderStyle}">
                    <div>
                        <span class="zone-name">${meta.name}<span class="badge-live">LIVE</span></span>
                        <div class="zone-hw-tag">${meta.tag}</div>
                    </div>
                    <span class="zone-temp">${z.temperature_c.toFixed(1)}°C</span>
                </div>
                <div class="zone-details">
                    <div><strong>RH:</strong> ${z.humidity_pct.toFixed(1)}%</div>
                    <div><strong>SP:</strong> ${z.target_setpoint_c.toFixed(1)}°C</div>
                    <div><strong>Occ:</strong> ${z.occupancy_count}</div>
                    <div><strong>HVAC:</strong> ${z.hvac_power_kw.toFixed(2)} kW</div>
                </div>
            `;
            zonesContainer.appendChild(card);
        }
    }

    async function fetchAndRenderZones() {
        try {
            const res = await fetch("/api/zones");
            if (res.ok) {
                const data = await res.json();
                if (data && data.states && Object.keys(data.states).length > 0) {
                    renderZones(data.states);
                }
            }
        } catch (e) {
            console.debug("Failed to fetch zones:", e);
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
                
                statusInd.textContent = "Live Hardware";
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
                    statusInd.textContent = "Live Hardware";
                    statusInd.className = "status-indicator running";
                }
            } catch (err) {}
        });

        eventSource.onerror = () => {
            statusInd.textContent = "Disconnected";
            statusInd.className = "status-indicator stopped";
        };
    }

    async function checkMqttHealth() {
        try {
            const res = await fetch("/api/sensors/health");
            if (res.ok) {
                const health = await res.json();
                if (mqttStatus && health.mqtt) {
                    if (health.mqtt.connected) {
                        mqttStatus.textContent = `MQTT: ${health.mqtt.broker_host}`;
                        mqttStatus.className = "status-indicator running";
                    } else if (health.mqtt.running) {
                        mqttStatus.textContent = "MQTT: Connecting...";
                        mqttStatus.className = "status-indicator stopped";
                    } else {
                        mqttStatus.textContent = "MQTT: Inactive";
                        mqttStatus.className = "status-indicator stopped";
                    }
                }
            }
        } catch (e) {}
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
                statusInd.textContent = status.running ? "Live Hardware" : "Paused";
                statusInd.className = status.running ? "status-indicator running" : "status-indicator stopped";
            }
        } catch (e) {
            console.error("Failed to load initial state:", e);
        }
        fetchAndRenderZones();
        checkMqttHealth();
    }

    // Init
    loadInitialState();
    connectSSE();
    
    // Poll status and live zones periodically to ensure continuous display of ESP32 sensor telemetry
    setInterval(async () => {
        try {
            const res = await fetch("/api/status");
            const status = await res.json();
            if (!status.running) {
                statusInd.textContent = "Paused";
                statusInd.className = "status-indicator stopped";
            } else if (eventSource && eventSource.readyState === EventSource.OPEN) {
                statusInd.textContent = "Live Hardware";
                statusInd.className = "status-indicator running";
            }
        } catch (e) {}
        checkMqttHealth();
        fetchAndRenderZones();
    }, 1000);
});
