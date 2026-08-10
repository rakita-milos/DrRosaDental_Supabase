SET search_path TO app, public;

CREATE TEMP TABLE final_activities (
  value TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO final_activities (value, sort_order)
VALUES
  ('Pregledi i dijagnostika', 1),
  ('Preventivna stomatologija', 2),
  ('Konzervativna stomatologija', 3),
  ('Endodoncija', 4),
  ('Decja stomatologija', 5),
  ('Oralna hirurgija', 6),
  ('Parodontologija', 7),
  ('Protetika', 8),
  ('Estetska stomatologija', 9),
  ('Okluzija i splint terapija', 10);

CREATE TEMP TABLE final_procedures (
  value TEXT NOT NULL,
  group_name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  metadata TEXT,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (value, group_name)
) ON COMMIT DROP;

INSERT INTO final_procedures (value, group_name, price, metadata, sort_order)
VALUES
  ('Analiza snimka', 'Pregledi i dijagnostika', 1000, NULL, 1),
  ('Pregled sa planom', 'Pregledi i dijagnostika', 2000, NULL, 2),
  ('Zalivanje fisura', 'Preventivna stomatologija', 2000, NULL, 3),
  ('Pesikiranje zuba', 'Preventivna stomatologija', 1000, '{"pricePrefix":"+"}', 4),
  ('Kompozitna plomba I klasa', 'Konzervativna stomatologija', 4000, NULL, 5),
  ('Kompozitna plomba V klasa', 'Konzervativna stomatologija', 4000, NULL, 6),
  ('Kompozitna plomba II klasa', 'Konzervativna stomatologija', 4500, NULL, 7),
  ('Kompozitna plomba MOD', 'Konzervativna stomatologija', 5000, NULL, 8),
  ('Indirektno prekrivanje pulpe', 'Konzervativna stomatologija', 1500, NULL, 9),
  ('Amalgamska plomba', 'Konzervativna stomatologija', 2500, NULL, 10),
  ('Kompozitna nadogradnja zuba', 'Konzervativna stomatologija', 5000, NULL, 11),
  ('Kompozitni ispun na lecenom zubu / kom', 'Konzervativna stomatologija', 4000, '{"code":"106"}', 12),
  ('Lecenje zuba I faza', 'Endodoncija', 2000, NULL, 13),
  ('Lecenje zuba II faza', 'Endodoncija', 2000, NULL, 14),
  ('Lecenje zuba III faza', 'Endodoncija', 3000, NULL, 15),
  ('Lecenje zuba', 'Endodoncija', 3000, NULL, 16),
  ('Lecenje zuba - Ca kanalno punjenje', 'Endodoncija', 2000, NULL, 17),
  ('Revizija', 'Endodoncija', 4000, NULL, 18),
  ('Masinska endodoncija I faza', 'Endodoncija', 2000, NULL, 19),
  ('Masinska endodoncija II faza', 'Endodoncija', 4000, NULL, 20),
  ('Masinska endodoncija III faza', 'Endodoncija', 3000, NULL, 21),
  ('Lecenje zuba - trepanacija komore i ekstirpacija pulpe / kom', 'Endodoncija', 2000, '{"code":"107"}', 22),
  ('Interseansna medikacija kanala / kom', 'Endodoncija', 2000, '{"code":"103*"}', 23),
  ('Lecenje zuba - instrumentacija kanala - incizivi / kom', 'Endodoncija', 4000, '{"code":"102"}', 24),
  ('Lecenje zuba - instrumentacija kanala - premolari / kom', 'Endodoncija', 5000, '{"code":"101"}', 25),
  ('Lecenje zuba - instrumentacija kanala - molari / kom', 'Endodoncija', 6000, '{"code":"100"}', 26),
  ('Lecenje zuba - opturacija kanala - premolari i incizivi / kom', 'Endodoncija', 3000, '{"code":"105"}', 27),
  ('Lecenje zuba - opturacija kanala - molari / kom', 'Endodoncija', 4000, '{"code":"104"}', 28),
  ('Plomba na mlecnom zubu I klasa', 'Decja stomatologija', 2500, NULL, 29),
  ('Plomba na mlecnom zubu II klasa', 'Decja stomatologija', 3000, NULL, 30),
  ('Indirektno prekrivanje pulpe na mlecnom zubu', 'Decja stomatologija', 1000, NULL, 31),
  ('Kompozitna plomba na mlecnom zubu', 'Decja stomatologija', 3000, NULL, 32),
  ('Lecenje mlecnog zuba I faza', 'Decja stomatologija', 2000, NULL, 33),
  ('Vadjenje mlecnog zuba', 'Decja stomatologija', 2500, NULL, 34),
  ('Vadjenje zuba', 'Oralna hirurgija', 4000, NULL, 35),
  ('Komplikovano vadjenje', 'Oralna hirurgija', 6000, NULL, 36),
  ('Uklanjanje zubnog kamenca i uklanjanje mekih naslaga', 'Parodontologija', 3500, NULL, 37),
  ('Uklanjanje zubnog kamenca i mekih naslaga sa ispiranjem dzepova', 'Parodontologija', 4000, NULL, 38),
  ('Kiretaza parodontalnog dzepa', 'Parodontologija', 1500, NULL, 39),
  ('Lasersko oblikovanje gingive', 'Parodontologija', 3600, NULL, 40),
  ('Parodontoloska rezanj operacija / kom', 'Parodontologija', 25000, '{"code":"99"}', 41),
  ('Metalni kocic', 'Protetika', 4500, NULL, 42),
  ('Livena nadogradnja', 'Protetika', 8000, NULL, 43),
  ('Skidanje stare krune po zubu', 'Protetika', 1500, NULL, 44),
  ('Privremena krunica', 'Protetika', 4700, NULL, 45),
  ('Fasete kompozitne', 'Estetska stomatologija', 7000, NULL, 46),
  ('Korekcija fasete', 'Estetska stomatologija', 4000, NULL, 47),
  ('Izbeljivanje zuba', 'Estetska stomatologija', 18000, NULL, 48),
  ('Sportski splint', 'Okluzija i splint terapija', 8000, NULL, 49),
  ('Splint terapija bruksizma', 'Okluzija i splint terapija', 8000, NULL, 50);

CREATE TEMP TABLE canonical_maps (
  old_value TEXT PRIMARY KEY,
  new_value TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO canonical_maps (old_value, new_value)
VALUES
  ('Kontrola', 'Pregled sa planom'),
  ('Ciscenje', 'Uklanjanje zubnog kamenca i uklanjanje mekih naslaga'),
  ('Plomba', 'Kompozitna plomba I klasa'),
  ('Endodontija', 'Lecenje zuba'),
  ('Izbeljivanje', 'Izbeljivanje zuba'),
  ('Vadjenja zuba', 'Vadjenje zuba'),
  ('Hirursko vadjenje', 'Komplikovano vadjenje'),
  ('Fasete', 'Fasete kompozitne');

CREATE TEMP TABLE text_maps (
  old_value TEXT PRIMARY KEY,
  new_value TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO text_maps (old_value, new_value)
VALUES
  ('Kontrola', 'Pregled sa planom'),
  ('Ciscenje', 'Uklanjanje zubnog kamenca i uklanjanje mekih naslaga'),
  ('Kontrola i ciscenje', 'Uklanjanje zubnog kamenca i uklanjanje mekih naslaga'),
  ('Plomba', 'Kompozitna plomba I klasa'),
  ('Endodontija', 'Lecenje zuba'),
  ('Izbeljivanje', 'Izbeljivanje zuba'),
  ('Parodontologija', 'Uklanjanje zubnog kamenca i uklanjanje mekih naslaga'),
  ('Vadjenja zuba', 'Vadjenje zuba'),
  ('Hirursko vadjenje', 'Komplikovano vadjenje'),
  ('Impakcija umnjaka', 'Komplikovano vadjenje'),
  ('Fasete', 'Fasete kompozitne');

WITH pairs AS (
  SELECT old_item.id AS old_id,
         new_item.id AS new_id
  FROM canonical_maps map
  JOIN final_procedures final ON final.value = map.new_value
  JOIN codebook_items old_item ON old_item.type = 'procedure' AND old_item.value = map.old_value
  JOIN codebook_items new_item ON new_item.type = 'procedure'
    AND new_item.value = final.value
    AND new_item.group_name = final.group_name
    AND new_item.id <> old_item.id
)
UPDATE appointments appointment
SET procedure_id = pairs.old_id
FROM pairs
WHERE appointment.procedure_id = pairs.new_id;

WITH pairs AS (
  SELECT old_item.id AS old_id,
         new_item.id AS new_id
  FROM canonical_maps map
  JOIN final_procedures final ON final.value = map.new_value
  JOIN codebook_items old_item ON old_item.type = 'procedure' AND old_item.value = map.old_value
  JOIN codebook_items new_item ON new_item.type = 'procedure'
    AND new_item.value = final.value
    AND new_item.group_name = final.group_name
    AND new_item.id <> old_item.id
)
UPDATE public_booking_requests request
SET procedure_id = pairs.old_id
FROM pairs
WHERE request.procedure_id = pairs.new_id;

WITH pairs AS (
  SELECT new_item.id AS new_id
  FROM canonical_maps map
  JOIN final_procedures final ON final.value = map.new_value
  JOIN codebook_items old_item ON old_item.type = 'procedure' AND old_item.value = map.old_value
  JOIN codebook_items new_item ON new_item.type = 'procedure'
    AND new_item.value = final.value
    AND new_item.group_name = final.group_name
    AND new_item.id <> old_item.id
)
DELETE FROM codebook_items item
USING pairs
WHERE item.id = pairs.new_id;

UPDATE codebook_items item
SET value = final.value,
    label = final.value,
    group_name = final.group_name,
    metadata = final.metadata,
    price = final.price,
    price_currency = 'RSD',
    is_active = true,
    sort_order = final.sort_order,
    updated_at = now()
FROM canonical_maps map
JOIN final_procedures final ON final.value = map.new_value
WHERE item.type = 'procedure'
  AND item.value = map.old_value;

INSERT INTO codebook_items (type, value, label, group_name, metadata, price, price_currency, is_active, sort_order)
SELECT 'activity', value, value, NULL, NULL, 0, 'RSD', true, sort_order
FROM final_activities
ON CONFLICT (type, value, (COALESCE(group_name, '')))
DO UPDATE SET
  label = excluded.label,
  metadata = excluded.metadata,
  price = excluded.price,
  price_currency = excluded.price_currency,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

INSERT INTO codebook_items (type, value, label, group_name, metadata, price, price_currency, is_active, sort_order)
SELECT 'procedure', value, value, group_name, metadata, price, 'RSD', true, sort_order
FROM final_procedures
ON CONFLICT (type, value, (COALESCE(group_name, '')))
DO UPDATE SET
  label = excluded.label,
  metadata = excluded.metadata,
  price = excluded.price,
  price_currency = excluded.price_currency,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

WITH target_ids AS (
  SELECT map.old_value, target.id AS target_id
  FROM text_maps map
  JOIN final_procedures final ON final.value = map.new_value
  JOIN codebook_items target ON target.type = 'procedure'
    AND target.value = final.value
    AND target.group_name = final.group_name
)
UPDATE appointments appointment
SET procedure_id = target_ids.target_id
FROM target_ids
WHERE appointment.procedure_id IN (
  SELECT id
  FROM codebook_items
  WHERE type = 'procedure'
    AND value = target_ids.old_value
);

WITH target_ids AS (
  SELECT map.old_value, target.id AS target_id
  FROM text_maps map
  JOIN final_procedures final ON final.value = map.new_value
  JOIN codebook_items target ON target.type = 'procedure'
    AND target.value = final.value
    AND target.group_name = final.group_name
)
UPDATE public_booking_requests request
SET procedure_id = target_ids.target_id
FROM target_ids
WHERE request.procedure_id IN (
  SELECT id
  FROM codebook_items
  WHERE type = 'procedure'
    AND value = target_ids.old_value
);

UPDATE appointments appointment
SET procedure_name = map.new_value
FROM text_maps map
WHERE appointment.procedure_name = map.old_value;

UPDATE public_booking_requests request
SET procedure_name = map.new_value
FROM text_maps map
WHERE request.procedure_name = map.old_value;

UPDATE visit_records record
SET procedure = map.new_value,
    updated_at = now()
FROM text_maps map
WHERE record.procedure = map.old_value;

UPDATE treatments treatment
SET treatment_type = map.new_value
FROM text_maps map
WHERE treatment.treatment_type = map.old_value;

DELETE FROM codebook_items item
WHERE item.type = 'activity'
  AND NOT EXISTS (
    SELECT 1
    FROM final_activities final
    WHERE final.value = item.value
      AND item.group_name IS NULL
  );

DELETE FROM codebook_items item
WHERE item.type = 'procedure'
  AND NOT EXISTS (
    SELECT 1
    FROM final_procedures final
    WHERE final.value = item.value
      AND final.group_name = item.group_name
  );
