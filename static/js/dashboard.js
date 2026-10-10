/**
 * =============================================================================
 * DASHBOARD CONTROLLER - REAL-TIME HARDWARE TELEMETRY & EVENT MANAGEMENT
 * =============================================================================
 */

// Global State
let systemState = {
  isMuted: false,
  alarmAcknowledged: false,
  audioEnabled: false,
  zone1Stats: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  zone2Stats: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  renameZoneIndex: 1
};

// Web Audio API Synthesizer for Industrial Alarm Beep
class AudioAlarmSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.isPlaying = false;
    this.intervalId = null;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  startAlarm() {
    if (this.isPlaying || systemState.isMuted || !systemState.audioEnabled) return;
    this.init();
    this.isPlaying = true;

    // Pulse periodic warning double-beeps
    const playBeep = () => {
      if (!this.isPlaying || systemState.isMuted) return;
      try {
        const now = this.audioCtx.currentTime;
        
        // Beep 1 (High tone)
        const osc1 = this.audioCtx.createOscillator();
        const gain1 = this.audioCtx.createGain();
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(0.12, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc1.connect(gain1);
        gain1.connect(this.audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        // Beep 2 (Alarm pulse)
        const osc2 = this.audioCtx.createOscillator();
        const gain2 = this.audioCtx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1174.66, now + 0.2);
        gain2.gain.setValueAtTime(0.12, now + 0.2);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc2.connect(gain2);
        gain2.connect(this.audioCtx.destination);
        osc2.start(now + 0.2);
        osc2.stop(now + 0.35);
      } catch (e) {
        console.warn('Web Audio playback error:', e);
      }
    };

    playBeep();
    this.intervalId = setInterval(playBeep, 1200);
  }

  stopAlarm() {
    this.isPlaying = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

const alarmAudio = new AudioAlarmSynthesizer();

// =============================================================================
// DOM INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Live Sensor Chart (starts clean with no mock data)
  window.sensorChart.init(1000);

  // Preload genuine historical readings if any exist in SQLite
  fetch('/api/readings/recent?limit=40')
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success' && data.readings && data.readings.length > 0) {
        window.sensorChart.preloadHistory(data.readings);
      }
    })
    .catch(err => console.error('Error preloading history:', err));

  // Initial Fetch of Status, COM Ports, and Events
  fetchSystemStatus();
  fetchEventLogs();
  refreshAllSerialPorts();

  // Setup Recurring Polling (1 Hz for real-time responsiveness)
  setInterval(fetchSystemStatus, 1000);
  setInterval(fetchEventLogs, 3000);

  // Bind Event Listeners
  setupEventListeners();
});

