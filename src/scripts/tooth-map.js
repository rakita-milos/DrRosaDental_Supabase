(function () {
  const permanentSvg = `<svg class="ortomapa natural-tooth-map" viewBox="0 0 760 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Interaktivna FDI mapa zuba">
            <defs>
              <linearGradient id="gradient-treated" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#63b73a;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#1891f0;stop-opacity:1" />
              </linearGradient>
              <linearGradient id="tooth-natural" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                <stop offset="45%" style="stop-color:#fbfdff;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#e8f2f8;stop-opacity:1" />
              </linearGradient>
              <radialGradient id="tooth-shine" cx="36%" cy="24%" r="62%">
                <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.92" />
                <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0" />
              </radialGradient>
            </defs>
            <path class="jaw-guide upper" d="M110 240 C150 72 300 44 380 44 C460 44 610 72 650 240" />
            <path class="jaw-guide lower" d="M110 320 C150 488 300 516 380 516 C460 516 610 488 650 320" />
            <line class="jaw-midline" x1="380" y1="54" x2="380" y2="506" />
            <text x="380" y="20" class="jaw-label">Gornja vilica</text>
            <text x="380" y="556" class="jaw-label">Donja vilica</text>
            <g class="tooth-node" data-tooth="18" tabindex="0" role="button" aria-label="Zub 18"><ellipse class="tooth-hit" cx="118" cy="229" rx="32" ry="36"/><ellipse class="tooth-surface molar" cx="118" cy="229" rx="25" ry="29"/><path class="tooth-groove" d="M103 229 H133 M118 211 V247"/><text x="118" y="234" class="tooth-number">18</text></g>
            <g class="tooth-node" data-tooth="17" tabindex="0" role="button" aria-label="Zub 17"><ellipse class="tooth-hit" cx="126" cy="185" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="126" cy="185" rx="27" ry="30"/><path class="tooth-groove" d="M109 185 H143 M126 166 V204"/><text x="126" y="190" class="tooth-number">17</text></g>
            <g class="tooth-node" data-tooth="16" tabindex="0" role="button" aria-label="Zub 16"><ellipse class="tooth-hit" cx="146" cy="143" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="146" cy="143" rx="27" ry="30"/><path class="tooth-groove" d="M129 143 H163 M146 124 V162"/><text x="146" y="148" class="tooth-number">16</text></g>
            <g class="tooth-node" data-tooth="15" tabindex="0" role="button" aria-label="Zub 15"><ellipse class="tooth-hit" cx="178" cy="108" rx="30" ry="34"/><ellipse class="tooth-surface premolar" cx="178" cy="108" rx="22" ry="27"/><path class="tooth-groove" d="M166 108 H190"/><text x="178" y="113" class="tooth-number">15</text></g>
            <g class="tooth-node" data-tooth="14" tabindex="0" role="button" aria-label="Zub 14"><ellipse class="tooth-hit" cx="217" cy="83" rx="30" ry="33"/><ellipse class="tooth-surface premolar" cx="217" cy="83" rx="21" ry="26"/><path class="tooth-groove" d="M205 83 H229"/><text x="217" y="88" class="tooth-number">14</text></g>
            <g class="tooth-node" data-tooth="13" tabindex="0" role="button" aria-label="Zub 13"><ellipse class="tooth-hit" cx="263" cy="67" rx="28" ry="34"/><path class="tooth-surface canine" d="M263 40 C282 54 281 86 263 99 C245 86 244 54 263 40Z"/><text x="263" y="72" class="tooth-number">13</text></g>
            <g class="tooth-node" data-tooth="12" tabindex="0" role="button" aria-label="Zub 12"><ellipse class="tooth-hit" cx="315" cy="58" rx="26" ry="31"/><path class="tooth-surface incisor" d="M298 36 H332 C336 57 333 78 315 88 C297 78 294 57 298 36Z"/><text x="315" y="63" class="tooth-number">12</text></g>
            <g class="tooth-node" data-tooth="11" tabindex="0" role="button" aria-label="Zub 11"><ellipse class="tooth-hit" cx="363" cy="56" rx="28" ry="32"/><path class="tooth-surface incisor wide" d="M344 34 H382 C387 56 383 80 363 90 C343 80 339 56 344 34Z"/><text x="363" y="61" class="tooth-number">11</text></g>

            <g class="tooth-node" data-tooth="21" tabindex="0" role="button" aria-label="Zub 21"><ellipse class="tooth-hit" cx="397" cy="56" rx="28" ry="32"/><path class="tooth-surface incisor wide" d="M378 34 H416 C421 56 417 80 397 90 C377 80 373 56 378 34Z"/><text x="397" y="61" class="tooth-number">21</text></g>
            <g class="tooth-node" data-tooth="22" tabindex="0" role="button" aria-label="Zub 22"><ellipse class="tooth-hit" cx="445" cy="58" rx="26" ry="31"/><path class="tooth-surface incisor" d="M428 36 H462 C466 57 463 78 445 88 C427 78 424 57 428 36Z"/><text x="445" y="63" class="tooth-number">22</text></g>
            <g class="tooth-node" data-tooth="23" tabindex="0" role="button" aria-label="Zub 23"><ellipse class="tooth-hit" cx="497" cy="67" rx="28" ry="34"/><path class="tooth-surface canine" d="M497 40 C516 54 515 86 497 99 C479 86 478 54 497 40Z"/><text x="497" y="72" class="tooth-number">23</text></g>
            <g class="tooth-node" data-tooth="24" tabindex="0" role="button" aria-label="Zub 24"><ellipse class="tooth-hit" cx="543" cy="83" rx="30" ry="33"/><ellipse class="tooth-surface premolar" cx="543" cy="83" rx="21" ry="26"/><path class="tooth-groove" d="M531 83 H555"/><text x="543" y="88" class="tooth-number">24</text></g>
            <g class="tooth-node" data-tooth="25" tabindex="0" role="button" aria-label="Zub 25"><ellipse class="tooth-hit" cx="582" cy="108" rx="30" ry="34"/><ellipse class="tooth-surface premolar" cx="582" cy="108" rx="22" ry="27"/><path class="tooth-groove" d="M570 108 H594"/><text x="582" y="113" class="tooth-number">25</text></g>
            <g class="tooth-node" data-tooth="26" tabindex="0" role="button" aria-label="Zub 26"><ellipse class="tooth-hit" cx="614" cy="143" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="614" cy="143" rx="27" ry="30"/><path class="tooth-groove" d="M597 143 H631 M614 124 V162"/><text x="614" y="148" class="tooth-number">26</text></g>
            <g class="tooth-node" data-tooth="27" tabindex="0" role="button" aria-label="Zub 27"><ellipse class="tooth-hit" cx="634" cy="185" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="634" cy="185" rx="27" ry="30"/><path class="tooth-groove" d="M617 185 H651 M634 166 V204"/><text x="634" y="190" class="tooth-number">27</text></g>
            <g class="tooth-node" data-tooth="28" tabindex="0" role="button" aria-label="Zub 28"><ellipse class="tooth-hit" cx="642" cy="229" rx="32" ry="36"/><ellipse class="tooth-surface molar" cx="642" cy="229" rx="25" ry="29"/><path class="tooth-groove" d="M627 229 H657 M642 211 V247"/><text x="642" y="234" class="tooth-number">28</text></g>

            <g class="tooth-node" data-tooth="48" tabindex="0" role="button" aria-label="Zub 48"><ellipse class="tooth-hit" cx="118" cy="331" rx="32" ry="36"/><ellipse class="tooth-surface molar" cx="118" cy="331" rx="25" ry="29"/><path class="tooth-groove" d="M103 331 H133 M118 313 V349"/><text x="118" y="336" class="tooth-number">48</text></g>
            <g class="tooth-node" data-tooth="47" tabindex="0" role="button" aria-label="Zub 47"><ellipse class="tooth-hit" cx="126" cy="375" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="126" cy="375" rx="27" ry="30"/><path class="tooth-groove" d="M109 375 H143 M126 356 V394"/><text x="126" y="380" class="tooth-number">47</text></g>
            <g class="tooth-node" data-tooth="46" tabindex="0" role="button" aria-label="Zub 46"><ellipse class="tooth-hit" cx="146" cy="417" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="146" cy="417" rx="27" ry="30"/><path class="tooth-groove" d="M129 417 H163 M146 398 V436"/><text x="146" y="422" class="tooth-number">46</text></g>
            <g class="tooth-node" data-tooth="45" tabindex="0" role="button" aria-label="Zub 45"><ellipse class="tooth-hit" cx="178" cy="452" rx="30" ry="34"/><ellipse class="tooth-surface premolar" cx="178" cy="452" rx="22" ry="27"/><path class="tooth-groove" d="M166 452 H190"/><text x="178" y="457" class="tooth-number">45</text></g>
            <g class="tooth-node" data-tooth="44" tabindex="0" role="button" aria-label="Zub 44"><ellipse class="tooth-hit" cx="217" cy="477" rx="30" ry="33"/><ellipse class="tooth-surface premolar" cx="217" cy="477" rx="21" ry="26"/><path class="tooth-groove" d="M205 477 H229"/><text x="217" y="482" class="tooth-number">44</text></g>
            <g class="tooth-node" data-tooth="43" tabindex="0" role="button" aria-label="Zub 43"><ellipse class="tooth-hit" cx="263" cy="493" rx="28" ry="34"/><path class="tooth-surface canine" d="M263 520 C282 506 281 474 263 461 C245 474 244 506 263 520Z"/><text x="263" y="498" class="tooth-number">43</text></g>
            <g class="tooth-node" data-tooth="42" tabindex="0" role="button" aria-label="Zub 42"><ellipse class="tooth-hit" cx="315" cy="502" rx="26" ry="31"/><path class="tooth-surface incisor" d="M298 524 H332 C336 503 333 482 315 472 C297 482 294 503 298 524Z"/><text x="315" y="507" class="tooth-number">42</text></g>
            <g class="tooth-node" data-tooth="41" tabindex="0" role="button" aria-label="Zub 41"><ellipse class="tooth-hit" cx="363" cy="504" rx="28" ry="32"/><path class="tooth-surface incisor wide" d="M344 526 H382 C387 504 383 480 363 470 C343 480 339 504 344 526Z"/><text x="363" y="509" class="tooth-number">41</text></g>

            <g class="tooth-node" data-tooth="31" tabindex="0" role="button" aria-label="Zub 31"><ellipse class="tooth-hit" cx="397" cy="504" rx="28" ry="32"/><path class="tooth-surface incisor wide" d="M378 526 H416 C421 504 417 480 397 470 C377 480 373 504 378 526Z"/><text x="397" y="509" class="tooth-number">31</text></g>
            <g class="tooth-node" data-tooth="32" tabindex="0" role="button" aria-label="Zub 32"><ellipse class="tooth-hit" cx="445" cy="502" rx="26" ry="31"/><path class="tooth-surface incisor" d="M428 524 H462 C466 503 463 482 445 472 C427 482 424 503 428 524Z"/><text x="445" y="507" class="tooth-number">32</text></g>
            <g class="tooth-node" data-tooth="33" tabindex="0" role="button" aria-label="Zub 33"><ellipse class="tooth-hit" cx="497" cy="493" rx="28" ry="34"/><path class="tooth-surface canine" d="M497 520 C516 506 515 474 497 461 C479 474 478 506 497 520Z"/><text x="497" y="498" class="tooth-number">33</text></g>
            <g class="tooth-node" data-tooth="34" tabindex="0" role="button" aria-label="Zub 34"><ellipse class="tooth-hit" cx="543" cy="477" rx="30" ry="33"/><ellipse class="tooth-surface premolar" cx="543" cy="477" rx="21" ry="26"/><path class="tooth-groove" d="M531 477 H555"/><text x="543" y="482" class="tooth-number">34</text></g>
            <g class="tooth-node" data-tooth="35" tabindex="0" role="button" aria-label="Zub 35"><ellipse class="tooth-hit" cx="582" cy="452" rx="30" ry="34"/><ellipse class="tooth-surface premolar" cx="582" cy="452" rx="22" ry="27"/><path class="tooth-groove" d="M570 452 H594"/><text x="582" y="457" class="tooth-number">35</text></g>
            <g class="tooth-node" data-tooth="36" tabindex="0" role="button" aria-label="Zub 36"><ellipse class="tooth-hit" cx="614" cy="417" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="614" cy="417" rx="27" ry="30"/><path class="tooth-groove" d="M597 417 H631 M614 398 V436"/><text x="614" y="422" class="tooth-number">36</text></g>
            <g class="tooth-node" data-tooth="37" tabindex="0" role="button" aria-label="Zub 37"><ellipse class="tooth-hit" cx="634" cy="375" rx="34" ry="36"/><ellipse class="tooth-surface molar" cx="634" cy="375" rx="27" ry="30"/><path class="tooth-groove" d="M617 375 H651 M634 356 V394"/><text x="634" y="380" class="tooth-number">37</text></g>
            <g class="tooth-node" data-tooth="38" tabindex="0" role="button" aria-label="Zub 38"><ellipse class="tooth-hit" cx="642" cy="331" rx="32" ry="36"/><ellipse class="tooth-surface molar" cx="642" cy="331" rx="25" ry="29"/><path class="tooth-groove" d="M627 331 H657 M642 313 V349"/><text x="642" y="336" class="tooth-number">38</text></g>
          </svg>`;
  let sequence = 0;
  function svgFor(type, id) {
    const template = document.createElement('template');
    template.innerHTML = permanentSvg;
    const svg = template.content.firstElementChild;
    svg.setAttribute('aria-label', `FDI mapa: ${window.DrRosaDental.labels[type]}`);
    for (const key of ['tooth-natural','tooth-shine','gradient-treated']) svg.style.setProperty(`--${key}`, `url(#${key}-${id})`);
    const ids = new Map();
    svg.querySelectorAll('[id]').forEach(node => {
      const old = node.id;
      node.id = `${old}-${id}`;
      ids.set(old, node.id);
    });
    svg.querySelectorAll('*').forEach(child => {
      for (const attribute of [...child.attributes]) {
        if (!attribute.value.includes('url(#')) continue;
        child.setAttribute(attribute.name, attribute.value.replace(/url\(#([^)]+)\)/g, (match, key) => ids.has(key) ? `url(#${ids.get(key)})` : match));
      }
    });
    if (type === 'primary') {
      svg.querySelectorAll('.tooth-node').forEach(node => {
        const old = node.dataset.tooth;
        const position = Number(old[1]);
        if (position > 5) return node.remove();
        const tooth = `${Number(old[0]) + 4}${position}`;
        node.dataset.tooth = tooth;
        node.setAttribute('aria-label', `Mlečni zub ${tooth}`);
        node.querySelector('.tooth-number').textContent = tooth;
        if (position >= 4) node.querySelector('.tooth-surface').classList.replace('premolar', 'molar');
      });
    }
    svg.querySelectorAll('.tooth-node').forEach(node => {
      const hit = node.querySelector('.tooth-hit');
      const x = Number(hit.getAttribute('cx')), y = Number(hit.getAttribute('cy'));
      if (type === 'primary') {
        const p = Number(node.dataset.tooth[1]);
        const targetX = [0, 337, 260, 190, 140, 115][p];
        const targetY = [0, 70, 88, 125, 177, 235][p];
        const quadrant = Number(node.dataset.tooth[0]);
        node.setAttribute('transform', `translate(${(quadrant === 5 || quadrant === 8 ? targetX : 760-targetX)-x} ${(quadrant < 7 ? targetY : 560-targetY)-y})`);
      } else node.setAttribute('transform', `translate(${(x-380)*0.30} ${(y-280)*0.06})`);
      node.setAttribute('aria-pressed', 'false');
    });
    const side = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    side.setAttribute('x','380'); side.setAttribute('y','280'); side.setAttribute('class','jaw-label');
    side.textContent = 'Desna strana pacijenta ← → Leva strana pacijenta';
    svg.appendChild(side);
    return svg;
  }
  function create(root, options = {}) {
    const id = `dentition-${++sequence}`;
    let type = options.type === 'primary' ? 'primary' : 'permanent';
    root.innerHTML = `<div class="dentition-tabs" role="tablist" aria-label="Vrsta zuba">${Object.entries(window.DrRosaDental.labels).map(([key,label]) => `<button type="button" class="secondary-btn" role="tab" id="${id}-${key}-tab" data-dentition="${key}" aria-controls="${id}-${key}">${label}</button>`).join('')}</div>`;
    for (const key of ['permanent','primary']) {
      const panel = document.createElement('div');
      panel.className = 'ortomapa-container dentition-panel';
      panel.id = `${id}-${key}`; panel.dataset.dentitionPanel = key;
      panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',`${id}-${key}-tab`);
      panel.appendChild(svgFor(key, `${id}-${key}`)); root.appendChild(panel);
    }
    const hint = document.createElement('p');
    hint.className = 'tooth-map-mobile-hint';
    hint.textContent = 'Pomerite mapu levo ili desno za izbor zuba.';
    root.appendChild(hint);
    const historyLegend = document.createElement('p');
    historyLegend.className = 'tooth-map-history-legend';
    historyLegend.textContent = 'Narandžasta oznaka: ranije evidentirano vađenje; trenutno stanje nije evidentirano.';
    historyLegend.hidden = true;
    root.appendChild(historyLegend);
    function setType(next, notify = true) {
      if (!window.DrRosaDental.labels[next]) return;
      type = next;
      root.querySelectorAll('[data-dentition]').forEach(button => {
        const active = button.dataset.dentition === type;
        button.setAttribute('aria-selected',String(active)); button.tabIndex = active ? 0 : -1;
        button.classList.toggle('active',active);
      });
      root.querySelectorAll('[data-dentition-panel]').forEach(panel => { panel.hidden = panel.dataset.dentitionPanel !== type; });
      updateHistoryLegend();
      if (notify) options.onChange?.(type);
    }
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-dentition]');
      if (!button || !root.contains(button) || button.dataset.dentition === type) return;
      if (options.beforeChange?.(button.dataset.dentition) === false) return;
      setType(button.dataset.dentition);
    });
    root.addEventListener('keydown', event => {
      const tab = event.target.closest('[data-dentition]');
      if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'permanent' : event.key === 'End' ? 'primary' : type === 'permanent' ? 'primary' : 'permanent';
      root.querySelector(`[data-dentition="${next}"]`).click();
      root.querySelector(`[data-dentition="${type}"]`).focus();
    });
    setType(type,false);
    function updateHistoryLegend() {
      historyLegend.hidden = !root.querySelector('[data-dentition-panel]:not([hidden]) [data-extraction-history="true"]');
    }
    function markHistoricalExtractions(teeth, latest) {
      root.querySelectorAll('.tooth-node').forEach(node => {
        const inferred = teeth.has(node.dataset.tooth) && !latest.has(node.dataset.tooth);
        node.dataset.extractionHistory = String(inferred);
        if (inferred) node.setAttribute('aria-label', `${node.getAttribute('aria-label')}; ranije evidentirano vađenje, trenutno stanje nije evidentirano`);
      });
      updateHistoryLegend();
    }
    return { setType, getType: () => type, nodes: [...root.querySelectorAll('.tooth-node')], markHistoricalExtractions };
  }
  window.DrRosaToothMap = { create };
})();
