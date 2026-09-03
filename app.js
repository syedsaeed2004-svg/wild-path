/**
 * WILDPATH EXPLORER - Dead Reckoning & Path Mapping Engine + Offline PWA & Backend Sync
 * 100% Zero-GPS and Zero-Network Compatible for Jungle Explorers.
 */

class WildPathEngine {
    constructor() {
        // App State
        this.pathPoints = [{ x: 0, y: 0, heading: 0, distance: 0, steps: 0, timestamp: new Date() }];
        this.waypoints = [];
        this.serverTrails = [];
        
        this.currentHeading = 0; // 0° = North, 90° = East, 180° = South, 270° = West
        this.inputMode = 'meters';
        this.strideLength = 0.75;
        this.soundEnabled = true;
        
        // Canvas & Viewport State
        this.canvas = document.getElementById('map-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.camera = { x: 0, y: 0, zoom: 1.5 };
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.mapTheme = 'tactical';
        
        // Hardware sensors, Replay & Simulation
        this.sensorsActive = false;
        this.simulationTimer = null;
        this.isSimulating = false;
        this.isReplaying = false;
        this.replayTimer = null;
        this.isSosActive = false;
        
        // Waypoint Modal Selection
        this.selectedWpIcon = 'camp';
        
        // Audio Synthesizer Context
        this.audioCtx = null;
        this.sosOscillator = null;

        this.init();
    }

    async init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.setupAudio();
        this.bindEvents();
        this.bindOfflineNetworkListeners();
        
        // Initial Base Camp Waypoint
        this.waypoints.push({
            id: 'wp_base',
            x: 0,
            y: 0,
            title: 'Base Camp (Start)',
            type: 'camp',
            notes: 'Initial starting point of expedition.',
            timestamp: new Date()
        });

        this.renderWaypointsList();
        this.updateHUDStats();
        this.draw();

        // Connect to Backend Server or Fallback to Offline LocalStorage
        await this.checkBackendServer();

        console.log('WildPath Explorer Engine ready (Zero GPS Needed).');
    }

    // ==========================================
    // OFFLINE & BACKEND SYNC MANAGEMENT
    // ==========================================
    bindOfflineNetworkListeners() {
        window.addEventListener('online', () => this.updateOnlineStatusBadge(true));
        window.addEventListener('offline', () => this.updateOnlineStatusBadge(false));
    }

    updateOnlineStatusBadge(isOnline) {
        const badge = document.getElementById('server-status-badge');
        const statusText = document.getElementById('server-status-text');
        const statusDot = document.getElementById('status-dot-icon');

        if (isOnline) {
            statusText.textContent = 'ZERO-GPS VECTOR DR (ONLINE SYNC)';
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            if (statusDot) statusDot.style.backgroundColor = '#10b981';
            this.checkBackendServer();
        } else {
            statusText.textContent = '100% OFF-GRID OFFLINE READY (ZERO GPS/NET)';
            badge.style.background = 'rgba(249, 115, 22, 0.2)';
            if (statusDot) statusDot.style.backgroundColor = '#f97316';
        }
    }

    async checkBackendServer() {
        if (!navigator.onLine) {
            this.updateOnlineStatusBadge(false);
            this.loadLocalStorageTrails();
            return;
        }

        try {
            const res = await fetch('/api/health');
            if (res.ok) {
                const data = await res.json();
                document.getElementById('server-status-text').textContent = `BACKEND ONLINE (${data.totalTrails} TRAILS)`;
                this.fetchServerTrails();
            } else {
                throw new Error('Server health check failed');
            }
        } catch (err) {
            this.updateOnlineStatusBadge(false);
            this.loadLocalStorageTrails();
        }
    }

    async fetchServerTrails() {
        try {
            const res = await fetch('/api/trails');
            const result = await res.json();
            if (result.success) {
                this.serverTrails = result.data;
                this.renderSavedTrailsList();
            }
        } catch (e) {
            this.loadLocalStorageTrails();
        }
    }

    async saveTrailToServer(name) {
        if (!name.trim()) return;
        
        let totalDist = 0;
        this.pathPoints.forEach(p => totalDist += p.distance);

        const payload = {
            name: name.trim(),
            points: this.pathPoints,
            waypoints: this.waypoints,
            totalDistance: totalDist,
            notes: `Recorded on ${new Date().toLocaleString()}`
        };

        if (navigator.onLine) {
            try {
                const res = await fetch('/api/trails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (data.success) {
                    alert(`Expedition "${name}" saved to Server!`);
                    this.fetchServerTrails();
                    this.playTone('waypoint');
                    return;
                }
            } catch (e) {}
        }

        // Offline Fallback
        this.saveLocalStorageTrail(payload);
    }

    saveLocalStorageTrail(payload) {
        let trails = JSON.parse(localStorage.getItem('wildpath_trails') || '[]');
        trails.push({ ...payload, id: 'local_' + Date.now(), createdAt: new Date() });
        localStorage.setItem('wildpath_trails', JSON.stringify(trails));
        alert(`Saved locally to browser offline storage!`);
        this.loadLocalStorageTrails();
    }

