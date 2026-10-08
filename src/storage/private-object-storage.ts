export type UploadUrlResult = {
  url: string;
  expiresAt: string;
  headers: Record<string,string>;
};

export type PrivateObjectInfo = {
  sizeBytes: number;
  contentType: string | null;
};

export interface PrivateObjectStorage {
  providerName: string;
  createUploadUrl(input:{
    key:string;
    contentType:string;
    expiresInSeconds:number;
  }):Promise<UploadUrlResult>;
  headObject(key:string):Promise<PrivateObjectInfo>;
  readObject(key:string,maxBytes:number):Promise<Uint8Array>;
  createDownloadUrl(key:string,expiresInSeconds:number):Promise<string>;
}
