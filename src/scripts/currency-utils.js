(function () {
  const DEFAULT_CURRENCIES = [
    { value: "EUR", label: "EUR", metadata: { exchangeRate: 117, rateBase: "EUR", rateCurrency: "RSD" } },
    { value: "RSD", label: "RSD", metadata: { exchangeRate: 1, rateBase: "RSD", rateCurrency: "RSD" } },
    { value: "USD", label: "USD", metadata: { exchangeRate: 108, rateBase: "USD", rateCurrency: "RSD" } }
  ];

  let currencies = DEFAULT_CURRENCIES;

  function code(value) {
    return String(value || "EUR").toUpperCase();
  }

  function setCurrencies(items) {
    currencies = Array.isArray(items) && items.length ? items : DEFAULT_CURRENCIES;
  }

  function currencyItems() {
    return currencies;
  }

  function rateToRsd(currency) {
    const source = code(currency);
    if (source === "RSD") return 1;
    const item = currencies.find(entry => code(entry.value) === source);
    const metadata = item?.metadata || {};
    const rate = Number(metadata.exchangeRate || 0);
    const base = code(metadata.rateBase || source);
    const target = code(metadata.rateCurrency || "RSD");
    if (rate > 0 && base === source && target === "RSD") return rate;
    if (rate > 0 && base === "RSD" && target === source) return 1 / rate;
    return 0;
  }

  function convert(amount, fromCurrency = "EUR", toCurrency = "EUR") {
    const from = code(fromCurrency);
    const to = code(toCurrency);
    const value = Number(amount || 0);
    if (from === to) return value;
    const fromRate = rateToRsd(from);
    const toRate = rateToRsd(to);
    if (fromRate <= 0 || toRate <= 0) return value;
    return value * fromRate / toRate;
  }

  function formatMoney(amount, currency = "EUR") {
    return `${Number(amount || 0).toFixed(2)} ${code(currency)}`;
  }

  function conversionLabel(amount, fromCurrency = "EUR", toCurrency = "EUR") {
    const from = code(fromCurrency);
    const to = code(toCurrency);
    const converted = convert(amount, from, to);
    return from === to
      ? formatMoney(amount, from)
      : `${formatMoney(amount, from)} = ${formatMoney(converted, to)}`;
  }

  window.DrRosaCurrencyUtils = {
    setCurrencies,
    currencyItems,
    rateToRsd,
    convert,
    formatMoney,
    conversionLabel
  };
})();
