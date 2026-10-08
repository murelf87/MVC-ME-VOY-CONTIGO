import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";

export type InsuranceOcrResult = {
  provider: string;
  reference?: string;
  text: string;
};

export interface InsuranceOcrProvider {
  providerName: string;
  analyzeImage(bytes:Uint8Array,contentType:string):Promise<InsuranceOcrResult>;
}

class DisabledInsuranceOcrProvider implements InsuranceOcrProvider {
  readonly providerName="disabled";
  async analyzeImage():Promise<InsuranceOcrResult>{
    throw new DomainError(
      "INSURANCE_OCR_NOT_CONFIGURED",
      "Automatic insurance OCR is not configured",
      503
    );
  }
}

class GoogleVisionInsuranceOcrProvider implements InsuranceOcrProvider {
  readonly providerName="google_vision";
  constructor(private readonly apiKey:string){}

  async analyzeImage(bytes:Uint8Array,contentType:string):Promise<InsuranceOcrResult>{
    if(!["image/jpeg","image/png","image/webp","image/gif","image/bmp"].includes(contentType)){
      throw new DomainError(
        "INSURANCE_OCR_UNSUPPORTED_TYPE",
        "Automatic insurance OCR currently requires an image file",
        422
      );
    }

    const base64=Buffer.from(bytes).toString("base64");
    const response=await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(this.apiKey)}`,
      {
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          requests:[{
            image:{content:base64},
            features:[{type:"DOCUMENT_TEXT_DETECTION"}]
          }]
        })
      }
    );

    if(!response.ok){
      const body=await response.text();
      throw new DomainError(
        "INSURANCE_OCR_PROVIDER_ERROR",
        "Insurance OCR provider returned an error",
        502,
        {status:response.status,body:body.slice(0,500)}
      );
    }

    const data=await response.json() as any;
    const first=data?.responses?.[0];
    if(first?.error){
      throw new DomainError(
        "INSURANCE_OCR_PROVIDER_ERROR",
        "Insurance OCR provider rejected the image",
        502,
        {providerError:first.error}
      );
    }
    const text=String(
      first?.fullTextAnnotation?.text ??
      first?.textAnnotations?.[0]?.description ??
      ""
    ).trim();

    if(!text){
      throw new DomainError(
        "INSURANCE_OCR_EMPTY",
        "No readable text was detected in the insurance image",
        422
      );
    }

    return {
      provider:this.providerName,
      text
    };
  }
}

export function buildInsuranceOcrProvider(config:AppConfig):InsuranceOcrProvider{
  if(config.insuranceOcrProvider==="disabled"){
    return new DisabledInsuranceOcrProvider();
  }
  if(!config.googleVisionApiKey){
    throw new Error(
      "GOOGLE_VISION_API_KEY is required when INSURANCE_OCR_PROVIDER=google_vision"
    );
  }
  return new GoogleVisionInsuranceOcrProvider(config.googleVisionApiKey);
}
