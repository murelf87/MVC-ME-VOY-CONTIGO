import { DomainError } from "../errors.js";
import type { AppConfig } from "../config.js";
import type {
  PrivateObjectInfo,
  PrivateObjectStorage,
  UploadUrlResult
} from "./private-object-storage.js";
import { S3PrivateObjectStorage } from "./s3-private-object-storage.js";

class DisabledPrivateObjectStorage implements PrivateObjectStorage {
  readonly providerName="disabled";

  private fail():never{
    throw new DomainError(
      "PRIVATE_STORAGE_NOT_CONFIGURED",
      "Private file storage is not configured",
      503
    );
  }

  async createUploadUrl():Promise<UploadUrlResult>{return this.fail()}
  async headObject():Promise<PrivateObjectInfo>{return this.fail()}
  async readObject():Promise<Uint8Array>{return this.fail()}
  async createDownloadUrl():Promise<string>{return this.fail()}
}

export function buildPrivateObjectStorage(config:AppConfig):PrivateObjectStorage{
  if(config.privateStorageProvider==="disabled"){
    return new DisabledPrivateObjectStorage();
  }

  if(
    !config.s3Bucket ||
    !config.s3AccessKeyId ||
    !config.s3SecretAccessKey
  ){
    throw new Error(
      "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when PRIVATE_STORAGE_PROVIDER=s3"
    );
  }

  return new S3PrivateObjectStorage(config.s3Bucket,{
    region:config.s3Region,
    ...(config.s3Endpoint?{endpoint:config.s3Endpoint}:{}),
    accessKeyId:config.s3AccessKeyId,
    secretAccessKey:config.s3SecretAccessKey,
    forcePathStyle:config.s3ForcePathStyle
  });
}
