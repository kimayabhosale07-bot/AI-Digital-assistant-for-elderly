(() => {
  'use strict';

  const metrics = {
    blood_pressure: { title: 'Blood pressure', valueLabel: 'Systolic and diastolic', units: ['mmHg'] },
    heart_rate: { title: 'Heart rate', valueLabel: 'Heart rate', units: ['bpm'] },
    blood_sugar: { title: 'Blood sugar', valueLabel: 'Blood sugar', units: ['mg/dL', 'mmol/L'] },
    body_temperature: { title: 'Body temperature', valueLabel: 'Temperature', units: ['°C', '°F'] },
    oxygen_saturation: { title: 'Oxygen saturation (SpO₂)', valueLabel: 'Oxygen saturation', units: ['%'] },
  };
  const filters = Object.fromEntries(Object.keys(metrics).map(type => [type, 30]));
  let stepsDays = 30;
  let profileId = null;
  let records = [];
  let initialized = false;

  function normalizeRecord(record) {
    if (record.type) return record;
    if (record.heartRate !== undefined) return { ...record, type: 'heart_rate', value: record.heartRate, unit: 'bpm' };
    return null;
  }

  function filterHealthHistory(history, type, days, now = Date.now(), ownerId = profileId) {
    const start = now - days * 24 * 60 * 60 * 1000;
    return history.map(normalizeRecord).filter(record => {
      if (!record || record.type !== type || record.userId !== ownerId) return false;
      const timestamp = Date.parse(record.timestamp);
      return Number.isFinite(timestamp) && timestamp >= start && timestamp <= now;
    }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  function filterStepsHistory(history, days, now = Date.now(), ownerId = profileId) {
    const start = now - days * 24 * 60 * 60 * 1000;
    return history.map(record => {
      if (!record || record.userId !== ownerId) return null;
      if (record.type === 'steps') return record;
      if (Number.isInteger(record.steps) && record.steps >= 0) return { ...record, type: 'steps', value: record.steps, unit: 'steps' };
      return null;
    }).filter(record => {
      if (!record) return false;
      const timestamp = Date.parse(record.timestamp);
      const value = record.value ?? record.steps;
      return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100000
        && Number.isFinite(timestamp) && timestamp >= start && timestamp <= now;
    }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function timestampLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function readingLabel(record) {
    if (record.type === 'blood_pressure') return `${record.systolic}/${record.diastolic} ${record.unit}`;
    return `${record.value} ${record.unit}`;
  }

  function buildChartCards() {
    const grid = document.getElementById('health-chart-grid');
    grid.innerHTML = Object.entries(metrics).map(([type, metric]) => `<section class="health-chart-card" aria-labelledby="health-title-${type}">
      <div class="health-chart-heading"><div><h2 id="health-title-${type}">${escapeHtml(metric.title)}</h2><p>Each point is a saved measurement; multiple readings on one day remain separate.</p></div>
      <div class="health-range" role="group" aria-label="${escapeHtml(metric.title)} date range">
        <button type="button" data-range-type="${type}" data-days="7" aria-pressed="false">7 days</button>
        <button type="button" data-range-type="${type}" data-days="30" aria-pressed="true">30 days</button>
        <button type="button" data-range-type="${type}" data-days="90" aria-pressed="false">90 days</button>
      </div></div>
      <div class="health-chart" data-chart="${type}"></div><div class="health-legend" data-legend="${type}" aria-label="Chart legend"></div>
      <h3 class="health-readings-title">Readings and timestamps</h3><ol class="health-reading-list" data-readings="${type}"></ol>
    </section>`).join('');
  }

  function chartSeries(history, type) {
    if (type === 'blood_pressure') return [
      { name: 'Systolic (mmHg)', points: history.map(record => ({ timestamp: Date.parse(record.timestamp), value: record.systolic, label: `${record.systolic} mmHg` })) },
      { name: 'Diastolic (mmHg)', points: history.map(record => ({ timestamp: Date.parse(record.timestamp), value: record.diastolic, label: `${record.diastolic} mmHg` })) },
    ];
    const byUnit = new Map();
    history.forEach(record => {
      if (!byUnit.has(record.unit)) byUnit.set(record.unit, []);
      byUnit.get(record.unit).push({ timestamp: Date.parse(record.timestamp), value: record.value, label: `${record.value} ${record.unit}` });
    });
    return [...byUnit].map(([unit, points]) => ({ name: unit, points }));
  }

  function renderChart(type, days) {
    const container = document.querySelector(`[data-chart="${type}"]`);
    const legend = document.querySelector(`[data-legend="${type}"]`);
    const readingList = document.querySelector(`[data-readings="${type}"]`);
    const history = filterHealthHistory(records, type, days);
    if (!history.length) {
      container.innerHTML = '<p class="health-empty">No readings recorded in this period.</p>';
      legend.innerHTML = '';
      readingList.innerHTML = '';
      return;
    }

    const series = chartSeries(history, type);
    const points = series.flatMap(item => item.points);
    const values = points.map(point => point.value);
    let low = Math.min(...values);
    let high = Math.max(...values);
    const pad = Math.max((high - low) * 0.12, Math.abs(high) * 0.05, 1);
    low -= pad;
    high += pad;
    const left = 52, right = 700, top = 24, bottom = 198;
    const earliest = Date.now() - days * 86400000;
    const x = timestamp => left + ((timestamp - earliest) / (Date.now() - earliest)) * (right - left);
    const y = value => bottom - ((value - low) / (high - low)) * (bottom - top);
    const grid = [0, 1, 2, 3].map(index => {
      const gy = top + index * (bottom - top) / 3;
      const value = high - index * (high - low) / 3;
      return `<line x1="${left}" y1="${gy}" x2="${right}" y2="${gy}" stroke="#E6DED5"/><text x="${left - 8}" y="${gy + 4}" text-anchor="end" fill="#625B55" font-size="12">${Number(value.toPrecision(3))}</text>`;
    }).join('');
    const plotted = series.map((item, seriesIndex) => {
      const color = seriesIndex % 2 === 0 ? '#A44737' : '#66806A';
      const ordered = item.points.slice().sort((a, b) => a.timestamp - b.timestamp);
      const line = ordered.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="3" points="${ordered.map(point => `${x(point.timestamp)},${y(point.value)}`).join(' ')}"/>` : '';
      const dots = ordered.map(point => `<circle cx="${x(point.timestamp)}" cy="${y(point.value)}" r="5" fill="${color}"><title>${escapeHtml(timestampLabel(point.timestamp))}: ${escapeHtml(point.label)}</title></circle>`).join('');
      return line + dots;
    }).join('');
    container.innerHTML = `<svg viewBox="0 0 720 230" role="img" aria-label="${escapeHtml(metrics[type].title)} history over ${days} days. Exact timestamps and values are listed below.">${grid}<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#80766D"/><text x="${left}" y="220" fill="#625B55" font-size="12">${days} days ago</text><text x="${right}" y="220" text-anchor="end" fill="#625B55" font-size="12">Now</text>${plotted}</svg>`;
    legend.innerHTML = series.map((item, index) => `<span class="health-legend-item"><i style="background:${index % 2 === 0 ? '#A44737' : '#66806A'}"></i>${escapeHtml(item.name)}</span>`).join('');
    readingList.innerHTML = history.slice().reverse().map(record => `<li><time datetime="${escapeHtml(record.timestamp)}">${escapeHtml(timestampLabel(record.timestamp))}</time><strong>${escapeHtml(readingLabel(record))}</strong>${record.context ? `<span>${escapeHtml(record.context.replaceAll('_', ' '))}</span>` : ''}${record.notes ? `<p>${escapeHtml(record.notes)}</p>` : ''}</li>`).join('');
  }

  function renderAllCharts() {
    Object.keys(metrics).forEach(type => renderChart(type, filters[type]));
    renderStepsHistory();
  }

  function renderStepsHistory() {
    const status = document.getElementById('steps-history-status');
    const list = document.getElementById('steps-history-list');
    if (!status || !list) return;
    const history = filterStepsHistory(records, stepsDays);
    if (!history.length) {
      status.textContent = `No saved steps in the last ${stepsDays} days.`;
      list.innerHTML = '';
      return;
    }
    status.textContent = `${history.length} saved step ${history.length === 1 ? 'reading' : 'readings'} in the last ${stepsDays} days.`;
    list.innerHTML = buildStepsHistoryHtml(history);
  }

  function buildStepsHistoryHtml(history) {
    return history.map(record => {
      const value = Number(record.value ?? record.steps);
      return `<li><time datetime="${escapeHtml(record.timestamp)}">${escapeHtml(timestampLabel(record.timestamp))}</time><strong>${escapeHtml(value.toLocaleString())} steps</strong>${record.notes ? `<p>${escapeHtml(record.notes)}</p>` : ''}</li>`;
    }).join('');
  }

  async function loadHealthHistory() {
    const state = document.getElementById('health-history-status');
    if (!state || !profileId) return false;
    state.textContent = 'Loading saved health records…';
    state.className = 'health-status';
    try {
      const result = await window.CareMateAPI.getHealthLogs(profileId);
      if (!result.success || !Array.isArray(result.data)) throw new Error(result.error || 'Health history could not be loaded. Check your connection and retry.');
      records = result.data.filter(record => record && record.userId === profileId);
      state.textContent = records.length ? 'Health history loaded from your Carewise profile.' : 'No saved health measurements yet.';
      state.className = 'health-modal-status';
      renderAllCharts();
      return true;
    } catch (error) {
      records = [];
      state.textContent = error.message || 'Health history could not be loaded. Check your connection and retry.';
      state.className = 'health-status health-status--error';
      renderAllCharts();
      const stepsState = document.getElementById('steps-history-status');
      if (stepsState) {
        stepsState.textContent = 'Steps history could not be loaded. Check your connection and retry.';
        stepsState.className = 'health-status health-status--error';
      }
      return false;
    }
  }

  function setupForm() {
    const typeInput = document.getElementById('health-type');
    const unitInput = document.getElementById('health-unit');
    const valueLabel = document.getElementById('health-value-label');
    const bpFields = document.getElementById('blood-pressure-fields');
    const singleField = document.getElementById('single-measurement-field');
    const sugarContext = document.getElementById('blood-sugar-context');
    const configure = () => {
      const type = typeInput.value;
      const metric = metrics[type];
      bpFields.hidden = type !== 'blood_pressure';
      singleField.hidden = type === 'blood_pressure';
      sugarContext.hidden = type !== 'blood_sugar';
      document.getElementById('sugar-context').required = type === 'blood_sugar';
      valueLabel.textContent = metric.valueLabel;
      unitInput.replaceChildren(...metric.units.map(unit => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = unit;
        return option;
      }));
    };
    typeInput.addEventListener('change', configure);
    configure();
    document.querySelectorAll('[data-range-type]').forEach(button => button.addEventListener('click', () => {
      const type = button.dataset.rangeType;
      const days = Number(button.dataset.days);
      if (![7, 30, 90].includes(days)) return;
      filters[type] = days;
      document.querySelectorAll(`[data-range-type="${type}"]`).forEach(control => control.setAttribute('aria-pressed', String(control === button)));
      renderChart(type, days);
    }));
    document.querySelectorAll('[data-steps-days]').forEach(button => button.addEventListener('click', () => {
      const days = Number(button.dataset.stepsDays);
      if (![7, 30, 90].includes(days)) return;
      stepsDays = days;
      document.querySelectorAll('[data-steps-days]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
      renderStepsHistory();
    }));
    document.getElementById('health-entry-form').addEventListener('submit', submitHealthReading);
    document.getElementById('health-history-retry').addEventListener('click', loadHealthHistory);
    const current = new Date();
    const localDateTime = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('health-timestamp').value = localDateTime;
  }

  async function submitHealthReading(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('health-form-status');
    const button = document.getElementById('health-save-button');
    const type = document.getElementById('health-type').value;
    const timestampValue = document.getElementById('health-timestamp').value;
    const timestampDate = timestampValue ? new Date(timestampValue) : null;
    if (!timestampDate || !Number.isFinite(timestampDate.getTime())) {
      status.textContent = 'Enter a valid measurement date and time.';
      status.className = 'health-status health-status--error';
      return;
    }
    const payload = {
      type,
      unit: document.getElementById('health-unit').value,
      timestamp: timestampDate.toISOString(),
      notes: document.getElementById('health-notes').value.trim(),
    };
    if (type === 'blood_pressure') {
      payload.systolic = Number(document.getElementById('health-systolic').value);
      payload.diastolic = Number(document.getElementById('health-diastolic').value);
    } else {
      payload.value = Number(document.getElementById('health-value').value);
    }
    if (type === 'blood_sugar') payload.context = document.getElementById('sugar-context').value;

    const validationError = window.CareMateAPI.validateHealthLogPayload(payload);
    if (validationError) {
      status.textContent = validationError;
      status.className = 'health-status health-status--error';
      return;
    }

    button.disabled = true;
    button.textContent = 'Saving measurement…';
    status.textContent = 'Saving to your Carewise health log…';
    status.className = 'health-status';
    try {
      const result = await window.CareMateAPI.logHealthReading({ userId: profileId, ...payload });
      if (!result.success) {
        status.textContent = result.error || 'The measurement could not be saved. Check the details and retry.';
        status.className = 'health-status health-status--error';
        return;
      }
      status.textContent = 'Measurement saved to your health log.';
      status.className = 'health-status health-status--success';
      form.reset();
      document.getElementById('health-type').dispatchEvent(new Event('change'));
      const current = new Date();
      document.getElementById('health-timestamp').value = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      await loadHealthHistory();
      if (typeof window.refreshDashboardHealthSummary === 'function') await window.refreshDashboardHealthSummary();
    } catch (_) {
      status.textContent = 'The health service could not be reached. Your measurement was not reported as saved; please retry.';
      status.className = 'health-status health-status--error';
    } finally {
      button.disabled = false;
      button.textContent = 'Save measurement';
    }
  }

  function init() {
    if (initialized) return false;
    profileId = window.CareMateAPI.getCurrentUserId();
    if (!profileId) return false;
    document.getElementById('user-display-name').textContent = localStorage.getItem('caremate_user_name') || 'User';
    buildChartCards();
    setupForm();
    Object.keys(metrics).forEach(type => renderChart(type, filters[type]));
    initialized = true;
    loadHealthHistory();
    return true;
  }

  window.CarewiseHealthLogs = { init, filterHealthHistory, filterStepsHistory, buildStepsHistoryHtml, normalizeRecord, validateHealthReading: payload => window.CareMateAPI.validateHealthLogPayload(payload), renderAllCharts, renderStepsHistory, loadHealthHistory };
})();
