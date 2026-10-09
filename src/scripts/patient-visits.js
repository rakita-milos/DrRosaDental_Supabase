(function () {
  const escape = value => window.DrRosaSecurity.escapeHtml(String(value ?? ""));
  const listOf = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  const text = value => String(value ?? "").trim();
  const note = value => text(value) === "-" ? "" : text(value);
  const fold = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function groupsFor(record) {
    const groups = new Map();
    function add(region, item) {
      const procedure = text(item.type || record.procedure);
      const details = note(item.note);
      // Keep different details separate, including a blank detail.
      const key = JSON.stringify([procedure, details]);
      if (!groups.has(key)) groups.set(key, { procedure, details, regions: new Set() });
      groups.get(key).regions.add(region);
    }
    Object.entries(record.treatments || {}).forEach(([tooth, items]) => listOf(items).forEach(item => add(tooth, item)));
    listOf(record.generalTreatments).forEach(item => add(text(item.region) || "Opšti postupak", item));
    if (!groups.size) add("Opšti postupak", { type: record.procedure });
    return [...groups.values()].map(group => ({ ...group, regions: [...group.regions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }));
  }

  function mount(records) {
    const root = document.getElementById("visits-card");
    if (!root) return;
    const rows = [...records].sort((a, b) => String(b.lastVisit || "").localeCompare(String(a.lastVisit || "")) || Number(b.id || 0) - Number(a.id || 0))
      .map((record, index) => ({ record, key: String(index), groups: groupsFor(record) }));
    const byId = id => document.getElementById(id);
    const search = byId("visits-search"), tooth = byId("visits-tooth"), from = byId("visits-from"), to = byId("visits-to");
    byId("patient-visits-count").textContent = rows.length;
    const regions = [...new Set(rows.flatMap(row => row.groups.flatMap(group => group.regions)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    tooth.innerHTML = '<option value="">Svi zubi i regije</option>' + regions.map(region => `<option value="${escape(region)}">${escape(region)}</option>`).join("");
    let page = 1, openKey = rows[0]?.key;
    function filtered() {
      const query = fold(search.value);
      return rows.filter(({ record, groups }) => {
        const date = String(record.lastVisit || "").slice(0, 10);
        const searchable = [record.procedure, note(record.note || record.notes), ...groups.flatMap(group => [group.procedure, group.details])].join(" ");
        return (!query || fold(searchable).includes(query))
          && (!tooth.value || groups.some(group => group.regions.includes(tooth.value)))
          && (!from.value || date >= from.value) && (!to.value || date <= to.value);
      });
    }
    function render(selectFirst = false) {
      const matches = filtered();
      const pages = Math.max(1, Math.ceil(matches.length / 10));
      page = Math.min(page, pages);
      const visible = matches.slice((page - 1) * 10, page * 10);
      if (selectFirst) openKey = visible[0]?.key;
      byId("visits-results").textContent = from.value && to.value && from.value > to.value
        ? "Datum početka mora biti pre završnog datuma."
        : `Prikazano ${matches.length ? (page - 1) * 10 + 1 : 0}–${Math.min(page * 10, matches.length)} od ${matches.length} poseta (ukupno ${rows.length}).`;
      byId("patient-visits-list").innerHTML = visible.length ? visible.map(({ record, key, groups }) => {
        const expanded = openKey === key;
        const params = new URLSearchParams({ record: record.id, patient: record.patient || "" });
        if (record.patientId) params.set("patientId", record.patientId);
        const regions = [...new Set(groups.flatMap(group => group.regions))].join(", ");
        return `<article class="patient-visit">
          <div class="visit-summary"><span><small>Datum</small>${escape(window.DrRosaDateUtils.formatDate(record.lastVisit))}</span><span><small>Doktor</small>${escape(record.doctor || "—")}</span><span><small>Zubi/regija</small>${escape(regions)}</span>
            <button class="secondary-btn" type="button" data-open-visit="${key}" aria-expanded="${expanded}" aria-controls="visit-detail-${key}">${expanded ? "Zatvori" : "Otvori"}</button></div>
          <div class="visit-detail" id="visit-detail-${key}" ${expanded ? "" : "hidden"}>
            <div class="visit-work-heading" aria-hidden="true"><span>Zubi/regija</span><span>Postupak</span><span>Detalji rada</span></div>
            ${groups.map(group => `<div class="visit-work"><div><small>Zubi/regija</small>${escape(group.regions.join(", "))}</div><div><small>Postupak</small>${escape(group.procedure || "—")}</div><div><small>Detalji rada</small>${escape(group.details || "—")}</div></div>`).join("")}
            <div class="visit-note"><strong>Napomena posete</strong><p>${escape(note(record.note || record.notes) || "Nema napomene.")}</p></div>
            <a class="primary-btn" href="new-entry.html?${escape(params.toString())}">Uredi posetu</a>
          </div></article>`;
      }).join("") : '<p class="empty-row">Nema poseta za izabrane filtere.</p>';
      byId("visits-page").textContent = `Strana ${page} / ${pages}`;
      byId("visits-prev").disabled = page <= 1;
      byId("visits-next").disabled = page >= pages;
    }
    byId("patient-visits-list").onclick = event => {
      const button = event.target.closest("[data-open-visit]");
      if (!button) return;
      openKey = openKey === button.dataset.openVisit ? null : button.dataset.openVisit;
      render();
      byId("patient-visits-list").querySelector(`[data-open-visit="${button.dataset.openVisit}"]`)?.focus({ preventScroll: true });
    };
    [search, tooth, from, to].forEach(input => {
      const filter = () => { page = 1; render(true); };
      input.oninput = filter;
      input.onchange = filter;
    });
    byId("visits-reset").onclick = () => {
      [search, tooth, from, to].forEach(input => { input.value = ""; input.dispatchEvent(new Event("change", { bubbles: true })); });
      page = 1; render(true);
    };
    byId("visits-prev").onclick = () => { page--; render(true); };
    byId("visits-next").onclick = () => { page++; render(true); };
    render();
  }
  window.DrRosaPatientVisits = { mount, groupsFor };
})();
