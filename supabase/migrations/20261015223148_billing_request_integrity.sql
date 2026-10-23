-- Internal backend state. No historical invoice numbers or ledger amounts are rewritten.
-- Keep old application writers from inserting between the bootstrap and trigger installation.
LOCK TABLE app.invoices IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE app.invoice_number_counters (
  year integer PRIMARY KEY CHECK (year BETWEEN 0 AND 9999),
  last_number numeric NOT NULL CHECK (last_number >= 0 AND last_number = trunc(last_number))
);

INSERT INTO app.invoice_number_counters (year, last_number)
SELECT substring(invoice_number FROM '^DR-([0-9]{4})-')::integer,
       max(substring(invoice_number FROM '^DR-[0-9]{4}-([0-9]+)$')::numeric)
FROM (
  SELECT invoice_number FROM app.invoices
  UNION ALL
  -- Deletion retains the charge/storno description in the ledger. Reserve
  -- these historical numbers too, even when the invoice itself is gone.
  SELECT substring(description FROM '(DR-[0-9]{4}-[0-9]+)$') AS invoice_number
  FROM app.patient_ledger_entries WHERE source IN ('invoice', 'invoice_delete')
) history WHERE invoice_number ~ '^DR-[0-9]{4}-[0-9]+$'
GROUP BY 1;

CREATE FUNCTION app.assign_invoice_number() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = app, pg_temp AS $$
DECLARE
  number_year integer;
  next_number numeric;
BEGIN
  IF NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = '' THEN
    number_year := extract(year FROM current_timestamp AT TIME ZONE 'Europe/Belgrade')::integer;
    INSERT INTO app.invoice_number_counters (year, last_number) VALUES (number_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_number = app.invoice_number_counters.last_number + 1
    RETURNING last_number INTO next_number;
    NEW.invoice_number := 'DR-' || lpad(number_year::text, 4, '0') || '-' ||
      lpad(next_number::text, greatest(5, length(next_number::text)), '0');
  ELSIF NEW.invoice_number ~ '^DR-[0-9]{4}-[0-9]+$' THEN
    number_year := substring(NEW.invoice_number FROM '^DR-([0-9]{4})-')::integer;
    next_number := substring(NEW.invoice_number FROM '^DR-[0-9]{4}-([0-9]+)$')::numeric;
    INSERT INTO app.invoice_number_counters (year, last_number) VALUES (number_year, next_number)
    ON CONFLICT (year) DO UPDATE SET last_number = greatest(app.invoice_number_counters.last_number, EXCLUDED.last_number);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_assign_number BEFORE INSERT OR UPDATE OF invoice_number ON app.invoices
FOR EACH ROW EXECUTE FUNCTION app.assign_invoice_number();

CREATE TABLE app.financial_requests (
  scope text NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, request_key)
);

ALTER TABLE app.invoice_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.invoice_number_counters, app.financial_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assign_invoice_number() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.invoice_number_counters, app.financial_requests FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON app.invoice_number_counters, app.financial_requests FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON app.invoice_number_counters, app.financial_requests TO service_role;
  END IF;
END;
$$;
