import { DomainError } from "../errors.js";
import type { OtpProvider, SendOtpInput, SendOtpResult } from "./otp-provider.js";

export class DisabledOtpProvider implements OtpProvider {
  async sendOtp(_input: SendOtpInput): Promise<SendOtpResult> {
    throw new DomainError(
      "SMS_PROVIDER_NOT_CONFIGURED",
      "Real SMS provider is not configured",
      503
    );
  }
}
