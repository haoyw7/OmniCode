/** Unknown means the platform may have accepted the message. Never replay it automatically. */
export class ImDeliveryError extends Error {
  readonly kind: "unknown" | "retryable" | "permanent";
  readonly code?: string;

  constructor(kind: ImDeliveryError["kind"], message: string, code?: string) {
    super(message);
    this.name = "ImDeliveryError";
    this.kind = kind;
    this.code = code;
  }
}
