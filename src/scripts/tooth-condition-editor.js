(function () {
  const INITIAL_ENTRY_TYPE = "initial_condition";
  const QUICK_NOTES = [
    "Zdrav",
    "Karijes",
    "Stara plomba",
    "Nedostaje",
    "Krunica",
    "Implant",
    "Za pracenje",
    "Bol",
    "Upala"
  ];

  function escapeHtml(value) {
    if (window.DrRosaSecurity?.escapeHtml) return window.DrRosaSecurity.escapeHtml(value);
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeEntry(entry = {}) {
    return {
      id: entry.id || null,
      toothNumber: String(entry.toothNumber || entry.tooth_number || "").trim(),
      status: entry.status || "watch",
      diagnosis: entry.diagnosis || "Zateceno stanje",
      notes: entry.notes || "",
      procedureCode: entry.procedureCode || entry.procedure_code || "Zateceno stanje",
      entryType: entry.entryType || entry.entry_type || INITIAL_ENTRY_TYPE,
      createdAt: entry.createdAt || entry.created_at || ""
    };
  }

  function isInitialCondition(entry) {
    const normalized = normalizeEntry(entry);
    return normalized.entryType === INITIAL_ENTRY_TYPE
      || normalized.procedureCode === "Zateceno stanje"
      || normalized.diagnosis === "Zateceno stanje";
  }

  function payloadFromEntry(entry) {
    const normalized = normalizeEntry(entry);
    return {
      toothNumber: normalized.toothNumber,
      surfaces: [],
      status: normalized.status,
      diagnosis: normalized.diagnosis || "Zateceno stanje",
      procedureCode: "Zateceno stanje",
      notes: normalized.notes,
      phase: 1,
      price: 0,
      currency: "RSD",
      priceRsd: 0,
      exchangeRateToRsd: 0,
      entryType: INITIAL_ENTRY_TYPE
    };
  }

  function initialConditionsFromEntries(entries = []) {
    return entries.filter(isInitialCondition).map(normalizeEntry);
  }

  function createEditor(root, options = {}) {
    const session = window.DrRosaApi?.getSession?.();
    const canWrite = !session || session.role === 'director' || session.permissions?.includes('clinical:write');
    const state = {
      entries: (options.entries || []).map(normalizeEntry),
      selectedTeeth: new Set(),
      editingId: null,
      type: 'permanent',
      notes: '',
      events: options.events || [],
      treatments: options.treatments || []
    };
    const title = options.title || "Zateceno stanje zuba";
    const emptyMessage = options.emptyMessage || "Nema dodatog zatecenog stanja.";
    const mode = options.mode || "draft";
    let toothMap;

    function selectedTeethList() {
      return Array.from(state.selectedTeeth).sort((a, b) => Number(a) - Number(b));
    }

    function mountSharedToothMap() {
      const target = root.querySelector(".condition-map");
      if (!target) return;
      if (!toothMap) toothMap = window.DrRosaToothMap.create(target, {
        type: state.type,
        onChange: type => {
          state.type = type; state.selectedTeeth.clear(); state.editingId = null; render();
          root.querySelector(`[data-dentition="${type}"]`)?.focus({ preventScroll: true });
        }
      });
      toothMap.setType(state.type, false);
      const conditioned = new Set(state.entries.map(item => item.toothNumber));
      const latest = window.DrRosaDental.latestStates(state.events);
      toothMap.nodes.forEach(toothNode => {
        const tooth = toothNode.dataset.tooth;
        toothNode.dataset.conditionTooth = tooth;
        toothNode.classList.add("condition-map-tooth");
        toothNode.classList.toggle("selected", state.selectedTeeth.has(tooth));
        toothNode.classList.toggle("initial-condition", conditioned.has(tooth));
        toothNode.classList.toggle('treated', state.treatments.some(item => item.tooth === tooth));
        const presence = latest.get(tooth)?.presence || 'unknown';
        toothNode.dataset.presence = presence;
        toothNode.setAttribute('aria-label', `Zub ${tooth}: ${window.DrRosaDental.presenceLabels[presence]}`);
        toothNode.setAttribute("aria-pressed", state.selectedTeeth.has(tooth) ? "true" : "false");
      });
      toothMap.markHistoricalExtractions(window.DrRosaDental.historicalExtractionTeeth(state.treatments), latest);
    }

    function filtered(items, toothKey) {
      return items.filter(item => window.DrRosaDental.typeOf(item[toothKey]) === state.type
        && (!state.selectedTeeth.size || state.selectedTeeth.has(item[toothKey])));
    }

    function renderToothDetails() {
      const latest = window.DrRosaDental.latestStates(state.events);
      const teeth = state.selectedTeeth.size ? selectedTeethList() : window.DrRosaDental.rows[state.type].flat();
      const events = filtered(state.events, 'toothNumber').slice().sort((a,b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)) || Number(b.id || 0)-Number(a.id || 0));
      const treatments = filtered(state.treatments, 'tooth');
      const date = value => window.DrRosaDateUtils?.formatDate(value) || value;
      return `<section class="tooth-details">
        <h3>Stanje zuba — ${escapeHtml(window.DrRosaDental.labels[state.type])}</h3>
        <p class="tooth-state-legend">${Object.entries(window.DrRosaDental.presenceLabels).map(([key,label]) => `<span data-presence="${key}">${escapeHtml(label)}</span>`).join('')}</p>
        <p>Stanje prisutnosti je odvojeno od opisa zatečenog stanja i naplate. Klik na zub filtrira istoriju.</p>
        <div class="tooth-state-current">${teeth.map(tooth => `<span>Zub ${escapeHtml(tooth)}: <strong>${escapeHtml(window.DrRosaDental.presenceLabels[latest.get(tooth)?.presence || 'unknown'])}</strong></span>`).join('')}</div>
        <div class="input-grid tooth-state-form">
          <label>Stanje za izabrane zube<select class="tooth-presence">${Object.entries(window.DrRosaDental.presenceLabels).filter(([key]) => key !== 'exfoliated' || state.type === 'primary').map(([key,label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('')}</select></label>
          <label>Datum stanja<input type="date" class="tooth-state-date" value="${window.DrRosaDateUtils?.isoDateKey(new Date()) || ''}" /></label>
          <label>Napomena promene<input class="tooth-state-note" maxlength="1000" /></label>
        </div>
        <button type="button" class="primary-btn tooth-state-save">${options.patientId ? 'Sačuvaj stanje zuba' : 'Dodaj stanje u nacrt'}</button>
        ${options.patientId ? `<a class="secondary-btn tooth-new-work" href="new-entry.html?patientId=${encodeURIComponent(options.patientId)}&dentition=${state.type}${state.selectedTeeth.size === 1 ? `&tooth=${encodeURIComponent(teeth[0])}` : ''}">Novi rad</a>` : ''}
        <h4>Istorija promena stanja</h4>
        ${events.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Zub</th><th>Stanje</th><th>Napomena</th><th>Uneo</th></tr></thead><tbody>${events.map(item => `<tr><td>${escapeHtml(date(item.effectiveDate))}</td><td>${escapeHtml(item.toothNumber)}</td><td>${escapeHtml(window.DrRosaDental.presenceLabels[item.presence])}</td><td>${escapeHtml(item.notes || '-')}</td><td>${escapeHtml(item.recordedByName || (item.id ? '-' : 'Nacrt'))}</td></tr>`).join('')}</tbody></table></div>` : '<p>Nema evidentiranih promena stanja.</p>'}
        <h3>Istorija radova — ${escapeHtml(window.DrRosaDental.labels[state.type])}</h3>
        <button type="button" class="secondary-btn tooth-history-all">Svi zubi na ovoj mapi</button>
        ${window.DrRosaTreatmentHistory ? window.DrRosaTreatmentHistory.renderEntries(treatments, { dentitionGrouped: true }) : '<p>Radovi će biti dostupni nakon unosa posete.</p>'}
      </section>`;
    }

    function renderList() {
      const visible = state.entries.map((entry, index) => ({entry,index})).filter(({entry}) => !window.DrRosaDental.typeOf(entry.toothNumber) || window.DrRosaDental.typeOf(entry.toothNumber) === state.type);
      if (!visible.length) {
        return `<div class="condition-empty">${escapeHtml(emptyMessage)}</div>`;
      }
      return `
        <div class="table-wrap condition-table-wrap">
          <table class="condition-table">
            <thead>
              <tr>
                <th>Zub</th>
                <th>Opis</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              ${visible.map(({entry,index}) => `
                <tr data-condition-index="${index}">
                  <td><strong>${escapeHtml(entry.toothNumber)}</strong></td>
                  <td>${escapeHtml(entry.notes || "-")}</td>
                  <td>
                    <button class="secondary-btn condition-edit-btn" type="button" data-condition-index="${index}">Uredi</button>
                    <button class="danger-btn condition-remove-btn" type="button" data-condition-index="${index}">Obrisi</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    function render() {
      const oldDate = root.querySelector('.tooth-state-date');
      if (oldDate) {
        state.stateDate = oldDate.value;
        state.statePresence = root.querySelector('.tooth-presence').value;
        state.stateNote = root.querySelector('.tooth-state-note').value;
      }
      if (!toothMap) root.innerHTML = `
        <div class="condition-editor" data-condition-mode="${escapeHtml(mode)}">
          <div class="section-header condition-header">
            <div>
              <p class="eyebrow">Zubi</p>
              <h2>${escapeHtml(title)}</h2>
            </div>
          </div>
          <div class="condition-layout">
            <div class="condition-map" aria-label="FDI selektor zuba">
            </div>
            <div class="condition-form">
              <label>
                Selektovani zubi
                <input class="condition-selected" type="text" value="${escapeHtml(selectedTeethList().join(", "))}" readonly />
              </label>
              <label>
                Opis za izabrane zube
                <textarea class="condition-notes" rows="4" placeholder="npr. stara plomba, karijes, zub nedostaje"></textarea>
              </label>
              <div class="condition-quick-notes" aria-label="Brze oznake za zateceno stanje">
                ${QUICK_NOTES.map(note => `<button class="secondary-btn condition-note-chip" type="button" data-condition-note="${escapeHtml(note)}">${escapeHtml(note)}</button>`).join("")}
              </div>
              <div class="form-actions condition-actions">
                <button class="primary-btn condition-add-btn" type="button">${state.editingId ? "Sacuvaj izmenu" : "Dodaj za izabrane zube"}</button>
                <button class="secondary-btn condition-clear-btn" type="button">Ocisti izbor</button>
              </div>
              <p class="form-alert condition-message" role="status"></p>
            </div>
          </div>
          <div class="condition-list"></div>
          <div class="condition-details"></div>
        </div>
      `;
      mountSharedToothMap();
      root.querySelector('.condition-list').innerHTML = renderList();
      root.querySelector('.condition-details').innerHTML = renderToothDetails();
      root.querySelector('.condition-selected').value = selectedTeethList().join(', ');
      root.querySelector('.condition-add-btn').textContent = state.editingId ? 'Sacuvaj izmenu' : 'Dodaj za izabrane zube';
      root.querySelector('.condition-notes').value = state.notes;
      if (state.stateDate) root.querySelector('.tooth-state-date').value = state.stateDate;
      if (state.statePresence && !(state.statePresence === 'exfoliated' && state.type === 'permanent')) root.querySelector('.tooth-presence').value = state.statePresence;
      root.querySelector('.tooth-state-note').value = state.stateNote || '';
      if (!canWrite) {
        root.querySelectorAll('.condition-add-btn, .condition-edit-btn, .condition-remove-btn, .tooth-state-save').forEach(button => { button.disabled = true; });
      }
    }

    function setMessage(message, isError = false) {
      const messageEl = root.querySelector(".condition-message");
      if (!messageEl) return;
      messageEl.textContent = message || "";
      messageEl.className = `form-alert condition-message ${isError ? "alert-error" : "alert-success"}`;
    }

    function clearForm() {
      state.selectedTeeth.clear();
      state.editingId = null;
      state.notes = '';
      render();
    }

    async function persistAdd(entry) {
      if (options.onAdd) return options.onAdd(payloadFromEntry(entry), entry);
      return entry;
    }

    async function persistUpdate(entry) {
      if (options.onUpdate) return options.onUpdate(entry.id, payloadFromEntry(entry), entry);
      return entry;
    }

    async function persistRemove(entry) {
      if (options.onRemove) await options.onRemove(entry);
    }

    root.addEventListener("click", async event => {
      if (event.target.closest('.tooth-history-all')) {
        state.selectedTeeth.clear(); render(); return;
      }
      if (event.target.closest('.tooth-state-save')) {
        if (state.busy || !canWrite) return;
        if (!state.selectedTeeth.size) return setMessage('Odaberite bar jedan zub.', true);
        const effectiveDate = root.querySelector('.tooth-state-date').value;
        const today = window.DrRosaDateUtils.isoDateKey(new Date());
        if (!effectiveDate || effectiveDate > today) return setMessage('Unesite datum koji nije u budućnosti.', true);
        const events = selectedTeethList().map(toothNumber => ({ toothNumber, presence: root.querySelector('.tooth-presence').value, effectiveDate, notes: root.querySelector('.tooth-state-note').value.trim() }));
        state.busy = true;
        const button = event.target.closest('button'); button.disabled = true;
        try {
          const saved = options.onStateAdd ? await options.onStateAdd(events) : events;
          state.events.push(...saved);
          render();
          setMessage('Stanje je evidentirano. Prethodni radovi su sačuvani.');
        } catch (error) { setMessage(error.message || 'Stanje nije sačuvano.', true); }
        finally { state.busy = false; button.disabled = false; }
        return;
      }
      const toothButton = event.target.closest("[data-condition-tooth]");
      if (toothButton && root.contains(toothButton)) {
        const tooth = toothButton.dataset.conditionTooth;
        if (state.selectedTeeth.has(tooth)) state.selectedTeeth.delete(tooth);
        else state.selectedTeeth.add(tooth);
        render();
        root.querySelector(`[data-condition-tooth="${tooth}"]`)?.focus({ preventScroll: true });
        return;
      }

      const clearButton = event.target.closest(".condition-clear-btn");
      if (clearButton && root.contains(clearButton)) {
        clearForm();
        return;
      }

      const addButton = event.target.closest(".condition-add-btn");
      if (addButton && root.contains(addButton)) {
        if (state.busy || !canWrite) return;
        const teeth = selectedTeethList();
        const status = "watch";
        const notes = root.querySelector(".condition-notes")?.value.trim() || "";
        if (!teeth.length) return setMessage("Odaberite bar jedan zub.", true);
        if (!notes) return setMessage("Unesite opis zatecenog stanja.", true);
        state.busy = true;
        addButton.disabled = true;
        try {
          for (const toothNumber of teeth) {
            const existingIndex = state.entries.findIndex(item => item.toothNumber === toothNumber);
            const previous = existingIndex >= 0 ? state.entries[existingIndex] : {};
            const entry = normalizeEntry({ ...previous, toothNumber, status, notes });
            if (entry.id) {
              const saved = normalizeEntry(await persistUpdate(entry) || entry);
              state.entries[existingIndex] = saved;
            } else {
              const saved = normalizeEntry(await persistAdd(entry) || entry);
              state.entries = state.entries.filter(item => item.toothNumber !== toothNumber);
              state.entries.push(saved);
            }
          }
          clearForm();
          setMessage("Zateceno stanje je dodato.");
        } catch (error) {
          setMessage(error.message || "Zateceno stanje nije sacuvano.", true);
        } finally { state.busy = false; addButton.disabled = false; }
        return;
      }

      const noteChip = event.target.closest(".condition-note-chip");
      if (noteChip && root.contains(noteChip)) {
        const notesEl = root.querySelector(".condition-notes");
        if (!notesEl) return;
        const note = noteChip.dataset.conditionNote || noteChip.textContent.trim();
        const current = notesEl.value.trim();
        const parts = current.split(",").map(item => item.trim()).filter(Boolean);
        if (!parts.some(item => item.toLowerCase() === note.toLowerCase())) {
          notesEl.value = current ? `${current}, ${note}` : note;
          state.notes = notesEl.value;
        }
        notesEl.focus();
        return;
      }

      const editButton = event.target.closest(".condition-edit-btn");
      if (editButton && root.contains(editButton)) {
        const entry = state.entries[Number(editButton.dataset.conditionIndex)];
        if (!entry) return;
        state.selectedTeeth = new Set([entry.toothNumber]);
        state.editingId = entry.id || entry.toothNumber;
        state.type = window.DrRosaDental.typeOf(entry.toothNumber) || state.type;
        state.notes = entry.notes;
        render();
        const notesEl = root.querySelector(".condition-notes");
        if (notesEl) notesEl.value = entry.notes;
        return;
      }

      const removeButton = event.target.closest(".condition-remove-btn");
      if (removeButton && root.contains(removeButton)) {
        if (state.busy || !canWrite) return;
        const index = Number(removeButton.dataset.conditionIndex);
        const entry = state.entries[index];
        if (!entry) return;
        state.busy = true;
        removeButton.disabled = true;
        try {
          await persistRemove(entry);
          state.entries.splice(index, 1);
          render();
          setMessage("Zateceno stanje je obrisano.");
        } catch (error) {
          setMessage(error.message || "Zateceno stanje nije obrisano.", true);
        } finally { state.busy = false; removeButton.disabled = false; }
      }
    });

    root.addEventListener('input', event => {
      if (event.target.matches('.condition-notes')) state.notes = event.target.value;
    });

    root.addEventListener("keydown", event => {
      const toothButton = event.target.closest("[data-condition-tooth]");
      if (!toothButton || !root.contains(toothButton)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toothButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    render();

    return {
      setPatientId(patientId) { options.patientId = patientId; render(); },
      setLocked(locked) { root.inert = Boolean(locked); root.setAttribute('aria-busy', String(Boolean(locked))); },
      getStateEvents() { return state.events.slice(); },
      setStateEvents(events = []) { state.events = events; render(); },
      setTreatments(treatments = []) { state.treatments = treatments; render(); },
      getEntries() {
        return state.entries.map(normalizeEntry);
      },
      setEntries(entries = []) {
        state.entries = entries.map(normalizeEntry);
        state.selectedTeeth.clear();
        state.editingId = null;
        render();
      },
      clear() {
        state.entries = [];
        clearForm();
      },
      payloadFromEntry
    };
  }

  window.DrRosaToothCondition = {
    INITIAL_ENTRY_TYPE,
    createEditor,
    initialConditionsFromEntries,
    payloadFromEntry
  };
})();
