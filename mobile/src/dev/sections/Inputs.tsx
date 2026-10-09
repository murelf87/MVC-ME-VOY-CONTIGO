import React, { useState } from "react";
import { View } from "react-native";
import type { TripCategory, Weekday } from "@/api/types/common";
import {
  Button,
  Checkbox,
  CategoryChips,
  DayPills,
  OtpInput,
  PhoneField,
  PickupCode,
  RadioRow,
  Segmented,
  SelectField,
  Switch,
  Text,
  TextArea,
  TextField,
  type ButtonVariant,
} from "@/ui";
import { Demo, Group, Spacer, Wrap } from "../GalleryParts";

const buttonVariants: readonly ButtonVariant[] = [
  "primary",
  "outline",
  "success",
  "danger",
  "dangerOutline",
  "tint",
  "successSoft",
  "dangerSoft",
  "ghost",
  "link",
];

export function ButtonsSection(): React.JSX.Element {
  const [pressed, setPressed] = useState(0);
  return (
    <View>
      <Text variant="body" color="muted" style={{ marginTop: 8 }}>{`Pulsaciones registradas: ${pressed}`}</Text>
      <Group title="Variantes (tamaño md, 54 pt)">
        {buttonVariants.map((variant) => (
          <Demo key={variant} title={variant}>
            <Button label={variant === "link" ? "Explorar sin registrarme" : "Crear cuenta"} variant={variant} onPress={() => setPressed((n) => n + 1)} testID={`Gallery.button.${variant}`} />
          </Demo>
        ))}
      </Group>
      <Group title="Tamaños">
        <Demo title="sm · 44 pt">
          <Button label="Ver viaje" size="sm" onPress={() => setPressed((n) => n + 1)} />
        </Demo>
        <Demo title="xs · 34 pt">
          <Wrap>
            <Button label="Ver todos" size="xs" inline variant="tint" onPress={() => setPressed((n) => n + 1)} />
            <Button label="Editar" size="xs" inline variant="outline" onPress={() => setPressed((n) => n + 1)} />
          </Wrap>
        </Demo>
        <Demo title="rounded (bienvenida 01)">
          <Button label="Entrar" variant="outline" rounded onPress={() => setPressed((n) => n + 1)} />
        </Demo>
      </Group>
      <Group title="Con icono">
        <Demo title="leadingIcon">
          <Button label="Solicitar plaza" leadingIcon="passenger" onPress={() => setPressed((n) => n + 1)} />
          <Spacer height={10} />
          <Button label="Contactar con Ana" leadingIcon="phone" variant="outline" onPress={() => setPressed((n) => n + 1)} />
          <Spacer height={10} />
          <Button label="Repetir captura" leadingIcon="camera" onPress={() => setPressed((n) => n + 1)} />
        </Demo>
        <Demo title="inline sin chevron" note="Llamar a Ana (26)">
          <Button label="Llamar a Ana" leadingIcon="phone" variant="outline" size="sm" inline chevron={false} onPress={() => setPressed((n) => n + 1)} />
        </Demo>
      </Group>
      <Group title="Estados">
        <Demo title="disabled">
          <Button label="Recibir código" disabled />
        </Demo>
        <Demo title="loading">
          <Button label="Recibir código" loading />
          <Spacer height={10} />
          <Button label="Pagar" variant="outline" loading />
        </Demo>
      </Group>
    </View>
  );
}

export function FieldsSection(): React.JSX.Element {
  const [name, setName] = useState("Miguel");
  const [email, setEmail] = useState("miguel@");
  const [phone, setPhone] = useState("612 345 678");
  const [search, setSearch] = useState("Universidad de Sevilla");
  const [empty, setEmpty] = useState("");
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState("482");
  const [otpError, setOtpError] = useState("481935");
  return (
    <View>
      <Group title="TextField · labeled (68 pt, 03)">
        <Demo title="relleno">
          <TextField label="Nombre" value={name} onChangeText={setName} testID="Gallery.field.name" />
        </Demo>
        <Demo title="vacío con placeholder">
          <TextField label="Correo electrónico (opcional)" value={empty} onChangeText={setEmpty} placeholder="tu@correo.es" keyboardType="email-address" autoCapitalize="none" />
        </Demo>
        <Demo title="error">
          <TextField label="Correo electrónico" value={email} onChangeText={setEmail} error="Escribe un correo válido." keyboardType="email-address" autoCapitalize="none" />
        </Demo>
        <Demo title="ayuda">
          <TextField label="Nombre" value={name} onChangeText={setName} helper="Así te verán los demás usuarios." />
        </Demo>
        <Demo title="desactivado">
          <TextField label="Municipio" value="Sevilla" onChangeText={() => undefined} disabled />
        </Demo>
      </Group>
      <Group title="PhoneField">
        <Demo title="+34 · formato 6xx xxx xxx">
          <PhoneField value={phone} onChangeText={setPhone} />
        </Demo>
      </Group>
      <Group title="TextField · compact (44 pt, 09/10)">
        <Demo title="búsqueda con aspa de borrar">
          <TextField variant="compact" leadingIcon="search" value={search} onChangeText={setSearch} placeholder="¿A dónde vas?" clearable />
        </Demo>
        <Demo title="vacío">
          <TextField variant="compact" leadingIcon="search" value={empty} onChangeText={setEmpty} placeholder="¿A dónde vas?" />
        </Demo>
      </Group>
      <Group title="SelectField">
        <Demo title="con valor">
          <SelectField label="Marca" valueLabel="SEAT" onPress={() => undefined} />
        </Demo>
        <Demo title="sin valor">
          <SelectField label="Modelo" placeholder="Elige el modelo" onPress={() => undefined} />
        </Demo>
        <Demo title="compact con icono">
          <SelectField variant="compact" leadingIcon="pin" valueLabel="Sevilla" onPress={() => undefined} />
        </Demo>
      </Group>
      <Group title="TextArea (35)">
        <Demo title="con contador">
          <TextArea value={note} onChangeText={setNote} placeholder="Cuéntanos qué ha pasado…" maxLength={500} />
        </Demo>
      </Group>
      <Group title="OtpInput (04)">
        <Demo title="6 dígitos, a medias">
          <OtpInput value={otp} onChange={setOtp} />
        </Demo>
        <Demo title="error">
          <OtpInput value={otpError} onChange={setOtpError} error />
        </Demo>
        <Demo title="PickupCode (23)">
          <PickupCode code="4821" />
        </Demo>
      </Group>
    </View>
  );
}

