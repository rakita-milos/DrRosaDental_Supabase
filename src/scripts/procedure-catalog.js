(function () {
  let activities = {
    "Pregledi i dijagnostika": [
      "Analiza snimka",
      "Pregled sa planom"
    ],
    "Preventivna stomatologija": [
      "Zalivanje fisura",
      "Pesikiranje zuba"
    ],
    "Konzervativna stomatologija": [
      "Kompozitna plomba I klasa",
      "Kompozitna plomba V klasa",
      "Kompozitna plomba II klasa",
      "Kompozitna plomba MOD",
      "Indirektno prekrivanje pulpe",
      "Amalgamska plomba",
      "Kompozitna nadogradnja zuba",
      "Kompozitni ispun na lecenom zubu / kom"
    ],
    "Endodoncija": [
      "Lecenje zuba I faza",
      "Lecenje zuba II faza",
      "Lecenje zuba III faza",
      "Lecenje zuba",
      "Lecenje zuba - Ca kanalno punjenje",
      "Revizija",
      "Masinska endodoncija I faza",
      "Masinska endodoncija II faza",
      "Masinska endodoncija III faza",
      "Lecenje zuba - trepanacija komore i ekstirpacija pulpe / kom",
      "Interseansna medikacija kanala / kom",
      "Lecenje zuba - instrumentacija kanala - incizivi / kom",
      "Lecenje zuba - instrumentacija kanala - premolari / kom",
      "Lecenje zuba - instrumentacija kanala - molari / kom",
      "Lecenje zuba - opturacija kanala - premolari i incizivi / kom",
      "Lecenje zuba - opturacija kanala - molari / kom"
    ],
    "Decja stomatologija": [
      "Plomba na mlecnom zubu I klasa",
      "Plomba na mlecnom zubu II klasa",
      "Indirektno prekrivanje pulpe na mlecnom zubu",
      "Kompozitna plomba na mlecnom zubu",
      "Lecenje mlecnog zuba I faza",
      "Vadjenje mlecnog zuba"
    ],
    "Oralna hirurgija": [
      "Vadjenje zuba",
      "Komplikovano vadjenje"
    ],
    "Parodontologija": [
      "Uklanjanje zubnog kamenca i uklanjanje mekih naslaga",
      "Uklanjanje zubnog kamenca i mekih naslaga sa ispiranjem dzepova",
      "Kiretaza parodontalnog dzepa",
      "Lasersko oblikovanje gingive",
      "Parodontoloska rezanj operacija / kom"
    ],
    "Protetika": [
      "Metalni kocic",
      "Livena nadogradnja",
      "Skidanje stare krune po zubu",
      "Privremena krunica"
    ],
    "Estetska stomatologija": [
      "Fasete kompozitne",
      "Korekcija fasete",
      "Izbeljivanje zuba"
    ],
    "Okluzija i splint terapija": [
      "Sportski splint",
      "Splint terapija bruksizma"
    ]
  };

  let prices = {
    "Analiza snimka": 1000,
    "Pregled sa planom": 2000,
    "Zalivanje fisura": 2000,
    "Pesikiranje zuba": 1000,
    "Kompozitna plomba I klasa": 4000,
    "Kompozitna plomba V klasa": 4000,
    "Kompozitna plomba II klasa": 4500,
    "Kompozitna plomba MOD": 5000,
    "Indirektno prekrivanje pulpe": 1500,
    "Amalgamska plomba": 2500,
    "Kompozitna nadogradnja zuba": 5000,
    "Kompozitni ispun na lecenom zubu / kom": 4000,
    "Lecenje zuba I faza": 2000,
    "Lecenje zuba II faza": 2000,
    "Lecenje zuba III faza": 3000,
    "Lecenje zuba": 3000,
    "Lecenje zuba - Ca kanalno punjenje": 2000,
    "Revizija": 4000,
    "Masinska endodoncija I faza": 2000,
    "Masinska endodoncija II faza": 4000,
    "Masinska endodoncija III faza": 3000,
    "Lecenje zuba - trepanacija komore i ekstirpacija pulpe / kom": 2000,
    "Interseansna medikacija kanala / kom": 2000,
    "Lecenje zuba - instrumentacija kanala - incizivi / kom": 4000,
    "Lecenje zuba - instrumentacija kanala - premolari / kom": 5000,
    "Lecenje zuba - instrumentacija kanala - molari / kom": 6000,
    "Lecenje zuba - opturacija kanala - premolari i incizivi / kom": 3000,
    "Lecenje zuba - opturacija kanala - molari / kom": 4000,
    "Plomba na mlecnom zubu I klasa": 2500,
    "Plomba na mlecnom zubu II klasa": 3000,
    "Indirektno prekrivanje pulpe na mlecnom zubu": 1000,
    "Kompozitna plomba na mlecnom zubu": 3000,
    "Lecenje mlecnog zuba I faza": 2000,
    "Vadjenje mlecnog zuba": 2500,
    "Vadjenje zuba": 4000,
    "Komplikovano vadjenje": 6000,
    "Uklanjanje zubnog kamenca i uklanjanje mekih naslaga": 3500,
    "Uklanjanje zubnog kamenca i mekih naslaga sa ispiranjem dzepova": 4000,
    "Kiretaza parodontalnog dzepa": 1500,
    "Lasersko oblikovanje gingive": 3600,
    "Parodontoloska rezanj operacija / kom": 25000,
    "Metalni kocic": 4500,
    "Livena nadogradnja": 8000,
    "Skidanje stare krune po zubu": 1500,
    "Privremena krunica": 4700,
    "Fasete kompozitne": 7000,
    "Korekcija fasete": 4000,
    "Izbeljivanje zuba": 18000,
    "Sportski splint": 8000,
    "Splint terapija bruksizma": 8000
  };
  let priceCurrencies = Object.fromEntries(Object.keys(prices).map(procedure => [procedure, "RSD"]));

  function fold(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function getActivities() {
    return Object.keys(activities);
  }

  function getProcedures(activity) {
    return activities[activity] || [];
  }

  function getAllProcedures() {
    return getActivities().flatMap(getProcedures);
  }

  function getPrice(procedure) {
    return prices[procedure] || 0;
  }

  function getPriceCurrency(procedure) {
    return priceCurrencies[procedure] || "RSD";
  }

  function getPriceInfo(procedure) {
    return {
      amount: getPrice(procedure),
      currency: getPriceCurrency(procedure)
    };
  }

  function findActivityForProcedure(procedure) {
    const normalized = fold(procedure);
    return getActivities().find(activity => getProcedures(activity).some(item => {
      const normalizedItem = fold(item);
      return normalized === normalizedItem || normalized.includes(normalizedItem) || normalizedItem.includes(normalized);
    })) || "";
  }

  function matchesActivity(record, activity) {
    if (!activity) return true;
    const procedures = getProcedures(activity).map(fold);
    const values = [record.procedure];
    if (record.treatments) {
      Object.values(record.treatments).forEach(treatments => {
        (Array.isArray(treatments) ? treatments : [treatments]).forEach(treatment => values.push(treatment?.type));
      });
    }
    return values.some(value => {
      const normalized = fold(value);
      return procedures.some(procedure => normalized === procedure || normalized.includes(procedure) || procedure.includes(normalized));
    });
  }

  async function loadFromApi() {
    if (!window.DrRosaApi?.getCodebooks || !window.DrRosaApi.getSession?.()) return;
    try {
      const items = await window.DrRosaApi.getCodebooks();
      const activeItems = items.filter(item => item.isActive !== false);
      const nextActivities = {};
      const nextPrices = {};
      const nextPriceCurrencies = {};

      activeItems
        .filter(item => item.type === "activity")
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.label.localeCompare(b.label))
        .forEach(item => {
          nextActivities[item.value] = [];
        });

      activeItems
        .filter(item => item.type === "procedure")
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.label.localeCompare(b.label))
        .forEach(item => {
          const group = item.groupName || "Ostalo";
          if (!nextActivities[group]) nextActivities[group] = [];
          nextActivities[group].push(item.value);
          nextPrices[item.value] = Number(item.price || 0);
          nextPriceCurrencies[item.value] = item.priceCurrency || item.price_currency || "RSD";
        });

      if (Object.keys(nextActivities).length > 0) {
        activities = nextActivities;
        prices = nextPrices;
        priceCurrencies = nextPriceCurrencies;
        window.DrRosaProcedureCatalog.activities = activities;
      }
    } catch (error) {
      console.error("Codebook catalog load error:", error);
    }
  }

  window.DrRosaProcedureCatalog = {
    activities,
    getActivities,
    getProcedures,
    getAllProcedures,
    getPrice,
    getPriceCurrency,
    getPriceInfo,
    findActivityForProcedure,
    matchesActivity,
    loadFromApi
  };
})();
