/* globals window */
const App = window.go.main.App;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  excelEntries: [],        // KollektenEintrag[] from last parse
  newOptions: [],          // options to sync (from preview)
  factOptions: [],         // current CT options for dropdown
  events: [],              // EventWithFact[]
  pendingChanges: {},      // eventID -> kollektengrund (unsaved)
  pendingBetrags: {},      // eventID -> betrag string (unsaved)
};

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'gottesdienste') onGottesdiensteTabOpen();
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  initDateDefaults();
  initSetupOverlay();
}

// ── Setup overlay ─────────────────────────────────────────────────────────────
function initSetupOverlay() {
  const overlay = document.getElementById('setup-overlay');
  const urlInput = document.getElementById('setup-ct-url');
  const keyInput = document.getElementById('setup-api-key');
  const saveBtn  = document.getElementById('setup-btn-save');
  const status   = document.getElementById('setup-status');
  const toggleBtn = document.getElementById('setup-toggle-token');

  // Show overlay if credentials are missing
  const url = document.getElementById('ct-url').value;
  const key = document.getElementById('api-key').value;
  if (!url || !key) {
    overlay.classList.remove('hidden');
  }

  toggleBtn.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  saveBtn.addEventListener('click', async () => {
    const u = urlInput.value.trim();
    const k = keyInput.value.trim();
    if (!u.startsWith('http')) {
      status.textContent = 'URL muss mit http:// oder https:// beginnen.';
      status.style.color = '#ff3b30';
      return;
    }
    if (!k) {
      status.textContent = 'Bitte Login-Token eingeben.';
      status.style.color = '#ff3b30';
      return;
    }
    saveBtn.disabled = true;
    status.textContent = 'Speichere…';
    status.style.color = '#6e6e73';
    try {
      await App.SaveSettings(u, k);
      // Mirror values to settings tab
      document.getElementById('ct-url').value = u;
      document.getElementById('api-key').value = k;
      document.getElementById('gear-btn').classList.remove('needs-attention');
      overlay.classList.add('hidden');
    } catch (e) {
      status.textContent = 'Fehler: ' + e;
      status.style.color = '#ff3b30';
      saveBtn.disabled = false;
    }
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await App.GetSettings();
    document.getElementById('ct-url').value = s.ctURL || '';
    document.getElementById('api-key').value = s.apiKey || '';
    const missing = !s.ctURL || !s.apiKey;
    document.getElementById('gear-btn').classList.toggle('needs-attention', missing);
  } catch (e) {
    console.error(e);
  }
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const url = document.getElementById('ct-url').value.trim();
  const key = document.getElementById('api-key').value.trim();
  const status = document.getElementById('settings-status');
  if (!url.startsWith('http')) {
    status.textContent = 'URL muss mit http:// oder https:// beginnen.';
    status.style.color = '#ff3b30';
    return;
  }
  try {
    await App.SaveSettings(url, key);
    status.textContent = 'Gespeichert.';
    status.style.color = '#34c759';
    document.getElementById('gear-btn').classList.toggle('needs-attention', !url || !key);
  } catch (e) {
    status.textContent = 'Fehler: ' + e;
    status.style.color = '#ff3b30';
  }
});

document.getElementById('btn-test-connection').addEventListener('click', async () => {
  const status = document.getElementById('settings-status');
  status.textContent = 'Teste Verbindung…';
  status.style.color = '#6e6e73';
  try {
    await App.TestConnection();
    status.textContent = '✓ Verbindung erfolgreich, Fakt gefunden.';
    status.style.color = '#34c759';
  } catch (e) {
    status.textContent = '✗ ' + e;
    status.style.color = '#ff3b30';
  }
});