// =============================================================================
// EVENT LISTENERS SETUP
// =============================================================================
function setupEventListeners() {
  // Audio Prompt
  const btnEnableAudio = document.getElementById('btnEnableAudio');
  if (btnEnableAudio) {
    btnEnableAudio.addEventListener('click', () => {
      systemState.audioEnabled = true;
      alarmAudio.init();
      document.getElementById('audioAlertPrompt').classList.add('hidden');
    });
  }

  const btnDismissAudio = document.getElementById('btnDismissAudio');
  if (btnDismissAudio) {
    btnDismissAudio.addEventListener('click', () => {
      document.getElementById('audioAlertPrompt').classList.add('hidden');
    });
  }

  // Master Mute Button
  const btnToggleMute = document.getElementById('btnToggleMute');
  if (btnToggleMute) {
    btnToggleMute.addEventListener('click', () => {
      systemState.isMuted = !systemState.isMuted;
      const muteIcon = document.getElementById('muteIcon');
      if (systemState.isMuted) {
        muteIcon.className = 'fa-solid fa-volume-xmark';
        btnToggleMute.classList.add('active');
        alarmAudio.stopAlarm();
      } else {
        muteIcon.className = 'fa-solid fa-volume-high';
        btnToggleMute.classList.remove('active');
      }
    });
  }

  // Alarm Acknowledgement Buttons
  const btnHeaderAck = document.getElementById('btnHeaderAck');
  const btnAckAlarms = document.getElementById('btnAckAlarms');
  const handleAck = () => {
    systemState.alarmAcknowledged = true;
    alarmAudio.stopAlarm();
    
    fetch('/api/alarm/acknowledge', { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        fetchEventLogs();
        const saveStatus = document.getElementById('thresholdSaveStatus');
        if (saveStatus) {
          saveStatus.textContent = 'Alarms acknowledged (Leak condition remains active until safe).';
          setTimeout(() => { saveStatus.textContent = ''; }, 4000);
        }
      });
  };
  if (btnHeaderAck) btnHeaderAck.addEventListener('click', handleAck);
  if (btnAckAlarms) btnAckAlarms.addEventListener('click', handleAck);

  // Threshold Slider & Input Synchronization
  const thresholdRange = document.getElementById('thresholdRange');
  const thresholdInput = document.getElementById('thresholdInput');
  const btnSaveThreshold = document.getElementById('btnSaveThreshold');
  const thresholdSaveStatus = document.getElementById('thresholdSaveStatus');

  if (thresholdRange && thresholdInput) {
    thresholdRange.addEventListener('input', (e) => {
      thresholdInput.value = e.target.value;
    });
    thresholdInput.addEventListener('input', (e) => {
      thresholdRange.value = e.target.value;
    });
  }

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-val');
      if (thresholdRange) thresholdRange.value = val;
      if (thresholdInput) thresholdInput.value = val;
    });
  });

  // Save Threshold Button
  if (btnSaveThreshold) {
    btnSaveThreshold.addEventListener('click', () => {
      const val = parseFloat(thresholdInput.value);
      if (isNaN(val) || val < 0 || val > 4095) {
        alert('Please enter a valid threshold between 0 and 4095');
        return;
      }

      fetch('/api/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: val })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          window.sensorChart.updateThreshold(val);
          thresholdSaveStatus.textContent = `Threshold set to ${val} ADC!`;
          setTimeout(() => { thresholdSaveStatus.textContent = ''; }, 3500);
          fetchSystemStatus();
          fetchEventLogs();
        }
      });
    });
  }

  // Time Window Selector for Chart
  document.querySelectorAll('[data-window]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-window]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const secs = parseInt(btn.getAttribute('data-window'), 10);
      window.sensorChart.setTimeWindow(secs);
    });
  });

  // Chart Actions
  const btnPauseChart = document.getElementById('btnPauseChart');
  if (btnPauseChart) {
    btnPauseChart.addEventListener('click', () => {
      const isPaused = window.sensorChart.togglePause();
      const pauseIcon = document.getElementById('chartPauseIcon');
      const pauseText = document.getElementById('chartPauseText');
      if (isPaused) {
        pauseIcon.className = 'fa-solid fa-play';
        pauseText.textContent = 'Resume';
        btnPauseChart.classList.add('active');
      } else {
        pauseIcon.className = 'fa-solid fa-pause';
        pauseText.textContent = 'Pause';
        btnPauseChart.classList.remove('active');
      }
    });
  }

  const btnClearChart = document.getElementById('btnClearChart');
  if (btnClearChart) {
    btnClearChart.addEventListener('click', () => {
      window.sensorChart.clear();
    });
  }

  const btnExportChart = document.getElementById('btnExportChart');
  if (btnExportChart) {
    btnExportChart.addEventListener('click', () => {
      window.sensorChart.exportImage();
    });
  }

  // Event Log Filters
  const eventZoneFilter = document.getElementById('eventZoneFilter');
  const eventSeverityFilter = document.getElementById('eventSeverityFilter');
  if (eventZoneFilter) eventZoneFilter.addEventListener('change', fetchEventLogs);
  if (eventSeverityFilter) eventSeverityFilter.addEventListener('change', fetchEventLogs);

  // Clear Event Logs Button
  const btnClearLogs = document.getElementById('btnClearLogs');
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all event audit history?')) {
        fetch('/api/events/clear', { method: 'POST' })
          .then(res => res.json())
          .then(() => fetchEventLogs());
      }
    });
  }

  // Direct Card Serial Buttons
  const btnDirectConnect = document.getElementById('btnDirectConnect');
  if (btnDirectConnect) {
    btnDirectConnect.addEventListener('click', connectDirectSerial);
  }

  const btnDirectDisconnect = document.getElementById('btnDirectDisconnect');
  if (btnDirectDisconnect) {
    btnDirectDisconnect.addEventListener('click', disconnectDirectSerial);
  }

  const btnRefreshDirectPorts = document.getElementById('btnRefreshDirectPorts');
  if (btnRefreshDirectPorts) {
    btnRefreshDirectPorts.addEventListener('click', refreshAllSerialPorts);
  }

  // Header Modal Serial Controls
  const btnOpenSerialModal = document.getElementById('btnOpenSerialModal');
  if (btnOpenSerialModal) {
    btnOpenSerialModal.addEventListener('click', openSerialModal);
  }

  const btnRefreshPorts = document.getElementById('btnRefreshPorts');
  if (btnRefreshPorts) {
    btnRefreshPorts.addEventListener('click', refreshAllSerialPorts);
  }

  const btnModalConnect = document.getElementById('btnModalConnect');
  if (btnModalConnect) {
    btnModalConnect.addEventListener('click', connectSerialFromModal);
  }

  const btnModalDisconnect = document.getElementById('btnModalDisconnect');
  if (btnModalDisconnect) {
    btnModalDisconnect.addEventListener('click', disconnectSerialFromModal);
  }

  // Rename Zone Modal Save Button
  const btnSaveZoneName = document.getElementById('btnSaveZoneName');
  if (btnSaveZoneName) {
    btnSaveZoneName.addEventListener('click', saveZoneName);
  }
}

