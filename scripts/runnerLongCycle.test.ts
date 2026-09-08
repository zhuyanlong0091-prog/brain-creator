import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRunnerCycle } from "./runnerLongCycle.js";

describe("GitHub Actions Runner long-cycle fixture", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("persists and resumes scheduled iterations through the sharded repository", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "brain-runner-cycle-"));
    directories.push(workspace);

    const first = await runRunnerCycle({
      workspace,
      targetIterations: 2,
      minIntervalMs: 0,
      leaseMs: 50,
      leaseRenewalMs: 5,
      maxWallTimeMs: 200
    });
    const second = await runRunnerCycle({
      workspace,
      targetIterations: 2,
      minIntervalMs: 0,
      leaseMs: 50,
      leaseRenewalMs: 5,
      maxWallTimeMs: 200
    });

    expect(first.status).toBe("progressed");
    expect(first.completedIterations).toBe(1);
    expect(second.status).toBe("complete");
    expect(second.completedIterations).toBe(2);
    expect(second.strongEvidenceCount).toBe(2);
    expect(second.activeLeases).toBe(0);
    expect(JSON.parse(await readFile(join(workspace, "runner-report.json"), "utf8"))).toEqual(
      expect.objectContaining({ status: "complete", completedIterations: 2 })
    );
  });
});
