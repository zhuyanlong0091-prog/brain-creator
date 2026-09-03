import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  preflightAgentBridge,
  runAgent,
  runChain,
  validateActorJourneyUsage,
  validateHealerMutation,
  validateStepInstrumentation
} from "./orchestrator.js";
import { encryptSecrets } from "../shared/crypto.js";
import type {
  AuthProfile,
  BusinessRule,
  GlossaryTerm,
  SystemProfile,
  TestCase
} from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("actor journey guard", () => {
  it("requires every declared actor role to be explicitly used", () => {
    expect(
      validateActorJourneyUsage(
        "await bc.runAsRole(browser, 'recruiter', action);",
        [{ role: "recruiter" }, { role: "approver" }]
      )
    ).toEqual({
      valid: false,
      reason: "Generated test does not reference actor role(s): approver."
    });
    expect(
      validateActorJourneyUsage(
        "await bc.runAsRole(browser, 'recruiter', action); await bc.runAsRole(browser, 'approver', action);",
        [{ role: "recruiter" }, { role: "approver" }]
      )
    ).toEqual({ valid: true });
  });
});

describe("step instrumentation guard", () => {
  it("requires each executable step to be wrapped by bc.step", () => {
    expect(validateStepInstrumentation("await bc.step('step-create', page, action);", ["step-create", "step-save"]))
      .toEqual({
        valid: false,
        reason: "Generated test is missing bc.step instrumentation for: step-save."
      });
    expect(validateStepInstrumentation("await bc.step(\"step-create\", page, action);", ["step-create"]))
      .toEqual({ valid: true });
    expect(validateStepInstrumentation("// bc.step(\"step-create\", page, action);", ["step-create"]).valid)
      .toBe(false);
  });
});

describe("healer mutation guard", () => {
  it("rejects a healer mutation that removes assertions or step instrumentation", () => {
    const before = `await bc.step("step-create", page, async () => { await expect(page.getByText("Created")).toBeVisible(); });`;
    const removedAssertion = `await bc.step("step-create", page, async () => { await page.getByText("Created").click(); });`;
    const removedStep = `await expect(page.getByText("Created")).toBeVisible();`;

    expect(validateHealerMutation(before, removedAssertion, ["step-create"])).toEqual({
      valid: false,
      reason: expect.stringContaining("assertion")
    });
    expect(validateHealerMutation(before, removedStep, ["step-create"])).toEqual({
      valid: false,
      reason: expect.stringContaining("bc.step")
    });
  });

  it("rejects healer attempts that skip or isolate tests", () => {
    const before = `test("case", async () => { await expect(true).toBeTruthy(); });`;

    expect(validateHealerMutation(before, `test.skip("case", async () => {});`, [])).toEqual({
      valid: false,
      reason: expect.stringContaining("skip")
    });
    expect(validateHealerMutation(before, `test.only("case", async () => { await expect(true).toBeTruthy(); });`, [])).toEqual({
      valid: false,
      reason: expect.stringContaining("only")
    });
    expect(validateHealerMutation(
      "assert.equal(result, true);",
      "",
      []
    )).toEqual({
      valid: false,
      reason: expect.stringContaining("assertion")
    });
  });

  it("rejects a healer mutation that changes a protected assertion target", () => {
    const before = `await bc.step("step-create", page, async () => { await expect(page.getByText("Created")).toBeVisible(); });`;
    const changedTarget = `await bc.step("step-create", page, async () => { await expect(page.getByText("Draft")).toBeVisible(); });`;

    expect(validateHealerMutation(before, changedTarget, ["step-create"])).toEqual({
      valid: false,
      reason: expect.stringContaining("semantic assertion")
    });
  });
});

