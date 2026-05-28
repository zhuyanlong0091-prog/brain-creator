import { ok, fail } from "@/src/api/response";
import { getBrainCreatorService } from "@/src/api/singleton";
import { recordTrainingEvidence } from "@/src/browser/trainingRecorder";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const service = getBrainCreatorService();
    if (body.recordingMode === "browser") {
      const recording = await recordTrainingEvidence({
        targetUrl: body.targetUrl,
        auth: service.getCaptureAuth(body.authProfileId),
        artifactDir: body.artifactDir,
        action: body.action
      });
      return ok(
        service.completeTrainingSession({
          sessionId: id,
          actions: recording.actionSteps,
          apiRequests: recording.apiRequests,
          artifacts: {
            traceUrl: recording.traceUrl,
            harUrl: recording.harUrl,
            screenshotUrl: recording.screenshotUrl
          }
        })
      );
    }
    return ok(
      service.completeTrainingSession({
        sessionId: id,
        actions: body.actions ?? [],
        apiRequests: body.apiRequests ?? []
      })
    );
  } catch (error) {
    return fail(error);
  }
}
