const { tokenFor } = require("./auth");

function authHeaders(role = "director") {
  return {
    Authorization: `Bearer ${tokenFor(role)}`
  };
}

async function cleanupPatientsAndRecords(request, baseURL, prefixes) {
  const appointmentsResponse = await request.get(`${baseURL}/api/appointments?from=1970-01-01T00:00:00.000Z&to=2999-12-31T23:59:59.999Z`, { headers: authHeaders("staff") });
  if (appointmentsResponse.ok()) {
    const appointments = await appointmentsResponse.json();
    for (const appointment of appointments) {
      const patient = String(appointment.patientName || "");
      const note = String(appointment.notes || "");
      if (prefixes.some(prefix => patient.includes(prefix) || note.includes(prefix))) {
        await request.delete(`${baseURL}/api/appointments/${appointment.id}?hard=1`, { headers: authHeaders("staff") });
      }
    }
  }

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
      await cleanupPatientAdvancedData(request, baseURL, patient.id);
      await request.delete(`${baseURL}/api/patients/${patient.id}`, { headers: authHeaders("staff") });
    }
  }
}

async function cleanupPatientAdvancedData(request, baseURL, patientId) {
  const datasets = [
    {
      path: `/api/patients/${patientId}/treatment-plans`,
      deletePath: item => `/api/treatment-plans/${item.id}`
    },
    {
      path: `/api/patients/${patientId}/perio-charts`,
      deletePath: item => `/api/perio-charts/${item.id}`
    },
    {
      path: `/api/patients/${patientId}/invoices`,
      deletePath: item => `/api/invoices/${item.id}`
    },
    {
      path: `/api/patients/${patientId}/insurance-claims`,
      deletePath: item => `/api/insurance-claims/${item.id}`
    }
  ];

  for (const dataset of datasets) {
    const response = await request.get(`${baseURL}${dataset.path}`, { headers: authHeaders("staff") });
    if (!response.ok()) continue;
    const items = await response.json();
    for (const item of items) {
      await request.delete(`${baseURL}${dataset.deletePath(item)}`, { headers: authHeaders("staff") });
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
