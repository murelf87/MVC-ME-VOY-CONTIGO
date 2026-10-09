/**
 * Comparador entre el contrato TypeScript que consume la app (mobile/src/api/types/comms.ts) y los schemas JSON que el
 * servidor usa para validar y serializar. No es un test: lo usa tests/comms-http.integration.test.ts.
 *
 * Por qué existe: Fastify serializa con el schema de la ruta, así que un campo que esté en el contrato y falte en el schema
 * se pierde en silencio (la app lo recibiría como `undefined`), y un campo `nullable` mal declarado cambia la forma sin avisar.
 * El comparador lee los tipos con el propio compilador de TypeScript y los cruza con los schemas reales de cada ruta.
 */
import path from "node:path";
import ts from "typescript";

export type Shape =
  | { kind: "any" }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; item: Shape }
  | { kind: "record"; value: Shape }
  | { kind: "object"; props: Map<string, { optional: boolean; shape: Shape }>; open: boolean }
  | { kind: "nullable"; inner: Shape };

export const nullable = (inner: Shape): Shape => (inner.kind === "nullable" || inner.kind === "any" ? inner : { kind: "nullable", inner });

/** `Page<T>` de mobile/src/api/types/common.ts. */
export const pageShape = (item: Shape): Shape => ({
  kind: "object",
  open: false,
  props: new Map([
    ["items", { optional: false, shape: { kind: "array", item } }],
    ["nextCursor", { optional: false, shape: nullable({ kind: "string" }) }]
  ])
});

/* ───────────────────────────── Lado TypeScript (contrato de la app) ───────────────────────────── */

export class ContractReader {
  private readonly program: ts.Program;
  private readonly checker: ts.TypeChecker;
  private readonly source: ts.SourceFile;

