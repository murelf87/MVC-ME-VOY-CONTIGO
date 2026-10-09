export * from "./format";
export { es } from "./es";
export type { EsStrings } from "./es";

import { es } from "./es";

/** Catálogo activo. La V1 es solo es-ES; el objeto existe para poder añadir otros idiomas sin tocar a los consumidores. */
export const strings = es;