// ── Wiki Import ───────────────────────────────────────────────────────────────
document.getElementById('btn-load-wiki').addEventListener('click', async () => {
  const status  = document.getElementById('wiki-status');
  const loadingEl = document.getElementById('wiki-loading');
  const errorEl = document.getElementById('wiki-error');

  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  status.textContent = '';

  try {
    const entries = await App.GetWikiEntries();
    state.excelEntries = entries || [];
    renderWikiTable(state.excelEntries);

    status.textContent = `${state.excelEntries.length} Zeilen geladen.`;
    status.style.color = '#34c759';

    document.getElementById('sync-section').classList.remove('hidden');
    document.getElementById('options-preview').classList.add('hidden');
    document.getElementById('btn-sync').disabled = true;
    state.newOptions = [];
  } catch (e) {
    errorEl.textContent = 'Fehler: ' + e;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
});


function renderWikiTable(entries) {
  const wrap  = document.getElementById('wiki-preview-wrap');
  const tbody = document.getElementById('wiki-tbody');
  const badge = document.getElementById('wiki-count');

  tbody.innerHTML = '';
  entries.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(e.datum)}</td><td>${esc(e.kollektengrund)}</td><td>${esc(e.betrag)}</td>`;
    tbody.appendChild(tr);
  });

  badge.textContent = entries.length + ' Zeilen';
  wrap.classList.toggle('hidden', entries.length === 0);
  document.getElementById('autofill-bar').classList.toggle('hidden', entries.length === 0);
}

// Options preview & sync
document.getElementById('btn-preview-options').addEventListener('click', async () => {
  const loadingEl = document.getElementById('preview-loading');
  const previewEl = document.getElementById('options-preview');
  loadingEl.classList.remove('hidden');
  previewEl.classList.add('hidden');

  try {
    const all = state.excelEntries.map(e => (e.kollektengrund || '').trim()).filter(Boolean);
    const preview = await App.GetOptionsPreview(all);

    renderOptionsList('existing-options-list', preview.existing, false);
    renderOptionsList('new-options-list', preview.new, true);

    state.newOptions = preview.new || [];
    const existing = preview.existing || [];
    const unchanged = existing.length === state.newOptions.length &&
      state.newOptions.every((o, i) => o === existing[i]);
    document.getElementById('btn-sync').disabled = unchanged;

    const syncMsg = document.getElementById('sync-msg');
    if (unchanged) {
      syncMsg.textContent = 'Liste bereits aktuell, keine Änderungen.';
      syncMsg.style.color = '#34c759';
    } else {
      syncMsg.textContent = `${state.newOptions.length} Option(en) werden die aktuelle Liste ersetzen.`;
      syncMsg.style.color = '#0071e3';
    }

    previewEl.classList.remove('hidden');
  } catch (e) {
    alert('Fehler beim Abrufen der Optionen: ' + e);
  } finally {
    loadingEl.classList.add('hidden');
  }
});

function renderOptionsList(elId, opts, isNew) {
  const el = document.getElementById(elId);
  if (!opts || opts.length === 0) {
    el.innerHTML = '<div class="options-empty">–</div>';
    return;
  }
  el.innerHTML = opts.map(o =>
    `<div class="option-item${isNew ? ' new-item' : ''}">${esc(o)}</div>`
  ).join('');
}

document.getElementById('btn-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync');
  const msg = document.getElementById('sync-msg');
  btn.disabled = true;
  msg.textContent = 'Speichere…';
  msg.style.color = '#6e6e73';
  try {
    await App.SyncOptions(state.newOptions);
    msg.textContent = `✓ ${state.newOptions.length} Option(en) gespeichert (Liste ersetzt).`;
    msg.style.color = '#34c759';
    state.newOptions = [];
    // Refresh preview
    document.getElementById('btn-preview-options').click();
  } catch (e) {
    msg.textContent = '✗ Fehler: ' + e;
    msg.style.color = '#ff3b30';
    btn.disabled = false;
  }
});

// ── Gottesdienste ─────────────────────────────────────────────────────────────
function initDateDefaults() {
  const now = new Date();
  const year = now.getFullYear();
  document.getElementById('date-from').value = `${year}-01-01`;
  document.getElementById('date-to').value = `${year}-12-31`;
}

// Quick-range buttons
document.getElementById('btn-rolling').addEventListener('click', () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  setRange(localDateStr(from), localDateStr(to));
});
document.getElementById('btn-this-year').addEventListener('click', () => {
  const y = new Date().getFullYear();
  setRange(`${y}-01-01`, `${y}-12-31`);
});
[[1,'01','03'],[2,'04','06'],[3,'07','09'],[4,'10','12']].forEach(([q, m1, m2]) => {
  document.getElementById(`btn-q${q}`).addEventListener('click', () => {
    const y = new Date().getFullYear();
    setRange(`${y}-${m1}-01`, `${y}-${m2}-${lastDay(y, parseInt(m2))}`);
  });
});
function lastDay(y, m) {
  return new Date(y, m, 0).getDate().toString().padStart(2,'0');
}
function setRange(from, to) {
  document.getElementById('date-from').value = from;
  document.getElementById('date-to').value = to;
}

document.getElementById('btn-load-events').addEventListener('click', () => loadEvents());

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadEvents(fromOverride, toOverride) {
  const from = fromOverride || document.getElementById('date-from').value;
  const to   = toOverride   || document.getElementById('date-to').value;
  if (!from || !to) { alert('Bitte Von- und Bis-Datum angeben.'); return; }

  const loadingEl = document.getElementById('events-loading');
  const tableWrap = document.getElementById('events-table-wrap');
  const emptyEl  = document.getElementById('events-empty');
  const errorEl  = document.getElementById('events-error');

  loadingEl.classList.remove('hidden');
  tableWrap.classList.add('hidden');
  emptyEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  state.pendingChanges = {};
  state.pendingBetrags = {};

  try {
    const [events, opts] = await Promise.all([
      App.GetEvents(from, to),
      App.GetFactOptions().catch(() => []),
    ]);
    state.events = events || [];
    state.factOptions = opts || [];
    renderEventsTable(state.events, state.factOptions);
    if (state.excelEntries.length > 0) applyWikiAutofill();
  } catch (e) {
    errorEl.textContent = 'Fehler beim Laden: ' + e;
    errorEl.classList.remove('hidden');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function renderEventsTable(events, opts) {
  const tbody = document.getElementById('events-tbody');
  const tableWrap = document.getElementById('events-table-wrap');
  const emptyEl = document.getElementById('events-empty');

  tbody.innerHTML = '';

  if (events.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  events.forEach(ev => {
    const tr = document.createElement('tr');
    tr.dataset.eventId = ev.id;

    const dateDisplay = formatEventDate(ev.startDate);

    // Build dropdown options
    const optionsHtml = buildSelectOptions(opts, ev.currentValue);

    tr.innerHTML = `
      <td>${esc(dateDisplay)}</td>
      <td>${esc(ev.name)}</td>
      <td>
        <select class="kollekten-select" data-event-id="${ev.id}" data-original="${esc(ev.currentValue)}">
          <option value="">– kein –</option>
          ${optionsHtml}
        </select>
      </td>
      <td>
        <input type="text" class="betrag-input" data-event-id="${ev.id}"
               data-original="${esc(ev.currentBetrag)}"
               value="${esc(formatBetrag(ev.currentBetrag))}"
               placeholder="0,00 €" />
      </td>
      <td>
        <button class="save-row-btn" data-event-id="${ev.id}">Speichern</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Select change listeners
  tbody.querySelectorAll('.kollekten-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const eventId = parseInt(sel.dataset.eventId);
      const original = sel.dataset.original;
      sel.classList.toggle('changed', sel.value !== original);
      if (sel.value !== original) {
        state.pendingChanges[eventId] = sel.value;
      } else {
        delete state.pendingChanges[eventId];
      }
    });
  });

  // Betrag change listeners
  tbody.querySelectorAll('.betrag-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const eventId = parseInt(inp.dataset.eventId);
      const originalFormatted = formatBetrag(inp.dataset.original);
      const changed = inp.value !== originalFormatted;
      inp.classList.toggle('changed', changed);
      if (changed) {
        state.pendingBetrags[eventId] = inp.value;
      } else {
        delete state.pendingBetrags[eventId];
      }
    });
  });

  // Save button listeners
  tbody.querySelectorAll('.save-row-btn').forEach(btn => {
    btn.addEventListener('click', () => saveRow(parseInt(btn.dataset.eventId)));
  });

  tableWrap.classList.remove('hidden');
}