  constructor(readonly contractFile: string) {
    this.program = ts.createProgram([contractFile], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      types: [],
      lib: ["lib.es2022.d.ts"]
    });
    this.checker = this.program.getTypeChecker();
    const source = this.program.getSourceFile(contractFile);
    if (!source) throw new Error(`No se pudo leer el contrato ${contractFile}`);
    this.source = source;
  }

  /** Errores de compilación del propio fichero de contrato (debe compilar solo, con `strict`). */
  diagnostics(): string[] {
    return ts
      .getPreEmitDiagnostics(this.program, this.source)
      .map(d => `${path.basename(d.file?.fileName ?? "?")}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }

  exportedNames(): string[] {
    const moduleSymbol = this.checker.getSymbolAtLocation(this.source);
    return moduleSymbol ? this.checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.name) : [];
  }

  shapeOfExport(name: string): Shape {
    const moduleSymbol = this.checker.getSymbolAtLocation(this.source);
    const symbol = moduleSymbol ? this.checker.getExportsOfModule(moduleSymbol).find(item => item.name === name) : undefined;
    if (!symbol) throw new Error(`El contrato no exporta «${name}»`);
    return this.shapeOf(this.checker.getDeclaredTypeOfSymbol(symbol), 0);
  }

  private shapeOf(type: ts.Type, depth: number): Shape {
    if (depth > 16) throw new Error("Tipo demasiado profundo (¿recursivo?)");
    const flags = type.flags;
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { kind: "any" };

    if (type.isUnion()) {
      const hasNull = type.types.some(part => part.flags & ts.TypeFlags.Null);
      const rest = type.types.filter(part => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
      let inner: Shape;
      if (rest.length === 0) inner = { kind: "any" };
      else if (rest.every(part => part.flags & ts.TypeFlags.BooleanLiteral)) inner = { kind: "boolean" };
      else if (rest.every(part => part.isStringLiteral())) inner = { kind: "enum", values: rest.map(part => (part as ts.StringLiteralType).value).sort() };
      else if (rest.some(part => this.isStringLike(part))) inner = { kind: "string" };
      else if (rest.length === 1) inner = this.shapeOf(rest[0] as ts.Type, depth + 1);
      else throw new Error(`Unión no soportada por el comparador: ${this.checker.typeToString(type)}`);
      return hasNull ? nullable(inner) : inner;
    }

    if (flags & ts.TypeFlags.StringLiteral) return { kind: "enum", values: [(type as ts.StringLiteralType).value] };
    if (flags & ts.TypeFlags.StringLike) return { kind: "string" };
    if (flags & ts.TypeFlags.NumberLike) return { kind: "number" };
    if (flags & ts.TypeFlags.BooleanLike) return { kind: "boolean" };
    if (flags & ts.TypeFlags.Null) return { kind: "any" };
    if (type.isIntersection() && type.types.some(part => this.isStringLike(part))) return { kind: "string" };

    if (this.checker.isArrayType(type)) {
      const [item] = this.checker.getTypeArguments(type as ts.TypeReference);
      return { kind: "array", item: item ? this.shapeOf(item, depth + 1) : { kind: "any" } };
    }

    if (flags & ts.TypeFlags.Object || type.isIntersection()) {
      const properties = this.checker.getPropertiesOfType(type);
      const indexInfo = this.checker.getIndexInfoOfType(type, ts.IndexKind.String);
      if (properties.length === 0 && indexInfo) return { kind: "record", value: this.shapeOf(indexInfo.type, depth + 1) };
      const props = new Map<string, { optional: boolean; shape: Shape }>();
      for (const property of properties) {
        props.set(property.name, {
          optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
          shape: this.shapeOf(this.checker.getTypeOfSymbol(property), depth + 1)
        });
      }
      return { kind: "object", props, open: indexInfo !== undefined };
    }
    throw new Error(`Tipo no soportado por el comparador: ${this.checker.typeToString(type)}`);
  }

  private isStringLike(type: ts.Type): boolean {
    return (type.flags & ts.TypeFlags.String) !== 0 || (type.isIntersection() && type.types.some(part => (part.flags & ts.TypeFlags.String) !== 0));
  }
}

/* ───────────────────────────── Lado servidor (schema JSON de la ruta) ───────────────────────────── */

type JsonSchema = {
  type?: string | string[];
  nullable?: boolean;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
};

export function shapeOfSchema(input: unknown): Shape {
  const schema = (input ?? {}) as JsonSchema;
  if (Object.keys(schema).length === 0) return { kind: "any" };
  let isNullable = schema.nullable === true;
  let type = schema.type;
  if (Array.isArray(type)) {
    if (type.includes("null")) isNullable = true;
    type = type.find(item => item !== "null");
  }
  let inner: Shape;
  if (Array.isArray(schema.enum)) {
    if (schema.enum.includes(null)) isNullable = true;
    const values = schema.enum.filter(value => value !== null);
    inner = values.every(value => typeof value === "boolean") ? { kind: "boolean" } : { kind: "enum", values: values.map(String).sort() };
  } else if (type === "string") inner = { kind: "string" };
  else if (type === "integer" || type === "number") inner = { kind: "number" };
  else if (type === "boolean") inner = { kind: "boolean" };
  else if (type === "array") inner = { kind: "array", item: shapeOfSchema(schema.items) };
  else if (type === "object") {
    if (schema.properties) {
      const required = new Set(schema.required ?? []);
      const props = new Map<string, { optional: boolean; shape: Shape }>();
      for (const [name, child] of Object.entries(schema.properties)) props.set(name, { optional: !required.has(name), shape: shapeOfSchema(child) });
      inner = { kind: "object", props, open: schema.additionalProperties !== false };
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      inner = { kind: "record", value: shapeOfSchema(schema.additionalProperties) };
    } else {
      inner = { kind: "object", props: new Map(), open: true };
    }
  } else if (type === "null") inner = { kind: "any" };
  else inner = { kind: "any" };
  return isNullable ? nullable(inner) : inner;
}

/* ───────────────────────────── Comparación ───────────────────────────── */

export type CompareMode = "response" | "request";

const describe = (shape: Shape): string => {
  switch (shape.kind) {
    case "enum":
      return `enum(${shape.values.join("|")})`;
    case "array":
      return `array<${describe(shape.item)}>`;
    case "nullable":
      return `${describe(shape.inner)}|null`;
    case "record":
      return `record<${describe(shape.value)}>`;
    case "object":
      return `objeto{${[...shape.props.keys()].join(",")}}`;
    default:
      return shape.kind;
  }
};

/**
 * Compara el contrato (`contract`) con lo que el servidor declara (`wire`). Acumula las diferencias en `out`.
 * En peticiones, un schema más permisivo que el contrato en texto libre (p. ej. `confirmation`, que el servicio valida con su
 * propio error) es aceptable; en respuestas la igualdad es estricta.
 */
export function compareShapes(contract: Shape, wire: Shape, where: string, mode: CompareMode, out: string[]): void {
  if (contract.kind === "any") return;

  if (contract.kind === "nullable" || wire.kind === "nullable") {
    if (contract.kind !== wire.kind) {
      out.push(`${where}: nulabilidad distinta (contrato ${describe(contract)} · schema ${describe(wire)})`);
    }
    compareShapes(contract.kind === "nullable" ? contract.inner : contract, wire.kind === "nullable" ? wire.inner : wire, where, mode, out);
    return;
  }

  if (wire.kind === "any") {
    out.push(`${where}: el schema no declara el tipo (contrato ${describe(contract)})`);
    return;
  }

  if (contract.kind === "enum") {
    if (wire.kind === "string" && mode === "request") return;
    if (wire.kind !== "enum") {
      out.push(`${where}: el contrato es ${describe(contract)} y el schema ${describe(wire)}`);
      return;
    }
    const missing = contract.values.filter(value => !wire.values.includes(value));
    const extra = wire.values.filter(value => !contract.values.includes(value));
    if (missing.length > 0 || extra.length > 0) {
      out.push(`${where}: valores distintos (faltan en el schema: [${missing.join(", ")}] · sobran: [${extra.join(", ")}])`);
    }
    return;
  }

  if (contract.kind === "array") {
    if (wire.kind !== "array") out.push(`${where}: el contrato es array y el schema ${describe(wire)}`);
    else compareShapes(contract.item, wire.item, `${where}[]`, mode, out);
    return;
  }

  if (contract.kind === "record") {
    if (wire.kind !== "record") out.push(`${where}: el contrato es record y el schema ${describe(wire)}`);
    else compareShapes(contract.value, wire.value, `${where}{}`, mode, out);
    return;
  }

  if (contract.kind === "object") {
    if (wire.kind !== "object") {
      out.push(`${where}: el contrato es objeto y el schema ${describe(wire)}`);
      return;
    }
    if (!contract.open) {
      for (const name of contract.props.keys()) {
        if (!wire.props.has(name)) out.push(`${where}.${name}: está en el contrato y falta en el schema (se perdería al serializar)`);
      }
      for (const name of wire.props.keys()) {
        if (!contract.props.has(name)) out.push(`${where}.${name}: está en el schema y no en el contrato`);
      }
    }
    for (const [name, expected] of contract.props) {
      const actual = wire.props.get(name);
      if (!actual) continue;
      if (expected.optional !== actual.optional) {
        out.push(`${where}.${name}: ${expected.optional ? "opcional en el contrato y obligatorio en el schema" : "obligatorio en el contrato y opcional en el schema"}`);
      }
      compareShapes(expected.shape, actual.shape, `${where}.${name}`, mode, out);
    }
    return;
  }

  if (contract.kind !== wire.kind) out.push(`${where}: el contrato es ${describe(contract)} y el schema ${describe(wire)}`);
}

/* ───────────────────────────── Endpoints del módulo y su tipo del contrato ───────────────────────────── */

/** Un tipo del contrato, o una página (`Page<T>`) de uno. `null` = sin cuerpo (204). */
export type TypeRef = string | { page: string } | null;

export type ContractEntry = {
  route: string;
  /** Tipo TypeScript del cuerpo de la petición (si la ruta lo tiene). */
  request?: string;
  /** Estado → tipo de la respuesta. Debe coincidir con los 2xx que declara la ruta. */
  responses: Record<number, TypeRef>;
};

/** Los 39 endpoints del módulo y los tipos de mobile/src/api/types/comms.ts que les corresponden. */
export const COMMS_CONTRACT: ContractEntry[] = [
  // Notificaciones y dispositivos push
  { route: "GET /v1/notifications", responses: { 200: "NotificationPage" } },
  { route: "GET /v1/notifications/unread-count", responses: { 200: "NotificationUnreadCount" } },
  { route: "POST /v1/notifications/read-all", request: "NotificationReadAllRequest", responses: { 200: "NotificationReadAllResponse" } },
  { route: "POST /v1/notifications/:notificationId/read", responses: { 200: "AppNotification" } },
  { route: "GET /v1/me/notification-preferences", responses: { 200: "NotificationPreferences" } },
  { route: "PATCH /v1/me/notification-preferences", request: "NotificationPreferencesPatch", responses: { 200: "NotificationPreferences" } },
  { route: "GET /v1/me/push-tokens", responses: { 200: { page: "PushTokenInfo" } } },
  { route: "POST /v1/me/push-tokens", request: "PushTokenRegistration", responses: { 200: "PushTokenInfo", 201: "PushTokenInfo" } },
  { route: "DELETE /v1/me/push-tokens/:tokenId", responses: { 204: null } },
  // Mensajes
  { route: "GET /v1/conversations", responses: { 200: "ConversationPage" } },
  { route: "GET /v1/conversations/unread-count", responses: { 200: "ConversationUnreadCount" } },
  { route: "POST /v1/conversations/direct", request: "OpenDirectConversationRequest", responses: { 200: "ConversationDetail", 201: "ConversationDetail" } },
  { route: "GET /v1/conversations/:conversationId", responses: { 200: "ConversationDetail" } },
  { route: "GET /v1/conversations/:conversationId/messages", responses: { 200: "ChatMessagePage" } },
  { route: "POST /v1/conversations/:conversationId/messages", request: "SendChatMessageRequest", responses: { 200: "ChatMessage", 201: "ChatMessage" } },
  { route: "POST /v1/conversations/:conversationId/read", request: "MarkConversationReadRequest", responses: { 200: "MarkConversationReadResponse" } },
  { route: "GET /v1/conversations/:conversationId/call-contact", responses: { 200: "PeerCallContact" } },
  { route: "POST /v1/conversations/:conversationId/messages/:messageId/report", request: "ReportMessageRequest", responses: { 200: "UserReport", 201: "UserReport" } },
  // Bloqueos y denuncias
  { route: "GET /v1/me/blocks", responses: { 200: { page: "BlockedUser" } } },
  { route: "POST /v1/me/reports", request: "CreateUserReportRequest", responses: { 200: "UserReport", 201: "UserReport" } },
  { route: "GET /v1/me/reports", responses: { 200: { page: "UserReport" } } },
  // Centro de ayuda
  { route: "GET /v1/me/support/trips", responses: { 200: { page: "SupportTripOption" } } },
  { route: "POST /v1/me/support/uploads/intents", request: "SupportUploadIntentRequest", responses: { 201: "SupportUploadIntent" } },
  { route: "POST /v1/me/support/uploads/:intentId/complete", responses: { 200: "SupportAttachment", 201: "SupportAttachment" } },
  { route: "GET /v1/me/support/attachments/:attachmentId/download", responses: { 200: "SupportAttachmentDownload" } },
  { route: "POST /v1/me/support/tickets", request: "CreateSupportTicketRequest", responses: { 200: "SupportTicketDetail", 201: "SupportTicketDetail" } },
  { route: "GET /v1/me/support/tickets", responses: { 200: { page: "SupportTicketSummary" } } },
  { route: "GET /v1/me/support/tickets/:ticketId", responses: { 200: "SupportTicketDetail" } },
  { route: "POST /v1/me/support/tickets/:ticketId/replies", request: "SupportReplyRequest", responses: { 201: "SupportTicketDetail" } },
  { route: "POST /v1/me/support/tickets/:ticketId/close", responses: { 200: "SupportTicketDetail" } },
  // Ajustes
  { route: "GET /v1/me/settings", responses: { 200: "UserSettings" } },
  { route: "PATCH /v1/me/settings", request: "UserSettingsPatch", responses: { 200: "UserSettings" } },
  // Derechos sobre los datos
  { route: "POST /v1/me/data-exports", responses: { 200: "DataExportRequest", 202: "DataExportRequest" } },
  { route: "GET /v1/me/data-exports", responses: { 200: { page: "DataExportRequest" } } },
  { route: "GET /v1/me/data-exports/:exportId", responses: { 200: "DataExportRequest" } },
  { route: "GET /v1/me/data-exports/:exportId/download", responses: { 200: "DataExportDownload" } },
  { route: "GET /v1/me/account-deletion", responses: { 200: "AccountDeletionState" } },
  { route: "POST /v1/me/account-deletion", request: "RequestAccountDeletionRequest", responses: { 200: "AccountDeletionState", 201: "AccountDeletionState" } },
  { route: "POST /v1/me/account-deletion/cancel", responses: { 200: "AccountDeletionState" } }
];
