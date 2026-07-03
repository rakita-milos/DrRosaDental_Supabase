(function () {
  function escapeHtml(value) {
    if (window.DrRosaSecurity?.escapeHtml) return window.DrRosaSecurity.escapeHtml(value);
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function treatmentListForValue(treatments) {
    if (!treatments) return [];
    return Array.isArray(treatments) ? treatments : [treatments];
  }

  function normalizeDiscountType(type) {
    return type === "percent" ? "percent" : "amount";
  }

  function normalizeDiscountValue(value, type) {
    const amount = Math.max(0, Number(value || 0));
    return normalizeDiscountType(type) === "percent" ? Math.min(100, amount) : amount;
  }

  function treatmentDiscountAmount(treatment) {
    const price = Number(treatment?.price || 0);
    const type = normalizeDiscountType(treatment?.discountType || treatment?.discount_type);
    const value = normalizeDiscountValue(treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0, type);
    const discount = type === "percent" ? price * value / 100 : value;
    return Math.min(price, Math.max(0, discount));
  }

  function discountSummary(groups, currency, formatMoney) {
    return Array.from(groups.values()).map(item => item.type === "percent"
      ? `${item.value.toFixed(2).replace(/\.00$/, "")}% (${formatMoney(item.discount, currency)})`
      : formatMoney(item.discount, currency)).join(", ");
  }

  function entriesFromRecords(records, options = {}) {
    const {
      patientId,
      patientName,
      excludeRecordId,
      procedureCatalog = window.DrRosaProcedureCatalog
    } = options;
    const normalizedName = String(patientName || "").trim();

    return (records || [])
      .filter(record => {
        if (excludeRecordId && String(record.id) === String(excludeRecordId)) return false;
        if (patientId) return String(record.patientId) === String(patientId);
        if (normalizedName) return record.patient === normalizedName;
        return true;
      })
      .flatMap(record => Object.entries(record.treatments || {}).flatMap(([tooth, treatments]) =>
        treatmentListForValue(treatments).filter(Boolean).map(treatment => ({
          tooth,
          ...treatment,
          type: treatment.type || record.procedure,
          activity: treatment.activity || procedureCatalog?.findActivityForProcedure?.(treatment.type || record.procedure) || "",
          date: record.lastVisit,
          visitId: record.id || `${record.lastVisit}-${record.procedure}`,
          procedure: record.procedure,
          currency: treatment.currency || record.currency || "EUR"
        }))
      ))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  function groupEntries(entries, formatMoney) {
    const groups = new Map();
    entries.forEach(item => {
      const key = `${item.visitId}|${item.type || ""}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: item.date,
          visitId: item.visitId,
          procedure: item.procedure,
          type: item.type,
          currency: item.currency || "EUR",
          teeth: [],
          notes: [],
          gross: 0,
          discount: 0,
          discountGroups: new Map()
        });
      }

      const group = groups.get(key);
      group.teeth.push(item.tooth);
      if (item.note && item.note !== "-") group.notes.push(item.note);
      group.gross += Number(item.price || 0);

      const itemDiscount = treatmentDiscountAmount(item);
      group.discount += itemDiscount;
      if (itemDiscount > 0) {
        const type = normalizeDiscountType(item.discountType || item.discount_type);
        const value = normalizeDiscountValue(item.discountValue ?? item.discount_value ?? item.discount ?? 0, type);
        const discountKey = `${type}:${value}`;
        const current = group.discountGroups.get(discountKey) || { type, value, discount: 0 };
        current.discount += itemDiscount;
        group.discountGroups.set(discountKey, current);
      }
    });

    return Array.from(groups.values()).map(group => ({
      ...group,
      teeth: Array.from(new Set(group.teeth)).sort((a, b) => Number(a) - Number(b)),
      notes: Array.from(new Set(group.notes)),
      discountLabel: discountSummary(group.discountGroups, group.currency, formatMoney),
      total: Math.max(0, group.gross - group.discount)
    }));
  }

  function renderEntries(entries, options = {}) {
    const formatMoney = options.formatMoney || ((amount, currency = "EUR") => (
      window.DrRosaCurrencyUtils
        ? window.DrRosaCurrencyUtils.formatMoney(amount, currency)
        : `${Number(amount || 0).toFixed(2)} ${currency}`
    ));
    const formatDate = options.formatDate || (value => value || "-");
    const emptyMessage = options.emptyMessage || "Nema unesenih tretmana po zubima.";
    const title = options.title ? `<h4>${escapeHtml(options.title)}</h4>` : "";

    if (!entries || entries.length === 0) {
      return `${title}<p>${escapeHtml(emptyMessage)}</p>`;
    }

    return title + groupEntries(entries, formatMoney).map(item => `
      <div class="treatment-item">
        <div>
          <strong>Zubi ${escapeHtml(item.teeth.join(", "))}</strong> - ${escapeHtml(item.type)}
          <div style="margin-top: 6px; font-weight: 700;">Ukupno: ${formatMoney(item.total, item.currency)}</div>
          ${Number(item.discount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${escapeHtml(item.discountLabel || formatMoney(item.discount, item.currency))}</div>` : ""}
          <div style="margin-top: 6px;">${escapeHtml(item.notes.join("; ") || "-")}</div>
          <div style="margin-top: 6px; font-size: 0.9rem; color: #5b6c7d;">${formatDate(item.date)} | ${escapeHtml(item.procedure || "-")}</div>
        </div>
      </div>
    `).join("");
  }

  window.DrRosaTreatmentHistory = {
    entriesFromRecords,
    groupEntries,
    renderEntries,
    treatmentDiscountAmount
  };
})();
