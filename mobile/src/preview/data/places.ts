/**
 * Gazetteer SIMULADO de Sevilla y alrededores para geocodificación, geocodificación inversa y etiquetas de paradas.
 * Coordenadas aproximadas (± 200 m), suficientes para dibujar el mapa y calcular distancias de ejemplo. No es el
 * proveedor de mapas real (Google) ni datos oficiales.
 */

export type PlaceKind = "ciudad" | "municipio" | "barrio" | "poi" | "calle";

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Municipio al que pertenece (para «Calle, Municipio»). */
  municipality: string;
  lat: number;
  lng: number;
  /** Otros nombres con los que se puede buscar. */
  aliases?: readonly string[];
  /** Dirección corta para mostrar. */
  address?: string;
}

const p = (
  id: string,
  name: string,
  kind: PlaceKind,
  municipality: string,
  lat: number,
  lng: number,
  extra: { aliases?: readonly string[]; address?: string } = {}
): Place => ({ id, name, kind, municipality, lat, lng, ...extra });

export const PLACES: readonly Place[] = [
  // ---- municipios y ciudades de la provincia de Sevilla ----
  p("sevilla", "Sevilla", "ciudad", "Sevilla", 37.3891, -5.9845, { aliases: ["sevilla capital", "sevilla centro"] }),
  p("dos-hermanas", "Dos Hermanas", "municipio", "Dos Hermanas", 37.2829, -5.9209),
  p("montequinto", "Montequinto", "barrio", "Dos Hermanas", 37.3256, -5.9396, { aliases: ["montequinto dos hermanas"] }),
  p("mairena-aljarafe", "Mairena del Aljarafe", "municipio", "Mairena del Aljarafe", 37.3445, -6.0603, { aliases: ["mairena"] }),
  p("palomares", "Palomares del Río", "municipio", "Palomares del Río", 37.3103, -6.0486),
  p("camas", "Camas", "municipio", "Camas", 37.4036, -6.0328),
  p("tomares", "Tomares", "municipio", "Tomares", 37.3719, -6.0472),
  p("san-juan", "San Juan de Aznalfarache", "municipio", "San Juan de Aznalfarache", 37.3667, -6.0394, { aliases: ["san juan"] }),
  p("bormujos", "Bormujos", "municipio", "Bormujos", 37.3714, -6.0719),
  p("gelves", "Gelves", "municipio", "Gelves", 37.334, -6.025),
  p("coria", "Coria del Río", "municipio", "Coria del Río", 37.288, -6.054, { aliases: ["coria"] }),
  p("castilleja-cuesta", "Castilleja de la Cuesta", "municipio", "Castilleja de la Cuesta", 37.386, -6.056),
  p("espartinas", "Espartinas", "municipio", "Espartinas", 37.387, -6.116),
  p("valencina", "Valencina de la Concepción", "municipio", "Valencina de la Concepción", 37.42, -6.07),
  p("salteras", "Salteras", "municipio", "Salteras", 37.412, -6.101),
  p("olivares", "Olivares", "municipio", "Olivares", 37.417, -6.153),
  p("sanlucar-mayor", "Sanlúcar la Mayor", "municipio", "Sanlúcar la Mayor", 37.387, -6.202),
  p("la-rinconada", "La Rinconada", "municipio", "La Rinconada", 37.488, -5.981),
  p("alcala-guadaira", "Alcalá de Guadaíra", "municipio", "Alcalá de Guadaíra", 37.338, -5.84, { aliases: ["alcala de guadaira"] }),
  p("mairena-alcor", "Mairena del Alcor", "municipio", "Mairena del Alcor", 37.372, -5.744),
  p("carmona", "Carmona", "municipio", "Carmona", 37.471, -5.643),
  p("utrera", "Utrera", "municipio", "Utrera", 37.185, -5.78),
  p("los-palacios", "Los Palacios y Villafranca", "municipio", "Los Palacios y Villafranca", 37.162, -5.925, { aliases: ["los palacios"] }),
  p("lebrija", "Lebrija", "municipio", "Lebrija", 36.92, -6.074),
  p("ecija", "Écija", "municipio", "Écija", 37.542, -5.082, { aliases: ["ecija"] }),
  p("moron", "Morón de la Frontera", "municipio", "Morón de la Frontera", 37.121, -5.454, { aliases: ["moron"] }),
  p("osuna", "Osuna", "municipio", "Osuna", 37.236, -5.102),
  p("marchena", "Marchena", "municipio", "Marchena", 37.329, -5.413),
  p("lora-rio", "Lora del Río", "municipio", "Lora del Río", 37.66, -5.526),
  p("cantillana", "Cantillana", "municipio", "Cantillana", 37.6, -5.82),
  // ---- barrios de Sevilla ----
  p("triana", "Triana", "barrio", "Sevilla", 37.3828, -6.0046),
  p("los-remedios", "Los Remedios", "barrio", "Sevilla", 37.377, -6.003),
  p("nervion", "Nervión", "barrio", "Sevilla", 37.383, -5.971),
  p("los-bermejales", "Los Bermejales", "barrio", "Sevilla", 37.35, -5.977),
  p("cartuja", "La Cartuja", "barrio", "Sevilla", 37.41, -6.003, { aliases: ["cartuja", "isla de la cartuja"] }),
  p("macarena", "La Macarena", "barrio", "Sevilla", 37.406, -5.99, { aliases: ["macarena"] }),
  p("bellavista", "Bellavista", "barrio", "Sevilla", 37.3329, -5.9748),
  p("sevilla-este", "Sevilla Este", "barrio", "Sevilla", 37.4007, -5.9175),
  p("pino-montano", "Pino Montano", "barrio", "Sevilla", 37.4223, -5.9786),
  // ---- puntos de interés ----
  p("universidad-sevilla", "Universidad de Sevilla", "poi", "Sevilla", 37.3825, -5.9919, {
    aliases: ["us", "rectorado", "universidad sevilla", "universidad"],
    address: "C. San Fernando, 4",
  }),
  p("us-ingenieria", "Escuela Técnica Superior de Ingeniería", "poi", "Sevilla", 37.4107, -6.0044, {
    aliases: ["etsi", "ingenieria", "facultad de ingenieria"],
    address: "Camino de los Descubrimientos",
  }),
  p("us-reina-mercedes", "Campus de Reina Mercedes", "poi", "Sevilla", 37.359, -5.983, {
    aliases: ["reina mercedes", "facultad de farmacia"],
    address: "Av. Reina Mercedes",
  }),
  p("upo", "Universidad Pablo de Olavide", "poi", "Sevilla", 37.3567, -5.9391, {
    aliases: ["upo", "pablo de olavide", "olavide"],
    address: "Ctra. de Utrera, km 1",
  }),
  p("santa-justa", "Estación de Santa Justa", "poi", "Sevilla", 37.3922, -5.9757, {
    aliases: ["santa justa", "estacion de tren", "ave"],
    address: "Av. Kansas City",
  }),
  p("prado-san-sebastian", "Estación de autobuses Prado de San Sebastián", "poi", "Sevilla", 37.3757, -5.9892, {
    aliases: ["prado de san sebastian", "estacion de autobuses"],
  }),
  p("plaza-armas", "Estación de autobuses Plaza de Armas", "poi", "Sevilla", 37.3917, -6.0, { aliases: ["plaza de armas"] }),
  p("aeropuerto", "Aeropuerto de Sevilla", "poi", "Sevilla", 37.418, -5.8931, { aliases: ["aeropuerto san pablo"] }),
  p("isla-magica", "Isla Mágica", "poi", "Sevilla", 37.405, -6.0025, { aliases: ["isla magica"], address: "Camino de los Descubrimientos" }),
  p("torre-sevilla", "Torre Sevilla", "poi", "Sevilla", 37.4091, -6.0039, { address: "C. Gonzalo Jiménez de Quesada" }),
  p("pct-cartuja", "Parque Científico y Tecnológico Cartuja", "poi", "Sevilla", 37.404, -6.012, { aliases: ["pct cartuja", "parque tecnologico"] }),
  p("hosp-rocio", "Hospital Universitario Virgen del Rocío", "poi", "Sevilla", 37.3643, -5.976, {
    aliases: ["virgen del rocio", "hospital del rocio", "hospital rocio"],
    address: "Av. Manuel Siurot, s/n",
  }),
  p("hosp-macarena", "Hospital Universitario Virgen Macarena", "poi", "Sevilla", 37.409, -5.993, {
    aliases: ["virgen macarena", "hospital macarena"],
    address: "C. Dr. Fedriani, 3",
  }),
  p("hosp-valme", "Hospital Universitario de Valme", "poi", "Sevilla", 37.3197, -5.9628, {
    aliases: ["valme", "hospital de valme"],
    address: "Ctra. de Cádiz, km 548",
  }),
  p("benito-villamarin", "Estadio Benito Villamarín", "poi", "Sevilla", 37.3567, -5.9814, { aliases: ["villamarin", "betis"] }),
  p("sanchez-pizjuan", "Estadio Ramón Sánchez-Pizjuán", "poi", "Sevilla", 37.384, -5.9706, { aliases: ["pizjuan", "sevilla fc"] }),
  p("calonge", "Polígono Calonge", "poi", "Sevilla", 37.401, -5.978, { aliases: ["poligono calonge"] }),
  p("los-arcos", "Centro Comercial Los Arcos", "poi", "Sevilla", 37.3764, -5.979, { aliases: ["los arcos"] }),
  p("plaza-nueva", "Plaza Nueva", "poi", "Sevilla", 37.3886, -5.9953, { aliases: ["ayuntamiento"] }),
  p("parque-alamillo", "Parque del Alamillo", "poi", "Sevilla", 37.418, -5.991),
  p("cruz-campo", "Estación Cruz del Campo (metro)", "poi", "Sevilla", 37.3715, -5.9533, { aliases: ["metro cruz del campo"] }),
  p("san-bernardo", "Estación de San Bernardo", "poi", "Sevilla", 37.3787, -5.9758, { aliases: ["san bernardo"] }),
  // ---- calles y puntos de recogida frecuentes ----
  p("c-manuel-siurot", "Av. Manuel Siurot", "calle", "Sevilla", 37.3705, -5.9915),
  p("c-buhaira", "Av. de la Buhaira", "calle", "Sevilla", 37.3795, -5.9738),
  p("c-luis-montoto", "C. Luis Montoto", "calle", "Sevilla", 37.3873, -5.9769),
  p("c-kansas-city", "Av. Kansas City", "calle", "Sevilla", 37.3858, -5.9725),
  p("c-republica-argentina", "Av. de la República Argentina", "calle", "Sevilla", 37.3786, -6.0006),
  p("c-sierpes", "Calle Sierpes", "calle", "Sevilla", 37.3913, -5.9942),
  p("c-san-juan-ramon", "Av. de la Palmera", "calle", "Sevilla", 37.3624, -5.9848, { aliases: ["palmera"] }),
  p("c-doctor-fedriani", "C. Doctor Fedriani", "calle", "Sevilla", 37.4077, -5.9897),
  p("c-ronda-historica", "Ronda Histórica", "calle", "Sevilla", 37.4008, -5.9867),
  p("c-americo-vespucio", "Av. Américo Vespucio", "calle", "Sevilla", 37.4062, -6.0067),
  p("c-antonio-machado", "Av. Antonio Machado", "calle", "Dos Hermanas", 37.3269, -5.9395),
  p("c-europa-montequinto", "Av. de Europa", "calle", "Dos Hermanas", 37.3246, -5.9402),
  p("c-los-arcos-aljarafe", "Av. de las Ciencias", "calle", "Mairena del Aljarafe", 37.3498, -6.0624),
  p("c-ronda-sur-dh", "Calle Real Utrera", "calle", "Dos Hermanas", 37.2847, -5.9205),
  p("c-san-juan-ramon-jimenez", "Av. Juan Ramón Jiménez", "calle", "Bormujos", 37.3702, -6.0731),
];

const BY_ID = new Map(PLACES.map((place) => [place.id, place]));

export function placeById(id: string): Place | undefined {
  return BY_ID.get(id);
}

export function placeByName(name: string): Place | undefined {
  const needle = fold(name);
  return PLACES.find((place) => fold(place.name) === needle || (place.aliases ?? []).some((a) => fold(a) === needle));
}

/** Minúsculas sin acentos ni signos, para comparar nombres. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
