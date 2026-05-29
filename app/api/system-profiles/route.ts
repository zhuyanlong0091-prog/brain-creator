import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function GET() {
  try {
    return ok(getBrainCreatorService().listSystemProfiles());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return ok(getBrainCreatorService().createSystemProfile(body));
  } catch (error) {
    return fail(error);
  }
}