    loadLocalStorageTrails() {
        const trails = JSON.parse(localStorage.getItem('wildpath_trails') || '[]');
        this.serverTrails = trails;
        this.renderSavedTrailsList();
    }

    async deleteServerTrail(id) {
        if (!confirm('Delete this expedition track?')) return;
        if (navigator.onLine && id && !id.startsWith('local_')) {
            try {
                const res = await fetch(`/api/trails/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    this.fetchServerTrails();
                    return;
                }
            } catch (e) {}
        }

        let trails = JSON.parse(localStorage.getItem('wildpath_trails') || '[]');
        trails = trails.filter(t => t.id !== id);
        localStorage.setItem('wildpath_trails', JSON.stringify(trails));
        this.loadLocalStorageTrails();
    }

    // ==========================================
    // AUDIO SYNTHESIZER (Web Audio API)
    // ==========================================
    setupAudio() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
        } catch (e) {
            console.warn('Web Audio API not supported.');
        }
    }

    playTone(type) {
        if (!this.soundEnabled || !this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        const now = this.audioCtx.currentTime;

        if (type === 'step') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'click') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);
            osc.start(now);
            osc.stop(now + 0.03);
        } else if (type === 'waypoint') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            osc.frequency.setValueAtTime(783.99, now + 0.16);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'danger') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.linearRampToValueAtTime(400, now + 0.2);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'clear') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    }

    startSosSiren() {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        this.sosOscillator = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        this.sosOscillator.type = 'sawtooth';

        const now = this.audioCtx.currentTime;
        this.sosOscillator.frequency.setValueAtTime(900, now);
        
        let toggle = true;
        this.sirenInterval = setInterval(() => {
            if (this.sosOscillator && this.audioCtx) {
                const t = this.audioCtx.currentTime;
                this.sosOscillator.frequency.exponentialRampToValueAtTime(toggle ? 1200 : 600, t + 0.3);
                toggle = !toggle;
            }
        }, 350);

        gain.gain.setValueAtTime(0.25, now);
        this.sosOscillator.connect(gain);
        gain.connect(this.audioCtx.destination);
        this.sosOscillator.start();
    }

    stopSosSiren() {
        if (this.sosOscillator) {
            try { this.sosOscillator.stop(); } catch (e) {}
            this.sosOscillator = null;
        }
        if (this.sirenInterval) clearInterval(this.sirenInterval);
    }

    triggerSosBeacon() {
        this.isSosActive = true;
        const current = this.pathPoints[this.pathPoints.length - 1];
        
        let bearingRad = Math.atan2(-current.x, current.y);
        let bearingDeg = Math.round((bearingRad * 180 / Math.PI + 360) % 360);
        const displacement = Math.hypot(current.x, current.y);

        document.getElementById('sos-coord-text').textContent = `X: ${current.x.toFixed(1)}m, Y: ${(-current.y).toFixed(1)}m`;
        document.getElementById('sos-bearing-text').textContent = `${bearingDeg}° (${displacement.toFixed(1)}m away)`;
        document.getElementById('sos-strobe-overlay').classList.add('active');

        this.startSosSiren();

        if (navigator.onLine) {
            fetch('/api/sos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    position: { x: current.x, y: current.y },
                    heading: this.currentHeading,
                    displacement: displacement,
                    bearingToBase: `${bearingDeg}°`,
                    notes: 'EMERGENCY BEACON ACTIVATED FROM APP HUD'
                })
            }).catch(() => {});
        }
    }

    stopSosBeacon() {
        this.isSosActive = false;
        document.getElementById('sos-strobe-overlay').classList.remove('active');
        this.stopSosSiren();
    }

    // ==========================================
    // HARDWARE GYRO / MAGNETOMETER COMPASS API
    // ==========================================
    enableMobileCompass() {
        const btn = document.getElementById('btn-enable-sensors');
        const infoText = document.getElementById('sensor-info-text');

        const startOrientationListener = () => {
            let hasReceivedOrientation = false;

            const handleOrientation = (event) => {
                let heading = null;

                // iOS Safari webkitCompassHeading
                if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
                    heading = event.webkitCompassHeading;
                } 
                // Android / Standard W3C DeviceOrientation alpha
                else if (event.alpha !== undefined && event.alpha !== null) {
                    heading = (360 - event.alpha) % 360;
                }

                if (heading !== null && !isNaN(heading)) {
                    hasReceivedOrientation = true;
                    const roundedHeading = Math.round((heading + 360) % 360);
                    this.updateHeadingUI(roundedHeading);
                    this.sensorsActive = true;

                    if (btn) {
                        btn.classList.remove('btn-outline');
                        btn.classList.add('btn-primary');
                        btn.innerHTML = `<span>🎯 HARDWARE COMPASS LIVE (${roundedHeading}°)</span>`;
                    }

                    if (infoText) {
                        infoText.textContent = `Mobile Gyro/Magnetometer active. Point phone in walking direction!`;
                        infoText.style.color = '#34d399';
                    }

                    this.draw();
                }
            };

            // Register Orientation Listeners
            if ('ondeviceorientationabsolute' in window) {
                window.addEventListener('deviceorientationabsolute', handleOrientation, true);
            }
            window.addEventListener('deviceorientation', handleOrientation, true);

            this.playTone('waypoint');

            // Desktop / Non-gyro Fallback Test Mode
            setTimeout(() => {
                if (!hasReceivedOrientation && btn) {
                    btn.classList.remove('btn-outline');
                    btn.classList.add('btn-warning');
                    btn.innerHTML = `<span>🎯 SENSOR READY (SIMULATING HEADING)</span>`;
                    if (infoText) {
                        infoText.textContent = `No hardware magnetometer detected (Desktop Mode). Move slider or use mobile phone!`;
                        infoText.style.color = '#f59e0b';
                    }
                }
            }, 1000);
        };

        // iOS 13+ permission request
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        startOrientationListener();
                    } else {
                        alert('Permission to access mobile compass sensors was denied.');
                    }
                })
                .catch(err => {
                    console.error(err);
                    startOrientationListener();
                });
        } else {
            startOrientationListener();
        }
    }

    // ==========================================
    // CANVAS & RENDERING ENGINE
    // ==========================================
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.draw();
    }

    worldToScreen(x, y) {
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        return {
            x: centerX + (x - this.camera.x) * this.camera.zoom,
            y: centerY + (y - this.camera.y) * this.camera.zoom
        };
    }

    screenToWorld(screenX, screenY) {
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        return {
            x: this.camera.x + (screenX - centerX) / this.camera.zoom,
            y: this.camera.y + (screenY - centerY) / this.camera.zoom
        };
    }

    draw() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;

        if (this.mapTheme === 'tactical') ctx.fillStyle = '#080d0a';
        else if (this.mapTheme === 'topographic') ctx.fillStyle = '#0d1812';
        else ctx.fillStyle = '#040705';
        
        ctx.fillRect(0, 0, width, height);

        this.drawGrid(ctx);
        this.drawRadarRings(ctx);
        this.drawPath(ctx);
        this.drawWaypoints(ctx);
        this.drawCurrentPositionBeacon(ctx);
        this.updateScaleBar();
    }

    drawGrid(ctx) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        let gridStep = 10;
        if (this.camera.zoom < 0.5) gridStep = 100;
        else if (this.camera.zoom < 1.2) gridStep = 50;
        else if (this.camera.zoom > 4) gridStep = 2;

        const pMin = this.screenToWorld(0, 0);
        const pMax = this.screenToWorld(width, height);

        const startX = Math.floor(pMin.x / gridStep) * gridStep;
        const endX = Math.ceil(pMax.x / gridStep) * gridStep;
        const startY = Math.floor(pMin.y / gridStep) * gridStep;
        const endY = Math.ceil(pMax.y / gridStep) * gridStep;

        for (let x = startX; x <= endX; x += gridStep) {
            const screen = this.worldToScreen(x, 0);
            ctx.strokeStyle = (x === 0) ? 'rgba(52, 211, 153, 0.4)' : 'rgba(52, 211, 153, 0.06)';
            ctx.lineWidth = (x === 0) ? 1.5 : 1;
            
            ctx.beginPath();
            ctx.moveTo(screen.x, 0);
            ctx.lineTo(screen.x, height);
            ctx.stroke();

            if (x !== 0 && this.camera.zoom > 0.4) {
                ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
                ctx.font = '10px "JetBrains Mono"';
                ctx.fillText(`${x}m`, screen.x + 4, height - 10);
            }
        }

        for (let y = startY; y <= endY; y += gridStep) {
            const screen = this.worldToScreen(0, y);
            ctx.strokeStyle = (y === 0) ? 'rgba(52, 211, 153, 0.4)' : 'rgba(52, 211, 153, 0.06)';
            ctx.lineWidth = (y === 0) ? 1.5 : 1;

            ctx.beginPath();
            ctx.moveTo(0, screen.y);
            ctx.lineTo(width, screen.y);
            ctx.stroke();

            if (y !== 0 && this.camera.zoom > 0.4) {
                ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
                ctx.font = '10px "JetBrains Mono"';
                ctx.fillText(`${-y}m`, 8, screen.y - 4);
            }
        }
    }

    drawRadarRings(ctx) {
        const origin = this.worldToScreen(0, 0);
        const distances = [50, 100, 250, 500, 1000];

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.12)';
        ctx.setLineDash([4, 4]);

        distances.forEach(d => {
            const radius = d * this.camera.zoom;
            if (radius > 15 && radius < Math.max(this.canvas.width, this.canvas.height) * 1.5) {
                ctx.beginPath();
                ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = 'rgba(52, 211, 153, 0.3)';
                ctx.font = '9px "JetBrains Mono"';
                ctx.fillText(`${d}m Radius`, origin.x + radius + 4, origin.y);
            }
        });

        ctx.setLineDash([]);
    }

    drawPath(ctx) {
        if (this.pathPoints.length < 2) return;

        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3 * Math.min(1.8, Math.max(0.8, this.camera.zoom));
        ctx.strokeStyle = '#10b981';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        const start = this.worldToScreen(this.pathPoints[0].x, this.pathPoints[0].y);
        ctx.moveTo(start.x, start.y);

        for (let i = 1; i < this.pathPoints.length; i++) {
            const pt = this.worldToScreen(this.pathPoints[i].x, this.pathPoints[i].y);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#a7f3d0';
        ctx.stroke();

        for (let i = 1; i < this.pathPoints.length; i++) {
            const p1 = this.worldToScreen(this.pathPoints[i - 1].x, this.pathPoints[i - 1].y);
            const p2 = this.worldToScreen(this.pathPoints[i].x, this.pathPoints[i].y);

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const distPx = Math.hypot(dx, dy);

            if (distPx > 35) {
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const angle = Math.atan2(dy, dx);

                ctx.save();
                ctx.translate(midX, midY);
                ctx.rotate(angle);

                ctx.fillStyle = '#34d399';
                ctx.beginPath();
                ctx.moveTo(6, 0);
                ctx.lineTo(-4, -4);
                ctx.lineTo(-4, 4);
                ctx.closePath();
                ctx.fill();

                if (this.camera.zoom > 0.6) {
                    ctx.rotate(-angle);
                    ctx.fillStyle = 'rgba(10, 15, 13, 0.85)';
                    ctx.fillRect(10, -18, 56, 14);
                    ctx.strokeStyle = 'rgba(52, 211, 153, 0.3)';
                    ctx.strokeRect(10, -18, 56, 14);

                    ctx.fillStyle = '#34d399';
                    ctx.font = '9px "JetBrains Mono"';
                    ctx.fillText(`${this.pathPoints[i].distance}m`, 14, -7);
                }

                ctx.restore();
            }

            ctx.fillStyle = '#059669';
            ctx.beginPath();
            ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawWaypoints(ctx) {
        this.waypoints.forEach(wp => {
            const screen = this.worldToScreen(wp.x, wp.y);

            let color = '#34d399';
            if (wp.type === 'camp') color = '#f97316';
            else if (wp.type === 'water') color = '#38bdf8';
            else if (wp.type === 'danger') color = '#ef4444';
            else if (wp.type === 'landmark') color = '#a855f7';
            else if (wp.type === 'resource') color = '#eab308';

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            ctx.fillStyle = 'rgba(12, 18, 15, 0.9)';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            
            ctx.font = '11px "Inter", sans-serif';
            const textWidth = ctx.measureText(wp.title).width;

            ctx.fillRect(screen.x - textWidth / 2 - 6, screen.y - 32, textWidth + 12, 18);
            ctx.strokeRect(screen.x - textWidth / 2 - 6, screen.y - 32, textWidth + 12, 18);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(wp.title, screen.x - textWidth / 2, screen.y - 19);
        });
    }

    drawCurrentPositionBeacon(ctx) {
        const current = this.pathPoints[this.pathPoints.length - 1];
        const screen = this.worldToScreen(current.x, current.y);

        const time = Date.now() / 400;
        const pulseRadius = 12 + Math.sin(time) * 4;

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();

        const rad = (this.currentHeading * Math.PI) / 180;
        const coneLen = 28;

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(rad);

        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 35);
        grad.addColorStop(0, 'rgba(52, 211, 153, 0.6)');
        grad.addColorStop(1, 'rgba(52, 211, 153, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 35, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.moveTo(0, -coneLen);
        ctx.lineTo(-7, 6);
        ctx.lineTo(0, 2);
        ctx.lineTo(7, 6);
        ctx.closePath();
        ctx.fill();

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.restore();
    }

    updateScaleBar() {
        const targetPx = 80;
        const meters = targetPx / this.camera.zoom;
        
        let roundedMeters = Math.round(meters);
        if (roundedMeters > 1000) roundedMeters = Math.round(roundedMeters / 500) * 500;
        else if (roundedMeters > 100) roundedMeters = Math.round(roundedMeters / 50) * 50;
        else if (roundedMeters > 10) roundedMeters = Math.round(roundedMeters / 10) * 10;
        else roundedMeters = Math.max(1, roundedMeters);

        const actualPx = roundedMeters * this.camera.zoom;

        const scaleLine = document.getElementById('scale-bar-line');
        const scaleText = document.getElementById('scale-bar-text');

        if (scaleLine) scaleLine.style.width = `${actualPx}px`;
        if (scaleText) {
            scaleText.textContent = (roundedMeters >= 1000) ? `${(roundedMeters / 1000).toFixed(1)} km` : `${roundedMeters} m`;
        }
    }

    // ==========================================
    // DEAD RECKONING ENGINE & MOVEMENT RECORDING
    // ==========================================
    recordMovement(distanceMeters, stepsCount = null) {
        if (distanceMeters <= 0) return;

        const last = this.pathPoints[this.pathPoints.length - 1];
        const rad = (this.currentHeading * Math.PI) / 180;
        const dx = distanceMeters * Math.sin(rad);
        const dy = -distanceMeters * Math.cos(rad);

        const calculatedSteps = stepsCount !== null ? stepsCount : Math.round(distanceMeters / this.strideLength);

        const newPoint = {
            x: last.x + dx,
            y: last.y + dy,
            heading: this.currentHeading,
            distance: distanceMeters,
            steps: calculatedSteps,
            timestamp: new Date()
        };

        this.pathPoints.push(newPoint);

        this.camera.x = newPoint.x;
        this.camera.y = newPoint.y;

        this.playTone('step');
        this.checkHazardProximity(newPoint);
        this.updateHUDStats();
        this.renderRouteLogList();
        this.draw();
    }

    checkHazardProximity(currentPos) {
        const hazardBanner = document.getElementById('hazard-warning-banner');
        let nearHazard = false;

        this.waypoints.forEach(wp => {
            if (wp.type === 'danger') {
                const dist = Math.hypot(wp.x - currentPos.x, wp.y - currentPos.y);
                if (dist <= 15) {
                    nearHazard = true;
                }
            }
        });

        if (nearHazard) {
            hazardBanner.style.display = 'flex';
            this.playTone('danger');
        } else {
            hazardBanner.style.display = 'none';
        }
    }

    undoLastStep() {
        if (this.pathPoints.length > 1) {
            this.pathPoints.pop();
            const current = this.pathPoints[this.pathPoints.length - 1];
            this.camera.x = current.x;
            this.camera.y = current.y;
            this.playTone('click');
            this.updateHUDStats();
            this.renderRouteLogList();
            this.draw();
        }
    }

    clearPath() {
        if (confirm('Reset current map trail?')) {
            this.pathPoints = [{ x: 0, y: 0, heading: 0, distance: 0, steps: 0, timestamp: new Date() }];
            this.camera = { x: 0, y: 0, zoom: 1.5 };
            this.playTone('clear');
            this.updateHUDStats();
            this.renderRouteLogList();
            this.draw();
        }
    }

    replayPathTimeline() {
        if (this.pathPoints.length <= 1) return;
        if (this.isReplaying) {
            clearInterval(this.replayTimer);
            this.isReplaying = false;
            return;
        }

        const fullPoints = [...this.pathPoints];
        this.pathPoints = [fullPoints[0]];
        let stepIdx = 1;
        this.isReplaying = true;

        this.replayTimer = setInterval(() => {
            if (stepIdx < fullPoints.length) {
                this.pathPoints.push(fullPoints[stepIdx]);
                const pt = fullPoints[stepIdx];
                this.currentHeading = pt.heading;
                this.updateHeadingUI(pt.heading);
                this.camera.x = pt.x;
                this.camera.y = pt.y;
                this.playTone('step');
                this.draw();
                stepIdx++;
            } else {
                clearInterval(this.replayTimer);
                this.isReplaying = false;
                alert('Trek Replay Completed!');
            }
        }, 600);
    }

    updateHUDStats() {
        let totalDist = 0;
        let totalSteps = 0;

        for (let i = 1; i < this.pathPoints.length; i++) {
            totalDist += this.pathPoints[i].distance;
            totalSteps += this.pathPoints[i].steps;
        }

        const current = this.pathPoints[this.pathPoints.length - 1];
        const displacement = Math.hypot(current.x, current.y);

        let bearingToBaseRad = Math.atan2(-current.x, current.y);
        let bearingToBaseDeg = Math.round((bearingToBaseRad * 180 / Math.PI + 360) % 360);

        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const cardinalIdx = Math.round(bearingToBaseDeg / 45) % 8;
        const baseCardinalStr = cardinals[cardinalIdx];

        const currentCardinalIdx = Math.round(this.currentHeading / 45) % 8;
        const currentCardinalStr = cardinals[currentCardinalIdx];

        const distKm = totalDist / 1000;
        const waterLiters = Math.max(0.25, 0.25 + (distKm * 0.15));

        document.getElementById('stat-distance').innerHTML = (totalDist >= 1000) ? `${(totalDist / 1000).toFixed(2)} <small>km</small>` : `${totalDist.toFixed(1)} <small>m</small>`;
        document.getElementById('stat-steps').textContent = totalSteps.toLocaleString();
        document.getElementById('stat-displacement').innerHTML = (displacement >= 1000) ? `${(displacement / 1000).toFixed(2)} <small>km</small>` : `${displacement.toFixed(1)} <small>m</small>`;
        document.getElementById('stat-water').innerHTML = `${waterLiters.toFixed(2)} <small>L</small>`;
        document.getElementById('stat-heading').innerHTML = `${String(this.currentHeading).padStart(3, '0')}° <small>${currentCardinalStr}</small>`;

        document.getElementById('hud-pos-x').textContent = `${current.x.toFixed(1)} m`;
        document.getElementById('hud-pos-y').textContent = `${(-current.y).toFixed(1)} m`;
        document.getElementById('hud-segment-count').textContent = this.pathPoints.length - 1;

        document.getElementById('base-bearing').textContent = `${bearingToBaseDeg}° (${baseCardinalStr})`;
        document.getElementById('base-distance').textContent = (displacement >= 1000) ? `${(displacement / 1000).toFixed(2)} km` : `${displacement.toFixed(1)} m`;
        document.getElementById('backtrack-arrow').style.transform = `rotate(${bearingToBaseDeg}deg)`;

        document.getElementById('compass-needle').style.transform = `rotate(${-this.currentHeading}deg)`;
    }

    renderRouteLogList() {
        const container = document.getElementById('route-list-container');
        document.getElementById('log-count').textContent = this.pathPoints.length - 1;

        if (this.pathPoints.length <= 1) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No movements recorded yet.</p>
                    <small>Use direction pad or arrow keys to start mapping your trail.</small>
                </div>
            `;
            return;
        }

        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        let html = '';

        for (let i = this.pathPoints.length - 1; i >= 1; i--) {
            const pt = this.pathPoints[i];
            const cIdx = Math.round(pt.heading / 45) % 8;
            const cStr = cardinals[cIdx];
            const timeStr = new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            html += `
                <div class="route-item">
                    <div class="route-dir-badge">${cStr}</div>
                    <div class="route-details">
                        <div class="route-heading-text">Heading ${pt.heading}° (${cStr})</div>
                        <div class="route-subtext">${pt.distance}m • ${pt.steps} steps • ${timeStr}</div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    renderWaypointsList() {
        const container = document.getElementById('waypoint-list-container');

        if (this.waypoints.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>No waypoints dropped yet.</p></div>`;
            return;
        }

        let html = '';
        this.waypoints.forEach(wp => {
            const current = this.pathPoints[this.pathPoints.length - 1];
            const distFromCurrent = Math.hypot(wp.x - current.x, wp.y - current.y);
            const distStr = (distFromCurrent >= 1000) ? `${(distFromCurrent / 1000).toFixed(2)} km` : `${distFromCurrent.toFixed(1)} m`;

            html += `
                <div class="waypoint-item">
                    <div class="waypoint-header-line">
                        <span class="wp-title-text">${wp.title}</span>
                        <span class="wp-coords">${distStr} away</span>
                    </div>
                    ${wp.notes ? `<div class="wp-note">${wp.notes}</div>` : ''}
                </div>
            `;
        });

        container.innerHTML = html;
    }

    renderSavedTrailsList() {
        const container = document.getElementById('saved-trails-container');
        if (!container) return;

        if (this.serverTrails.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>No saved expeditions found.</p></div>`;
            return;
        }

        let html = '';
        this.serverTrails.forEach(trail => {
            const dateStr = new Date(trail.createdAt || trail.savedAt).toLocaleDateString();
            html += `
                <div class="trail-card">
                    <div>
                        <div class="trail-name">${trail.name}</div>
                        <div class="trail-meta">${(trail.points || []).length - 1} steps • ${trail.totalDistance.toFixed(0)}m • ${dateStr}</div>
                    </div>
                    <div class="trail-actions">
                        <button class="btn btn-xs btn-outline btn-load-trail" data-id="${trail.id}">Load</button>
                        ${trail.id ? `<button class="btn btn-xs btn-text danger-text btn-del-trail" data-id="${trail.id}">✕</button>` : ''}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.btn-load-trail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.loadTrailFromData(id);
            });
        });

