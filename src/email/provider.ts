import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";

export type EmailMessage = { to: string; subject: string; text: string };
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  async send(): Promise<never> {
    throw new DomainError("EMAIL_PROVIDER_UNAVAILABLE", "Email delivery is not configured", 503);
  }
}

/** Development only: writes the email to the server log instead of sending it. */
export class DevConsoleEmailProvider implements EmailProvider {
  readonly name = "dev_console";
  async send(message: EmailMessage): Promise<void> {
    console.log(`[DEV EMAIL] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}

export function buildEmailProvider(config: Pick<AppConfig, "emailProvider" | "nodeEnv">): EmailProvider {
  if (config.emailProvider === "dev_console") {
    if (config.nodeEnv !== "development") {
      throw new Error("EMAIL_PROVIDER=dev_console is only allowed with NODE_ENV=development");
    }
    return new DevConsoleEmailProvider();
  }
  return new DisabledEmailProvider();
}
