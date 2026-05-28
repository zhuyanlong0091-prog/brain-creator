import { fail, ok } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return ok(
      getBrainCreatorService().listGlossaryTerms({
        projectId: url.searchParams.get("projectId") ?? "",
        query: url.searchParams.get("query") ?? ""
      })
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(getBrainCreatorService().createGlossaryTerm(await request.json()));
  } catch (error) {
    return fail(error);
  }
}
