import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";
import { capturePageEvidence } from "@/src/browser/pageCapture";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.captureMode === "browser") {
      if (!body.targetUrl) {
        throw new Error("targetUrl is required for browser capture mode");
      }
      body.browserCapture = await capturePageEvidence({ targetUrl: body.targetUrl });
    }
    return ok(getBrainCreatorService().discoverPageModel(body));
  } catch (error) {
    return fail(error);
  }
}