describe("runAgent", () => {
  it("fails clearly when no Claude subagent bridge is configured", async () => {
    const run = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "planner bridge missing",
      args: ["--prompt", "specs/_context/system_1-prompt.md"],
      outputPaths: ["specs/robot.md"]
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Claude subagent bridge required");
    expect(run.logs).toEqual([expect.stringContaining("Claude subagent bridge required")]);
  });

  it("records a succeeded Playwright agent run from an explicit command bridge", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const run = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "测试购买机器人",
      args: ["--prompt", "specs/_context/system_1-prompt.md"],
      outputPaths: ["specs/robot.md"],
      agentBridge: commandRunnerAgentBridge(async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "planner ok", stderr: "" };
      })
    });

    expect(calls).toEqual([
      {
        command: "npx",
        args: ["playwright", "agent", "planner", "--prompt", "specs/_context/system_1-prompt.md"]
      }
    ]);
    expect(run).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent_/),
        systemId: "system_1",
        agent: "planner",
        status: "succeeded",
        inputSummary: "测试购买机器人",
        outputPaths: ["specs/robot.md"],
        logs: ["planner ok"]
      })
    );
    expect(run.duration).toBeGreaterThanOrEqual(0);
  });

  it("records a failed Playwright agent run without throwing", async () => {
    const run = await runAgent({
      systemId: "system_1",
      agent: "generator",
      inputSummary: "生成购买机器人测试",
      args: ["--spec", "specs/robot.md"],
      outputPaths: [],
      agentBridge: async () => ({ exitCode: 1, stdout: "", stderr: "generator failed" })
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe("generator failed");
    expect(run.logs).toEqual(["generator failed"]);
  });

  it("records runner errors as failed agent runs", async () => {
    const run = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "planner timeout",
      args: ["--prompt", "specs/_context/system_1-prompt.md"],
      outputPaths: [],
      agentBridge: async () => {
        throw new Error("Command timed out after 1000ms");
      }
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe("Command timed out after 1000ms");
    expect(run.logs).toEqual(["Command timed out after 1000ms"]);
  });
});

describe("generatePlanDraft", () => {
  it("builds context, runs planner, parses scenarios, checks rules, and extracts new terms", async () => {
    const workDir = await tempDir();
    const specPath = join(workDir, "specs", "robot.md");
    const calls: string[][] = [];

    const result = await generatePlanDraft({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      requirement: "测试购买机器人的完整流程",
      glossaryTerms: [robotTerm()],
      businessRules: [paymentRule()],
      specPath,
      agentBridge: commandRunnerAgentBridge(async (_command, args) => {
        calls.push(args);
        await writeFile(
          specPath,
          [
            "## Scenario: 购买机器人",
            "Priority: critical",
            "Rule: rule_1",
            "- navigate: 商品列表",
            "- click: 机器人商品",
            "- assert: 订单金额 => 金额正确",
            "- click: 提交订单"
          ].join("\n"),
          "utf8"
        );
        return { exitCode: 0, stdout: "planner wrote spec", stderr: "" };
      })
    });

    expect(calls[0]).toEqual(
      expect.arrayContaining(["playwright", "agent", "planner", "--output", specPath])
    );
    expect(result.agentRun.status).toBe("succeeded");
    expect(result.scenarios[0]).toEqual(
      expect.objectContaining({
        title: "购买机器人",
        priority: "critical",
        businessRuleRef: "rule_1"
      })
    );
    expect(result.ruleCheckResult.passed).toBe(true);
    expect(result.newTerms.map((term) => term.zhCN)).toEqual(["商品列表", "订单金额", "提交订单"]);
    expect(await readFile(result.promptPath, "utf8")).toContain("测试购买机器人的完整流程");
  });
});

