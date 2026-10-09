/** Une la capa de red (`describeError`) con la traducción de errores del conductor (lógica pura en `../logic/errors`). */
import { describeError } from "@/api";
import { opsErrorView, type OpsErrorView } from "../logic/errors";

export function describeOps(error: unknown): OpsErrorView {
  return opsErrorView(error, describeError(error));
}