// =============================================================================
// STATUS FETCH & UI UPDATE
// =============================================================================
function fetchSystemStatus() {
  fetch('/api/status')
    .then(res => res.json())
    .then(data => {
      updateDashboardUI(data);
    })
    .catch(err => {
      console.warn('Failed to fetch status:', err);
      renderDisconnectedUI();
    });
}

function updateDashboardUI(state) {
  const { threshold, last_data_time, seconds_since_last_data, is_stale, serial, zone1, zone2, system } = state;

  // 1. Header Telemetry Updates
  const serialStatusLabel = document.getElementById('serialStatusLabel');
  const esp32ConnectionText = document.getElementById('esp32ConnectionText');
  const comPortBtnLabel = document.getElementById('comPortBtnLabel');

  if (serial.is_connected) {
    serialStatusLabel.textContent = `Connected (${serial.port})`;
    esp32ConnectionText.className = 'pill-value status-connected';
    if (comPortBtnLabel) comPortBtnLabel.textContent = serial.port;
  } else {
    serialStatusLabel.textContent = 'Disconnected';
    esp32ConnectionText.className = 'pill-value status-disconnected';
    if (comPortBtnLabel) comPortBtnLabel.textContent = 'Select Port';
  }

  // Last data time text
  const lastDataTimeText = document.getElementById('lastDataTimeText');
  if (!serial.is_connected) {
    lastDataTimeText.textContent = 'Disconnected';
  } else if (seconds_since_last_data === null || seconds_since_last_data === undefined) {
    lastDataTimeText.textContent = 'Waiting for data...';
  } else if (seconds_since_last_data < 2) {
    lastDataTimeText.textContent = 'Live (Just now)';
  } else if (seconds_since_last_data < 60) {
    lastDataTimeText.textContent = `${Math.round(seconds_since_last_data)}s ago`;
  } else {
    lastDataTimeText.textContent = last_data_time;
  }

  // Threshold Badges & Markers
  document.getElementById('headerThresholdText').textContent = `${Math.round(threshold)} ADC`;
  document.getElementById('bannerThresholdBadge').textContent = `${Math.round(threshold)} ADC`;
  document.getElementById('chartLegendThreshold').textContent = `${Math.round(threshold)}`;
  document.getElementById('zone1ThresholdLabel').textContent = `Threshold: ${Math.round(threshold)}`;
  document.getElementById('zone2ThresholdLabel').textContent = `Threshold: ${Math.round(threshold)}`;

  // Position Threshold marker on progress bars (0 - 4095 range)
  const markerPercent = Math.min(100, Math.max(0, (threshold / 4095.0) * 100));
  document.getElementById('zone1ThresholdMarker').style.left = `${markerPercent}%`;
  document.getElementById('zone2ThresholdMarker').style.left = `${markerPercent}%`;

  // 2. Overall System Status Banner
  const banner = document.getElementById('systemStatusBanner');
  const bannerTitle = document.getElementById('systemStatusTitle');
  const bannerDesc = document.getElementById('systemStatusDesc');
  const bannerIcon = document.getElementById('statusBannerIcon');
  const bannerZ1Badge = document.getElementById('bannerZ1Badge');
  const bannerZ2Badge = document.getElementById('bannerZ2Badge');
  const statusUpdateTime = document.getElementById('statusUpdateTime');

  banner.className = 'system-status-banner';

  if (!serial.is_connected) {
    banner.classList.add('status-disconnected');
    bannerTitle.textContent = 'ESP32 HARDWARE DISCONNECTED';
    bannerDesc.textContent = 'USB Serial interface to the ESP32 microcontroller is offline. Select COM port and connect.';
    bannerIcon.className = 'fa-solid fa-plug-circle-xmark';
    statusUpdateTime.textContent = 'Hardware Offline';
    alarmAudio.stopAlarm();
    systemState.alarmAcknowledged = false;
  } else if (system.is_waiting) {
    banner.classList.add('status-waiting');
    bannerTitle.textContent = 'WAITING FOR ESP32 DATA';
    bannerDesc.textContent = 'Serial link is established. Listening on 9600 baud for gas1_val and gas2_val transmissions...';
    bannerIcon.className = 'fa-solid fa-clock';
    statusUpdateTime.textContent = 'Awaiting Telemetry';
    alarmAudio.stopAlarm();
    systemState.alarmAcknowledged = false;
  } else if (system.is_stale) {
    banner.classList.add('status-stale');
    bannerTitle.textContent = 'SENSOR DATA UNAVAILABLE';
    bannerDesc.textContent = 'Telemetry timeout: No fresh data received from gas sensors in over 3.5 seconds. Check hardware wiring.';
    bannerIcon.className = 'fa-solid fa-triangle-exclamation';
    statusUpdateTime.textContent = 'Telemetry Timeout';
    alarmAudio.stopAlarm();
    systemState.alarmAcknowledged = false;
  } else if (system.is_leak) {
    banner.classList.add('status-leak');
    bannerTitle.textContent = system.message;
    bannerDesc.textContent = 'URGENT: Hydrocarbon / flammable vapour concentration has crossed safe operating limits. Inspect designated zone.';
    bannerIcon.className = 'fa-solid fa-triangle-exclamation';
    statusUpdateTime.textContent = 'CRITICAL ALERT';
    
    // Play sound alert if not acknowledged
    if (!systemState.alarmAcknowledged) {
      alarmAudio.startAlarm();
    }
  } else {
    // Genuine All Safe
    banner.classList.add('status-safe');
    bannerTitle.textContent = 'ALL ZONES SAFE';
    bannerDesc.textContent = 'Both monitoring zones are reporting real sensor concentrations within normal baseline safety limits.';
    bannerIcon.className = 'fa-solid fa-circle-check';
    statusUpdateTime.textContent = 'Active Monitoring';
    alarmAudio.stopAlarm();
    systemState.alarmAcknowledged = false;
  }

  // Update Zone Badges on Banner
  updateQuickBadge(bannerZ1Badge, zone1.status);
  updateQuickBadge(bannerZ2Badge, zone2.status);

  // 3. Update Zone 1 Card
  updateZoneCard(1, zone1, threshold, last_data_time);

  // 4. Update Zone 2 Card (Strictly Independent)
  updateZoneCard(2, zone2, threshold, last_data_time);

  // 5. Update Hardware Peripherals & LCD Sync
  updateHardwareState(zone1, zone2, system, serial);

  // 6. Push real data to Live Chart (Only when valid numbers are received!)
  if (zone1.value !== null && zone2.value !== null && !zone1.is_unavailable && !zone2.is_unavailable) {
    const timeLabel = new Date().toLocaleTimeString();
    window.sensorChart.addPoint(timeLabel, zone1.value, zone2.value, threshold);
  }

  // Update Direct Card serial UI
  updateSerialCardUI(serial);
}

