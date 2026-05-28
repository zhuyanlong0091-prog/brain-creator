import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";
import { capturePageEvidence } from "@/src/browser/pageCapture";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const service = getBrainCreatorService();
    if (body.captureMode === "browser") {
      if (!body.targetUrl) {
        throw new Error("targetUrl is required for browser capture mode");
      }
      assertSafeCaptureUrl(body.targetUrl);
      body.browserCapture = await capturePageEvidence({
        targetUrl: body.targetUrl,
        auth: service.getCaptureAuth(body.authProfileId)
      });
    }
    return ok(service.discoverPageModel(body));
  } catch (error) {
    return fail(error);
  }
}

function assertSafeCaptureUrl(targetUrl: string) {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be captured");
  }
}
