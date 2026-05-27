import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return ok(
      getBrainCreatorService().searchAssets({
        projectId: url.searchParams.get("projectId") ?? "project-1",
        query: url.searchParams.get("query") ?? ""
      })
    );
  } catch (error) {
    return fail(error);
  }
}
