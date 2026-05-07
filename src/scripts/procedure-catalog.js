(function () {
  const activities = {
    "Opšta stomatologija": [
      "Kontrola",
      "Čišćenje",
      "Kontrola i čišćenje",
      "Plomba",
      "Endodontija",
      "Izbeljivanje",
      "Parodontologija"
    ],
    "Hirurgija": [
      "Vađenja zuba",
      "Impakcija umnjaka",
      "Impakcija očnjaka",
      "Apikotomija",
      "Hirurško vađenje",
      "Kiretaža",
      "Zatvaranje sinusa",
      "Frenulum",
      "Meka tkiva",
      "Nivelacija grebena",
      "Zaostali korenovi",
      "Implant",
      "Mini implanti",
      "Operacija"
    ],
    "Protetika": [
      "Keramička kruna",
      "Cirkonijum kruna",
      "Totalna proteza",
      "Skeletirana proteza",
      "Parcijalna proteza",
      "Reparatura proteze",
      "Privremene krune",
      "Splintevi",
      "Nadogradnja",
      "Atečmeni",
      "Krunica na implantu",
      "Podlaganje proteze",
      "Fasete",
      "Ostalo"
    ],
    "Ortodoncija": [
      "Mobilna",
      "Fiksna",
      "Pozicioner",
      "Monoblok",
      "Ostalo"
    ]
  };

  const prices = {
    "Kontrola": 30,
    "Čišćenje": 50,
    "Kontrola i čišćenje": 50,
    "Plomba": 60,
    "Endodontija": 120,
    "Izbeljivanje": 150,
    "Parodontologija": 90,
    "Vađenja zuba": 50,
    "Hirurško vađenje": 90,
    "Impakcija umnjaka": 180,
    "Impakcija očnjaka": 220,
    "Apikotomija": 180,
    "Kiretaža": 80,
    "Zatvaranje sinusa": 250,
    "Frenulum": 90,
    "Meka tkiva": 100,
    "Nivelacija grebena": 150,
    "Zaostali korenovi": 70,
    "Implant": 600,
    "Mini implanti": 250,
    "Operacija": 200,
    "Keramička kruna": 250,
    "Cirkonijum kruna": 300,
    "Totalna proteza": 450,
    "Skeletirana proteza": 500,
    "Parcijalna proteza": 350,
    "Reparatura proteze": 60,
    "Privremene krune": 40,
    "Splintevi": 80,
    "Nadogradnja": 90,
    "Atečmeni": 120,
    "Krunica na implantu": 300,
    "Podlaganje proteze": 90,
    "Fasete": 220,
    "Mobilna": 600,
    "Fiksna": 900,
    "Pozicioner": 120,
    "Monoblok": 180,
    "Ostalo": 0
  };

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

  window.DrRosaProcedureCatalog = {
    activities,
    getActivities,
    getProcedures,
    getAllProcedures,
    getPrice,
    findActivityForProcedure,
    matchesActivity
  };
})();
