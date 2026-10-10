// Generic report document wrapper + open/print helpers.
// Any view can call these with its own title + body HTML.

export function buildReportDocument(bodyHtml, title) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page{ size:A4; margin:16mm; }
  *{ box-sizing:border-box; }
  body{
    font-family:'Inter','Segoe UI',sans-serif;
    color:#15151b;
    margin:0;
    padding:32px 40px;
    background:#fff;
    font-size:13px;
    line-height:1.5;
  }
  .rpt-header{
    border-bottom:3px solid #e5342a;
    padding-bottom:16px;
    margin-bottom:24px;
  }
  .rpt-company{
    font-size:11px; font-weight:700; letter-spacing:1.5px;
    color:#e5342a; text-transform:uppercase; margin-bottom:4px;
  }
  .rpt-title{ font-size:22px; font-weight:800; margin-bottom:8px; }
  .rpt-meta{ display:flex; gap:20px; font-size:11.5px; color:#6c6c78; }
  .rpt-summary{ display:flex; flex-wrap:wrap; gap:12px; margin-bottom:28px; }
  .rpt-stat{
    background:#f7f7f9; border:1px solid #ececee; border-radius:10px;
    padding:12px 18px; min-width:120px;
  }
  .rpt-stat .num{ display:block; font-size:20px; font-weight:800; }
  .rpt-stat .lbl{ font-size:10.5px; color:#6c6c78; text-transform:uppercase; letter-spacing:.4px; }
  .rpt-section-title{
    font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid #ececee;
  }
  .rpt-table{ width:100%; border-collapse:collapse; font-size:12px; }
  .rpt-table th{
    text-align:left; font-size:10.5px; font-weight:700; text-transform:uppercase;
    color:#6c6c78; padding:8px 10px; border-bottom:2px solid #15151b;
  }
  .rpt-table td{ padding:8px 10px; border-bottom:1px solid #ececee; }
  .rpt-table td.num, .rpt-table th.num{ text-align:right; font-variant-numeric:tabular-nums; }
  .rpt-footer{
    margin-top:40px; padding-top:14px; border-top:1px solid #ececee;
    font-size:10.5px; color:#9a9aa6; text-align:center;
  }
  @media print{ body{ padding:0; } }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// Opens a new tab with the report. Returns the window (or null if blocked).
export function openReport(bodyHtml, title) {
  const win = window.open('', '_blank');
  if (!win) return null;
  win.document.write(buildReportDocument(bodyHtml, title));
  win.document.close();
  return win;
}

// Opens a new tab and triggers the print dialog once it's rendered.
export function printReport(bodyHtml, title) {
  const win = openReport(bodyHtml, title);
  if (!win) return null;
  win.onload = () => {
    win.focus();
    win.print();
  };
  return win;
}