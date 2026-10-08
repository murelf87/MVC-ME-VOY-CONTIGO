import crypto from "node:crypto";
import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { PrivateObjectStorage } from "../storage/private-object-storage.js";
import type { InsuranceOcrProvider } from "./insurance-ocr-provider.js";
import { detectInsuranceExpiryFromText } from "./insurance-expiry-detector.js";
import {
  recordInsuranceAnalysisResult,
  registerVerifiedPrivateDocument
} from "./document-service.js";

export type PrivateUploadKind = "vehicle_photo" | "vehicle_insurance";

const ALLOWED_TYPES:Record<PrivateUploadKind,Set<string>>={
  vehicle_photo:new Set([
    "image/jpeg","image/png","image/webp","image/heic","image/heif"
  ]),
  vehicle_insurance:new Set([
    "image/jpeg","image/png","image/webp","application/pdf"
  ])
};

function validateUpload(kind:PrivateUploadKind,contentType:string,sizeBytes:number):void{
  if(!ALLOWED_TYPES[kind].has(contentType)){
    throw new DomainError(
      "PRIVATE_UPLOAD_TYPE_NOT_ALLOWED",
      "File type is not allowed for this upload",
      422,
      {kind,contentType}
    );
  }
  if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>20*1024*1024){
    throw new DomainError(
      "PRIVATE_UPLOAD_SIZE_INVALID",
      "File size must be between 1 byte and 20 MiB",
      422
    );
  }
}

