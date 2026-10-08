import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  PrivateObjectInfo,
  PrivateObjectStorage,
  UploadUrlResult
} from "./private-object-storage.js";

export class S3PrivateObjectStorage implements PrivateObjectStorage {
  readonly providerName="s3";
  private readonly client:S3Client;

  constructor(
    private readonly bucket:string,
    input:{
      region:string;
      endpoint?:string;
      accessKeyId:string;
      secretAccessKey:string;
      forcePathStyle:boolean;
    }
  ){
    this.client=new S3Client({
      region:input.region,
      ...(input.endpoint?{endpoint:input.endpoint}:{}),
      forcePathStyle:input.forcePathStyle,
      credentials:{
        accessKeyId:input.accessKeyId,
        secretAccessKey:input.secretAccessKey
      }
    });
  }

  async createUploadUrl(input:{
    key:string;
    contentType:string;
    expiresInSeconds:number;
  }):Promise<UploadUrlResult>{
    const command=new PutObjectCommand({
      Bucket:this.bucket,
      Key:input.key,
      ContentType:input.contentType
    });
    const url=await getSignedUrl(this.client,command,{expiresIn:input.expiresInSeconds});
    return {
      url,
      expiresAt:new Date(Date.now()+input.expiresInSeconds*1000).toISOString(),
      headers:{"content-type":input.contentType}
    };
  }

  async headObject(key:string):Promise<PrivateObjectInfo>{
    const result=await this.client.send(new HeadObjectCommand({
      Bucket:this.bucket,
      Key:key
    }));
    return {
      sizeBytes:Number(result.ContentLength ?? 0),
      contentType:result.ContentType ?? null
    };
  }

  async readObject(key:string,maxBytes:number):Promise<Uint8Array>{
    const result=await this.client.send(new GetObjectCommand({
      Bucket:this.bucket,
      Key:key
    }));
    if(!result.Body) throw new Error("S3 object body missing");
    const bytes=await result.Body.transformToByteArray();
    if(bytes.byteLength>maxBytes){
      throw new Error("S3 object exceeds allowed size");
    }
    return bytes;
  }

  async createDownloadUrl(key:string,expiresInSeconds:number):Promise<string>{
    return getSignedUrl(
      this.client,
      new GetObjectCommand({Bucket:this.bucket,Key:key}),
      {expiresIn:expiresInSeconds}
    );
  }
}