function buildSelectOptions(opts, currentValue) {
  return opts.map(o => {
    const selected = o === currentValue ? ' selected' : '';
    return `<option value="${esc(o)}"${selected}>${esc(o)}</option>`;
  }).join('');
}

async function saveRow(eventId) {
  const sel = document.querySelector(`.kollekten-select[data-event-id="${eventId}"]`);
  const inp = document.querySelector(`.betrag-input[data-event-id="${eventId}"]`);
  const btn = document.querySelector(`.save-row-btn[data-event-id="${eventId}"]`);
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const saves = [];
    if (sel) saves.push(App.SetKollektengrund(eventId, sel.value));
    if (inp && inp.value !== formatBetrag(inp.dataset.original)) saves.push(App.SetKollektenbetrag(eventId, inp.value));
    await Promise.all(saves);

    if (sel) { sel.dataset.original = sel.value; sel.classList.remove('changed'); delete state.pendingChanges[eventId]; }
    if (inp) {
      // Derive the raw CT value from what we sent so data-original stays in dot format.
      const raw = inp.value.replace(/[€\s]/g, '').replace('.', '').replace(',', '.');
      inp.dataset.original = raw;
      inp.classList.remove('changed');
      delete state.pendingBetrags[eventId];
    }
    btn.textContent = '✓';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = 'Speichern'; btn.classList.remove('saved'); btn.disabled = false; }, 1800);
  } catch (e) {
    btn.textContent = '✗';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Speichern'; }, 1800);
    alert('Fehler: ' + e);
  }
}