        container.querySelectorAll('.btn-del-trail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.deleteServerTrail(id);
            });
        });
    }

    loadTrailFromData(id) {
        const trail = this.serverTrails.find(t => t.id === id);
        if (!trail) return;

        if (confirm(`Load expedition "${trail.name}" onto map canvas?`)) {
            this.pathPoints = trail.points;
            this.waypoints = trail.waypoints || [];
            const last = this.pathPoints[this.pathPoints.length - 1];
            this.camera.x = last.x;
            this.camera.y = last.y;
            this.updateHUDStats();
            this.renderRouteLogList();
            this.renderWaypointsList();
            this.draw();
        }
    }

    toggleSimulation() {
        const btn = document.getElementById('btn-demo-sim');
        if (this.isSimulating) {
            clearInterval(this.simulationTimer);
            this.isSimulating = false;
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-secondary');
            btn.querySelector('span').textContent = 'Auto Hike';
        } else {
            this.isSimulating = true;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-warning');
            btn.querySelector('span').textContent = 'Stop Hike';

            this.simulationTimer = setInterval(() => {
                const headingChange = (Math.random() - 0.5) * 60;
                this.currentHeading = Math.round((this.currentHeading + headingChange + 360) % 360);
                this.updateHeadingUI(this.currentHeading);

                const randomDist = Math.round(5 + Math.random() * 15);
                this.recordMovement(randomDist);
            }, 1800);
        }
    }

    updateHeadingUI(deg) {
        this.currentHeading = deg;
        const range = document.getElementById('heading-range');
        const input = document.getElementById('heading-input');
        const centerVal = document.getElementById('center-heading-val');
        const centerCard = document.getElementById('center-cardinal-val');

        if (range) range.value = deg;
        if (input) input.value = deg;
        if (centerVal) centerVal.textContent = `${deg}°`;

        const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(deg / 45) % 8;
        if (centerCard) centerCard.textContent = cardinals[idx];

        document.querySelectorAll('.dir-btn').forEach(btn => {
            const btnDeg = parseInt(btn.dataset.deg);
            if (Math.abs(btnDeg - deg) < 22.5 || (deg > 337.5 && btnDeg === 0)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        this.updateHUDStats();
    }

    // EXPORTS (Works 100% Offline in Browser Memory)
    exportGPX() {
        const baseLat = -3.4653;
        const baseLon = -62.2159;
        const metersPerLat = 111000;
        const metersPerLon = 111000 * Math.cos(baseLat * Math.PI / 180);

        let trkpts = '';
        this.pathPoints.forEach(pt => {
            const lat = baseLat + (-pt.y / metersPerLat);
            const lon = baseLon + (pt.x / metersPerLon);
            trkpts += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(pt.timestamp).toISOString()}</time></trkpt>\n`;
        });

        const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="WildPath Explorer"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
        this.downloadFile(gpx, 'expedition_trail.gpx', 'application/gpx+xml');
    }

    exportKML() {
        const baseLat = -3.4653;
        const baseLon = -62.2159;
        const metersPerLat = 111000;
        const metersPerLon = 111000 * Math.cos(baseLat * Math.PI / 180);

        let coords = '';
        this.pathPoints.forEach(pt => {
            const lat = baseLat + (-pt.y / metersPerLat);
            const lon = baseLon + (pt.x / metersPerLon);
            coords += `${lon.toFixed(6)},${lat.toFixed(6)},0 `;
        });

        const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>${coords.trim()}</coordinates></LineString></Placemark></Document></kml>`;
        this.downloadFile(kml, 'expedition_trail.kml', 'application/vnd.google-earth.kml+xml');
    }

    exportJSON() {
        const payload = { app: 'WildPath Explorer', pathPoints: this.pathPoints, waypoints: this.waypoints };
        this.downloadFile(JSON.stringify(payload, null, 2), 'expedition_backup.json', 'application/json');
    }

    exportPNG() {
        const a = document.createElement('a');
        a.download = 'wildpath_canvas_map.png';
        a.href = this.canvas.toDataURL('image/png');
        a.click();
    }

    downloadFile(content, fileName, contentType) {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // EVENT LISTENERS
    bindEvents() {
        document.querySelectorAll('.dir-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const deg = parseInt(e.currentTarget.dataset.deg);
                this.updateHeadingUI(deg);
                this.playTone('click');
                this.draw();
            });
        });

        const range = document.getElementById('heading-range');
        const input = document.getElementById('heading-input');

        if (range) range.addEventListener('input', (e) => { this.updateHeadingUI(parseInt(e.target.value)); this.draw(); });
        if (input) input.addEventListener('change', (e) => { this.updateHeadingUI(parseInt(e.target.value) % 360); this.draw(); });

        const tabMeters = document.getElementById('tab-meters');
        const tabSteps = document.getElementById('tab-steps');
        const unitTag = document.getElementById('unit-tag');

        tabMeters.addEventListener('click', () => {
            tabMeters.classList.add('active');
            tabSteps.classList.remove('active');
            this.inputMode = 'meters';
            unitTag.textContent = 'meters';
        });

        tabSteps.addEventListener('click', () => {
            tabSteps.classList.add('active');
            tabMeters.classList.remove('active');
            this.inputMode = 'steps';
            unitTag.textContent = 'steps';
        });

        document.querySelectorAll('.chip-btn').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const addVal = parseInt(e.currentTarget.dataset.add);
                const distInput = document.getElementById('distance-val');
                distInput.value = parseInt(distInput.value || 0) + addVal;
                this.playTone('click');
            });
        });

        document.getElementById('btn-add-step').addEventListener('click', () => {
            const rawVal = parseFloat(document.getElementById('distance-val').value) || 0;
            if (rawVal <= 0) return;

            if (this.inputMode === 'meters') {
                this.recordMovement(rawVal);
            } else {
                const distMeters = rawVal * this.strideLength;
                this.recordMovement(distMeters, Math.round(rawVal));
            }
        });

        document.getElementById('btn-undo-step').addEventListener('click', () => this.undoLastStep());
        document.getElementById('btn-clear-path').addEventListener('click', () => this.clearPath());
        document.getElementById('btn-replay-track').addEventListener('click', () => this.replayPathTimeline());

        // Keyboard Navigation (WASD & Arrow Keys)
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                const rawVal = parseFloat(document.getElementById('distance-val').value) || 10;
                this.recordMovement(rawVal);
            } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                this.updateHeadingUI((this.currentHeading - 45 + 360) % 360);
                this.draw();
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                this.updateHeadingUI((this.currentHeading + 45) % 360);
                this.draw();
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                this.updateHeadingUI((this.currentHeading + 180) % 360);
                this.draw();
            }
        });

        // Offline Celestial Compass Modal
        const celestialModal = document.getElementById('celestial-modal');
        document.getElementById('btn-open-celestial-tool').addEventListener('click', () => celestialModal.classList.add('open'));
        document.getElementById('celestial-close-btn').addEventListener('click', () => celestialModal.classList.remove('open'));
        document.getElementById('btn-celestial-done').addEventListener('click', () => celestialModal.classList.remove('open'));

        // Enable Mobile Compass Hardware Listener
        const btnSensors = document.getElementById('btn-enable-sensors');
        if (btnSensors) {
            btnSensors.addEventListener('click', () => this.enableMobileCompass());
        }

        // SOS Trigger & Stop
        document.getElementById('btn-sos-trigger').addEventListener('click', () => this.triggerSosBeacon());
        document.getElementById('btn-stop-sos').addEventListener('click', () => this.stopSosBeacon());

        document.getElementById('btn-sound-toggle').addEventListener('click', (e) => {
            this.soundEnabled = !this.soundEnabled;
            e.currentTarget.style.opacity = this.soundEnabled ? '1' : '0.4';
        });

        document.getElementById('btn-demo-sim').addEventListener('click', () => this.toggleSimulation());

        document.getElementById('btn-backtrack-mode').addEventListener('click', () => {
            const current = this.pathPoints[this.pathPoints.length - 1];
            let bearingRad = Math.atan2(-current.x, current.y);
            let bearingDeg = Math.round((bearingRad * 180 / Math.PI + 360) % 360);
            this.updateHeadingUI(bearingDeg);
            this.draw();
            this.playTone('waypoint');
        });

        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

                e.currentTarget.classList.add('active');
                const targetId = e.currentTarget.id.replace('tab-', 'panel-');
                document.getElementById(targetId).classList.add('active');
            });
        });

        // Drag & Zoom
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.dragStart = { x: e.clientX, y: e.clientY };

            this.camera.x -= dx / this.camera.zoom;
            this.camera.y -= dy / this.camera.zoom;
            this.draw();
        });

        window.addEventListener('mouseup', () => { this.isDragging = false; });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            this.camera.zoom = Math.max(0.1, Math.min(10, this.camera.zoom * zoomFactor));
            this.draw();
        });

        document.getElementById('btn-zoom-in').addEventListener('click', () => { this.camera.zoom = Math.min(10, this.camera.zoom * 1.25); this.draw(); });
        document.getElementById('btn-zoom-out').addEventListener('click', () => { this.camera.zoom = Math.max(0.1, this.camera.zoom / 1.25); this.draw(); });

        document.getElementById('btn-recenter').addEventListener('click', () => {
            const current = this.pathPoints[this.pathPoints.length - 1];
            this.camera.x = current.x;
            this.camera.y = current.y;
            this.draw();
        });

        document.querySelectorAll('.map-style-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.map-style-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.mapTheme = e.currentTarget.dataset.theme;
                this.draw();
            });
        });

        // Modals
        const wpModal = document.getElementById('waypoint-modal');
        document.getElementById('btn-add-waypoint').addEventListener('click', () => wpModal.classList.add('open'));
        document.getElementById('btn-quick-add-camp').addEventListener('click', () => {
            const current = this.pathPoints[this.pathPoints.length - 1];
            this.waypoints.push({
                id: 'wp_' + Date.now(),
                x: current.x,
                y: current.y,
                title: 'Secondary Camp',
                type: 'camp',
                notes: 'Emergency shelter dropped.',
                timestamp: new Date()
            });
            this.playTone('waypoint');
            this.renderWaypointsList();
            this.draw();
        });

        document.getElementById('modal-close-btn').addEventListener('click', () => wpModal.classList.remove('open'));
        document.getElementById('btn-modal-cancel').addEventListener('click', () => wpModal.classList.remove('open'));

        document.querySelectorAll('.icon-opt').forEach(opt => {
            opt.addEventListener('click', (e) => {
                document.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.selectedWpIcon = e.currentTarget.dataset.type;
            });
        });

        document.getElementById('btn-modal-save').addEventListener('click', () => {
            const title = document.getElementById('wp-title').value.trim() || 'Uncharted Waypoint';
            const notes = document.getElementById('wp-notes').value.trim();
            const current = this.pathPoints[this.pathPoints.length - 1];

            this.waypoints.push({
                id: 'wp_' + Date.now(),
                x: current.x,
                y: current.y,
                title: title,
                type: this.selectedWpIcon,
                notes: notes,
                timestamp: new Date()
            });

            this.playTone('waypoint');
            this.renderWaypointsList();
            this.draw();
            wpModal.classList.remove('open');
        });

        const exportModal = document.getElementById('export-modal');
        document.getElementById('btn-export-menu').addEventListener('click', () => exportModal.classList.add('open'));
        document.getElementById('export-modal-close').addEventListener('click', () => exportModal.classList.remove('open'));

        document.getElementById('btn-export-gpx').addEventListener('click', () => { this.exportGPX(); exportModal.classList.remove('open'); });
        document.getElementById('btn-export-kml').addEventListener('click', () => { this.exportKML(); exportModal.classList.remove('open'); });
        document.getElementById('btn-export-json').addEventListener('click', () => { this.exportJSON(); exportModal.classList.remove('open'); });
        document.getElementById('btn-export-png').addEventListener('click', () => { this.exportPNG(); exportModal.classList.remove('open'); });

        document.getElementById('btn-save-current-trail').addEventListener('click', () => {
            const input = document.getElementById('trail-name-input');
            this.saveTrailToServer(input.value || 'Jungle Recon Expedition');
            input.value = '';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.wildpathApp = new WildPathEngine();
});