function updateQuickBadge(badgeEl, status) {
  badgeEl.className = 'value';
  if (status === 'SAFE') {
    badgeEl.classList.add('safe');
    badgeEl.textContent = 'NO LEAK';
  } else if (status === 'LEAK') {
    badgeEl.classList.add('leak');
    badgeEl.textContent = 'LEAK!';
  } else {
    badgeEl.classList.add('unavailable');
    badgeEl.textContent = 'UNAVAILABLE';
  }
}

function updateZoneCard(zoneIndex, zoneData, threshold, lastDataTime) {
  const prefix = `zone${zoneIndex}`;
  const readingEl = document.getElementById(`${prefix}Reading`);
  const progressBar = document.getElementById(`${prefix}ProgressBar`);
  const indicator = document.getElementById(`${prefix}Indicator`);
  const indicatorIcon = document.getElementById(`${prefix}IndicatorIcon`);
  const indicatorText = document.getElementById(`${prefix}StatusText`);
  const titleEl = document.getElementById(`${prefix}Title`);
  const lastTimeEl = document.getElementById(`${prefix}LastTime`);

  if (titleEl && zoneData.name) {
    titleEl.textContent = zoneData.name;
  }

  // State evaluation
  indicator.className = 'zone-status-indicator';
  progressBar.className = 'zone-progress-bar';

  if (zoneData.is_unavailable || zoneData.value === null || zoneData.value === undefined) {
    readingEl.textContent = '--';
    progressBar.style.width = '0%';
    progressBar.classList.add('bar-unavailable');
    indicator.classList.add('indicator-unavailable');
    indicatorIcon.className = 'fa-solid fa-circle-question';
    indicatorText.textContent = 'SENSOR DATA UNAVAILABLE';
  } else if (zoneData.is_leak) {
    readingEl.textContent = Math.round(zoneData.value);
    const barPercent = Math.min(100, Math.max(3, zoneData.percentage));
    progressBar.style.width = `${barPercent}%`;
    progressBar.classList.add('bar-leak');
    indicator.classList.add('indicator-leak');
    indicatorIcon.className = 'fa-solid fa-triangle-exclamation';
    indicatorText.textContent = 'POSSIBLE LEAK DETECTED';

    if (lastTimeEl) lastTimeEl.textContent = lastDataTime;
  } else {
    // Safe
    readingEl.textContent = Math.round(zoneData.value);
    const barPercent = Math.min(100, Math.max(3, zoneData.percentage));
    progressBar.style.width = `${barPercent}%`;
    progressBar.classList.add('bar-safe');
    indicator.classList.add('indicator-safe');
    indicatorIcon.className = 'fa-solid fa-shield-halved';
    indicatorText.textContent = 'NO LEAK DETECTED';

    if (lastTimeEl) lastTimeEl.textContent = lastDataTime;
  }

  // Update statistics calculations only on real data
  const statsKey = `zone${zoneIndex}Stats`;
  const stats = systemState[statsKey];
  if (!zoneData.is_unavailable && zoneData.value !== null && zoneData.value !== undefined) {
    stats.min = Math.min(stats.min, zoneData.value);
    stats.max = Math.max(stats.max, zoneData.value);
    stats.sum += zoneData.value;
    stats.count += 1;

    document.getElementById(`${prefix}MinVal`).textContent = `${Math.round(stats.min)}`;
    document.getElementById(`${prefix}MaxVal`).textContent = `${Math.round(stats.max)}`;
    document.getElementById(`${prefix}AvgVal`).textContent = `${Math.round(stats.sum / stats.count)}`;
  }
}

