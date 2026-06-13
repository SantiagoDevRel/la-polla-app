// lib/inicio/world-cup-facts.ts
//
// Dataset estático y bilingüe de datos curiosos REALES del Mundial de la
// FIFA. Lo consume components/inicio/WorldCupFactsCard.tsx, que muestra 4
// por día (rotación determinística por fecha de Bogotá, de a uno en un
// carrusel horizontal). Cero APIs en runtime — free-tier intacto.
//
// Curaduría: hechos bien establecidos y verificables (historia 1930-2022,
// formato del Mundial 2026, récords, jugadores icónicos, y Colombia en los
// mundiales). Generación asistida con búsqueda web (Gemini/agy) + curaduría
// manual. Para refrescar o ampliar, agregá entradas { es, en } al final —
// el orden no importa (la rotación es por índice módulo longitud).
//
// Reglas de estilo: una frase, ~110 caracteres máx (cabe en la card del
// celular), sin emojis. Mantené `es` y `en` en paridad de contenido.

export interface WorldCupFact {
  es: string;
  en: string;
}

export const WORLD_CUP_FACTS: WorldCupFact[] = [
  // ── Historia · orígenes y campeones ──────────────────────────────────
  { es: "El primer Mundial se jugó en 1930 en Uruguay, con solo 13 selecciones invitadas.", en: "The first World Cup was played in 1930 in Uruguay, with just 13 invited teams." },
  { es: "Uruguay fue el primer campeón del mundo: venció 4-2 a Argentina en la final de 1930.", en: "Uruguay were the first world champions, beating Argentina 4-2 in the 1930 final." },
  { es: "El primer gol en la historia de los mundiales lo marcó el francés Lucien Laurent en 1930.", en: "The first goal in World Cup history was scored by France's Lucien Laurent in 1930." },
  { es: "Los Mundiales de 1942 y 1946 se cancelaron por la Segunda Guerra Mundial.", en: "The 1942 and 1946 World Cups were cancelled because of World War II." },
  { es: "Brasil es la única selección que ha jugado todas las Copas del Mundo.", en: "Brazil are the only team to have played in every World Cup." },
  { es: "Brasil tiene el récord de títulos mundiales: cinco campeonatos.", en: "Brazil hold the record for World Cup titles with five championships." },
  { es: "Brasil ganó para siempre la Copa Jules Rimet al lograr su tercer título en 1970.", en: "Brazil won the Jules Rimet Trophy permanently after their third title in 1970." },
  { es: "El trofeo actual lo diseñó el italiano Silvio Gazzaniga y se usa desde 1974.", en: "The current trophy was designed by Italy's Silvio Gazzaniga and used since 1974." },
  { es: "En 1966 la Copa Jules Rimet fue robada y la encontró un perro llamado Pickles.", en: "In 1966 the Jules Rimet Trophy was stolen and found by a dog named Pickles." },
  { es: "El 'Maracanazo' de 1950: Uruguay venció a Brasil en el Maracaná y le quitó el título en casa.", en: "The 1950 'Maracanazo': Uruguay beat Brazil at the Maracanã to win the title in their home." },
  { es: "Italia y Brasil fueron las primeras selecciones en ganar dos mundiales seguidos.", en: "Italy and Brazil were the first teams to win two World Cups in a row." },

  // ── Mundial 2026 ─────────────────────────────────────────────────────
  { es: "El Mundial 2026 será el primero de la historia con 48 selecciones.", en: "The 2026 World Cup will be the first ever with 48 teams." },
  { es: "Estados Unidos, México y Canadá organizan juntos el Mundial 2026.", en: "The United States, Mexico and Canada are co-hosting the 2026 World Cup." },
  { es: "El Mundial 2026 tendrá un récord de 104 partidos en total.", en: "The 2026 World Cup will have a record 104 matches in total." },
  { es: "México será el primer país en albergar la Copa del Mundo en tres ocasiones.", en: "Mexico will become the first country to host the World Cup three times." },
  { es: "El Estadio Azteca será el primer estadio en albergar tres mundiales (1970, 1986 y 2026).", en: "Estadio Azteca will be the first stadium to host three World Cups (1970, 1986, 2026)." },
  { es: "El Mundial 2026 se reparte en 16 ciudades sede de los tres países anfitriones.", en: "The 2026 World Cup is spread across 16 host cities in the three host nations." },
  { es: "En 2026 habrá 12 grupos de cuatro: avanzan los dos primeros y los ocho mejores terceros.", en: "In 2026 there will be 12 groups of four: top two and the eight best third-placed advance." },
  { es: "El Mundial 2026 estrena una ronda de dieciseisavos (32 equipos) antes de octavos.", en: "The 2026 World Cup debuts a round of 32 before the round of 16." },
  { es: "La final del Mundial 2026 se jugará en el MetLife Stadium, cerca de Nueva York.", en: "The 2026 World Cup final will be played at MetLife Stadium, near New York." },
  { es: "El Mundial 2026 será el primero organizado por tres países a la vez.", en: "The 2026 World Cup will be the first hosted by three countries at once." },

  // ── Récords goleadores ───────────────────────────────────────────────
  { es: "El alemán Miroslav Klose es el máximo goleador histórico de los mundiales, con 16 goles.", en: "Germany's Miroslav Klose is the all-time World Cup top scorer with 16 goals." },
  { es: "El francés Just Fontaine marcó 13 goles en 1958, récord en una sola edición.", en: "France's Just Fontaine scored 13 goals in 1958, the record for a single edition." },
  { es: "El brasileño Ronaldo Nazário lideró la tabla histórica de goles hasta que Klose lo superó en 2014.", en: "Brazil's Ronaldo led the all-time scoring chart until Klose passed him in 2014." },
  { es: "El ruso Oleg Salenko marcó 5 goles en un solo partido del Mundial 1994.", en: "Russia's Oleg Salenko scored 5 goals in a single match at the 1994 World Cup." },
  { es: "El turco Hakan Şükür marcó el gol más rápido de un Mundial: a los 11 segundos en 2002.", en: "Turkey's Hakan Şükür scored the fastest World Cup goal ever: 11 seconds, in 2002." },
  { es: "La mayor goleada por marcador fue el 10-1 de Hungría a El Salvador en 1982.", en: "The biggest scoreline was Hungary's 10-1 win over El Salvador in 1982." },
  { es: "El partido con más goles fue Austria 7-5 Suiza en 1954: doce goles en total.", en: "The highest-scoring match was Austria 7-5 Switzerland in 1954: twelve goals total." },
  { es: "El argentino Guillermo Stábile fue el primer goleador de un Mundial, con 8 goles en 1930.", en: "Argentina's Guillermo Stábile was the first World Cup top scorer, with 8 goals in 1930." },

  // ── Jugadores y momentos icónicos ────────────────────────────────────
  { es: "Pelé es el único jugador que ha ganado tres Copas del Mundo (1958, 1962 y 1970).", en: "Pelé is the only player to win three World Cups (1958, 1962 and 1970)." },
  { es: "Con 17 años, Pelé fue el jugador más joven en marcar en una final de Mundial, en 1958.", en: "At 17, Pelé became the youngest player to score in a World Cup final, in 1958." },
  { es: "Maradona hizo la 'Mano de Dios' y el 'Gol del Siglo' en el mismo partido ante Inglaterra en 1986.", en: "Maradona scored the 'Hand of God' and the 'Goal of the Century' in the same 1986 game vs England." },
  { es: "Diego Maradona capitaneó a Argentina a su título mundial en México 1986.", en: "Diego Maradona captained Argentina to their World Cup title in Mexico 1986." },
  { es: "Lionel Messi es el jugador con más partidos en la historia de los mundiales: 26.", en: "Lionel Messi has played the most World Cup matches in history: 26." },
  { es: "Messi coronó su carrera ganando el Mundial con Argentina en Qatar 2022.", en: "Messi crowned his career by winning the World Cup with Argentina in Qatar 2022." },
  { es: "Argentina cortó una sequía de 36 años sin título al ganar Qatar 2022.", en: "Argentina ended a 36-year title drought by winning Qatar 2022." },
  { es: "Zinedine Zidane fue expulsado por un cabezazo a Materazzi en la final de 2006.", en: "Zinedine Zidane was sent off for headbutting Materazzi in the 2006 final." },
  { es: "Ronaldo Nazário marcó los dos goles con que Brasil ganó la final de 2002.", en: "Ronaldo scored both goals as Brazil won the 2002 final." },
  { es: "El argentino Gabriel Batistuta es el único que marcó tripletes en dos mundiales distintos.", en: "Argentina's Gabriel Batistuta is the only player to score hat-tricks in two different World Cups." },
  { es: "El camerunés Roger Milla marcó a los 42 años en 1994: el goleador más veterano de un Mundial.", en: "Cameroon's Roger Milla scored at age 42 in 1994, the oldest scorer in World Cup history." },

  // ── Anfitriones, sedes y curiosidades ────────────────────────────────
  { es: "Solo seis países anfitriones han ganado el Mundial jugando en casa.", en: "Only six host nations have won the World Cup on home soil." },
  { es: "Qatar 2022 fue el primer Mundial jugado en noviembre y diciembre, por el calor del verano.", en: "Qatar 2022 was the first World Cup played in November and December, due to summer heat." },
  { es: "Qatar y Sudáfrica son los únicos anfitriones eliminados en la primera fase.", en: "Qatar and South Africa are the only hosts eliminated in the group stage." },
  { es: "Corea y Japón 2002 fue el primer Mundial co-organizado por dos países.", en: "Korea/Japan 2002 was the first World Cup co-hosted by two countries." },
  { es: "Corea del Sur llegó a semifinales en 2002: el mejor resultado de una selección asiática.", en: "South Korea reached the semifinals in 2002, the best result by an Asian team." },
  { es: "Corea del Norte sorprendió al mundo al eliminar a Italia y llegar a cuartos en 1966.", en: "North Korea shocked the world by knocking out Italy and reaching the quarters in 1966." },
  { es: "En Suecia 1958 jugaron por única vez las cuatro selecciones del Reino Unido a la vez.", en: "Sweden 1958 was the only World Cup with all four UK nations playing at once." },
  { es: "World Cup Willie, un león inglés de 1966, fue la primera mascota de un Mundial.", en: "World Cup Willie, an English lion from 1966, was the first World Cup mascot." },
  { es: "La famosa 'Batalla de Santiago' fue un violento Chile-Italia en el Mundial de 1962.", en: "The infamous 'Battle of Santiago' was a violent Chile-Italy clash at the 1962 World Cup." },

  // ── Arbitraje y reglas ───────────────────────────────────────────────
  { es: "La tecnología de la línea de gol debutó en el Mundial de Brasil 2014.", en: "Goal-line technology debuted at the 2014 World Cup in Brazil." },
  { es: "El VAR se usó por primera vez en un Mundial en Rusia 2018.", en: "VAR was used at a World Cup for the first time in Russia 2018." },
  { es: "En 2022, Stéphanie Frappart fue la primera mujer en arbitrar un partido mundialista masculino.", en: "In 2022, Stéphanie Frappart became the first woman to referee a men's World Cup match." },
  { es: "El croata Josip Šimunić recibió tres tarjetas amarillas en un mismo partido en 2006.", en: "Croatia's Josip Šimunić received three yellow cards in one match in 2006." },
  { es: "El uruguayo José Batista fue expulsado a los 56 segundos ante Escocia en 1986.", en: "Uruguay's José Batista was sent off after 56 seconds against Scotland in 1986." },
  { es: "Desde 1994 se dan tres puntos por victoria en la fase de grupos, no dos.", en: "Since 1994, group-stage wins are worth three points instead of two." },
  { es: "Los penales para definir partidos del Mundial se usan desde la edición de 1982.", en: "Penalty shootouts to decide World Cup matches have been used since the 1982 edition." },

  // ── Selecciones · datos ──────────────────────────────────────────────
  { es: "Alemania es la selección con más partidos jugados en mundiales.", en: "Germany are the team with the most World Cup matches played." },
  { es: "Alemania llegó a ocho finales de Mundial, récord de la competición.", en: "Germany reached eight World Cup finals, a competition record." },
  { es: "Brasil 1970, con Pelé, es para muchos el mejor equipo de la historia de los mundiales.", en: "Brazil 1970, with Pelé, is regarded by many as the greatest World Cup team ever." },
  { es: "Alemania humilló 7-1 a Brasil en la semifinal de 2014, el 'Mineirazo'.", en: "Germany humiliated Brazil 7-1 in the 2014 semifinal, the 'Mineirazo'." },
  { es: "España ganó su único Mundial en 2010, con un gol de Iniesta en la final.", en: "Spain won their only World Cup in 2010, with an Iniesta goal in the final." },
  { es: "Italia ganó cuatro mundiales (1934, 1938, 1982 y 2006), solo superada por Brasil.", en: "Italy won four World Cups (1934, 1938, 1982, 2006), behind only Brazil." },
  { es: "Francia ganó sus dos mundiales (1998 y 2018) con veinte años de diferencia.", en: "France won both of their World Cups (1998 and 2018) twenty years apart." },

  // ── Colombia en los mundiales ────────────────────────────────────────
  { es: "Colombia debutó en una Copa del Mundo en Chile 1962.", en: "Colombia made their World Cup debut at Chile 1962." },
  { es: "En 1962, el colombiano Marcos Coll marcó el único gol olímpico en la historia de los mundiales.", en: "In 1962, Colombia's Marcos Coll scored the only Olympic goal in World Cup history." },
  { es: "Marcos Coll le marcó su gol olímpico nada menos que al legendario arquero Lev Yashin.", en: "Marcos Coll scored his Olympic goal against none other than the legendary keeper Lev Yashin." },
  { es: "En las eliminatorias de 1993, Colombia goleó 5-0 a Argentina en pleno Buenos Aires.", en: "In 1993 qualifying, Colombia thrashed Argentina 5-0 in the heart of Buenos Aires." },
  { es: "Carlos 'el Pibe' Valderrama jugó tres mundiales con Colombia: 1990, 1994 y 1998.", en: "Carlos 'el Pibe' Valderrama played three World Cups with Colombia: 1990, 1994 and 1998." },
  { es: "En Italia 1990, Colombia llegó a octavos en su regreso al Mundial tras 28 años.", en: "At Italy 1990, Colombia reached the round of 16 on their return after 28 years." },
  { es: "El trágico autogol de Andrés Escobar ante Estados Unidos marcó el Mundial de 1994.", en: "Andrés Escobar's tragic own goal against the USA marked the 1994 World Cup." },
  { es: "El mejor resultado de Colombia fue llegar a cuartos de final en Brasil 2014.", en: "Colombia's best result was reaching the quarterfinals at Brazil 2014." },
  { es: "James Rodríguez fue el goleador del Mundial 2014 con seis goles.", en: "James Rodríguez was the top scorer of the 2014 World Cup with six goals." },
  { es: "El golazo de James ante Uruguay en 2014 ganó el premio Puskás al mejor gol del año.", en: "James's stunning goal against Uruguay in 2014 won the Puskás Award for goal of the year." },
  { es: "En 2014, Faryd Mondragón jugó a los 43 años: el futbolista más veterano de un Mundial hasta entonces.", en: "In 2014, Faryd Mondragón played at 43, the oldest World Cup player up to that point." },
  { es: "René Higuita y su famoso 'escorpión' marcaron una época de la Colombia mundialista.", en: "René Higuita and his famous 'scorpion kick' defined an era of Colombia's World Cup teams." },

  // ── Más historia y curiosidades ──────────────────────────────────────
  { es: "El Mundial es el evento deportivo más visto del planeta, por encima de los Juegos Olímpicos.", en: "The World Cup is the most-watched sporting event on the planet, ahead of the Olympics." },
  { es: "El 'Milagro de Berna': Alemania Occidental venció 3-2 a la favorita Hungría en la final de 1954.", en: "The 'Miracle of Bern': West Germany beat favourites Hungary 3-2 in the 1954 final." },
  { es: "Hungría llegó invicta a la final de 1954 tras 32 partidos sin perder.", en: "Hungary reached the 1954 final unbeaten in 32 matches." },
  { es: "En 1938, Cuba y las Indias Orientales Holandesas debutaron y nunca más volvieron a un Mundial.", en: "In 1938, Cuba and the Dutch East Indies debuted and never returned to a World Cup." },
  { es: "El Mundial de 1930 se jugó todo en una sola ciudad: Montevideo.", en: "The entire 1930 World Cup was played in a single city: Montevideo." },
  { es: "La 'Naranja Mecánica' de Holanda perdió dos finales seguidas, en 1974 y 1978.", en: "The Netherlands' 'Total Football' side lost two straight finals, in 1974 and 1978." },
  { es: "Holanda llegó a tres finales (1974, 1978 y 2010) sin ganar nunca el Mundial.", en: "The Netherlands reached three finals (1974, 1978, 2010) without ever winning the World Cup." },
  { es: "El 'Mundial del calor', México 1986, popularizó la famosa 'ola' en las tribunas.", en: "Mexico 1986 popularised the famous stadium 'wave' among the crowds." },
  { es: "El balón Telstar de 1970 fue el primero en blanco y negro pensado para la TV.", en: "The 1970 Telstar ball was the first black-and-white ball designed for television." },
  { es: "La mayor asistencia a un partido fue la final de 1950 en el Maracaná, con casi 200.000 personas.", en: "The biggest match attendance was the 1950 final at the Maracanã, with nearly 200,000 people." },
  { es: "Solo ocho países diferentes han ganado la Copa del Mundo en toda su historia.", en: "Only eight different countries have ever won the World Cup." },
  { es: "Los campeones del mundo son: Brasil, Alemania, Italia, Argentina, Francia, Uruguay, España e Inglaterra.", en: "The world champions are: Brazil, Germany, Italy, Argentina, France, Uruguay, Spain and England." },
  { es: "Inglaterra ganó su único Mundial en casa, en 1966.", en: "England won their only World Cup at home, in 1966." },
  { es: "El inglés Geoff Hurst es el único en marcar un triplete en una final de Mundial, en 1966.", en: "England's Geoff Hurst is the only player to score a hat-trick in a World Cup final, in 1966." },
  { es: "Varios cracks han jugado cinco mundiales, como Messi, Cristiano Ronaldo y Antonio Carbajal.", en: "Several greats have played five World Cups, among them Messi, Cristiano Ronaldo and Carbajal." },
  { es: "Guillermo Ochoa, arquero de México, ha jugado cinco mundiales con atajadas memorables.", en: "Mexico's keeper Guillermo Ochoa has played five World Cups with memorable saves." },
  { es: "El mexicano Antonio Carbajal fue el primero en jugar cinco mundiales (1950-1966).", en: "Mexico's Antonio Carbajal was the first to play five World Cups (1950-1966)." },
  { es: "El portugués Cristiano Ronaldo marcó en cinco mundiales distintos, un récord histórico.", en: "Portugal's Cristiano Ronaldo scored in five different World Cups, a historic record." },
  { es: "Lothar Matthäus tiene el récord de partidos jugados por una sola persona hasta que Messi lo igualó.", en: "Lothar Matthäus held the record for matches played until Messi matched and passed it." },
  { es: "El Mundial de 1978 lo ganó Argentina en casa, en plena dictadura militar.", en: "Argentina won the 1978 World Cup at home, during a military dictatorship." },
  { es: "Camerún en 1990 fue la primera selección africana en llegar a cuartos de final.", en: "Cameroon in 1990 were the first African team to reach the quarterfinals." },
  { es: "Marruecos en 2022 fue la primera selección africana en llegar a semifinales.", en: "Morocco in 2022 became the first African team to reach the semifinals." },
  { es: "Senegal debutó en 2002 venciendo a Francia, la campeona vigente, en el partido inaugural.", en: "Senegal debuted in 2002 by beating reigning champions France in the opening match." },
  { es: "El 'Jogo Bonito' de Brasil hizo del fútbol vistoso una marca registrada mundialista.", en: "Brazil's 'Jogo Bonito' made beautiful football a World Cup trademark." },
  { es: "Rigobert Song fue el primer jugador expulsado en dos mundiales distintos (1994 y 1998).", en: "Rigobert Song was the first player sent off at two different World Cups (1994 and 1998)." },
  { es: "El Mundial de 1994 en Estados Unidos tiene el récord de asistencia promedio por partido.", en: "The 1994 World Cup in the USA holds the record for average attendance per match." },
  { es: "La final de 1994 entre Brasil e Italia se definió por penales: Baggio falló el decisivo.", en: "The 1994 final between Brazil and Italy was decided on penalties: Baggio missed the decisive one." },
  { es: "Pelé fue incluido en el equipo de 1962 aunque una lesión lo dejó casi todo el torneo afuera.", en: "Pelé was part of the 1962 winning squad even though injury kept him out most of the tournament." },
  { es: "El 'Mundial de las altitudes', México 1970, fue el primero transmitido a color a todo el planeta.", en: "Mexico 1970 was the first World Cup broadcast in colour worldwide." },
  { es: "La final de 1970, Brasil 4-1 Italia, es considerada una de las mejores de la historia.", en: "The 1970 final, Brazil 4-1 Italy, is regarded as one of the greatest ever." },
  { es: "El brasileño Cafú es el único que jugó tres finales de Mundial seguidas (1994, 1998 y 2002).", en: "Brazil's Cafú is the only player to appear in three straight World Cup finals (1994, 1998, 2002)." },
  { es: "Italia ganó el Mundial de 2006 poco después del escándalo 'Calciopoli' en su liga.", en: "Italy won the 2006 World Cup shortly after the 'Calciopoli' scandal in their league." },
  { es: "El primer Mundial televisado fue el de Suiza 1954.", en: "The first televised World Cup was Switzerland 1954." },
  { es: "El 'Gol Fantasma' de Lampard en 2010 aceleró la llegada de la tecnología de línea de gol.", en: "Lampard's 'ghost goal' in 2010 sped up the arrival of goal-line technology." },
  { es: "Vavá, Pelé y otros pocos han marcado en dos finales distintas de Mundial.", en: "Vavá, Pelé and a select few have scored in two different World Cup finals." },
  { es: "El alemán Franz Beckenbauer ganó el Mundial como jugador (1974) y como técnico (1990).", en: "Germany's Franz Beckenbauer won the World Cup as a player (1974) and a coach (1990)." },
  { es: "Mário Zagallo fue el primero en ser campeón del mundo como jugador y como entrenador.", en: "Mário Zagallo was the first to be world champion as both player and coach." },
  { es: "Didier Deschamps ganó el Mundial como capitán (1998) y como director técnico (2018).", en: "Didier Deschamps won the World Cup as captain (1998) and as head coach (2018)." },
  { es: "La final de 2022 entre Argentina y Francia, 3-3 y penales, es vista como la mejor de la historia.", en: "The 2022 final between Argentina and France, 3-3 then penalties, is hailed as the best ever." },
  { es: "Kylian Mbappé marcó un triplete en la final de 2022 y aún así perdió el título.", en: "Kylian Mbappé scored a hat-trick in the 2022 final and still finished on the losing side." },
  { es: "Mbappé, con 19 años, fue campeón del mundo en 2018, como lo había sido Pelé en 1958.", en: "Mbappé became a world champion at 19 in 2018, just as Pelé had in 1958." },
  { es: "El primer gol de penalti en un Mundial lo cobró el mexicano Manuel Rosas en 1930.", en: "The first penalty goal in a World Cup was scored by Mexico's Manuel Rosas in 1930." },
  { es: "El Mundial reparte hoy más dinero en premios que ningún otro torneo de selecciones.", en: "The World Cup hands out more prize money than any other national-team tournament." },
  { es: "El uruguayo Diego Forlán fue el mejor jugador del Mundial 2010 pese a no llegar a la final.", en: "Uruguay's Diego Forlán was player of the 2010 World Cup despite not reaching the final." },
  { es: "El primer hat-trick de la historia de los mundiales lo hizo el estadounidense Bert Patenaude en 1930.", en: "The first hat-trick in World Cup history was scored by the USA's Bert Patenaude in 1930." },

  // ── Mundial 2026 · detalles (verificado con búsqueda web) ────────────
  { es: "El Mundial 2026 dura 39 días, del 11 de junio al 19 de julio.", en: "The 2026 World Cup runs 39 days, from June 11 to July 19." },
  { es: "Estados Unidos será sede de 11 de las 16 ciudades del Mundial 2026.", en: "The United States will host 11 of the 16 cities at the 2026 World Cup." },
  { es: "México pone tres sedes en 2026: Ciudad de México, Guadalajara y Monterrey.", en: "Mexico contributes three host cities in 2026: Mexico City, Guadalajara and Monterrey." },
  { es: "Canadá será sede de un Mundial masculino por primera vez en 2026, con Toronto y Vancouver.", en: "Canada will host a men's World Cup for the first time in 2026, in Toronto and Vancouver." },
  { es: "Maple, Zayu y Clutch son las mascotas oficiales del Mundial 2026.", en: "Maple, Zayu and Clutch are the official mascots of the 2026 World Cup." },
  { es: "Trionda, de Adidas, es el balón oficial del Mundial 2026.", en: "Trionda, by Adidas, is the official ball of the 2026 World Cup." },
  { es: "Colombia volvió a un Mundial en 2026 tras quedarse afuera de Qatar 2022.", en: "Colombia returned to a World Cup in 2026 after missing out on Qatar 2022." },
  { es: "Cabo Verde, Curazao, Jordania y Uzbekistán llegan por primera vez a un Mundial en 2026.", en: "Cape Verde, Curaçao, Jordan and Uzbekistan reach a World Cup for the first time in 2026." },

  // ── Más récords y curiosidades (verificado con búsqueda web) ─────────
  { es: "Norman Whiteside es el jugador más joven de un Mundial: 17 años y 41 días, en 1982.", en: "Norman Whiteside is the youngest World Cup player ever: 17 years and 41 days, in 1982." },
  { es: "El egipcio Essam El-Hadary es el jugador más veterano de un Mundial: 45 años, en 2018.", en: "Egypt's Essam El-Hadary is the oldest World Cup player ever: 45 years old, in 2018." },
  { es: "Pelé es el goleador más joven de un Mundial: 17 años y 239 días, en 1958.", en: "Pelé is the youngest World Cup scorer ever: 17 years and 239 days, in 1958." },
  { es: "Qatar 2022 fue el Mundial con más goles de la historia: 172.", en: "Qatar 2022 was the highest-scoring World Cup ever, with 172 goals." },
  { es: "Estados Unidos 1994 tiene la mayor asistencia total: más de 3,5 millones de espectadores.", en: "The 1994 USA World Cup holds the record for total attendance: over 3.5 million spectators." },
  { es: "Brasil ganó once partidos seguidos de Mundial entre 2002 y 2006, un récord.", en: "Brazil won eleven consecutive World Cup matches between 2002 and 2006, a record." },
  { es: "Dino Zoff ganó el Mundial 1982 como capitán de Italia a los 40 años.", en: "Dino Zoff won the 1982 World Cup as Italy's captain at age 40." },
  { es: "Peter Shilton y Fabien Barthez comparten el récord de 10 partidos sin recibir gol en mundiales.", en: "Peter Shilton and Fabien Barthez share the record of 10 World Cup clean sheets." },
  { es: "El peruano Plácido Galindo fue el primer jugador expulsado en un Mundial, en 1930.", en: "Peru's Plácido Galindo was the first player ever sent off at a World Cup, in 1930." },
  { es: "El balón Azteca de 1986 fue el primero totalmente sintético en un Mundial.", en: "The 1986 Azteca ball was the first fully synthetic ball at a World Cup." },
  { es: "El Tango de 1982 fue el último balón mundialista hecho de cuero.", en: "The 1982 Tango was the last World Cup ball made of leather." },
  { es: "El Tricolore de Francia 1998 fue el primer balón multicolor de un Mundial.", en: "France 1998's Tricolore was the first multicoloured World Cup ball." },
  { es: "Al Rihla fue el balón oficial de Qatar 2022.", en: "Al Rihla was the official ball of Qatar 2022." },
  { es: "En su debut en 1962, Colombia rescató un histórico 4-4 ante la poderosa Unión Soviética.", en: "On their 1962 debut, Colombia rescued a historic 4-4 draw against the mighty Soviet Union." },
  { es: "Alemania ganó Brasil 2014 con un gol de Mario Götze en el alargue ante Argentina.", en: "Germany won Brazil 2014 with a Mario Götze goal in extra time against Argentina." },
  { es: "Naranjito, una naranja sonriente, fue la mascota de España 1982.", en: "Naranjito, a smiling orange, was the mascot of the 1982 World Cup in Spain." },
  { es: "El Mundial pasó de 16 a 24 selecciones en 1982 y a 32 en 1998.", en: "The World Cup grew from 16 to 24 teams in 1982 and to 32 in 1998." },

  // ── Récords y figuras ────────────────────────────────────────────────
  { es: "Miroslav Klose es el máximo goleador histórico de los mundiales, con 16 goles.", en: "Miroslav Klose is the all-time World Cup top scorer, with 16 goals." },
  { es: "Pelé es el único futbolista que ganó tres mundiales: 1958, 1962 y 1970.", en: "Pelé is the only footballer to win three World Cups: 1958, 1962 and 1970." },
  { es: "El francés Just Fontaine marcó 13 goles en un solo Mundial (1958), un récord intacto.", en: "France's Just Fontaine scored 13 goals at a single World Cup (1958), a record that still stands." },
  { es: "El gol más rápido de un Mundial lo hizo Hakan Sukur a los 11 segundos, en 2002.", en: "The fastest World Cup goal was scored by Hakan Sukur after 11 seconds, in 2002." },
  { es: "Roger Milla, de Camerún, anotó a los 42 años en 1994: el goleador más veterano del Mundial.", en: "Cameroon's Roger Milla scored at 42 in 1994, the oldest goalscorer in World Cup history." },
  { es: "Solo ocho selecciones han ganado un Mundial en toda la historia.", en: "Only eight nations have ever won a World Cup." },
  { es: "Lionel Messi por fin levantó la Copa en 2022, en su quinto Mundial.", en: "Lionel Messi finally lifted the trophy in 2022, at his fifth World Cup." },
  { es: "Alemania goleó 7-1 a Brasil en la semifinal de 2014, uno de los resultados más impactantes.", en: "Germany thrashed Brazil 7-1 in the 2014 semifinal, one of the most shocking results ever." },
  { es: "España ganó su primer y único Mundial en 2010, en Sudáfrica.", en: "Spain won their first and only World Cup in 2010, in South Africa." },

  // ── Tecnología, sedes y curiosidades ─────────────────────────────────
  { es: "La tecnología de gol en la línea debutó en 2014 y el VAR llegó en el Mundial de 2018.", en: "Goal-line technology debuted in 2014 and VAR arrived at the 2018 World Cup." },
  { es: "El sonido del Mundial de Sudáfrica 2010 fueron las vuvuzelas en las tribunas.", en: "The sound of the 2010 South Africa World Cup was the vuvuzelas in the stands." },
  { es: "En 1986, Maradona marcó la 'Mano de Dios' y el 'Gol del Siglo' en el mismo partido ante Inglaterra.", en: "In 1986, Maradona scored the 'Hand of God' and the 'Goal of the Century' in the same match against England." },
  { es: "El egipcio Essam El-Hadary jugó en 2018 a los 45 años: el futbolista más veterano de un Mundial.", en: "Egypt's Essam El-Hadary played in 2018 at age 45, the oldest player in World Cup history." },
  { es: "La final de 1950 en el Maracaná reunió a casi 200.000 personas, una multitud récord.", en: "The 1950 final at the Maracanã drew nearly 200,000 people, a record crowd." },

  // ── Colombia en los mundiales ────────────────────────────────────────
  { es: "El mejor Mundial de Colombia fue Brasil 2014: llegó a cuartos de final por primera vez.", en: "Colombia's best World Cup was Brazil 2014, reaching the quarterfinals for the first time." },
  { es: "James Rodriguez ganó la Bota de Oro de 2014 con 6 goles, incluida su volea ante Uruguay.", en: "James Rodriguez won the 2014 Golden Boot with 6 goals, including his volley against Uruguay." },
];
