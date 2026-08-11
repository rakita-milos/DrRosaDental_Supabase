SET search_path TO app, public;

CREATE TEMP TABLE currency_rates_to_rsd (
  currency TEXT PRIMARY KEY,
  rate NUMERIC(14, 6) NOT NULL
) ON COMMIT DROP;

WITH currency_source AS (
  SELECT value, metadata::jsonb AS metadata_json
  FROM codebook_items
  WHERE type = 'currency'
),
normalized_rates AS (
  SELECT value,
       CASE
         WHEN value = 'RSD' THEN 1
         WHEN COALESCE((metadata_json ->> 'rateBase'), value) = value
           AND COALESCE((metadata_json ->> 'rateCurrency'), 'RSD') = 'RSD'
           AND COALESCE((metadata_json ->> 'exchangeRate'), '0')::numeric > 0
           THEN (metadata_json ->> 'exchangeRate')::numeric
         WHEN COALESCE((metadata_json ->> 'rateBase'), '') = 'RSD'
           AND COALESCE((metadata_json ->> 'rateCurrency'), '') = value
           AND COALESCE((metadata_json ->> 'exchangeRate'), '0')::numeric > 0
           THEN 1 / (metadata_json ->> 'exchangeRate')::numeric
         WHEN value = 'EUR' THEN 117
         WHEN value = 'USD' THEN 108
         ELSE NULL
       END AS rate
  FROM currency_source
)
INSERT INTO currency_rates_to_rsd (currency, rate)
SELECT value, rate
FROM normalized_rates
WHERE rate IS NOT NULL;

INSERT INTO currency_rates_to_rsd (currency, rate)
VALUES ('RSD', 1), ('EUR', 117), ('USD', 108)
ON CONFLICT (currency) DO NOTHING;

DO $$
DECLARE
  missing_currencies TEXT;
BEGIN
  SELECT string_agg(used.currency, ', ' ORDER BY used.currency)
  INTO missing_currencies
  FROM (
    SELECT DISTINCT price_currency AS currency FROM codebook_items WHERE price_currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM treatments WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM payments WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM payment_parts WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM treatment_plans WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM clinical_chart_entries WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM invoices WHERE currency <> 'RSD'
    UNION
    SELECT DISTINCT currency FROM patient_ledger_entries WHERE currency <> 'RSD'
  ) used
  LEFT JOIN currency_rates_to_rsd rate ON rate.currency = used.currency
  WHERE rate.currency IS NULL OR rate.rate <= 0;

  IF missing_currencies IS NOT NULL THEN
    RAISE EXCEPTION 'Missing RSD exchange rates for currencies: %', missing_currencies;
  END IF;
END $$;

UPDATE codebook_items
SET metadata = '{"exchangeRate":1,"rateDate":"manual","rateBase":"RSD","rateCurrency":"RSD","rateSource":"default"}',
    is_active = true,
    sort_order = 1,
    updated_at = now()
WHERE type = 'currency' AND value = 'RSD';

UPDATE codebook_items
SET metadata = jsonb_set(
      jsonb_set(
        COALESCE(metadata::jsonb, '{}'::jsonb),
        '{rateBase}',
        to_jsonb(value)
      ),
      '{rateCurrency}',
      to_jsonb('RSD'::text)
    )::text,
    is_active = true,
    sort_order = CASE value WHEN 'EUR' THEN 2 WHEN 'USD' THEN 3 ELSE sort_order END,
    updated_at = now()
WHERE type = 'currency' AND value <> 'RSD';

ALTER TABLE codebook_items ALTER COLUMN price_currency SET DEFAULT 'RSD';
ALTER TABLE treatments ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE payment_parts ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE treatment_plans ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE clinical_chart_entries ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'RSD';
ALTER TABLE patient_ledger_entries ALTER COLUMN currency SET DEFAULT 'RSD';

UPDATE codebook_items
SET price_currency = 'RSD',
    updated_at = now()
WHERE price_currency <> 'RSD';

UPDATE treatments treatment
SET price = round((treatment.price * rate.rate)::numeric, 2),
    discount = round((treatment.discount * rate.rate)::numeric, 2),
    discount_value = CASE
      WHEN treatment.discount_type = 'percent' THEN treatment.discount_value
      ELSE round((treatment.discount_value * rate.rate)::numeric, 2)
    END,
    currency = 'RSD'
FROM currency_rates_to_rsd rate
WHERE treatment.currency <> 'RSD'
  AND rate.currency = treatment.currency;

UPDATE payments payment
SET amount = round((payment.amount * rate.rate)::numeric, 2),
    amount_paid = round((payment.amount_paid * rate.rate)::numeric, 2),
    currency = 'RSD',
    updated_at = now()
FROM currency_rates_to_rsd rate
WHERE payment.currency <> 'RSD'
  AND rate.currency = payment.currency;

UPDATE payment_parts part
SET exchange_rate_to_rsd = rate.rate,
    amount_rsd = round((part.amount * rate.rate)::numeric, 2),
    updated_at = now()
FROM currency_rates_to_rsd rate
WHERE rate.currency = part.currency;

UPDATE treatment_plan_items item
SET unit_price = round((item.unit_price * rate.rate)::numeric, 2),
    discount = round((item.discount * rate.rate)::numeric, 2)
FROM treatment_plans plan
JOIN currency_rates_to_rsd rate ON rate.currency = plan.currency
WHERE item.plan_id = plan.id
  AND plan.currency <> 'RSD';

UPDATE treatment_plans plan
SET currency = 'RSD',
    discount = round((plan.discount * rate.rate)::numeric, 2),
    updated_at = now()
FROM currency_rates_to_rsd rate
WHERE plan.currency <> 'RSD'
  AND rate.currency = plan.currency;

UPDATE clinical_chart_entries entry
SET price = round((entry.price * rate.rate)::numeric, 2),
    price_rsd = round((entry.price * rate.rate)::numeric, 2),
    exchange_rate_to_rsd = 1,
    currency = 'RSD',
    updated_at = now()
FROM currency_rates_to_rsd rate
WHERE entry.currency <> 'RSD'
  AND rate.currency = entry.currency;

UPDATE invoice_items item
SET unit_price = round((item.unit_price * rate.rate)::numeric, 2),
    discount = round((item.discount * rate.rate)::numeric, 2)
FROM invoices invoice
JOIN currency_rates_to_rsd rate ON rate.currency = invoice.currency
WHERE item.invoice_id = invoice.id
  AND invoice.currency <> 'RSD';

UPDATE invoices invoice
SET subtotal = round((invoice.subtotal * rate.rate)::numeric, 2),
    discount = round((invoice.discount * rate.rate)::numeric, 2),
    tax = round((invoice.tax * rate.rate)::numeric, 2),
    total = round((invoice.total * rate.rate)::numeric, 2),
    amount_paid = round((invoice.amount_paid * rate.rate)::numeric, 2),
    currency = 'RSD',
    updated_at = now()
FROM currency_rates_to_rsd rate
WHERE invoice.currency <> 'RSD'
  AND rate.currency = invoice.currency;

UPDATE patient_ledger_entries entry
SET amount = round((entry.amount * rate.rate)::numeric, 2),
    currency = 'RSD'
FROM currency_rates_to_rsd rate
WHERE entry.currency <> 'RSD'
  AND rate.currency = entry.currency;