function updateHardwareState(zone1, zone2, system, serial) {
  const z1LedGreen = document.getElementById('z1LedGreen');
  const z1LedGreenState = document.getElementById('z1LedGreenState');
  const z1LedRed = document.getElementById('z1LedRed');
  const z1LedRedState = document.getElementById('z1LedRedState');

  const z2LedGreen = document.getElementById('z2LedGreen');
  const z2LedGreenState = document.getElementById('z2LedGreenState');
  const z2LedRed = document.getElementById('z2LedRed');
  const z2LedRedState = document.getElementById('z2LedRedState');

  const buzzerIconWrap = document.getElementById('buzzerIconWrap');
  const buzzerStatusLabel = document.getElementById('buzzerStatusLabel');
  const hwSyncBadge = document.getElementById('hwSyncBadge');

  const lcdLine1 = document.getElementById('lcdLine1');
  const lcdLine2 = document.getElementById('lcdLine2');

  if (!serial.is_connected || zone1.is_unavailable || zone2.is_unavailable) {
    // Waiting or offline
    z1LedGreen.className = 'actuator-led led-green inactive';
    z1LedGreenState.className = 'actuator-state text-muted';
    z1LedGreenState.textContent = 'Offline';

    z1LedRed.className = 'actuator-led led-red inactive';
    z1LedRedState.className = 'actuator-state text-muted';
    z1LedRedState.textContent = 'Offline';

    z2LedGreen.className = 'actuator-led led-green inactive';
    z2LedGreenState.className = 'actuator-state text-muted';
    z2LedGreenState.textContent = 'Offline';

    z2LedRed.className = 'actuator-led led-red inactive';
    z2LedRedState.className = 'actuator-state text-muted';
    z2LedRedState.textContent = 'Offline';

    buzzerIconWrap.className = 'hw-device-icon';
    buzzerStatusLabel.className = 'hw-device-status status-off';
    buzzerStatusLabel.textContent = 'INACTIVE';

    if (hwSyncBadge) {
      hwSyncBadge.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Offline';
    }

    lcdLine1.textContent = 'Zone1 - Zone2   ';
    lcdLine2.textContent = serial.is_connected ? 'Waiting Data... ' : 'ESP32 Offline   ';
    return;
  }

  // Zone 1 Real Actuators
  if (zone1.is_leak) {
    z1LedGreen.className = 'actuator-led led-green inactive';
    z1LedGreenState.className = 'actuator-state text-muted';
    z1LedGreenState.textContent = 'OFF';

    z1LedRed.className = 'actuator-led led-red active';
    z1LedRedState.className = 'actuator-state text-danger';
    z1LedRedState.textContent = 'ON (LEAK)';
  } else {
    z1LedGreen.className = 'actuator-led led-green active';
    z1LedGreenState.className = 'actuator-state text-safe';
    z1LedGreenState.textContent = 'ON (Safe)';

    z1LedRed.className = 'actuator-led led-red inactive';
    z1LedRedState.className = 'actuator-state text-muted';
    z1LedRedState.textContent = 'OFF';
  }

  // Zone 2 Real Actuators
  if (zone2.is_leak) {
    z2LedGreen.className = 'actuator-led led-green inactive';
    z2LedGreenState.className = 'actuator-state text-muted';
    z2LedGreenState.textContent = 'OFF';

    z2LedRed.className = 'actuator-led led-red active';
    z2LedRedState.className = 'actuator-state text-danger';
    z2LedRedState.textContent = 'ON (LEAK)';
  } else {
    z2LedGreen.className = 'actuator-led led-green active';
    z2LedGreenState.className = 'actuator-state text-safe';
    z2LedGreenState.textContent = 'ON (Safe)';

    z2LedRed.className = 'actuator-led led-red inactive';
    z2LedRedState.className = 'actuator-state text-muted';
    z2LedRedState.textContent = 'OFF';
  }

  // Physical Buzzer (GPIO 5)
  if (zone1.is_leak || zone2.is_leak) {
    buzzerIconWrap.className = 'hw-device-icon active-buzzer';
    buzzerStatusLabel.className = 'hw-device-status status-on';
    buzzerStatusLabel.textContent = 'ACTIVE (BUZZER ON)';
  } else {
    buzzerIconWrap.className = 'hw-device-icon';
    buzzerStatusLabel.className = 'hw-device-status status-off';
    buzzerStatusLabel.textContent = 'INACTIVE (OFF)';
  }

  if (hwSyncBadge) {
    hwSyncBadge.innerHTML = '<i class="fa-solid fa-check"></i> Hardware Synced';
  }

  // LCD 16x2 Exact Output Matching ESP32 Firmware
  const z1Str = zone1.is_leak ? 'Leak   ' : 'No Leak';
  const z2Str = zone2.is_leak ? 'Leak   ' : 'No Leak';
  lcdLine1.textContent = 'Zone1 - Zone2   ';
  lcdLine2.textContent = `${z1Str} ${z2Str}`.padEnd(16, ' ');
}

