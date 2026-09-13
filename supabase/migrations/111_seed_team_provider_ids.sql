-- Semilla del crosswalk de equipos football-data/ESPN → API-Football (2026-09-13).
-- GENERADO por scripts/seed-team-crosswalk.mjs; no editar a mano: regenerar.
-- Fuente: prod REST (read-only) 2026-09-13T09:21:51.745Z. Generado: 2026-09-13T09:45:12.451Z.
-- Anclas: 1265 fixtures API-Football distintos (caché diaria + temporadas guardadas;
-- el generador no llama a la API).
-- Vínculos: 208 (fuertes 158, una ancla + nombre 50); rechazados: 0; vueltas: 3.
-- Requiere la migración 110. Solo inserta en team_provider_ids y recalcula
-- claves NULL/n: → af: (sin re-key de claves af: existentes). No toca
-- nombres, horarios, resultados ni pronósticos.

INSERT INTO public.team_provider_ids (provider, provider_team_id, af_team_id, source, anchors, reviewed) VALUES
  ('espn', '5', 451, 'seed-2026-09-13:single', 1, false), -- Boca Juniors
  ('espn', '8', 450, 'seed-2026-09-13:strong', 2, false), -- Estudiantes L.P.
  ('espn', '83', 529, 'seed-2026-09-13:strong', 4, false), -- Barcelona
  ('espn', '85', 538, 'seed-2026-09-13:single', 1, false), -- Celta Vigo
  ('espn', '86', 541, 'seed-2026-09-13:strong', 3, false), -- Real Madrid
  ('espn', '89', 548, 'seed-2026-09-13:single', 1, false), -- Real Sociedad
  ('espn', '102', 533, 'seed-2026-09-13:strong', 4, false), -- Villarreal
  ('espn', '103', 489, 'seed-2026-09-13:single', 1, false), -- AC Milan
  ('espn', '104', 497, 'seed-2026-09-13:strong', 3, false), -- AS Roma
  ('espn', '110', 505, 'seed-2026-09-13:strong', 4, false), -- Inter
  ('espn', '111', 496, 'seed-2026-09-13:single', 1, false), -- Juventus
  ('espn', '114', 492, 'seed-2026-09-13:strong', 4, false), -- Napoli
  ('espn', '124', 165, 'seed-2026-09-13:strong', 4, false), -- Borussia Dortmund
  ('espn', '131', 168, 'seed-2026-09-13:single', 1, false), -- Bayer Leverkusen
  ('espn', '132', 157, 'seed-2026-09-13:strong', 3, false), -- Bayern München
  ('espn', '134', 172, 'seed-2026-09-13:strong', 4, false), -- VfB Stuttgart
  ('espn', '140', 201, 'seed-2026-09-13:single', 1, false), -- AZ Alkmaar
  ('espn', '142', 209, 'seed-2026-09-13:strong', 4, false), -- Feyenoord
  ('espn', '147', 413, 'seed-2026-09-13:single', 1, false), -- NEC Nijmegen
  ('espn', '148', 197, 'seed-2026-09-13:strong', 4, false), -- PSV Eindhoven
  ('espn', '160', 85, 'seed-2026-09-13:strong', 3, false), -- Paris Saint Germain
  ('espn', '166', 79, 'seed-2026-09-13:strong', 4, false), -- Lille
  ('espn', '167', 80, 'seed-2026-09-13:single', 1, false), -- Lyon
  ('espn', '175', 116, 'seed-2026-09-13:strong', 4, false), -- Lens
  ('espn', '176', 81, 'seed-2026-09-13:single', 1, false), -- Marseille
  ('espn', '244', 543, 'seed-2026-09-13:strong', 4, false), -- Real Betis
  ('espn', '256', 247, 'seed-2026-09-13:single', 1, false), -- Celtic
  ('espn', '349', 35, 'seed-2026-09-13:single', 1, false), -- Bournemouth
  ('espn', '359', 42, 'seed-2026-09-13:strong', 4, false), -- Arsenal
  ('espn', '360', 33, 'seed-2026-09-13:strong', 3, false), -- Manchester United
  ('espn', '362', 66, 'seed-2026-09-13:strong', 4, false), -- Aston Villa
  ('espn', '364', 40, 'seed-2026-09-13:strong', 3, false), -- Liverpool
  ('espn', '366', 746, 'seed-2026-09-13:single', 1, false), -- Sunderland
  ('espn', '382', 50, 'seed-2026-09-13:strong', 3, false), -- Manchester City
  ('espn', '384', 52, 'seed-2026-09-13:single', 1, false), -- Crystal Palace
  ('espn', '432', 645, 'seed-2026-09-13:strong', 4, false), -- Galatasaray
  ('espn', '433', 628, 'seed-2026-09-13:single', 1, false), -- Sparta Praha
  ('espn', '436', 611, 'seed-2026-09-13:strong', 4, false), -- Fenerbahçe
  ('espn', '437', 212, 'seed-2026-09-13:strong', 4, false), -- FC Porto
  ('espn', '441', 554, 'seed-2026-09-13:single', 1, false), -- Anderlecht
  ('espn', '490', 646, 'seed-2026-09-13:single', 1, false), -- Levski Sofia
  ('espn', '493', 550, 'seed-2026-09-13:strong', 4, false), -- Shakhtar Donetsk
  ('espn', '494', 560, 'seed-2026-09-13:strong', 4, false), -- Slavia Praha
  ('espn', '510', 759, 'seed-2026-09-13:strong', 3, false), -- Viking
  ('espn', '521', 656, 'seed-2026-09-13:strong', 4, false), -- Slovan Bratislava
  ('espn', '570', 569, 'seed-2026-09-13:strong', 4, false), -- Club Brugge KV
  ('espn', '597', 620, 'seed-2026-09-13:single', 1, false), -- Dinamo Zagreb
  ('espn', '617', 3402, 'seed-2026-09-13:single', 1, false), -- Omonia Nicosia
  ('espn', '819', 127, 'seed-2026-09-13:strong', 2, false), -- Flamengo
  ('espn', '874', 131, 'seed-2026-09-13:strong', 2, false), -- Corinthians
  ('espn', '887', 575, 'seed-2026-09-13:strong', 4, false), -- AEK Athens FC
  ('espn', '987', 321, 'seed-2026-09-13:single', 1, false), -- Lillestrom
  ('espn', '1010', 1124, 'seed-2026-09-13:single', 1, false), -- OFI
  ('espn', '1068', 530, 'seed-2026-09-13:strong', 3, false), -- Atletico Madrid
  ('espn', '1895', 549, 'seed-2026-09-13:single', 1, false), -- Beşiktaş
  ('espn', '1929', 211, 'seed-2026-09-13:single', 1, false), -- Benfica
  ('espn', '2026', 126, 'seed-2026-09-13:single', 1, false), -- Sao Paulo
  ('espn', '2029', 121, 'seed-2026-09-13:strong', 2, false), -- Palmeiras
  ('espn', '2250', 228, 'seed-2026-09-13:strong', 4, false), -- Sporting CP
  ('espn', '2572', 895, 'seed-2026-09-13:strong', 4, false), -- Como
  ('espn', '2672', 1127, 'seed-2026-09-13:strong', 10, false), -- Deportivo Cali
  ('espn', '2674', 128, 'seed-2026-09-13:single', 1, false), -- Santos
  ('espn', '2690', 1128, 'seed-2026-09-13:strong', 11, false), -- Independiente Medellin
  ('espn', '2790', 571, 'seed-2026-09-13:single', 1, false), -- Red Bull Salzburg
  ('espn', '2919', 1136, 'seed-2026-09-13:strong', 9, false), -- Once Caldas
  ('espn', '2980', 327, 'seed-2026-09-13:strong', 4, false), -- Bodo/Glimt
  ('espn', '2990', 347, 'seed-2026-09-13:single', 1, false), -- Lech Poznan
  ('espn', '3362', 4360, 'seed-2026-09-13:single', 1, false), -- Celje
  ('espn', '3372', 2562, 'seed-2026-09-13:single', 1, false), -- Cienciano
  ('espn', '3445', 124, 'seed-2026-09-13:strong', 2, false), -- Fluminense
  ('espn', '3454', 133, 'seed-2026-09-13:single', 1, false), -- Vasco DA Gama
  ('espn', '4411', 1026, 'seed-2026-09-13:strong', 3, false), -- Lask Linz
  ('espn', '4815', 1135, 'seed-2026-09-13:strong', 14, false), -- Junior
  ('espn', '4816', 1158, 'seed-2026-09-13:strong', 2, false), -- LDU de Quito
  ('espn', '4928', 1147, 'seed-2026-09-13:strong', 10, false), -- Fortaleza FC
  ('espn', '5264', 1137, 'seed-2026-09-13:strong', 11, false), -- Atletico Nacional
  ('espn', '5480', 1132, 'seed-2026-09-13:strong', 8, false), -- Chico
  ('espn', '5484', 1125, 'seed-2026-09-13:strong', 7, false), -- Millonarios
  ('espn', '5485', 1126, 'seed-2026-09-13:strong', 10, false), -- Deportivo Pasto
  ('espn', '5486', 1462, 'seed-2026-09-13:strong', 9, false), -- Deportivo Pereira
  ('espn', '5488', 1139, 'seed-2026-09-13:strong', 14, false), -- Santa Fe
  ('espn', '5489', 1142, 'seed-2026-09-13:strong', 13, false), -- Deportes Tolima
  ('espn', '5807', 1393, 'seed-2026-09-13:single', 1, false), -- Union St. Gilloise
  ('espn', '6101', 1470, 'seed-2026-09-13:strong', 8, false), -- Cucuta
  ('espn', '6137', 1131, 'seed-2026-09-13:strong', 7, false), -- Bucaramanga
  ('espn', '7445', 1134, 'seed-2026-09-13:strong', 9, false), -- Internacional de Bogota
  ('espn', '7632', 1062, 'seed-2026-09-13:single', 1, false), -- Atletico-MG
  ('espn', '7764', 1064, 'seed-2026-09-13:strong', 2, false), -- Platense
  ('espn', '7911', 167, 'seed-2026-09-13:single', 1, false), -- 1899 Hoffenheim
  ('espn', '7915', 1464, 'seed-2026-09-13:strong', 9, false), -- Llaneros
  ('espn', '8109', 1138, 'seed-2026-09-13:strong', 10, false), -- America de Cali
  ('espn', '9761', 1141, 'seed-2026-09-13:strong', 9, false), -- Alianza Valledupar
  ('espn', '9762', 1144, 'seed-2026-09-13:strong', 9, false), -- Águilas Doradas
  ('espn', '10309', 1133, 'seed-2026-09-13:strong', 6, false), -- Jaguares
  ('espn', '11420', 173, 'seed-2026-09-13:strong', 4, false), -- RB Leipzig
  ('espn', '11706', 567, 'seed-2026-09-13:single', 1, false), -- Plzen
  ('espn', '13083', 563, 'seed-2026-09-13:single', 1, false), -- Hapoel Beer Sheva
  ('espn', '17086', 1153, 'seed-2026-09-13:strong', 2, false), -- Independiente del Valle
  ('espn', '19002', 2365, 'seed-2026-09-13:single', 1, false), -- Atletico Torque
  ('espn', '20024', 3683, 'seed-2026-09-13:single', 1, false), -- Ararat-Armenia
  ('espn', '21615', 4799, 'seed-2026-09-13:single', 1, false), -- Torreense
  ('espn', '21922', 13976, 'seed-2026-09-13:strong', 4, false), -- Sabah FA
  ('football-data', '1', 192, 'seed-2026-09-13:strong', 2, false), -- 1. FC Köln
  ('football-data', '2', 167, 'seed-2026-09-13:strong', 2, false), -- 1899 Hoffenheim
  ('football-data', '3', 168, 'seed-2026-09-13:strong', 2, false), -- Bayer Leverkusen
  ('football-data', '4', 165, 'seed-2026-09-13:strong', 3, false), -- Borussia Dortmund
  ('football-data', '5', 157, 'seed-2026-09-13:strong', 2, false), -- Bayern München
  ('football-data', '6', 174, 'seed-2026-09-13:strong', 2, false), -- FC Schalke 04
  ('football-data', '7', 175, 'seed-2026-09-13:strong', 2, false), -- Hamburger SV
  ('football-data', '10', 172, 'seed-2026-09-13:strong', 3, false), -- VfB Stuttgart
  ('football-data', '12', 162, 'seed-2026-09-13:strong', 2, false), -- Werder Bremen
  ('football-data', '15', 164, 'seed-2026-09-13:strong', 2, false), -- FSV Mainz 05
  ('football-data', '16', 170, 'seed-2026-09-13:strong', 2, false), -- FC Augsburg
  ('football-data', '17', 160, 'seed-2026-09-13:strong', 2, false), -- SC Freiburg
  ('football-data', '18', 163, 'seed-2026-09-13:strong', 2, false), -- Borussia Mönchengladbach
  ('football-data', '19', 169, 'seed-2026-09-13:strong', 2, false), -- Eintracht Frankfurt
  ('football-data', '28', 182, 'seed-2026-09-13:strong', 2, false), -- Union Berlin
  ('football-data', '29', 185, 'seed-2026-09-13:strong', 2, false), -- SC Paderborn 07
  ('football-data', '57', 42, 'seed-2026-09-13:strong', 3, false), -- Arsenal
  ('football-data', '58', 66, 'seed-2026-09-13:strong', 3, false), -- Aston Villa
  ('football-data', '61', 49, 'seed-2026-09-13:strong', 2, false), -- Chelsea
  ('football-data', '62', 45, 'seed-2026-09-13:strong', 2, false), -- Everton
  ('football-data', '63', 36, 'seed-2026-09-13:strong', 2, false), -- Fulham
  ('football-data', '64', 40, 'seed-2026-09-13:strong', 2, false), -- Liverpool
  ('football-data', '65', 50, 'seed-2026-09-13:strong', 2, false), -- Manchester City
  ('football-data', '66', 33, 'seed-2026-09-13:strong', 2, false), -- Manchester United
  ('football-data', '67', 34, 'seed-2026-09-13:strong', 2, false), -- Newcastle
  ('football-data', '71', 746, 'seed-2026-09-13:strong', 2, false), -- Sunderland
  ('football-data', '73', 47, 'seed-2026-09-13:strong', 2, false), -- Tottenham
  ('football-data', '77', 531, 'seed-2026-09-13:strong', 3, false), -- Athletic Club
  ('football-data', '78', 530, 'seed-2026-09-13:strong', 3, false), -- Atletico Madrid
  ('football-data', '79', 727, 'seed-2026-09-13:strong', 3, false), -- Osasuna
  ('football-data', '80', 540, 'seed-2026-09-13:strong', 3, false), -- Espanyol
  ('football-data', '81', 529, 'seed-2026-09-13:strong', 4, false), -- Barcelona
  ('football-data', '82', 546, 'seed-2026-09-13:strong', 4, false), -- Getafe
  ('football-data', '84', 535, 'seed-2026-09-13:strong', 3, false), -- Malaga
  ('football-data', '86', 541, 'seed-2026-09-13:strong', 3, false), -- Real Madrid
  ('football-data', '87', 728, 'seed-2026-09-13:strong', 3, false), -- Rayo Vallecano
  ('football-data', '88', 539, 'seed-2026-09-13:strong', 3, false), -- Levante
  ('football-data', '90', 543, 'seed-2026-09-13:strong', 4, false), -- Real Betis
  ('football-data', '92', 548, 'seed-2026-09-13:strong', 3, false), -- Real Sociedad
  ('football-data', '94', 533, 'seed-2026-09-13:strong', 4, false), -- Villarreal
  ('football-data', '95', 532, 'seed-2026-09-13:strong', 2, false), -- Valencia
  ('football-data', '98', 489, 'seed-2026-09-13:strong', 2, false), -- AC Milan
  ('football-data', '99', 502, 'seed-2026-09-13:strong', 2, false), -- Fiorentina
  ('football-data', '100', 497, 'seed-2026-09-13:strong', 2, false), -- AS Roma
  ('football-data', '102', 499, 'seed-2026-09-13:strong', 2, false), -- Atalanta
  ('football-data', '103', 500, 'seed-2026-09-13:strong', 2, false), -- Bologna
  ('football-data', '104', 490, 'seed-2026-09-13:strong', 2, false), -- Cagliari
  ('football-data', '107', 495, 'seed-2026-09-13:strong', 2, false), -- Genoa
  ('football-data', '108', 505, 'seed-2026-09-13:strong', 3, false), -- Inter
  ('football-data', '109', 496, 'seed-2026-09-13:strong', 2, false), -- Juventus
  ('football-data', '110', 487, 'seed-2026-09-13:strong', 3, false), -- Lazio
  ('football-data', '112', 523, 'seed-2026-09-13:strong', 2, false), -- Parma
  ('football-data', '113', 492, 'seed-2026-09-13:strong', 3, false), -- Napoli
  ('football-data', '115', 494, 'seed-2026-09-13:strong', 3, false), -- Udinese
  ('football-data', '263', 542, 'seed-2026-09-13:strong', 3, false), -- Alaves
  ('football-data', '285', 797, 'seed-2026-09-13:strong', 4, false), -- Elche
  ('football-data', '322', 64, 'seed-2026-09-13:strong', 2, false), -- Hull City
  ('football-data', '341', 63, 'seed-2026-09-13:strong', 2, false), -- Leeds
  ('football-data', '349', 57, 'seed-2026-09-13:strong', 2, false), -- Ipswich
  ('football-data', '351', 65, 'seed-2026-09-13:strong', 2, false), -- Nottingham Forest
  ('football-data', '354', 52, 'seed-2026-09-13:strong', 2, false), -- Crystal Palace
  ('football-data', '397', 51, 'seed-2026-09-13:strong', 2, false), -- Brighton
  ('football-data', '402', 55, 'seed-2026-09-13:strong', 2, false), -- Brentford
  ('football-data', '454', 517, 'seed-2026-09-13:strong', 2, false), -- Venezia
  ('football-data', '470', 512, 'seed-2026-09-13:strong', 2, false), -- Frosinone
  ('football-data', '471', 488, 'seed-2026-09-13:strong', 2, false), -- Sassuolo
  ('football-data', '503', 212, 'seed-2026-09-13:single', 1, false), -- FC Porto
  ('football-data', '511', 96, 'seed-2026-09-13:strong', 6, false), -- Toulouse
  ('football-data', '512', 106, 'seed-2026-09-13:strong', 6, false), -- Stade Brestois 29
  ('football-data', '516', 81, 'seed-2026-09-13:strong', 7, false), -- Marseille
  ('football-data', '519', 108, 'seed-2026-09-13:strong', 6, false), -- Auxerre
  ('football-data', '521', 79, 'seed-2026-09-13:strong', 7, false), -- Lille
  ('football-data', '522', 84, 'seed-2026-09-13:strong', 6, false), -- Nice
  ('football-data', '523', 80, 'seed-2026-09-13:strong', 8, false), -- Lyon
  ('football-data', '524', 85, 'seed-2026-09-13:strong', 6, false), -- Paris Saint Germain
  ('football-data', '525', 97, 'seed-2026-09-13:strong', 6, false), -- Lorient
  ('football-data', '529', 94, 'seed-2026-09-13:strong', 5, false), -- Rennes
  ('football-data', '531', 110, 'seed-2026-09-13:strong', 6, false), -- Estac Troyes
  ('football-data', '532', 77, 'seed-2026-09-13:strong', 6, false), -- Angers
  ('football-data', '533', 111, 'seed-2026-09-13:strong', 6, false), -- Le Havre
  ('football-data', '546', 116, 'seed-2026-09-13:strong', 7, false), -- Lens
  ('football-data', '548', 91, 'seed-2026-09-13:strong', 6, false), -- Monaco
  ('football-data', '558', 538, 'seed-2026-09-13:strong', 3, false), -- Celta Vigo
  ('football-data', '559', 536, 'seed-2026-09-13:strong', 2, false), -- Sevilla
  ('football-data', '560', 544, 'seed-2026-09-13:strong', 3, false), -- Deportivo La Coruna
  ('football-data', '576', 95, 'seed-2026-09-13:strong', 6, false), -- Strasbourg
  ('football-data', '586', 503, 'seed-2026-09-13:strong', 2, false), -- Torino
  ('football-data', '610', 645, 'seed-2026-09-13:single', 1, false), -- Galatasaray
  ('football-data', '613', 611, 'seed-2026-09-13:single', 1, false), -- Fenerbahçe
  ('football-data', '674', 197, 'seed-2026-09-13:single', 1, false), -- PSV Eindhoven
  ('football-data', '675', 209, 'seed-2026-09-13:single', 1, false), -- Feyenoord
  ('football-data', '719', 1660, 'seed-2026-09-13:strong', 2, false), -- SV Elversberg
  ('football-data', '721', 173, 'seed-2026-09-13:strong', 3, false), -- RB Leipzig
  ('football-data', '851', 569, 'seed-2026-09-13:single', 1, false), -- Club Brugge KV
  ('football-data', '930', 560, 'seed-2026-09-13:single', 1, false), -- Slavia Praha
  ('football-data', '1045', 114, 'seed-2026-09-13:strong', 6, false), -- Paris FC
  ('football-data', '1076', 1346, 'seed-2026-09-13:strong', 2, false), -- Coventry
  ('football-data', '1887', 550, 'seed-2026-09-13:single', 1, false), -- Shakhtar Donetsk
  ('football-data', '1899', 575, 'seed-2026-09-13:single', 1, false), -- AEK Athens FC
  ('football-data', '5335', 4665, 'seed-2026-09-13:strong', 3, false), -- Racing Santander
  ('football-data', '5721', 327, 'seed-2026-09-13:single', 1, false), -- Bodo/Glimt
  ('football-data', '5890', 867, 'seed-2026-09-13:strong', 2, false), -- Lecce
  ('football-data', '5911', 1579, 'seed-2026-09-13:strong', 2, false), -- Monza
  ('football-data', '7397', 895, 'seed-2026-09-13:strong', 3, false), -- Como
  ('football-data', '7509', 656, 'seed-2026-09-13:single', 1, false), -- Slovan Bratislava
  ('football-data', '10233', 13976, 'seed-2026-09-13:single', 1, false) -- Sabah FA
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_changes integer;
BEGIN
  SELECT count(*) INTO v_changes FROM public.refresh_match_team_keys(NULL, true, false) WHERE applied;
  RAISE NOTICE 'Claves de equipo actualizadas: %', v_changes;
END $$;
