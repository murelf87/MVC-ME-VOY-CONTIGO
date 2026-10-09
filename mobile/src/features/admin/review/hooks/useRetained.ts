/**
 * Conserva el último valor no nulo: una hoja o un diálogo que se cierra (valor → `null`) sigue pintando los textos de la
 * persona durante su animación de salida en vez de quedarse en blanco.
 */
import { useRef } from "react";

export function useRetained<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value);
  if (value !== null) ref.current = value;
  return ref.current;
}
