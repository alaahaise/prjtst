// Direct ports of the original vanilla-JS helpers, unchanged in behavior.

export function fmt(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function debounce(fn, ms = 180) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function esc(s) {
  return (s === null || s === undefined) ? '' : String(s);
}

const DAY_MS = 86400000;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function relativeLabel(dateStr) {
  const d = startOfDay(dateStr);
  const today = startOfDay(new Date());
  const diff = Math.round((today - d) / DAY_MS);
  if (diff === 0) return { text: "Aujourd'hui", cls: 'today' };
  if (diff === 1) return { text: 'Hier', cls: '' };
  if (diff > 1 && diff <= 6) return { text: 'Il y a ' + diff + ' jours', cls: '' };
  if (diff < 0) return { text: 'À venir', cls: '' };
  return null;
}

export function sortRows(rows, key, dir, type) {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (type === 'number') { va = Number(va) || 0; vb = Number(vb) || 0; }
    else if (type === 'date') { va = new Date(va).getTime() || 0; vb = new Date(vb).getTime() || 0; }
    else { va = (va ?? '').toString().toLowerCase(); vb = (vb ?? '').toString().toLowerCase(); }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

export function exportCSV(filename, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(r.map(v => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = startOfDay(dateStr).getTime();
  if (from && d < startOfDay(from).getTime()) return false;
  if (to && d > startOfDay(to).getTime()) return false;
  return true;
}

export function matchesText(row, fields, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some(f => (row[f] ?? '').toString().toLowerCase().includes(q));
}

export function printReport(title, columns, rows) {
  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const win = window.open('', '_blank');
  if (!win) { return false; }
  const styles = `
    body{font-family:'IBM Plex Mono', monospace; padding:32px; color:#23271f;}
    h1{font-family: Georgia, 'IBM Plex Serif', serif; font-size:19px; margin:0 0 2px;}
    .meta{font-size:11px; opacity:.6; margin-bottom:20px; text-transform:uppercase; letter-spacing:.4px;}
    table{width:100%; border-collapse:collapse; font-size:13px;}
    th{text-align:left; text-transform:uppercase; font-size:10px; letter-spacing:.4px; padding:6px 8px; border-bottom:2px solid #23271f;}
    td{padding:6px 8px; border-bottom:1px solid #ccc;}
    td.num, th.num{text-align:right;}
  `;
  const escHtml = (s) => (s === null || s === undefined) ? '' :
    String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const head = `<tr>${columns.map(c => `<th${c.num ? ' class="num"' : ''}>${escHtml(c.label)}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>${columns.map(c => `<td${c.num ? ' class="num"' : ''}>${escHtml(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>${escHtml(title)}</title><style>${styles}</style></head>
    <body>
      <h1>${escHtml(title)}</h1>
      <div class="meta">CASPM — ${escHtml(dateStr)}</div>
      <table><thead>${head}</thead><tbody>${body || `<tr><td colspan="${columns.length}">Aucune donnée</td></tr>`}</tbody></table>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 250);
  return true;
}
