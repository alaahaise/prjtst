import { toRaw, markRaw } from 'vue';
import Chart from 'chart.js';

// Shared look for every chart in the app
Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6c6c78';
Chart.defaults.borderColor = '#f2f2f4';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.boxHeight = 8;
Chart.defaults.plugins.tooltip.backgroundColor = '#15151b';
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;

// Thin Vue wrapper around Chart.js. Pass `type`, `data` and `options` exactly as in the Chart.js docs.
export default {
  name: 'ChartCanvas',
  props: {
    type: { type: String, default: 'bar' },
    data: { type: Object, required: true },
    options: { type: Object, default: () => ({}) },
    height: { type: Number, default: 300 }
  },
  mounted() { this.draw(); },
  beforeUnmount() { if (this.chart) this.chart.destroy(); },
  watch: {
    data() { this.draw(); },
    options() { this.draw(); }
  },
  methods: {
    draw() {
      if (this.chart) this.chart.destroy();
      this.chart = markRaw(new Chart(this.$refs.canvas, {
        type: this.type,
        data: toRaw(this.data),
        options: { responsive: true, maintainAspectRatio: false, ...toRaw(this.options) }
      }));
    }
  },
  template: `<div class="chart-box" :style="{ height: height + 'px' }"><canvas ref="canvas"></canvas></div>`
};