describe("runChain", () => {
  it("writes new generated artifacts into an owned run directory", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      agentBridge: async ({ outputPaths }) => {
        await writeFile(outputPaths[0], "import { test } from '@playwright/test';", "utf8");
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async () => ({ exitCode: 0, stdout: "passed", stderr: "" })
    });

    expect(result.specPath.replace(/\\/g, "/")).toContain("/.brain-creator/artifacts/");
    expect(result.testPath.replace(/\\/g, "/")).toContain("/.brain-creator/artifacts/");
    expect(result.specPath).not.toContain(`${join(workDir, "specs")}`);
  });

  it("stops before rerunning Playwright when Healer removes an assertion", async () => {
    const workDir = await tempDir();
    let testRuns = 0;
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      structuredReporter: true,
      requiredStepIds: ["step-1"],
      agentBridge: async ({ agent, outputPaths }) => {
        if (agent === "generator") {
          await writeFile(
            outputPaths[0],
            `await bc.step("step-1", page, async () => { await expect(page.getByText("Created")).toBeVisible(); });`,
            "utf8"
          );
        } else {
          await writeFile(
            outputPaths[0],
            `await bc.step("step-1", page, async () => { await page.getByText("Created").click(); });`,
            "utf8"
          );
        }
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, args) => {
        if (args.includes("--reporter=json")) {
          testRuns += 1;
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              stats: { duration: 1, expected: 0, unexpected: 1, skipped: 0 },
              suites: [{ specs: [{ title: "step-1", tests: [{ results: [{ status: "failed" }] }] }] }]
            }),
            stderr: "assertion failed"
          };
        }
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      maxHealAttempts: 1
    });

    expect(testRuns).toBe(1);
    expect(result.healerRuns).toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("assertion") })
    ]);
    expect(result.chainRun.status).toBe("failed");
  });

  it("fails closed when strict Reporter mode receives no structured output", async () => {
    const result = await runChain({
      workDir: await tempDir(),
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      structuredReporter: true,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(outputPaths[0], "import { test } from '@playwright/test'; test('generated', () => {});", "utf8");
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async () => ({ exitCode: 0, stdout: "1 passed", stderr: "" })
    });

    expect(result.testResult.structuredReporter).toBeUndefined();
    expect(result.testResult.exitCode).toBe(1);
    expect(result.testResult.stderr).toContain("Structured Playwright Reporter output was missing");
    expect(result.chainRun.status).toBe("failed");
  });

  it("uses the structured Playwright reporter when requested", async () => {
    const workDir = await tempDir();
    const testCase = approvedTestCase();
    const runnerArgs: string[][] = [];
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase,
      structuredReporter: true,
      browserMode: "observe",
      agentBridge: async ({ outputPaths }) => {
        await writeFile(outputPaths[0], "import { test } from '@playwright/test'; test('generated', () => {});", "utf8");
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, args) => {
        runnerArgs.push(args);
        return {
          exitCode: 0,
          stdout: args.includes("--reporter=json")
            ? JSON.stringify({
                stats: { duration: 12, expected: 1, unexpected: 0, skipped: 0 },
                suites: [{ specs: [{ id: "assertion-1", title: "workflow", tests: [{ results: [{ status: "passed" }] }] }] }]
              })
            : "agent ok",
          stderr: ""
        };
      }
    });

    expect(runnerArgs[0]).toContain("--headed");
    expect(result.testResult.structuredReporter).toEqual(
      expect.objectContaining({ status: "passed", total: 1, passed: 1 })
    );
    expect(result.testResult.reporterPath).toContain("playwright-report.json");
    expect(await readFile(result.testResult.reporterPath!, "utf8")).toContain('"status": "passed"');
  });

  it("blocks strict execution before the runner when the generator omitted the test file", async () => {
    let runnerCalled = false;
    const result = await runChain({
      workDir: await tempDir(),
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      structuredReporter: true,
      agentBridge: async () => ({ exitCode: 0, stdout: "agent ok", stderr: "" }),
      runner: async () => {
        runnerCalled = true;
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
    });

    expect(runnerCalled).toBe(false);
    expect(result.testResult.stderr).toContain("test file is missing or empty");
    expect(result.chainRun.status).toBe("failed");
  });

  it("requires runtime evidence for every declared actor role", async () => {
    const workDir = await tempDir();
    const actorJourney = [
      { role: "recruiter", authProfile: authProfile() },
      { role: "approver", authProfile: { ...authProfile(), id: "auth_approver", role: "approver" } }
    ];
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      actorJourney,
      testCase: approvedTestCase(),
      structuredReporter: true,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(
          outputPaths[0],
          'await bc.runAsRole(browser, "recruiter", async () => {});\nawait bc.runAsRole(browser, "approver", async () => {});',
          "utf8"
        );
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, args, options) => {
        const evidencePath = options?.env?.BRAIN_CREATOR_ACTOR_EVIDENCE_PATH;
        if (evidencePath) {
          await writeFile(
            evidencePath,
            '{"role":"recruiter","authProfileId":"auth_1","event":"entered"}\n{"role":"approver","authProfileId":"auth_approver","event":"entered"}\n',
            "utf8"
          );
        }
        return {
          exitCode: 0,
          stdout: args.includes("--reporter=json")
            ? JSON.stringify({ stats: { duration: 1, expected: 1, unexpected: 0, skipped: 0 }, suites: [] })
            : "agent ok",
          stderr: ""
        };
      }
    });

    expect(result.chainRun.status).toBe("succeeded");
    expect(result.testResult.actorRoleEvidencePath).toContain("actor-journey.jsonl");
  });

  it("blocks a multi-role run when runtime evidence omits a declared role", async () => {
    const workDir = await tempDir();
    const actorJourney = [
      { role: "recruiter", authProfile: authProfile() },
      { role: "approver", authProfile: { ...authProfile(), id: "auth_approver", role: "approver" } }
    ];
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      actorJourney,
      testCase: approvedTestCase(),
      structuredReporter: false,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(
          outputPaths[0],
          'await bc.runAsRole(browser, "recruiter", async () => {});\nawait bc.runAsRole(browser, "approver", async () => {});',
          "utf8"
        );
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, _args, options) => {
        await writeFile(
          options?.env?.BRAIN_CREATOR_ACTOR_EVIDENCE_PATH ?? "missing.jsonl",
          '{"role":"recruiter","authProfileId":"auth_1","event":"entered"}\n',
          "utf8"
        );
        return { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.testResult.stderr).toContain("missing role(s): approver");
  });

  it("blocks a multi-role run when runtime evidence uses roles out of order", async () => {
    const workDir = await tempDir();
    const actorJourney = [
      { role: "recruiter", authProfile: authProfile() },
      { role: "approver", authProfile: { ...authProfile(), id: "auth_approver", role: "approver" } }
    ];
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      actorJourney,
      testCase: approvedTestCase(),
      structuredReporter: false,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(
          outputPaths[0],
          'await bc.runAsRole(browser, "recruiter", async () => {});\nawait bc.runAsRole(browser, "approver", async () => {});',
          "utf8"
        );
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, _args, options) => {
        await writeFile(
          options?.env?.BRAIN_CREATOR_ACTOR_EVIDENCE_PATH ?? "missing.jsonl",
          '{"role":"approver","authProfileId":"auth_approver","event":"entered"}\n{"role":"recruiter","authProfileId":"auth_1","event":"entered"}\n',
          "utf8"
        );
        return { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.testResult.stderr).toContain("does not follow the declared role order");
  });

  it("blocks a multi-role run when a role uses the wrong AuthProfile", async () => {
    const workDir = await tempDir();
    const actorJourney = [
      { role: "recruiter", authProfile: authProfile() },
      { role: "approver", authProfile: { ...authProfile(), id: "auth_approver", role: "approver" } }
    ];
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      actorJourney,
      testCase: approvedTestCase(),
      structuredReporter: false,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(
          outputPaths[0],
          'await bc.runAsRole(browser, "recruiter", async () => {});\nawait bc.runAsRole(browser, "approver", async () => {});',
          "utf8"
        );
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async (_command, _args, options) => {
        await writeFile(
          options?.env?.BRAIN_CREATOR_ACTOR_EVIDENCE_PATH ?? "missing.jsonl",
          '{"role":"recruiter","authProfileId":"auth_1","event":"entered"}\n{"role":"approver","authProfileId":"auth_1","event":"entered"}\n',
          "utf8"
        );
        return { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.testResult.stderr).toContain("unexpected AuthProfile");
  });

  it("redacts protected values from bridge logs", async () => {
    const run = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "redact bridge output",
      args: [],
      outputPaths: [],
      protectedSecrets: { token: "secret-token-123" },
      agentBridge: async () => ({
        exitCode: 1,
        stdout: "token=secret-token-123",
        stderr: "Bearer abcdefghijklmnopqrstuvwxyz1234"
      })
    });

    expect(run.logs.join("\n")).not.toContain("secret-token-123");
    expect(run.logs.join("\n")).not.toContain("abcdefghijklmnopqrstuvwxyz1234");
    expect(run.error).toContain("[REDACTED]");
  });

  it("serializes an approved test case, runs generator, and executes the generated test", async () => {
    const workDir = await tempDir();
    const commands: string[][] = [];
    const testCase = approvedTestCase();

    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase,
      agentBridge: commandRunnerAgentBridge(async (_command, args) => {
        commands.push(args);
        return { exitCode: 0, stdout: `${args.join(" ")} ok`, stderr: "" };
      }),
      runner: async (_command, args) => {
        commands.push(args);
        return { exitCode: 0, stdout: `${args.join(" ")} ok`, stderr: "" };
      }
    });

    expect(commands).toEqual([
      expect.arrayContaining(["playwright", "agent", "generator"]),
      [
        "playwright",
        "test",
        relative(join(dirname(dirname(result.testPath)), "tests"), result.testPath).replace(/\\/g, "/"),
        "--workers=1",
        "--config",
        relative(workDir, join(result.testPath, "..", "..", "playwright.config.ts")).replace(/\\/g, "/")
      ]
    ]);
    expect(result.chainRun).toEqual(
      expect.objectContaining({
        systemId: "system_1",
        testCaseId: testCase.id,
        status: "succeeded",
        specPath: result.specPath,
        testPath: result.testPath,
        gaps: []
      })
    );
    expect(await readFile(result.specPath, "utf8")).toContain("## Scenario: 购买机器人");
  });

  it("marks the chain failed when the generated test command fails", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      agentBridge: async () => ({ exitCode: 0, stdout: "agent ok", stderr: "" }),
      runner: async (_command, args) => ({
        exitCode: args[1] === "test" ? 1 : 0,
        stdout: "",
        stderr: args[1] === "test" ? "test failed" : ""
      }),
      maxHealAttempts: 0
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.generateRun.status).toBe("succeeded");
  });

  it("blocks a generated test containing a credential pattern before Playwright runs", async () => {
    const workDir = await tempDir();
    const testCase = approvedTestCase();
    let runnerCalled = false;
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(outputPaths[0], 'const config = { password: "do-not-export-this" };', "utf8");
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async () => {
        runnerCalled = true;
        return { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });

    expect(runnerCalled).toBe(false);
    expect(result.testResult.stderr).toContain("pattern:sensitive-field-literal");
    expect(result.chainRun.status).toBe("failed");
  });

  it("scans and redacts every Agent output path at the shared bridge boundary", async () => {
    const workDir = await tempDir();
    const outputPath = join(workDir, "planner.md");
    const result = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "sensitive output check",
      args: [],
      outputPaths: [outputPath],
      cwd: workDir,
      protectedSecrets: { token: "long-lived-token-123" },
      agentBridge: async () => {
        await writeFile(outputPath, 'token = "long-lived-token-123"', "utf8");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("sensitive material");
    expect(await readFile(outputPath, "utf8")).toContain("[REDACTED]");
    expect(await readFile(outputPath, "utf8")).not.toContain("long-lived-token-123");
  });

  it("rejects Agent output paths outside the working directory before bridge execution", async () => {
    const workDir = await tempDir();
    let bridgeCalled = false;
    const result = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "path boundary",
      args: [],
      outputPaths: [join(workDir, "..", "outside.md")],
      cwd: workDir,
      agentBridge: async () => {
        bridgeCalled = true;
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("inside the workdir");
    expect(bridgeCalled).toBe(false);
  });

  it("records Playwright stdout as the failure reason when stderr is empty", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      maxHealAttempts: 0,
      agentBridge: async () => ({ exitCode: 0, stdout: "agent ok", stderr: "" }),
      runner: async () => ({
        exitCode: 1,
        stdout: "No tests found",
        stderr: ""
      })
    });

    expect(result.chainRun.gaps[0].reason).toContain("No tests found");
  });

  it("redacts runner output and structured reporter artifacts before persistence", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      maxHealAttempts: 0,
      structuredReporter: true,
      agentBridge: async ({ outputPaths }) => {
        await writeFile(outputPaths[0], "import { test } from '@playwright/test'; test('safe', () => {});", "utf8");
        return { exitCode: 0, stdout: "agent ok", stderr: "" };
      },
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          stats: { expected: 1, unexpected: 0, skipped: 0 },
          suites: [{ specs: [{ title: "token=secret-token", tests: [{ results: [{ status: "passed" }] }] }] }]
        }),
        stderr: "runner token=secret-token"
      })
    });

    expect(result.testResult.stdout).not.toContain("secret-token");
    expect(result.testResult.stderr).not.toContain("secret-token");
    const reporter = await readFile(result.testResult.reporterPath!, "utf8");
    expect(reporter).not.toContain("secret-token");
  });

  it("runs healer and retries the generated test until it succeeds", async () => {
    const workDir = await tempDir();
    const commands: string[][] = [];
    let testAttempts = 0;

    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      agentBridge: commandRunnerAgentBridge(async (_command, args) => {
        commands.push(args);
        return { exitCode: 0, stdout: `${args.join(" ")} ok`, stderr: "" };
      }),
      runner: async (_command, args) => {
        commands.push(args);
        if (args[1] === "test") {
          testAttempts += 1;
          return testAttempts === 1
            ? { exitCode: 1, stdout: "", stderr: "first test failed" }
            : { exitCode: 0, stdout: "test passed after heal", stderr: "" };
        }
        return { exitCode: 0, stdout: `${args.join(" ")} ok`, stderr: "" };
      }
    });

    expect(commands).toEqual([
      expect.arrayContaining(["playwright", "agent", "generator"]),
      ["playwright", "test", relative(join(dirname(dirname(result.testPath)), "tests"), result.testPath).replace(/\\/g, "/"), "--workers=1", "--config", relative(workDir, join(result.testPath, "..", "..", "playwright.config.ts")).replace(/\\/g, "/")],
      expect.arrayContaining(["playwright", "agent", "healer"]),
      ["playwright", "test", relative(join(dirname(dirname(result.testPath)), "tests"), result.testPath).replace(/\\/g, "/"), "--workers=1", "--config", relative(workDir, join(result.testPath, "..", "..", "playwright.config.ts")).replace(/\\/g, "/")]
    ]);
    expect(commands[2]).toEqual(
      expect.arrayContaining(["--seed", expect.stringContaining("seed-system_1.fixture.ts")])
    );
    expect(result.chainRun.status).toBe("succeeded");
    expect(result.chainRun.healRunId).toEqual(expect.stringMatching(/^agent_/));
    expect(result.healerRuns).toHaveLength(1);
  });

  it("creates a gap after healer retries are exhausted", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      maxHealAttempts: 2,
      agentBridge: async () => ({ exitCode: 0, stdout: "agent ok", stderr: "" }),
      runner: async (_command, args) => ({
        exitCode: args[1] === "test" ? 1 : 0,
        stdout: "",
        stderr: args[1] === "test" ? "assertion failed" : ""
      })
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.healerRuns).toHaveLength(2);
    expect(result.chainRun.gaps).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^gap_/),
        projectId: "system_1",
        sourceType: "healer-skip",
        sourceId: approvedTestCase().id,
        reason: expect.stringContaining("assertion failed"),
        status: "open"
      })
    ]);
  });
});

