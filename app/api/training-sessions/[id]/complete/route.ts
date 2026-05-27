import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    return ok(
      getBrainCreatorService().completeTrainingSession({
        sessionId: id,
        actions: body.actions ?? [],
        apiRequests: body.apiRequests ?? []
      })
    );
  } catch (error) {
    return fail(error);
  }
}