function updateSerialCardUI(serial) {
  const btnConnect = document.getElementById('btnDirectConnect');
  const btnDisconnect = document.getElementById('btnDirectDisconnect');
  const feedback = document.getElementById('serialDirectFeedback');

  if (serial.is_connected) {
    if (btnConnect) btnConnect.classList.add('hidden');
    if (btnDisconnect) btnDisconnect.classList.remove('hidden');
    if (feedback) {
      feedback.className = 'serial-feedback-box connected';
      feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected to ${serial.port} at 9600 Baud. Streaming sensor data.`;
    }
  } else {
    if (btnConnect) btnConnect.classList.remove('hidden');
    if (btnDisconnect) btnDisconnect.classList.add('hidden');
    if (feedback) {
      feedback.className = 'serial-feedback-box';
      feedback.innerHTML = `<i class="fa-solid fa-circle-info"></i> ESP32 is disconnected. Select a COM port above and click Connect.`;
    }
  }
}

function renderDisconnectedUI() {
  document.getElementById('serialStatusLabel').textContent = 'Disconnected';
  document.getElementById('systemStatusBanner').className = 'system-status-banner status-disconnected';
  document.getElementById('systemStatusTitle').textContent = 'SERVER DISCONNECTED';
}

// =============================================================================
// SQLITE EVENT LOGS MANAGEMENT
// =============================================================================
function fetchEventLogs() {
  const zone = document.getElementById('eventZoneFilter')?.value || 'ALL';
  const severity = document.getElementById('eventSeverityFilter')?.value || 'ALL';

  fetch(`/api/events?limit=40&zone=${encodeURIComponent(zone)}&severity=${encodeURIComponent(severity)}`)
    .then(res => res.json())
    .then(data => {
      renderEventsTable(data.events || []);
    })
    .catch(err => console.error('Error fetching events:', err));
}

function renderEventsTable(events) {
  const tbody = document.getElementById('eventsTableBody');
  const countLabel = document.getElementById('eventsCountLabel');
  if (!tbody) return;

  if (countLabel) {
    countLabel.textContent = `Showing ${events.length} recorded events`;
  }

  if (events.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4 text-muted">
          <i class="fa-solid fa-circle-info"></i> No event logs recorded yet. Genuine leak alerts and connection events will appear here.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  events.forEach(ev => {
    let badgeClass = 'badge-info';
    if (ev.severity === 'DANGER') badgeClass = 'badge-danger';
    else if (ev.severity === 'SUCCESS') badgeClass = 'badge-success';
    else if (ev.severity === 'WARNING') badgeClass = 'badge-warning';

    const ackBadge = ev.is_acknowledged 
      ? '<span class="text-safe"><i class="fa-solid fa-check"></i> Ack</span>' 
      : (ev.severity === 'DANGER' ? '<span class="text-danger font-bold">ACTIVE</span>' : '<span class="text-muted">--</span>');

    html += `
      <tr>
        <td class="mono-text">${ev.timestamp}</td>
        <td><strong>${ev.zone}</strong></td>
        <td class="mono-text">${ev.reading_value !== null && ev.reading_value !== undefined ? ev.reading_value + ' ADC' : '--'}</td>
        <td class="mono-text">${ev.threshold_value !== null && ev.threshold_value !== undefined ? ev.threshold_value : '--'}</td>
        <td><span class="event-type-badge ${badgeClass}">${ev.event_type}</span></td>
        <td>${ev.message}</td>
        <td>${ackBadge}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// =============================================================================
// SERIAL COM PORT DISCOVERY & CONNECTION MANAGEMENT
// =============================================================================
function refreshAllSerialPorts() {
  const directSelect = document.getElementById('directPortSelect');
  const modalSelect = document.getElementById('serialPortSelect');

  const placeholder = '<option value="">Scanning for COM ports...</option>';
  if (directSelect) directSelect.innerHTML = placeholder;
  if (modalSelect) modalSelect.innerHTML = placeholder;

  fetch('/api/serial/ports')
    .then(res => res.json())
    .then(data => {
      const ports = data.ports || [];
      populatePortSelect(directSelect, ports);
      populatePortSelect(modalSelect, ports);
    })
    .catch(err => {
      console.error('Error listing serial ports:', err);
    });
}

function populatePortSelect(selectEl, ports) {
  if (!selectEl) return;
  selectEl.innerHTML = '';

  if (ports.length === 0) {
    selectEl.innerHTML = '<option value="">No COM ports detected (Plug in ESP32)</option>';
    return;
  }

  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.port;
    opt.textContent = `${p.port} - ${p.description}`;
    selectEl.appendChild(opt);
  });
}

function connectDirectSerial() {
  const port = document.getElementById('directPortSelect').value;
  const feedback = document.getElementById('serialDirectFeedback');

  if (!port) {
    if (feedback) {
      feedback.className = 'serial-feedback-box error';
      feedback.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Please select a valid COM port.';
    }
    return;
  }

  if (feedback) {
    feedback.className = 'serial-feedback-box';
    feedback.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to ESP32 on ' + port + '...';
  }

  fetch('/api/serial/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: port, baud_rate: 9600 })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      fetchSystemStatus();
      fetchEventLogs();
    } else {
      if (feedback) {
        feedback.className = 'serial-feedback-box error';
        feedback.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Connection failed: ${data.message}. (Ensure Arduino Serial Monitor is closed).`;
      }
    }
  })
  .catch(err => {
    if (feedback) {
      feedback.className = 'serial-feedback-box error';
      feedback.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error: ${err.message}`;
    }
  });
}