// Auto-fill from wiki data
function applyWikiAutofill() {
  if (state.excelEntries.length === 0 || state.events.length === 0) return;

  const byDate = {};
  state.excelEntries.forEach(e => {
    const iso = parseToISO(e.datum);
    if (iso && e.kollektengrund) byDate[iso] = e.kollektengrund.replace(/,/g, ';');
  });

  const betragByDate = {};
  state.excelEntries.forEach(e => {
    const iso = parseToISO(e.datum);
    if (iso && e.betrag) betragByDate[iso] = e.betrag;
  });

  const filledDates = new Set();
  let filled = 0;
  state.events.forEach(ev => {
    const datePart = ev.startDate ? ev.startDate.substring(0, 10) : '';
    const suggestion = byDate[datePart];
    const betragSuggestion = betragByDate[datePart];
    let rowFilled = false;

    // Only fill the first service on each date.
    if (filledDates.has(datePart)) return;
    if (suggestion || betragSuggestion) filledDates.add(datePart);

    const sel = document.querySelector(`.kollekten-select[data-event-id="${ev.id}"]`);
    if (sel && suggestion) {
      const optExists = Array.from(sel.options).some(o => o.value === suggestion);
      if (optExists && (sel.value === '' || sel.value === 'Siehe Kollektenübersicht im Wiki')) {
        sel.value = suggestion;
        sel.classList.add('changed');
        state.pendingChanges[ev.id] = suggestion;
        rowFilled = true;
      }
    }

    const inp = document.querySelector(`.betrag-input[data-event-id="${ev.id}"]`);
    if (inp && betragSuggestion && (inp.value === '' || (inp.value === inp.dataset.original && inp.dataset.original === ''))) {
      inp.value = betragSuggestion;
      inp.classList.add('changed');
      state.pendingBetrags[ev.id] = betragSuggestion;
      rowFilled = true;
    }

    if (rowFilled) filled++;
  });

  const bar = document.getElementById('autofill-bar');
  const msg = document.getElementById('autofill-msg');
  const saveAllBtn = document.getElementById('btn-save-all');

  if (filled > 0) {
    msg.textContent = `${filled} Kollektengrund(¨e) aus Wiki vorgeschlagen.`;
    msg.style.color = '#0071e3';
    saveAllBtn.classList.remove('hidden');
    bar.classList.remove('hidden');
  } else if (state.excelEntries.length > 0) {
    msg.textContent = 'Wiki geladen – keine passenden Daten für diesen Zeitraum.';
    msg.style.color = '#6e6e73';
    saveAllBtn.classList.add('hidden');
    bar.classList.remove('hidden');
  }
}

