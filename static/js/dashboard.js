/**
 * =============================================================================
 * DASHBOARD CONTROLLER - REAL-TIME HARDWARE TELEMETRY & EVENT MANAGEMENT
 * =============================================================================
 */

// Global State
let systemState = {
  alarmAcknowledged: false,
  zone1Stats: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  zone2Stats: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  renameZoneIndex: 1,
  // Alert notification tracking to avoid duplicate notifications
  activeAlerts: { zone1: false, zone2: false },
  lastAlertState: { zone1: null, zone2: null },
  recoveryTimer: null
};

// =============================================================================
// DOM INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Live Sensor Chart (starts clean with no mock data)
  window.sensorChart.init(1000);

  // Preload genuine historical readings if any exist in SQLite
  fetch('/api/readings/recent?limit=40')
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
    .then(data => {
      if (data && data.status === 'success' && data.readings && data.readings.length > 0) {
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
  // Alarm Acknowledgement Buttons
  const btnAckAlarms = document.getElementById('btnAckAlarms');
  const btnAlertAck = document.getElementById('btnAlertAck');
  const handleAck = () => {
    systemState.alarmAcknowledged = true;
    
    fetch('/api/alarm/acknowledge', { method: 'POST' })
      .then(res => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        return res.json();
      })
      .then(() => {
        fetchEventLogs();
        const saveStatus = document.getElementById('thresholdSaveStatus');
        if (saveStatus) {
          saveStatus.textContent = 'Alarms acknowledged (Leak condition remains active until safe).';
          setTimeout(() => { saveStatus.textContent = ''; }, 4000);
        }
      });
  };
  if (btnAckAlarms) btnAckAlarms.addEventListener('click', handleAck);
  if (btnAlertAck) btnAlertAck.addEventListener('click', handleAck);

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
      .then(res => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        return res.json();
      })
      .then(data => {
        if (data && data.status === 'success') {
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
          .then(res => {
            if (res.status === 401) { window.location.href = '/login'; return null; }
            return res.json();
          })
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

  // Recovery banner dismiss
  const btnDismissRecovery = document.getElementById('btnDismissRecovery');
  if (btnDismissRecovery) {
    btnDismissRecovery.addEventListener('click', () => {
      document.getElementById('recoveryBanner').classList.add('hidden');
    });
  }
}

// =============================================================================
// STATUS FETCH & UI UPDATE
// =============================================================================
function fetchSystemStatus() {
  fetch('/api/status')
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
    .then(data => {
      if (data) updateDashboardUI(data);
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
    systemState.alarmAcknowledged = false;
  } else if (system.is_waiting) {
    banner.classList.add('status-waiting');
    bannerTitle.textContent = 'WAITING FOR ESP32 DATA';
    bannerDesc.textContent = 'Serial link is established. Listening on 9600 baud for gas1_val and gas2_val transmissions...';
    bannerIcon.className = 'fa-solid fa-clock';
    statusUpdateTime.textContent = 'Awaiting Telemetry';
    systemState.alarmAcknowledged = false;
  } else if (system.is_stale) {
    banner.classList.add('status-stale');
    bannerTitle.textContent = 'SENSOR DATA UNAVAILABLE';
    bannerDesc.textContent = 'Telemetry timeout: No fresh data received from gas sensors in over 3.5 seconds. Check hardware wiring.';
    bannerIcon.className = 'fa-solid fa-triangle-exclamation';
    statusUpdateTime.textContent = 'Telemetry Timeout';
    systemState.alarmAcknowledged = false;
  } else if (system.is_leak) {
    banner.classList.add('status-leak');
    bannerTitle.textContent = system.message;
    bannerDesc.textContent = 'URGENT: Hydrocarbon / flammable vapour concentration has crossed safe operating limits. Inspect designated zone immediately.';
    bannerIcon.className = 'fa-solid fa-triangle-exclamation';
    statusUpdateTime.textContent = 'CRITICAL ALERT';
  } else {
    // Genuine All Safe
    banner.classList.add('status-safe');
    bannerTitle.textContent = 'ALL ZONES SAFE';
    bannerDesc.textContent = 'Both monitoring zones are reporting real sensor concentrations within normal baseline safety limits.';
    bannerIcon.className = 'fa-solid fa-circle-check';
    statusUpdateTime.textContent = 'Active Monitoring';
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

  // 7. Update Summary Cards
  updateSummaryCards(zone1, zone2, serial, system);

  // 8. Update Leakage Alert Notification
  updateLeakageAlert(zone1, zone2, threshold, serial, system);

  // Update Direct Card serial UI
  updateSerialCardUI(serial);
}

// =============================================================================
// SUMMARY CARDS UPDATE
// =============================================================================
function updateSummaryCards(zone1, zone2, serial, system) {
  const z1Status = document.getElementById('summaryZ1Status');
  const z2Status = document.getElementById('summaryZ2Status');
  const alertCount = document.getElementById('summaryAlertCount');
  const connStatus = document.getElementById('summaryConnStatus');

  const z1Card = document.getElementById('summaryZ1Card');
  const z2Card = document.getElementById('summaryZ2Card');
  const alertsCard = document.getElementById('summaryAlertsCard');
  const connCard = document.getElementById('summaryConnCard');

  // Zone 1
  z1Card.className = 'summary-card';
  if (zone1.is_leak) {
    z1Status.textContent = 'LEAK DETECTED';
    z1Card.classList.add('summary-leak');
  } else if (zone1.is_safe) {
    z1Status.textContent = 'SAFE';
    z1Card.classList.add('summary-safe');
  } else {
    z1Status.textContent = 'UNAVAILABLE';
    z1Card.classList.add('summary-unavailable');
  }

  // Zone 2
  z2Card.className = 'summary-card';
  if (zone2.is_leak) {
    z2Status.textContent = 'LEAK DETECTED';
    z2Card.classList.add('summary-leak');
  } else if (zone2.is_safe) {
    z2Status.textContent = 'SAFE';
    z2Card.classList.add('summary-safe');
  } else {
    z2Status.textContent = 'UNAVAILABLE';
    z2Card.classList.add('summary-unavailable');
  }

  // Alert count
  let activeAlertCount = 0;
  if (zone1.is_leak) activeAlertCount++;
  if (zone2.is_leak) activeAlertCount++;
  alertCount.textContent = activeAlertCount;
  alertsCard.className = 'summary-card';
  if (activeAlertCount > 0) {
    alertsCard.classList.add('summary-leak');
  } else {
    alertsCard.classList.add('summary-safe');
  }

  // Connection
  connCard.className = 'summary-card';
  if (serial.is_connected && !system.is_stale) {
    connStatus.textContent = 'Online';
    connCard.classList.add('summary-safe');
  } else if (serial.is_connected) {
    connStatus.textContent = 'Stale Data';
    connCard.classList.add('summary-unavailable');
  } else {
    connStatus.textContent = 'Disconnected';
    connCard.classList.add('summary-unavailable');
  }
}

// =============================================================================
// LEAKAGE ALERT NOTIFICATION SYSTEM
// =============================================================================
function updateLeakageAlert(zone1, zone2, threshold, serial, system) {
  const alertBanner = document.getElementById('leakAlertBanner');
  const alertTitle = document.getElementById('leakAlertTitle');
  const alertMessage = document.getElementById('leakAlertMessage');
  const alertDetails = document.getElementById('leakAlertDetails');
  const recoveryBanner = document.getElementById('recoveryBanner');
  const recoveryMessage = document.getElementById('recoveryMessage');

  // If not connected or data unavailable, hide alerts and show appropriate warning
  if (!serial.is_connected || system.is_stale || system.is_waiting) {
    alertBanner.classList.add('hidden');
    // Reset tracking when disconnected so we detect transitions again on reconnect
    systemState.lastAlertState.zone1 = null;
    systemState.lastAlertState.zone2 = null;
    systemState.activeAlerts.zone1 = false;
    systemState.activeAlerts.zone2 = false;
    return;
  }

  const z1Leak = zone1.is_leak;
  const z2Leak = zone2.is_leak;
  const anyLeak = z1Leak || z2Leak;
  const prevZ1 = systemState.lastAlertState.zone1;
  const prevZ2 = systemState.lastAlertState.zone2;

  // Detect NEW leak transitions (false->true)
  const z1NewLeak = z1Leak && prevZ1 === false;
  const z2NewLeak = z2Leak && prevZ2 === false;

  // Detect RECOVERY transitions (true->false)
  const z1Recovery = !z1Leak && prevZ1 === true;
  const z2Recovery = !z2Leak && prevZ2 === true;

  // Show recovery notification for transitions
  if (z1Recovery || z2Recovery) {
    let recoveryZones = [];
    if (z1Recovery) recoveryZones.push('Zone 1');
    if (z2Recovery) recoveryZones.push('Zone 2');
    recoveryMessage.textContent = `✅ ${recoveryZones.join(' & ')} returned to safe operating range. Sensor readings are now below the configured threshold.`;
    recoveryBanner.classList.remove('hidden');
    // Auto-dismiss after 8 seconds
    if (systemState.recoveryTimer) clearTimeout(systemState.recoveryTimer);
    systemState.recoveryTimer = setTimeout(() => {
      recoveryBanner.classList.add('hidden');
    }, 8000);
  }

  // Update tracking state
  systemState.lastAlertState.zone1 = z1Leak;
  systemState.lastAlertState.zone2 = z2Leak;
  systemState.activeAlerts.zone1 = z1Leak;
  systemState.activeAlerts.zone2 = z2Leak;

  // Show or update leak alert banner
  if (anyLeak) {
    const now = new Date().toLocaleTimeString();
    let leakZones = [];
    let detailsHtml = '';

    if (z1Leak) {
      leakZones.push('Zone 1');
      detailsHtml += `<div class="alert-detail-row">
        <span class="alert-zone-tag">Zone 1</span>
        <span class="alert-reading">Reading: <strong>${Math.round(zone1.value)}</strong> ADC</span>
        <span class="alert-threshold">Threshold: <strong>${Math.round(threshold)}</strong> ADC</span>
        <span class="alert-time">Detected: ${now}</span>
      </div>`;
    }
    if (z2Leak) {
      leakZones.push('Zone 2');
      detailsHtml += `<div class="alert-detail-row">
        <span class="alert-zone-tag zone2-tag">Zone 2</span>
        <span class="alert-reading">Reading: <strong>${Math.round(zone2.value)}</strong> ADC</span>
        <span class="alert-threshold">Threshold: <strong>${Math.round(threshold)}</strong> ADC</span>
        <span class="alert-time">Detected: ${now}</span>
      </div>`;
    }

    alertTitle.textContent = `⚠️ PETROL LEAKAGE ALERT — ${leakZones.join(' & ')}`;
    alertMessage.textContent = `Possible gas/vapour leakage detected in ${leakZones.join(' and ')}. Please inspect the affected area safely and verify sensor readings.`;
    alertDetails.innerHTML = detailsHtml;
    alertBanner.classList.remove('hidden');
  } else {
    alertBanner.classList.add('hidden');
  }
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
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
    .then(data => {
      if (data) renderEventsTable(data.events || []);
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
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
    .then(data => {
      if (data) {
        const ports = data.ports || [];
        populatePortSelect(directSelect, ports);
        populatePortSelect(modalSelect, ports);
      }
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
  .then(res => {
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  })
  .then(data => {
    if (data && data.status === 'success') {
      fetchSystemStatus();
      fetchEventLogs();
    } else if (data) {
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
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
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
  .then(res => {
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  })
  .then(data => {
    if (data && data.status === 'success') {
      feedback.className = 'modal-status-feedback success';
      feedback.textContent = `Connected successfully to ${port}`;
      document.getElementById('btnModalDisconnect').classList.remove('hidden');
      setTimeout(closeSerialModal, 1200);
      fetchSystemStatus();
      fetchEventLogs();
    } else if (data) {
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
    .then(res => {
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res.json();
    })
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
  .then(res => {
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  })
  .then(() => {
    closeRenameModal();
    fetchSystemStatus();
  });
}

// =============================================================================
// AI SAFETY ADVISOR & HAZMAT INCIDENT RESPONSE (OPENAI)
// =============================================================================
let currentAiTargetZone = '';

function openAiAdvisorModal() {
  const modal = document.getElementById('aiAdvisorModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  fetchAiAnalysis();
}

function closeAiAdvisorModal() {
  const modal = document.getElementById('aiAdvisorModal');
  if (modal) modal.classList.add('hidden');
}

function selectAiTarget(zone) {
  currentAiTargetZone = zone;
  
  // Update button active states
  const btnAuto = document.getElementById('btnAiTargetAuto');
  const btnZ1 = document.getElementById('btnAiTargetZ1');
  const btnZ2 = document.getElementById('btnAiTargetZ2');

  if (btnAuto) btnAuto.classList.toggle('active', zone === '');
  if (btnZ1) btnZ1.classList.toggle('active', zone === 'Zone 1');
  if (btnZ2) btnZ2.classList.toggle('active', zone === 'Zone 2');

  fetchAiAnalysis();
}

function fetchAiAnalysis() {
  const loadingEl = document.getElementById('aiLoadingState');
  const contentEl = document.getElementById('aiContentState');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');

  const payload = {};
  if (currentAiTargetZone) {
    payload.zone = currentAiTargetZone;
  }

  fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    return res.json();
  })
  .then(data => {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    if (!data) return;

    renderAiAnalysis(data);
  })
  .catch(err => {
    console.error('Error fetching AI analysis:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    const summaryText = document.getElementById('aiSummaryText');
    if (summaryText) {
      summaryText.textContent = `Unable to generate AI analysis: ${err.message}. Please verify server status.`;
    }
  });
}

function renderAiAnalysis(data) {
  // Severity Badge
  const badge = document.getElementById('aiSeverityBadge');
  if (badge) {
    const sev = data.severity_level || 'ELEVATED';
    badge.className = `ai-severity-badge-large ai-severity-${sev}`;
    badge.textContent = `${sev} HAZARD LEVEL`;
  }

  // Meta Info
  const meta = document.getElementById('aiMetaInfo');
  if (meta) {
    const zoneName = data.zone_analyzed || 'Active Incident';
    const reading = data.reading !== undefined ? Math.round(data.reading) : '--';
    const thresh = data.threshold !== undefined ? Math.round(data.threshold) : '--';
    meta.textContent = `${zoneName} | Reading: ${reading} ADC | Threshold: ${thresh} ADC`;
  }

  // Summary Box
  const summary = document.getElementById('aiSummaryText');
  if (summary) {
    summary.textContent = data.summary || 'Emergency incident assessment active.';
  }

  // Flammability Risk
  const flam = document.getElementById('aiFlammabilityRisk');
  if (flam) {
    flam.textContent = data.flammability_risk || 'Hydrocarbon vapors present. Maintain ignition control.';
  }

  // Evacuation Radius
  const evac = document.getElementById('aiEvacuationRadius');
  if (evac) {
    evac.textContent = data.evacuation_radius || 'Restrict area access to emergency personnel.';
  }

  // PPE Guidance
  const ppe = document.getElementById('aiPpeGuidance');
  if (ppe) {
    ppe.textContent = data.ppe_guidance || 'Standard organic vapor respirator, antistatic PPE.';
  }

  // Action Checklist
  const actionList = document.getElementById('aiActionList');
  if (actionList) {
    actionList.innerHTML = '';
    const actions = data.immediate_actions || [];
    actions.forEach((act, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <input type="checkbox" id="aiCheck_${idx}">
        <label for="aiCheck_${idx}">${act}</label>
      `;
      actionList.appendChild(li);
    });
  }

  // Source & Note Labels
  const sourceLabel = document.getElementById('aiSourceLabel');
  if (sourceLabel) {
    if (data.source && data.source.startsWith('OPENAI')) {
      sourceLabel.textContent = `Live Analysis: ${data.source.replace('OPENAI_', 'OpenAI ')}`;
    } else {
      sourceLabel.textContent = 'Certified Industrial HAZMAT Emergency Protocol';
    }
  }

  const noteLabel = document.getElementById('aiNoteLabel');
  if (noteLabel) {
    noteLabel.textContent = data.note || '';
  }
}