const reasons = ["Ya no lo necesito", "Cambio en mi horario", "He encontrado otra opción", "Otro motivo"] as const;

export function ControlsSection(): React.JSX.Element {
  const [terms, setTerms] = useState(true);
  const [privacy, setPrivacy] = useState(false);
  const [reason, setReason] = useState<(typeof reasons)[number]>("Ya no lo necesito");
  const [essential, setEssential] = useState(true);
  const [optional, setOptional] = useState(true);
  const [blue, setBlue] = useState(true);
  const [seg, setSeg] = useState<"pasajero" | "conductor">("conductor");
  const [view, setView] = useState<"mapa" | "lista">("mapa");
  const [mode, setMode] = useState<"busco" | "ofrezco">("busco");
  const [filter, setFilter] = useState<"todas" | "viajes" | "mensajes" | "pagos">("todas");
  const [days, setDays] = useState<Weekday[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [category, setCategory] = useState<TripCategory | null>("work");
  return (
    <View>
      <Group title="Checkbox">
        <Demo title="marcada, con texto enriquecido (03)">
          <Checkbox checked={terms} onChange={setTerms}>
            <Text variant="body" color="body">
              {"Acepto los "}
              <Text variant="body" color="link" underline>
                Términos
              </Text>
              {" y la "}
              <Text variant="body" color="link" underline>
                Política de privacidad
              </Text>
              .
            </Text>
          </Checkbox>
        </Demo>
        <Demo title="sin marcar con error (07)">
          <Checkbox checked={privacy} onChange={setPrivacy} error label="He leído y acepto el uso de mi foto según esta información." />
        </Demo>
        <Demo title="desactivada">
          <Checkbox checked onChange={() => undefined} disabled label="Opción no disponible" />
        </Demo>
      </Group>
      <Group title="RadioRow (28)">
        <Demo title="motivo de la cancelación">
          {reasons.map((item, index) => (
            <RadioRow key={item} label={item} selected={reason === item} onSelect={() => setReason(item)} style={index > 0 ? { marginTop: 6 } : undefined} />
          ))}
        </Demo>
      </Group>
      <Group title="Switch">
        <Demo title="verde (18/34/40) y azul (27)">
          <Wrap gap={24}>
            <Switch value={essential} onValueChange={setEssential} accessibilityLabel="Avisos esenciales del viaje" />
            <Switch value={optional} onValueChange={setOptional} accessibilityLabel="Avisos opcionales de llegada" />
            <Switch value={blue} onValueChange={setBlue} tone="blue" accessibilityLabel="Avisos de llegada" />
            <Switch value={false} onValueChange={() => undefined} accessibilityLabel="Desactivado" disabled />
          </Wrap>
        </Demo>
      </Group>
      <Group title="Segmented">
        <Demo title="segmented (33 «Soy pasajero / Soy conductor»)">
          <Segmented
            variant="segmented"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "pasajero", label: "Soy pasajero" },
              { value: "conductor", label: "Soy conductor" },
            ]}
          />
        </Demo>
        <Demo title="buttons con icono (11 «Mapa / Lista»)">
          <Segmented
            variant="buttons"
            value={view}
            onChange={setView}
            options={[
              { value: "mapa", label: "Mapa", icon: "map" },
              { value: "lista", label: "Lista", icon: "list" },
            ]}
          />
        </Demo>
        <Demo title="outline con icono (09 «Busco coche / Ofrezco plazas»)">
          <Segmented
            variant="outline"
            value={mode}
            onChange={setMode}
            options={[
              { value: "busco", label: "Busco coche", icon: "car" },
              { value: "ofrezco", label: "Ofrezco plazas", icon: "person" },
            ]}
          />
        </Demo>
        <Demo title="pills (27 «Todas / Viajes / Mensajes / Pagos»)">
          <Segmented
            variant="pills"
            scrollable
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todas", label: "Todas" },
              { value: "viajes", label: "Viajes", icon: "car" },
              { value: "mensajes", label: "Mensajes", icon: "chatEllipses" },
              { value: "pagos", label: "Pagos", icon: "coins" },
            ]}
          />
        </Demo>
      </Group>
      <Group title="DayPills">
        <Demo title="selector circular (10)">
          <DayPills value={days} onChange={setDays} />
        </Demo>
        <Demo title="cuadradas, solo lectura (14)">
          <DayPills value={days} shape="square" />
        </Demo>
      </Group>
      <Group title="CategoryChips">
        <Demo title="fila (09)">
          <CategoryChips value={category} onChange={setCategory} />
        </Demo>
        <Demo title="baldosas (18)">
          <CategoryChips layout="tiles" value={category} onChange={setCategory} />
        </Demo>
      </Group>
    </View>
  );
}
