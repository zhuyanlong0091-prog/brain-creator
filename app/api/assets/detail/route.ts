import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return ok(
      getBrainCreatorService().getAssetDetail({
        projectId: url.searchParams.get("projectId") ?? "",
        type: url.searchParams.get("type") as never,
        id: url.searchParams.get("id") ?? ""
      })
    );
  } catch (error) {
    return fail(error);
  }
}