function extensionFor(contentType:string):string{
  switch(contentType){
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

export async function createPrivateUploadIntent(
  pool:Pool,
  principal:AuthPrincipal,
  storage:PrivateObjectStorage,
  ttlSeconds:number,
  input:{
    kind:PrivateUploadKind;
    vehicleId:string;
    contentType:string;
    sizeBytes:number;
  }
){
  requireAnyRole(principal,["driver"]);
  validateUpload(input.kind,input.contentType,input.sizeBytes);

  const vehicle=await pool.query(
    `select driver_user_id from vehicles where id=$1`,
    [input.vehicleId]
  );
  if(!vehicle.rowCount) throw new DomainError("VEHICLE_NOT_FOUND","Vehicle not found",404);
  if(vehicle.rows[0].driver_user_id!==principal.userId){
    throw new DomainError("VEHICLE_NOT_OWNED","You cannot upload files for another user's vehicle",403);
  }

  const id=crypto.randomUUID();
  const key=[
    "users",principal.userId,"vehicles",input.vehicleId,input.kind,
    `${id}.${extensionFor(input.contentType)}`
  ].join("/");

  const signed=await storage.createUploadUrl({
    key,
    contentType:input.contentType,
    expiresInSeconds:ttlSeconds
  });

  await pool.query(
    `insert into private_upload_intents(
       id,owner_user_id,vehicle_id,kind,storage_provider,storage_key,
       content_type,expected_size_bytes,expires_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,principal.userId,input.vehicleId,input.kind,storage.providerName,key,
      input.contentType,input.sizeBytes,signed.expiresAt
    ]
  );

  return {
    intentId:id,
    uploadUrl:signed.url,
    headers:signed.headers,
    expiresAt:signed.expiresAt
  };
}

export async function completePrivateUploadIntent(
  pool:Pool,
  principal:AuthPrincipal,
  storage:PrivateObjectStorage,
  ocr:InsuranceOcrProvider,
  intentId:string
){
  requireAnyRole(principal,["driver"]);

  const intentQ=await pool.query(
    `select * from private_upload_intents where id=$1 and owner_user_id=$2`,
    [intentId,principal.userId]
  );
  const intent=intentQ.rows[0];
  if(!intent) throw new DomainError("UPLOAD_INTENT_NOT_FOUND","Upload intent not found",404);

  if(intent.completed_at){
    const existing=await pool.query(
      `select id,vehicle_id,kind,content_type,size_bytes,sha256,review_status,
              analysis_status,detected_expires_on,verified_expires_on,analysis_confidence
         from private_documents
        where storage_provider=$1 and storage_key=$2
        limit 1`,
      [intent.storage_provider,intent.storage_key]
    );
    if(existing.rows[0]) return {document:existing.rows[0],alreadyCompleted:true};
  }

  if(new Date(intent.expires_at).getTime()<Date.now()){
    throw new DomainError("UPLOAD_INTENT_EXPIRED","Upload intent has expired",410);
  }
  if(intent.storage_provider!==storage.providerName){
    throw new DomainError("UPLOAD_STORAGE_MISMATCH","Upload storage provider mismatch",409);
  }

  const info=await storage.headObject(intent.storage_key);
  if(info.sizeBytes!==Number(intent.expected_size_bytes)){
    throw new DomainError(
      "UPLOADED_FILE_SIZE_MISMATCH",
      "Uploaded file size does not match the declared size",
      422,
      {expected:Number(intent.expected_size_bytes),actual:info.sizeBytes}
    );
  }
  if(info.contentType && info.contentType.split(";")[0]!==intent.content_type){
    throw new DomainError(
      "UPLOADED_FILE_TYPE_MISMATCH",
      "Uploaded file content type does not match the declared type",
      422
    );
  }

  const bytes=await storage.readObject(intent.storage_key,20*1024*1024);
  if(bytes.byteLength!==Number(intent.expected_size_bytes)){
    throw new DomainError("UPLOADED_FILE_SIZE_MISMATCH","Uploaded file byte count is invalid",422);
  }
  const sha256=crypto.createHash("sha256").update(bytes).digest("hex");

  let document;
  try{
    document=await registerVerifiedPrivateDocument(pool,principal,{
      kind:intent.kind,
      vehicleId:intent.vehicle_id,
      object:{
        storageProvider:intent.storage_provider,
        storageKey:intent.storage_key,
        contentType:intent.content_type,
        sizeBytes:bytes.byteLength,
        sha256
      }
    });
  }catch(error:any){
    if(error?.code==="23505"){
      const existing=await pool.query(
        `select id,vehicle_id,kind,content_type,size_bytes,sha256,review_status,
                analysis_status,detected_expires_on,verified_expires_on,analysis_confidence
           from private_documents
          where storage_provider=$1 and storage_key=$2
          limit 1`,
        [intent.storage_provider,intent.storage_key]
      );
      document=existing.rows[0];
    }else{
      throw error;
    }
  }

  await pool.query(
    `update private_upload_intents set completed_at=now() where id=$1`,
    [intentId]
  );

  let analysis:any=null;
  if(intent.kind==="vehicle_insurance"){
    if(ocr.providerName==="disabled"){
      analysis={status:"pending",provider:"disabled"};
    }else if(intent.content_type==="application/pdf"){
      analysis=await recordInsuranceAnalysisResult(pool,document.id,{
        status:"needs_review",
        provider:ocr.providerName
      });
    }else{
      try{
        const ocrResult=await ocr.analyzeImage(bytes,intent.content_type);
        const detection=detectInsuranceExpiryFromText(ocrResult.text);
        analysis=await recordInsuranceAnalysisResult(pool,document.id,detection?{
          status:detection.confidence>=0.75?"succeeded":"needs_review",
          detectedExpiresOn:detection.expiresOn,
          confidence:detection.confidence,
          provider:ocrResult.provider,
          ...(ocrResult.reference?{reference:ocrResult.reference}:{})
        }:{
          status:"needs_review",
          provider:ocrResult.provider,
          ...(ocrResult.reference?{reference:ocrResult.reference}:{})
        });
      }catch{
        analysis=await recordInsuranceAnalysisResult(pool,document.id,{
          status:"failed",
          provider:ocr.providerName
        });
      }
    }
  }

  return {document,analysis,alreadyCompleted:false};
}

export async function createOwnDocumentDownloadUrl(
  pool:Pool,
  principal:AuthPrincipal,
  storage:PrivateObjectStorage,
  documentId:string
){
  const result=await pool.query(
    `select storage_provider,storage_key
       from private_documents
      where id=$1 and owner_user_id=$2`,
    [documentId,principal.userId]
  );
  const document=result.rows[0];
  if(!document) throw new DomainError("DOCUMENT_NOT_FOUND","Document not found",404);
  if(document.storage_provider!==storage.providerName){
    throw new DomainError("DOCUMENT_STORAGE_MISMATCH","Document storage provider mismatch",409);
  }
  const url=await storage.createDownloadUrl(document.storage_key,300);
  return {url,expiresAt:new Date(Date.now()+300000).toISOString()};
}
