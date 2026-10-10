/**
 * =============================================================================
 * CHART HANDLER - REAL-TIME SENSOR TIME-SERIES WITH CHART.JS
 * =============================================================================
 */

class RealTimeSensorChart {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.chart = null;
    this.maxDataPoints = 30; // Default: 30 seconds
    this.isPaused = false;
    this.activeThreshold = 1000;
  }

  init(initialThreshold = 1000) {
    this.activeThreshold = initialThreshold;
    const ctx = document.getElementById(this.canvasId).getContext('2d');

    // Create subtle gradient fills for under the lines
    const gradientZ1 = ctx.createLinearGradient(0, 0, 0, 320);
    gradientZ1.addColorStop(0, 'rgba(0, 229, 255, 0.28)');
    gradientZ1.addColorStop(1, 'rgba(0, 229, 255, 0.00)');

    const gradientZ2 = ctx.createLinearGradient(0, 0, 0, 320);
    gradientZ2.addColorStop(0, 'rgba(255, 159, 67, 0.28)');
    gradientZ2.addColorStop(1, 'rgba(255, 159, 67, 0.00)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Zone 1 (Storage Tank)',
            data: [],
            borderColor: '#00e5ff',
            backgroundColor: gradientZ1,
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#00e5ff',
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Zone 2 (Dispensing Unit)',
            data: [],
            borderColor: '#ff9f43',
            backgroundColor: gradientZ2,
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ff9f43',
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Leak Threshold',
            data: [],
            borderColor: '#ff3b5c',
            borderWidth: 2,
            borderDash: [6, 6],
            pointRadius: 0,
            fill: false,
            tension: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false // Using custom styled legend in dashboard UI
          },
          tooltip: {
            backgroundColor: 'rgba(16, 26, 48, 0.95)',
            titleColor: '#f0f6fc',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            titleFont: { family: 'Outfit', size: 13, weight: 'bold' },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || '';
                let val = context.parsed.y;
                return ` ${label}: ${val} ADC`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          },
          y: {
            min: 0,
            suggestedMax: 2500,
            grid: {
              color: 'rgba(255, 255, 255, 0.06)',
              drawBorder: false
            },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 11 },
              callback: function(value) {
                return value + ' ADC';
              }
            }
          }
        }
      }
    });
  }

  preloadHistory(readings) {
    if (!this.chart || !readings || readings.length === 0) return;

    this.chart.data.labels = [];
    this.chart.data.datasets[0].data = [];
    this.chart.data.datasets[1].data = [];
    this.chart.data.datasets[2].data = [];

    readings.forEach(r => {
      const timeLabel = (r.timestamp || '').split(' ')[1] || r.timestamp;
      this.chart.data.labels.push(timeLabel);
      this.chart.data.datasets[0].data.push(r.zone1_val);
      this.chart.data.datasets[1].data.push(r.zone2_val);
      this.chart.data.datasets[2].data.push(this.activeThreshold);
    });

    // Trim to current window if needed
    while (this.chart.data.labels.length > this.maxDataPoints) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
      this.chart.data.datasets[1].data.shift();
      this.chart.data.datasets[2].data.shift();
    }

    this.chart.update('none');
  }

  addPoint(timeLabel, z1Val, z2Val, threshold) {
    if (!this.chart || this.isPaused) return;
    if (z1Val === null || z2Val === null || z1Val === undefined || z2Val === undefined) return;

    if (threshold !== undefined) {
      this.activeThreshold = threshold;
    }

    const labels = this.chart.data.labels;
    const dsZ1 = this.chart.data.datasets[0].data;
    const dsZ2 = this.chart.data.datasets[1].data;
    const dsThresh = this.chart.data.datasets[2].data;

    labels.push(timeLabel);
    dsZ1.push(z1Val);
    dsZ2.push(z2Val);
    dsThresh.push(this.activeThreshold);

    // Limit visible points to maxDataPoints
    while (labels.length > this.maxDataPoints) {
      labels.shift();
      dsZ1.shift();
      dsZ2.shift();
      dsThresh.shift();
    }

    // Dynamic Y-axis scale if values spike high
    const maxCurrentVal = Math.max(...dsZ1, ...dsZ2, this.activeThreshold);
    if (maxCurrentVal > 2200) {
      this.chart.options.scales.y.suggestedMax = Math.min(4095, Math.ceil(maxCurrentVal * 1.15));
    } else {
      this.chart.options.scales.y.suggestedMax = 2500;
    }

    this.chart.update();
  }

  updateThreshold(newThreshold) {
    this.activeThreshold = newThreshold;
    if (!this.chart) return;
    
    // Update all existing threshold points
    this.chart.data.datasets[2].data = this.chart.data.datasets[2].data.map(() => newThreshold);
    this.chart.update('none');
  }

  setTimeWindow(seconds) {
    this.maxDataPoints = seconds;
    if (this.chart) {
      while (this.chart.data.labels.length > this.maxDataPoints) {
        this.chart.data.labels.shift();
        this.chart.data.datasets[0].data.shift();
        this.chart.data.datasets[1].data.shift();
        this.chart.data.datasets[2].data.shift();
      }
      this.chart.update();
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  clear() {
    if (!this.chart) return;
    this.chart.data.labels = [];
    this.chart.data.datasets[0].data = [];
    this.chart.data.datasets[1].data = [];
    this.chart.data.datasets[2].data = [];
    this.chart.update();
  }

  exportImage() {
    if (!this.chart) return;
    const imageURI = this.chart.toBase64Image();
    const link = document.createElement('a');
    link.download = `petrol_leak_chart_${Date.now()}.png`;
    link.href = imageURI;
    link.click();
  }
}

// Global chart instance
window.sensorChart = new RealTimeSensorChart('liveSensorChart');
