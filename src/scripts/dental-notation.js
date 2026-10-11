(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrRosaDental = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const rows = {
    permanent: [['18','17','16','15','14','13','12','11'], ['21','22','23','24','25','26','27','28'], ['48','47','46','45','44','43','42','41'], ['31','32','33','34','35','36','37','38']],
    primary: [['55','54','53','52','51'], ['61','62','63','64','65'], ['85','84','83','82','81'], ['71','72','73','74','75']]
  };
  const labels = { permanent: 'Stalni zubi', primary: 'Mlečni zubi' };
  const presenceLabels = { unknown: 'Nije evidentirano', present: 'Prisutan', unerupted: 'Nije iznikao', exfoliated: 'Ispao', extracted: 'Izvađen' };
  const teeth = Object.fromEntries(Object.entries(rows).map(([type, values]) => [type, new Set(values.flat())]));
  function typeOf(value) {
    const tooth = String(value ?? '').trim();
    return teeth.permanent.has(tooth) ? 'permanent' : teeth.primary.has(tooth) ? 'primary' : null;
  }
  function latestStates(events) {
    const result = new Map();
    for (const event of events || []) {
      const previous = result.get(event.toothNumber);
      const key = item => `${String(item.effectiveDate).slice(0, 10)}|${item.createdAt || ''}|${String(item.id || 0).padStart(20, '0')}`;
      if (!previous || key(event) >= key(previous)) result.set(event.toothNumber, event);
    }
    return result;
  }
  function historicalExtractionTeeth(entries) {
    return new Set((entries || []).filter(item => String(item.type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').includes('vad')).map(item => item.tooth));
  }
  return { rows, labels, presenceLabels, typeOf, isTooth: value => Boolean(typeOf(value)), latestStates, historicalExtractionTeeth };
});
