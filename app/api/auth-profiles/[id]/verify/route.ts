import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return ok(getBrainCreatorService().verifyAuthProfile(id));
  } catch (error) {
    return fail(error, 404);
  }
}
