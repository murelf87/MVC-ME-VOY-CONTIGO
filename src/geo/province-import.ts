import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";

type JsonObject = Record<string, unknown>;

type GeoJsonGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

type GeoJsonFeature = {
  type: "Feature";
  properties: JsonObject | null;
  geometry: GeoJsonGeometry | null;
};

export type ProvinceFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

export type ProvinceDatasetMetadata = {
  sourceName: string;
  sourceUrl: string;
  sourceDate: string;
  sourceLicense: string;
  sourceVersion?: string;
  fileSha256: string;
  codeField: string;
  nameField: string;
};

export type ProvinceImportResult = {
  importId: string;
  featureCount: number;
  provinceCodes: string[];
};

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("PROVINCE_DATA_INVALID", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateSha256(value: string): string {
  const hash = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new DomainError("PROVINCE_DATA_INVALID_SHA256", "Dataset SHA-256 must contain 64 hexadecimal characters");
  }
  return hash;
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError("PROVINCE_DATA_INVALID_DATE", "sourceDate must use YYYY-MM-DD");
  }
  return value;
}

function validateSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError("PROVINCE_DATA_INVALID_URL", "sourceUrl must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new DomainError("PROVINCE_DATA_INVALID_URL", "sourceUrl must use HTTPS");
  }
  return url.toString();
}

function normalizeCode(value: unknown): string {
  const raw = requiredString(String(value ?? ""), "province code");
  const digits = raw.match(/(?:^|\D)(\d{2})(?:\D|$)/)?.[1] ?? (raw.length === 2 && /^\d{2}$/.test(raw) ? raw : null);
  if (!digits) {
    throw new DomainError("PROVINCE_DATA_INVALID_CODE", `Cannot derive a two-digit province code from "${raw}"`);
  }
  return digits;
}

function validateFeatureCollection(input: unknown): ProvinceFeatureCollection {
  if (!input || typeof input !== "object") {
    throw new DomainError("PROVINCE_DATA_INVALID", "Province dataset must be a GeoJSON FeatureCollection");
  }
  const data = input as Partial<ProvinceFeatureCollection>;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length < 1) {
    throw new DomainError("PROVINCE_DATA_INVALID", "Province dataset must contain at least one GeoJSON feature");
  }
  return data as ProvinceFeatureCollection;
}

async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function importProvinceFeatureCollection(
  pool: Pool,
  input: unknown,
  metadata: ProvinceDatasetMetadata
): Promise<ProvinceImportResult> {
  const collection = validateFeatureCollection(input);
  const sourceName = requiredString(metadata.sourceName, "sourceName");
  const sourceUrl = validateSourceUrl(metadata.sourceUrl);
  const sourceDate = validateDate(metadata.sourceDate);
  const sourceLicense = requiredString(metadata.sourceLicense, "sourceLicense");
  const sourceVersion = metadata.sourceVersion?.trim() || null;
  const fileSha256 = validateSha256(metadata.fileSha256);
  const codeField = requiredString(metadata.codeField, "codeField");
  const nameField = requiredString(metadata.nameField, "nameField");

  const prepared = collection.features.map((feature, index) => {
    if (!feature || feature.type !== "Feature" || !feature.properties || !feature.geometry) {
      throw new DomainError("PROVINCE_DATA_INVALID_FEATURE", `Feature ${index} is incomplete`);
    }
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
      throw new DomainError("PROVINCE_DATA_INVALID_GEOMETRY", `Feature ${index} must be Polygon or MultiPolygon`);
    }

    const code = normalizeCode(feature.properties[codeField]);
    const name = requiredString(feature.properties[nameField], `Feature ${index} province name`);
    return { code, name, geometry: feature.geometry };
  });

  const seen = new Set<string>();
  for (const feature of prepared) {
    if (seen.has(feature.code)) {
      throw new DomainError("PROVINCE_DATA_DUPLICATE_CODE", `Duplicate province code ${feature.code}`);
    }
    seen.add(feature.code);
  }

  return withTx(pool, async client => {
    const existing = await client.query<{ id: string; status: string }>(
      `select id,status from province_dataset_imports where file_sha256=$1 for update`,
      [fileSha256]
    );
    if (existing.rowCount) {
      throw new DomainError("PROVINCE_DATA_ALREADY_IMPORTED", "This exact province dataset has already been imported", 409, {
        importId: existing.rows[0]?.id,
        status: existing.rows[0]?.status
      });
    }

    const importRow = await client.query<{ id: string }>(
      `insert into province_dataset_imports(
         source_name,source_url,source_date,source_license,source_version,
         file_sha256,feature_count,status
       ) values($1,$2,$3,$4,$5,$6,$7,'loading')
       returning id`,
      [sourceName, sourceUrl, sourceDate, sourceLicense, sourceVersion, fileSha256, prepared.length]
    );
    const importId = importRow.rows[0]?.id;
    if (!importId) throw new Error("province dataset import insert returned no row");

    for (const feature of prepared) {
      const geometryJson = JSON.stringify(feature.geometry);
      const geometryCheck = await client.query<{ valid: boolean; empty: boolean; geom: string }>(
        `with g as (
           select ST_Multi(
             ST_CollectionExtract(
               ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)),
               3
             )
           )::geometry(MultiPolygon,4326) as geom
         )
         select ST_IsValid(geom) as valid, ST_IsEmpty(geom) as empty, ST_AsEWKT(geom) as geom
           from g`,
        [geometryJson]
      );
      const checked = geometryCheck.rows[0];
      if (!checked || !checked.valid || checked.empty) {
        throw new DomainError("PROVINCE_DATA_INVALID_GEOMETRY", `Province ${feature.code} has unusable geometry`);
      }

      await client.query(
        `insert into provinces(
           code,name,source_name,source_url,source_date,source_license,geom,dataset_import_id
         ) values(
           $1,$2,$3,$4,$5,$6,ST_GeomFromEWKT($7)::geometry(MultiPolygon,4326),$8
         )
         on conflict(code) do update set
           name=excluded.name,
           source_name=excluded.source_name,
           source_url=excluded.source_url,
           source_date=excluded.source_date,
           source_license=excluded.source_license,
           geom=excluded.geom,
           dataset_import_id=excluded.dataset_import_id`,
        [feature.code, feature.name, sourceName, sourceUrl, sourceDate, sourceLicense, checked.geom, importId]
      );
    }

    await client.query(
      `update province_dataset_imports
          set status='superseded'
        where status='active' and id<>$1`,
      [importId]
    );
    await client.query(
      `update province_dataset_imports
          set status='active',activated_at=now()
        where id=$1`,
      [importId]
    );
    await client.query(
      `insert into audit_events(action,entity_type,entity_id,metadata)
       values('province.dataset.activated','province_dataset_import',$1,$2::jsonb)`,
      [importId, JSON.stringify({
        sourceName,
        sourceUrl,
        sourceDate,
        sourceLicense,
        sourceVersion,
        fileSha256,
        featureCount: prepared.length
      })]
    );

    return {
      importId,
      featureCount: prepared.length,
      provinceCodes: prepared.map(feature => feature.code).sort()
    };
  });
}
