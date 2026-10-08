import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../theme";

const SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** ISO weekdays (1 = lunes) to a short Spanish label: "L–V", "L, X, V", "sábados". */
export function weekdaysLabel(days: number[] | null | undefined): string {
  const d = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (!d.length) return "";
  if (d.length === 1) return `los ${LONG[d[0]! - 1]}`;
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1]! + 1);
  if (contiguous && d.length >= 3) return `${SHORT[d[0]! - 1]}–${SHORT[d[d.length - 1]! - 1]}`;
  return d.map(v => SHORT[v - 1]).join(", ");
}

/** Monday (YYYY-MM-DD, local calendar) of the week containing the given instant. */
export function mondayOf(iso: string): string {
  const date = new Date(iso);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function RepeatPanel({
  initial,
  onConfirm,
  onClose,
}: {
  initial: number;
  onConfirm: (weekdays: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number[]>(initial >= 1 && initial <= 5 ? [1, 2, 3, 4, 5] : [initial]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (d: number) => setDays(c => (c.includes(d) ? c.filter(x => x !== d) : [...c, d]));

  async function submit() {
    if (!days.length) return setError("Elige al menos un día.");
    setBusy(true);
    setError("");
    try {
      await onConfirm(days);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo repetir el viaje.");
      setBusy(false);
    }
  }

  return (
    <View style={s.panel}>
      <View style={s.head}>
        <Text style={s.title}>Repetir cada semana</Text>
        <Pressable onPress={onClose} accessibilityLabel="Cerrar" hitSlop={8}>
          <Ionicons name="close" size={20} color={C.muted} />
        </Pressable>
      </View>
      <View style={s.days}>
        {SHORT.map((label, i) => {
          const on = days.includes(i + 1);
          return (
            <Pressable key={label} onPress={() => toggle(i + 1)} style={[s.day, on && s.dayOn]} accessibilityLabel={LONG[i]} accessibilityState={{ selected: on }}>
              <Text style={[s.dayText, on && s.dayTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.hint}>Misma hora, ruta, coche y plazas. Publicamos las próximas 4 semanas y vamos añadiendo más; cada día tiene sus propias plazas.</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={[s.primary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.primaryText}>Publicar {weekdaysLabel(days) || "días"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, backgroundColor: C.bg, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 14, fontWeight: "900", color: C.navy },
  days: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  day: { flex: 1, aspectRatio: 1, maxWidth: 40, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: C.blue, borderColor: C.blue },
  dayText: { fontSize: 13, fontWeight: "900", color: C.navy },
  dayTextOn: { color: "#fff" },
  hint: { fontSize: 11, lineHeight: 16, color: C.muted },
  error: { color: "#9E302D", backgroundColor: "#FFF0EF", padding: 9, borderRadius: 10, fontSize: 12 },
  primary: { height: 44, borderRadius: 12, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
});