describe("preflightAgentBridge", () => {
  it("returns ok:false when no bridge is configured", async () => {
    const result = await preflightAgentBridge(undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("BRAIN_CREATOR_AGENT_COMMAND");
    expect(result.checkedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}/));
  });

  it("returns ok:true when bridge responds (even with errors)", async () => {
    const bridge = commandRunnerAgentBridge(async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "no such subagent"
    }));
    const result = await preflightAgentBridge(bridge);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false on bridge timeout within the deadline", async () => {
    const bridge = async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const start = Date.now();
    const result = await preflightAgentBridge(bridge, 500);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unreachable");
    expect(result.error).toContain("500ms");
    // 必须在 deadline 附近返回，不能等到 2000ms
    expect(elapsed).toBeLessThan(1500);
  });

  it("returns ok:true for a healthy bridge", async () => {
    const bridge = commandRunnerAgentBridge(async () => ({
      exitCode: 0,
      stdout: "planner ready",
      stderr: ""
    }));
    const result = await preflightAgentBridge(bridge);
    expect(result.ok).toBe(true);
    expect(result.checkedAt).toBeDefined();
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-orchestrator-"));
  tempDirs.push(dir);
  return dir;
}

function systemProfile(): SystemProfile {
  return {
    id: "system_1",
    name: "Orders Console",
    environment: "staging",
    baseUrl: "https://shop.example.test",
    defaultLocale: "zh-CN",
    urlAllowlist: ["https://shop.example.test"],
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function authProfile(): AuthProfile {
  return {
    id: "auth_1",
    projectId: "system_1",
    env: "staging",
    role: "qa-admin",
    loginMethod: "token",
    encryptedSecrets: encryptSecrets({ token: "secret-token" }),
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function robotTerm(): GlossaryTerm {
  return {
    id: "term_1",
    projectId: "system_1",
    key: "product.robot",
    zhCN: "机器人",
    enUS: "Robot",
    aliases: [],
    pageScope: "/products",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function paymentRule(): BusinessRule {
  return {
    id: "rule_1",
    systemId: "system_1",
    name: "Payment amount rule",
    condition: "必须校验订单金额",
    severity: "block",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
}

function approvedTestCase(): TestCase {
  return {
    id: "case_1",
    systemId: "system_1",
    requirement: "测试购买机器人",
    status: "approved",
    scenarios: [
      {
        id: "scenario_1",
        title: "购买机器人",
        priority: "critical",
        steps: [
          { action: "navigate", target: "商品列表" },
          { action: "assert", target: "订单金额", expected: "金额正确" }
        ]
      }
    ],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] },
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}
