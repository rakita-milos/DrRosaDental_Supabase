(function () {
  const FDI_TEETH = [
    ["18", "17", "16", "15", "14", "13", "12", "11"],
    ["21", "22", "23", "24", "25", "26", "27", "28"],
    ["48", "47", "46", "45", "44", "43", "42", "41"],
    ["31", "32", "33", "34", "35", "36", "37", "38"]
  ];

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
  let sharedToothMapPromise;

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
      currency: "EUR",
      priceRsd: 0,
      exchangeRateToRsd: 0,
      entryType: INITIAL_ENTRY_TYPE
    };
  }

  function initialConditionsFromEntries(entries = []) {
    return entries.filter(isInitialCondition).map(normalizeEntry);
  }

  function loadSharedToothMap() {
    if (!sharedToothMapPromise) {
      sharedToothMapPromise = fetch("new-entry.html")
        .then(response => {
          if (!response.ok) throw new Error("Mapa zuba nije dostupna.");
          return response.text();
        })
        .then(html => {
          const documentTemplate = new DOMParser().parseFromString(html, "text/html");
          const container = documentTemplate.querySelector(".ortomapa-container");
          if (!container) throw new Error("Mapa zuba nije pronadjena.");
          return container;
        });
    }
    return sharedToothMapPromise;
  }

  function createEditor(root, options = {}) {
    const state = {
      entries: (options.entries || []).map(normalizeEntry),
      selectedTeeth: new Set(),
      editingId: null
    };
    const title = options.title || "Zateceno stanje zuba";
    const emptyMessage = options.emptyMessage || "Nema dodatog zatecenog stanja.";
    const mode = options.mode || "draft";

    function selectedTeethList() {
      return Array.from(state.selectedTeeth).sort((a, b) => Number(a) - Number(b));
    }

    function renderFallbackTeeth() {
      const conditioned = new Set(state.entries.map(item => item.toothNumber));
      return FDI_TEETH.map((row, rowIndex) => `
        <div class="condition-teeth-row" data-row="${rowIndex}">
          ${row.map(tooth => `
            <button
              class="condition-tooth-btn${state.selectedTeeth.has(tooth) ? " selected" : ""}${conditioned.has(tooth) ? " conditioned" : ""}"
              type="button"
              data-condition-tooth="${escapeHtml(tooth)}"
              aria-pressed="${state.selectedTeeth.has(tooth) ? "true" : "false"}"
            >${escapeHtml(tooth)}</button>
          `).join("")}
        </div>
      `).join("");
    }

    async function mountSharedToothMap() {
      const target = root.querySelector(".condition-map");
      if (!target) return;
      try {
        const sourceMap = await loadSharedToothMap();
        if (!root.contains(target)) return;
        const clone = sourceMap.cloneNode(true);
        const conditioned = new Set(state.entries.map(item => item.toothNumber));
        clone.querySelectorAll(".tooth-node").forEach(toothNode => {
          const tooth = toothNode.dataset.tooth;
          toothNode.dataset.conditionTooth = tooth;
          toothNode.classList.add("condition-map-tooth");
          toothNode.classList.toggle("selected", state.selectedTeeth.has(tooth));
          toothNode.classList.toggle("initial-condition", conditioned.has(tooth));
          toothNode.setAttribute("aria-pressed", state.selectedTeeth.has(tooth) ? "true" : "false");
        });
        target.innerHTML = "";
        target.appendChild(clone);
      } catch (error) {
        target.innerHTML = renderFallbackTeeth();
      }
    }

    function renderList() {
      if (!state.entries.length) {
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
              ${state.entries.map((entry, index) => `
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
      root.innerHTML = `
        <div class="condition-editor" data-condition-mode="${escapeHtml(mode)}">
          <div class="section-header condition-header">
            <div>
              <p class="eyebrow">Zubi</p>
              <h2>${escapeHtml(title)}</h2>
            </div>
          </div>
          <div class="condition-layout">
            <div class="condition-map" aria-label="FDI selektor zuba">
              ${renderFallbackTeeth()}
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
          <div class="condition-list">${renderList()}</div>
        </div>
      `;
      mountSharedToothMap();
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
      const toothButton = event.target.closest("[data-condition-tooth]");
      if (toothButton && root.contains(toothButton)) {
        const tooth = toothButton.dataset.conditionTooth;
        if (state.selectedTeeth.has(tooth)) state.selectedTeeth.delete(tooth);
        else state.selectedTeeth.add(tooth);
        render();
        return;
      }

      const clearButton = event.target.closest(".condition-clear-btn");
      if (clearButton && root.contains(clearButton)) {
        clearForm();
        return;
      }

      const addButton = event.target.closest(".condition-add-btn");
      if (addButton && root.contains(addButton)) {
        const teeth = selectedTeethList();
        const status = "watch";
        const notes = root.querySelector(".condition-notes")?.value.trim() || "";
        if (!teeth.length) return setMessage("Odaberite bar jedan zub.", true);
        if (!notes) return setMessage("Unesite opis zatecenog stanja.", true);
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
        }
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
        render();
        const notesEl = root.querySelector(".condition-notes");
        if (notesEl) notesEl.value = entry.notes;
        return;
      }

      const removeButton = event.target.closest(".condition-remove-btn");
      if (removeButton && root.contains(removeButton)) {
        const index = Number(removeButton.dataset.conditionIndex);
        const entry = state.entries[index];
        if (!entry) return;
        try {
          await persistRemove(entry);
          state.entries.splice(index, 1);
          render();
          setMessage("Zateceno stanje je obrisano.");
        } catch (error) {
          setMessage(error.message || "Zateceno stanje nije obrisano.", true);
        }
      }
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
    FDI_TEETH,
    INITIAL_ENTRY_TYPE,
    createEditor,
    initialConditionsFromEntries,
    payloadFromEntry
  };
})();
