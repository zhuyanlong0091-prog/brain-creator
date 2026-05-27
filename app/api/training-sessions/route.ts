import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return ok(getBrainCreatorService().createTrainingSession(body));
  } catch (error) {
    return fail(error);
  }
}
