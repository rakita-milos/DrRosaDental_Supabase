(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeFileName(value) {
    return String(value || "export")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  }

  function buildTable(headers, rows) {
    return `
      <table>
        <thead>
          <tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  function exportExcel(title, headers, rows) {
    if (!rows.length) {
      alert("Nema podataka za export.");
      return;
    }

    const html = `
      <html>
        <head><meta charset="UTF-8" /></head>
        <body>
          <h2>${escapeHtml(title)}</h2>
          ${buildTable(headers, rows)}
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeFileName(title)}.xls`;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  }

  function exportPdf(title, headers, rows) {
    if (!rows.length) {
      alert("Nema podataka za export.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Dozvolite popup prozor za PDF export.");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #17212b; padding: 24px; }
            h1 { font-size: 22px; margin: 0 0 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #d7e0eb; padding: 8px; text-align: left; }
            th { background: #eef4f9; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          ${buildTable(headers, rows)}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  window.DrRosaExport = {
    exportExcel,
    exportPdf
  };
})();
