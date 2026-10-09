/**
 * Etiqueta de rol de la otra persona de un chat («Ana (Conductora)», «Miguel (Pasajero)»).
 *
 * El contrato (`PublicUser`) no trae género y la lámina 26 escribe «Conductora». Para no decir «Conductora» de un hombre ni
 * «Pasajero» de una mujer, el género gramatical se deduce SOLO del nombre de pila con reglas prudentes: una lista corta de
 * nombres femeninos que no acaban en «a», nombres masculinos que sí acaban en «a», y la terminación. Si el nombre no da
 * una pista clara (acaba en «e», «i», «u»…), se usa la forma neutra «Conductor/a» y «Pasajero/a». Nunca se guarda ni se
 * envía al servidor: es solo una palabra de la pantalla.
 */
import type { ConversationRole } from "@/api/types";

export type GrammaticalGender = "feminine" | "masculine" | "unknown";

const FEMININE_NOT_ENDING_IN_A = new Set([
  "carmen",
  "ines",
  "beatriz",
  "pilar",
  "mercedes",
  "isabel",
  "raquel",
  "esther",
  "dolores",
  "rocio",
  "soledad",
  "lourdes",
  "noemi",
  "ruth",
  "montserrat",
  "maribel",
  "mar",
  "sol",
  "luz",
  "paz",
  "nieves",
  "angeles",
  "belen",
  "consuelo",
  "amparo",
  "socorro",
  "irene",
  "elisabet",
  "judith",
  "miriam",
]);

const MASCULINE_ENDING_IN_A = new Set(["borja", "luca", "luka", "joshua", "nikita", "jona", "bautista"]);

/** Minúsculas y sin acentos, para comparar nombres. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Género gramatical que sugiere un nombre de pila («Ana» → feminine, «Carlos» → masculine, «Irene» → feminine, «Jose» → unknown). */
export function guessGender(firstName: string): GrammaticalGender {
  const name = fold(firstName.trim().split(/\s+/)[0] ?? "");
  if (name === "") return "unknown";
  if (FEMININE_NOT_ENDING_IN_A.has(name)) return "feminine";
  if (MASCULINE_ENDING_IN_A.has(name)) return "masculine";
  const last = name.charAt(name.length - 1);
  if (last === "a") return "feminine";
  if (last === "o") return "masculine";
  if ("dlnrszxjkmtbcgpfhvwy".includes(last)) return "masculine";
  return "unknown";
}

export interface RoleWords {
  driver: string;
  passenger: string;
}

const WORDS: Record<GrammaticalGender, RoleWords> = {
  feminine: { driver: "Conductora", passenger: "Pasajera" },
  masculine: { driver: "Conductor", passenger: "Pasajero" },
  unknown: { driver: "Conductor/a", passenger: "Pasajero/a" },
};

/** Palabra de rol para esa persona: `roleWord("driver", "Ana")` → «Conductora». */
export function roleWord(role: ConversationRole, firstName: string): string {
  return WORDS[guessGender(firstName)][role];
}

/** «Ana (Conductora)». */
export function nameWithRole(firstName: string, role: ConversationRole): string {
  return `${firstName} (${roleWord(role, firstName)})`;
}

/** Rol de la OTRA persona del chat a partir del mío: si yo soy pasajero, la otra persona conduce. */
export function peerRoleOf(myRole: ConversationRole): ConversationRole {
  return myRole === "driver" ? "passenger" : "driver";
}

/** Primer nombre de un nombre completo («Ana García López» → «Ana»). En el chat solo se ven nombres de pila. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