document.getElementById('btn-save-all').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-all');
  const msg = document.getElementById('autofill-msg');
  const ids = Object.keys(state.pendingChanges).map(Number);
  if (ids.length === 0) return;

  btn.disabled = true;
  msg.textContent = `Speichere ${ids.length} Einträge…`;
  msg.style.color = '#6e6e73';

  const betragIds = Object.keys(state.pendingBetrags).map(Number);
  const allIds = [...new Set([...ids, ...betragIds])];

  let saved = 0, failed = 0;
  await Promise.all(allIds.map(async id => {
    try {
      const saves = [];
      if (state.pendingChanges[id] !== undefined) saves.push(App.SetKollektengrund(id, state.pendingChanges[id]));
      if (state.pendingBetrags[id] !== undefined) saves.push(App.SetKollektenbetrag(id, state.pendingBetrags[id]));
      await Promise.all(saves);

      const sel = document.querySelector(`.kollekten-select[data-event-id="${id}"]`);
      const inp = document.querySelector(`.betrag-input[data-event-id="${id}"]`);
      const rowBtn = document.querySelector(`.save-row-btn[data-event-id="${id}"]`);
      if (sel) { sel.dataset.original = sel.value; sel.classList.remove('changed'); }
      if (inp) { inp.dataset.original = inp.value; inp.classList.remove('changed'); }
      if (rowBtn) { rowBtn.textContent = '✓'; rowBtn.classList.add('saved'); setTimeout(() => { rowBtn.textContent = 'Speichern'; rowBtn.classList.remove('saved'); }, 1800); }
      delete state.pendingChanges[id];
      delete state.pendingBetrags[id];
      saved++;
    } catch { failed++; }
  }));

  msg.textContent = failed === 0
    ? `✓ ${saved} Einträge gespeichert.`
    : `${saved} gespeichert, ${failed} fehlgeschlagen.`;
  msg.style.color = failed === 0 ? '#34c759' : '#ff3b30';
  btn.classList.add('hidden');
  btn.disabled = false;
});

// Called when switching to Gottesdienste tab
function onGottesdiensteTabOpen() {
  if (state.excelEntries.length > 0 && state.events.length > 0) applyWikiAutofill();
  document.getElementById('autofill-bar').classList.toggle('hidden',
    state.excelEntries.length === 0 || state.events.length === 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

// Convert CT-stored dot notation ("425.25") to German display format ("425,25 €")
function formatBetrag(val) {
  if (!val && val !== 0) return '';
  const s = String(val).trim();
  if (s === '' || s === '0') return '';
  const num = parseFloat(s);
  if (isNaN(num)) return s;
  return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatEventDate(startDate) {
  if (!startDate) return '';
  const d = new Date(startDate);
  if (isNaN(d)) return startDate.substring(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const wd = weekdays[d.getDay()];
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${wd} ${day}.${month}.${year} ${h}:${min}`;
}

// Try to parse various date formats to YYYY-MM-DD
function parseToISO(dateStr) {
  if (!dateStr) return null;
  dateStr = String(dateStr).trim();
  // DD.MM.YYYY
  const dmy = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return null;
}

function uniqueKollektengründe(entries) {
  const seen = new Set();
  const result = [];
  entries.forEach(e => {
    const k = (e.kollektengrund || '').trim();
    if (k && !seen.has(k)) { seen.add(k); result.push(k); }
  });
  return result;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
