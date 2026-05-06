async function requireAccess(requiredRole) {
  const session = await window.DrRosaApi.verifySession(requiredRole);
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  const directorPanelLink = document.getElementById("director-panel-link");
  if (directorPanelLink && session.role === "director") {
    directorPanelLink.style.display = "";
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (event) => {
      event.preventDefault();
      window.DrRosaApi.clearSession();
      window.location.href = "login.html";
    });
  }

  return session;
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return new Date(rawDate).toLocaleDateString("hr-HR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function paymentIsDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return Number(record.amountDue || 0) > 0 && ["dugovanje", "delimicno"].includes(payment);
}

function renderDueSummary(records) {
  const uniqueDebtors = new Set(records.filter(paymentIsDebt).map(record => record.patient)).size;
  const debtorsCountEl = document.getElementById("debtors-count");
  if (debtorsCountEl) debtorsCountEl.textContent = uniqueDebtors;
}

function renderRecords(records) {
  const tableBody = document.getElementById("record-table-body");
  tableBody.innerHTML = "";

  if (records.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Nema dostupnih zapisa.</td></tr>`;
    return;
  }

  records.slice(0, 10).forEach((record) => {
    const statusClass = `status-${String(record.status || "").toLowerCase().replace(/\s+/g, "-")}`;
    const patientLink = `patient-dashboard.html?patient=${encodeURIComponent(record.patient)}`;
    const row = document.createElement("tr");
    row.append(
      window.DrRosaSecurity.cell(record.patient),
      window.DrRosaSecurity.cell(formatDate(record.lastVisit)),
      window.DrRosaSecurity.cell(record.procedure),
      window.DrRosaSecurity.cell(record.doctor),
      window.DrRosaSecurity.cell(record.status, statusClass),
      window.DrRosaSecurity.cell(record.visits || 1),
      window.DrRosaSecurity.cell(record.note || "-")
    );
    const actionCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = patientLink;
    link.className = "secondary-btn";
    link.textContent = "Otvori";
    actionCell.appendChild(link);
    row.appendChild(actionCell);
    tableBody.appendChild(row);
  });
}

(async function initDashboard() {
  if (!await requireAccess()) return;
  try {
    const records = await window.DrRosaApi.getRecords();
    renderDueSummary(records);
    renderRecords(records);
  } catch (error) {
    renderRecords([]);
    console.error("Dashboard load error:", error);
  }
})();
