export function ok(data: unknown) {
  return Response.json({
    success: true,
    data,
    errors: [],
    traceId: "local-trace"
  });
}

export function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    {
      success: false,
      data: null,
      errors: [message],
      traceId: "local-trace"
    },
    { status }
  );
}
