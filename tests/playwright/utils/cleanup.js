const { tokenFor } = require("./auth");

function authHeaders(role = "director") {
  return {
    Authorization: `Bearer ${tokenFor(role)}`
  };
}

async function cleanupPatientsAndRecords(request, baseURL, prefixes) {
  const recordsResponse = await request.get(`${baseURL}/api/records`, { headers: authHeaders("staff") });
  if (recordsResponse.ok()) {
    const records = await recordsResponse.json();
    for (const record of records) {
      const patient = String(record.patient || "");
      const note = String(record.notes || record.note || "");
      if (prefixes.some(prefix => patient.includes(prefix) || note.includes(prefix))) {
        await request.delete(`${baseURL}/api/records/${record.id}`, { headers: authHeaders("staff") });
      }
    }
  }

  const patientsResponse = await request.get(`${baseURL}/api/patients`, { headers: authHeaders("staff") });
  if (!patientsResponse.ok()) return;
  const patients = await patientsResponse.json();
  for (const patient of patients) {
    const fullName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
    const email = String(patient.email || "");
    if (prefixes.some(prefix => fullName.includes(prefix) || email.includes(prefix.toLowerCase()))) {
      await request.delete(`${baseURL}/api/patients/${patient.id}`, { headers: authHeaders("staff") });
    }
  }
}

async function cleanupCodebooks(request, baseURL, prefixes) {
  const response = await request.get(`${baseURL}/api/director/codebooks`, { headers: authHeaders("director") });
  if (!response.ok()) return;
  const items = await response.json();
  for (const item of items) {
    const value = String(item.value || "");
    const label = String(item.label || "");
    if (prefixes.some(prefix => value.includes(prefix) || label.includes(prefix))) {
      await request.delete(`${baseURL}/api/director/codebooks/${item.id}`, { headers: authHeaders("director") });
    }
  }
}

async function cleanupRegressionData(request, baseURL, prefixes = ["E2E", "Regression", "Test smena", "Test delatnost", "Izmenjena delatnost"]) {
  await cleanupPatientsAndRecords(request, baseURL, prefixes);
  await cleanupCodebooks(request, baseURL, prefixes);
}

module.exports = { cleanupRegressionData };
