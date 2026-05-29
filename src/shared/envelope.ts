export type Envelope<T> = {
  success: boolean;
  data: T | null;
  errors: string[];
  traceId: string;
};

export function successEnvelope<T>(data: T): Envelope<T> {
  return {
    success: true,
    data,
    errors: [],
    traceId: "local-trace"
  };
}

export function errorEnvelope(error: unknown): Envelope<never> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    data: null,
    errors: [message],
    traceId: "local-trace"
  };
}