function disconnectDirectSerial() {
  fetch('/api/serial/disconnect', { method: 'POST' })
    .then(res => res.json())
    .then(() => {
      fetchSystemStatus();
      fetchEventLogs();
    });
}

// Modal Handlers
function openSerialModal() {
  document.getElementById('serialModal').classList.remove('hidden');
  refreshAllSerialPorts();
}

function closeSerialModal() {
  document.getElementById('serialModal').classList.add('hidden');
}

function connectSerialFromModal() {
  const port = document.getElementById('serialPortSelect').value;
  const baud = document.getElementById('baudRateSelect').value;
  const feedback = document.getElementById('serialModalFeedback');

  if (!port) {
    feedback.className = 'modal-status-feedback error';
    feedback.textContent = 'Please select a valid COM port.';
    return;
  }

  feedback.className = 'modal-status-feedback';
  feedback.textContent = 'Connecting to ESP32...';

  fetch('/api/serial/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: port, baud_rate: baud })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      feedback.className = 'modal-status-feedback success';
      feedback.textContent = `Connected successfully to ${port}`;
      document.getElementById('btnModalDisconnect').classList.remove('hidden');
      setTimeout(closeSerialModal, 1200);
      fetchSystemStatus();
      fetchEventLogs();
    } else {
      feedback.className = 'modal-status-feedback error';
      feedback.textContent = data.message + ' (Close Arduino Serial Monitor first)';
    }
  })
  .catch(err => {
    feedback.className = 'modal-status-feedback error';
    feedback.textContent = `Connection failed: ${err.message}`;
  });
}

function disconnectSerialFromModal() {
  fetch('/api/serial/disconnect', { method: 'POST' })
    .then(res => res.json())
    .then(() => {
      const feedback = document.getElementById('serialModalFeedback');
      feedback.className = 'modal-status-feedback success';
      feedback.textContent = 'Disconnected from serial port.';
      document.getElementById('btnModalDisconnect').classList.add('hidden');
      fetchSystemStatus();
      fetchEventLogs();
    });
}

// Zone Rename Modal
function openRenameModal(zoneIdx) {
  systemState.renameZoneIndex = zoneIdx;
  document.getElementById('renameLabel').textContent = `Zone ${zoneIdx} Custom Display Name:`;
  const currentName = document.getElementById(`zone${zoneIdx}Title`).textContent;
  document.getElementById('renameInput').value = currentName;
  document.getElementById('renameModal').classList.remove('hidden');
}

function closeRenameModal() {
  document.getElementById('renameModal').classList.add('hidden');
}

function saveZoneName() {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName) return;

  const payload = {};
  payload[`zone${systemState.renameZoneIndex}_name`] = newName;

  fetch('/api/zones/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(() => {
    closeRenameModal();
    fetchSystemStatus();
  });
}
