import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("E2E session resume workflow documentation", () => {
  it("documents the complete session resume → bridge preflight → full workflow path", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("# E2E: Session Resume → Bridge Preflight → Plan → Full Workflow");
    expect(content).toContain("bc_session_resume");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_full_workflow");
    expect(content).toContain("preflightAgentBridge");
    expect(content).toContain("5-second");
    expect(content).toContain("bridge preflight");
    expect(content).toContain("nextAction");
  });

  it("explains what bc_session_resume returns in a single call", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("6–7 independent");
    expect(content).toContain("System profile");
    expect(content).toContain("Bridge preflight status");
    expect(content).toContain("Recommended next action");
    expect(content).toContain("Compute `nextAction`");
  });

  it("documents bridge preflight outcomes for each tool", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("Not configured");
    expect(content).toContain("BRAIN_CREATOR_AGENT_COMMAND");
    expect(content).toContain("Configured but unreachable");
    expect(content).toContain("Configured and healthy");
    expect(content).toContain("returns error immediately");
  });

  it("documents the nextAction decision tree", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("complete_onboarding");
    expect(content).toContain("configure_bridge");
    expect(content).toContain("resolve_gaps");
    expect(content).toContain("review_failures");
    expect(content).toContain("run_chain");
    expect(content).toContain("generate_plan");
  });

  it("includes recommended one-sentence prompts for each E2E scenario", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("Use Brain Creator to check the status");
    expect(content).toContain("If the planner isn't available");
    expect(content).toContain("all in one go");
    expect(content).toContain("resume where I left off");
  });

  it("references the verification smoke command", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(content).toContain("npm run verify:live-session-resume-workflow");
    expect(packageJson.scripts["verify:live-session-resume-workflow"]).toContain(
      "scripts/liveSessionResumeWorkflowSmoke.ts"
    );
  });

  it("documents the operator checklist for E2E sessions", async () => {
    const content = await readFile("docs/e2e-session-resume-workflow.md", "utf8");

    expect(content).toContain("Operator Checklist");
    expect(content).toContain("npm install");
    expect(content).toContain("BRAIN_CREATOR_AGENT_COMMAND");
    expect(content).toContain("BRAIN_CREATOR_AGENT_ARGS");
    expect(content).toContain("Auth profile is configured and verified");
  });
});
