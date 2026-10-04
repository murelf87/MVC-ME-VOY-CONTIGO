export type SendOtpInput = {
  phoneE164: string;
  code: string;
  ttlSeconds: number;
};

export type SendOtpResult = {
  providerName: string;
  providerMessageId: string;
};

export interface OtpProvider {
  sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
}
