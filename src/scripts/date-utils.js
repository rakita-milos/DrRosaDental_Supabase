(function () {
  let openPicker = null;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const text = String(value).trim();
    const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return "-";
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  function parseDisplayDate(value) {
    const text = String(value || "").trim();
    const display = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
    if (!display) return "";
    const day = Number(display[1]);
    const month = Number(display[2]);
    const year = Number(display[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
    return isoDateKey(date);
  }

  function normalizeDisplayTime(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return "";
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
    return `${pad(hours)}:${pad(minutes)}`;
  }

  function formatTime(value) {
    const date = parseDate(value);
    if (!date) {
      const text = String(value || "").trim();
      const match = text.match(/^(\d{1,2}):(\d{2})/);
      if (!match) return "-";
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? `${pad(hours)}:${pad(minutes)}` : "-";
    }
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return "-";
    return `${formatDate(date)} ${formatTime(date)}`;
  }

  function isoDateKey(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localDateTimeString(value) {
    const date = parseDate(value);
    if (!date) return "";
    return `${isoDateKey(date)}T${formatTime(date)}:${pad(date.getSeconds())}`;
  }

  function closeOpenPicker(except = null) {
    if (openPicker && openPicker !== except) openPicker.hidden = true;
    openPicker = except;
  }

  function setInputValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function wrapInput(input, className) {
    const wrapper = document.createElement("span");
    wrapper.className = className;
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    return wrapper;
  }

  function enhanceDateInput(input) {
    if (!input || input.dataset.drrosaPickerReady === "date") return;
    input.dataset.drrosaPickerReady = "date";

    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const wasRequired = input.required;
    const wrapper = wrapInput(input, "drrosa-picker drrosa-date-picker");
    const displayInput = document.createElement("input");
    const button = document.createElement("button");
    const popover = document.createElement("div");
    input.required = false;
    displayInput.type = "text";
    displayInput.className = "drrosa-picker-text";
    if (input.id) displayInput.dataset.drrosaFor = input.id;
    displayInput.placeholder = "DD.MM.YYYY";
    displayInput.inputMode = "numeric";
    displayInput.autocomplete = "off";
    displayInput.required = wasRequired;
    displayInput.pattern = "\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\.?";
    if (input.getAttribute("form")) displayInput.setAttribute("form", input.getAttribute("form"));
    displayInput.setAttribute("aria-label", input.closest("label")?.textContent?.trim() || "Datum");
    button.type = "button";
    button.className = "drrosa-picker-button drrosa-picker-icon";
    button.setAttribute("aria-label", "Otvori kalendar");
    button.setAttribute("aria-haspopup", "dialog");
    popover.className = "drrosa-picker-popover";
    popover.hidden = true;
    wrapper.append(displayInput, button, popover);
    input.classList.add("drrosa-native-picker-input");

    function setDisplayValidity(isValid, message = "") {
      displayInput.setCustomValidity(message);
      displayInput.setAttribute("aria-invalid", isValid ? "false" : "true");
    }

    function syncDisplay() {
      displayInput.value = input.value ? formatDate(input.value) : "";
      setDisplayValidity(true);
    }

    function commitDisplayValue() {
      const value = displayInput.value.trim();
      if (!value) {
        setInputValue(input, "");
        setDisplayValidity(true);
        return true;
      }
      const parsed = parseDisplayDate(value);
      if (!parsed) {
        setDisplayValidity(false, "Unesite datum u formatu DD.MM.YYYY");
        return false;
      }
      setInputValue(input, parsed);
      syncDisplay();
      return true;
    }

    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return nativeValue.get.call(input);
      },
      set(value) {
        nativeValue.set.call(input, parseDisplayDate(value) || isoDateKey(value) || value || "");
        syncDisplay();
      }
    });

    function renderCalendar(baseValue = input.value || isoDateKey(new Date())) {
      const baseDate = parseDate(baseValue) || new Date();
      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const selected = input.value;
      const first = new Date(year, month, 1);
      const startOffset = (first.getDay() || 7) - 1;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthLabel = `${pad(month + 1)}.${year}`;
      const cells = [];
      for (let i = 0; i < startOffset; i += 1) cells.push('<span class="drrosa-picker-empty"></span>');
      for (let day = 1; day <= daysInMonth; day += 1) {
        const iso = isoDateKey(new Date(year, month, day));
        cells.push(`<button type="button" class="${iso === selected ? "active" : ""}" data-date="${iso}">${day}</button>`);
      }
      popover.innerHTML = `
        <div class="drrosa-picker-header">
          <button type="button" data-month="-1" aria-label="Prethodni mesec">‹</button>
          <strong>${monthLabel}</strong>
          <button type="button" data-month="1" aria-label="Sledeći mesec">›</button>
        </div>
        <div class="drrosa-picker-weekdays"><span>Pon</span><span>Uto</span><span>Sre</span><span>Čet</span><span>Pet</span><span>Sub</span><span>Ned</span></div>
        <div class="drrosa-picker-days">${cells.join("")}</div>
        <button type="button" class="drrosa-picker-today" data-date="${isoDateKey(new Date())}">Danas</button>
      `;
      popover.dataset.year = String(year);
      popover.dataset.month = String(month);
      popover.querySelectorAll("[data-month]").forEach(monthButton => {
        monthButton.addEventListener("click", event => {
          event.stopPropagation();
          renderCalendar(new Date(Number(popover.dataset.year), Number(popover.dataset.month) + Number(monthButton.dataset.month), 1));
        });
      });
      popover.querySelectorAll("[data-date]").forEach(dateButton => {
        dateButton.addEventListener("click", event => {
          event.stopPropagation();
          setInputValue(input, dateButton.dataset.date);
          syncDisplay();
          popover.hidden = true;
          closeOpenPicker(null);
        });
      });
    }

    displayInput.addEventListener("input", () => {
      setDisplayValidity(true);
    });
    displayInput.addEventListener("change", () => {
      commitDisplayValue();
    });
    displayInput.addEventListener("blur", () => {
      commitDisplayValue();
    });
    displayInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        commitDisplayValue();
      }
      if (event.key === "ArrowDown" && event.altKey) {
        event.preventDefault();
        closeOpenPicker(popover);
        popover.hidden = false;
        renderCalendar();
      }
    });
    button.addEventListener("click", () => {
      commitDisplayValue();
      const willOpen = popover.hidden;
      closeOpenPicker(willOpen ? popover : null);
      popover.hidden = !willOpen;
      if (willOpen) renderCalendar();
    });
    popover.addEventListener("click", event => {
      const monthButton = event.target.closest("[data-month]");
      if (monthButton) {
        renderCalendar(new Date(Number(popover.dataset.year), Number(popover.dataset.month) + Number(monthButton.dataset.month), 1));
        return;
      }
      const dateButton = event.target.closest("[data-date]");
      if (!dateButton) return;
      setInputValue(input, dateButton.dataset.date);
      syncDisplay();
      popover.hidden = true;
      closeOpenPicker(null);
    });
    input.addEventListener("change", syncDisplay);
    input.form?.addEventListener("submit", event => {
      if (commitDisplayValue()) return;
      event.preventDefault();
      displayInput.reportValidity();
    }, true);
    syncDisplay();
  }

  function enhanceTimeInput(input) {
    if (!input || input.dataset.drrosaPickerReady === "time") return;
    input.dataset.drrosaPickerReady = "time";

    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const wasRequired = input.required;
    const wrapper = wrapInput(input, "drrosa-picker drrosa-time-picker");
    const displayInput = document.createElement("input");
    const button = document.createElement("button");
    const popover = document.createElement("div");
    input.required = false;
    displayInput.type = "text";
    displayInput.className = "drrosa-picker-text";
    if (input.id) displayInput.dataset.drrosaFor = input.id;
    displayInput.placeholder = "HH:MM";
    displayInput.inputMode = "numeric";
    displayInput.autocomplete = "off";
    displayInput.required = wasRequired;
    displayInput.pattern = "\\d{1,2}:\\d{1,2}";
    if (input.getAttribute("form")) displayInput.setAttribute("form", input.getAttribute("form"));
    displayInput.setAttribute("aria-label", input.closest("label")?.textContent?.trim() || "Vreme");
    button.type = "button";
    button.className = "drrosa-picker-button drrosa-picker-icon";
    button.setAttribute("aria-label", "Otvori birac vremena");
    button.setAttribute("aria-haspopup", "dialog");
    popover.className = "drrosa-picker-popover drrosa-time-popover";
    popover.hidden = true;
    wrapper.append(displayInput, button, popover);
    input.classList.add("drrosa-native-picker-input");

    function normalize(value) {
      return normalizeDisplayTime(value) || (formatTime(value) === "-" ? "" : formatTime(value));
    }

    function setDisplayValidity(isValid, message = "") {
      displayInput.setCustomValidity(message);
      displayInput.setAttribute("aria-invalid", isValid ? "false" : "true");
    }

    function syncDisplay() {
      displayInput.value = input.value || "";
      setDisplayValidity(true);
    }

    function commitDisplayValue() {
      const value = displayInput.value.trim();
      if (!value) {
        setInputValue(input, "");
        setDisplayValidity(true);
        return true;
      }
      const normalized = normalizeDisplayTime(value);
      if (!normalized) {
        setDisplayValidity(false, "Unesite vreme u formatu HH:MM");
        return false;
      }
      setInputValue(input, normalized);
      syncDisplay();
      return true;
    }

    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return nativeValue.get.call(input);
      },
      set(value) {
        nativeValue.set.call(input, normalize(value));
        syncDisplay();
      }
    });

    function renderTime() {
      const [hour = "09", minute = "00"] = (input.value || "09:00").split(":");
      const hourOptions = Array.from({ length: 24 }, (_, index) => `<option value="${pad(index)}"${pad(index) === hour ? " selected" : ""}>${pad(index)}</option>`).join("");
      const minuteOptions = Array.from({ length: 60 }, (_, index) => `<option value="${pad(index)}"${pad(index) === minute ? " selected" : ""}>${pad(index)}</option>`).join("");
      popover.innerHTML = `
        <div class="drrosa-time-grid">
          <label>Sati<select data-time-hour>${hourOptions}</select></label>
          <label>Minuti<select data-time-minute>${minuteOptions}</select></label>
        </div>
        <button type="button" class="drrosa-picker-today" data-time-apply>Primeni</button>
      `;
    }

    displayInput.addEventListener("input", () => {
      setDisplayValidity(true);
    });
    displayInput.addEventListener("change", () => {
      commitDisplayValue();
    });
    displayInput.addEventListener("blur", () => {
      commitDisplayValue();
    });
    displayInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        commitDisplayValue();
      }
      if (event.key === "ArrowDown" && event.altKey) {
        event.preventDefault();
        closeOpenPicker(popover);
        popover.hidden = false;
        renderTime();
      }
    });
    button.addEventListener("click", () => {
      commitDisplayValue();
      const willOpen = popover.hidden;
      closeOpenPicker(willOpen ? popover : null);
      popover.hidden = !willOpen;
      if (willOpen) renderTime();
    });
    popover.addEventListener("click", event => {
      if (!event.target.closest("[data-time-apply]")) return;
      const hour = popover.querySelector("[data-time-hour]").value;
      const minute = popover.querySelector("[data-time-minute]").value;
      setInputValue(input, `${hour}:${minute}`);
      syncDisplay();
      popover.hidden = true;
      closeOpenPicker(null);
    });
    input.addEventListener("change", syncDisplay);
    input.form?.addEventListener("submit", event => {
      if (commitDisplayValue()) return;
      event.preventDefault();
      displayInput.reportValidity();
    }, true);
    syncDisplay();
  }

  function enhancePickers(root = document) {
    root.querySelectorAll?.('input[type="date"]:not([data-drrosa-picker-ready])').forEach(enhanceDateInput);
    root.querySelectorAll?.('input[type="time"]:not([data-drrosa-picker-ready])').forEach(enhanceTimeInput);
  }

  function startPickerEnhancer() {
    enhancePickers();
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          if (node.matches?.('input[type="date"]')) enhanceDateInput(node);
          if (node.matches?.('input[type="time"]')) enhanceTimeInput(node);
          enhancePickers(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", event => {
      if (!event.target.closest(".drrosa-picker")) closeOpenPicker(null);
    });
  }

  window.DrRosaDateUtils = {
    formatDate,
    formatTime,
    formatDateTime,
    isoDateKey,
    localDateTimeString,
    enhancePickers
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPickerEnhancer, { once: true });
  } else {
    startPickerEnhancer();
  }
})();
