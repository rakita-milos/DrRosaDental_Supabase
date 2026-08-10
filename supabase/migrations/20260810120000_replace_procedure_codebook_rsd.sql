SET search_path TO app, public;

UPDATE codebook_items
SET is_active = false,
    updated_at = now()
WHERE type IN ('activity', 'procedure');

INSERT INTO codebook_items (type, value, label, group_name, metadata, price, price_currency, is_active, sort_order)
SELECT 'activity', value, value, NULL, NULL, 0, 'RSD', true, sort_order
FROM (VALUES
  ('Pregledi i dijagnostika', 1),
  ('Preventivna stomatologija', 2),
  ('Konzervativna stomatologija', 3),
  ('Endodoncija', 4),
  ('Decja stomatologija', 5),
  ('Oralna hirurgija', 6),
  ('Parodontologija', 7),
  ('Protetika', 8),
  ('Estetska stomatologija', 9),
  ('Okluzija i splint terapija', 10)
) AS activity(value, sort_order)
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
FROM (VALUES
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
  ('Splint terapija bruksizma', 'Okluzija i splint terapija', 8000, NULL, 50)
) AS procedure(value, group_name, price, metadata, sort_order)
ON CONFLICT (type, value, (COALESCE(group_name, '')))
DO UPDATE SET
  label = excluded.label,
  metadata = excluded.metadata,
  price = excluded.price,
  price_currency = excluded.price_currency,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();
