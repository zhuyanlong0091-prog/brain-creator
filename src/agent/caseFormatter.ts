import type { TestCaseScenario, TestCaseStep } from "../domain/types.js";
import { id } from "../shared/id.js";

export function parseSpecMarkdown(content: string): TestCaseScenario[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const scenarios: TestCaseScenario[] = [];
  let current: TestCaseScenario | undefined;

  for (const line of lines) {
    if (line.startsWith("## Scenario:")) {
      if (current) {
        scenarios.push(current);
      }
      current = {
        id: id("scenario"),
        title: line.replace("## Scenario:", "").trim(),
        priority: "medium",
        steps: []
      };
      continue;
    }
    if (!current || !line) {
      continue;
    }
    if (line.startsWith("Priority:")) {
      current.priority = parsePriority(line.replace("Priority:", "").trim());
      continue;
    }
    if (line.startsWith("Rule:")) {
      current.businessRuleRef = line.replace("Rule:", "").trim();
      continue;
    }
    if (line.startsWith("- ")) {
      current.steps.push(parseStep(line.slice(2)));
    }
  }

  if (current) {
    scenarios.push(current);
  }
  return scenarios;
}

export function formatScenariosAsMarkdown(scenarios: TestCaseScenario[]) {
  return scenarios
    .map((scenario) =>
      [
        `## Scenario: ${scenario.title}`,
        `Priority: ${scenario.priority}`,
        scenario.businessRuleRef ? `Rule: ${scenario.businessRuleRef}` : undefined,
        ...scenario.steps.map(formatStep)
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function parseStep(value: string): TestCaseStep {
  const [rawAction, rawTarget = ""] = value.split(/:(.*)/s);
  const action = parseAction(rawAction.trim());
  if (action === "fill") {
    const [target, inputValue = ""] = rawTarget.split(/\s+=\s+/);
    return { action, target: target.trim(), value: inputValue.trim() };
  }
  if (action === "assert") {
    const [target, expected = ""] = rawTarget.split(/\s+=>\s+/);
    return { action, target: target.trim(), expected: expected.trim() };
  }
  return { action, target: rawTarget.trim() };
}

function formatStep(step: TestCaseStep) {
  if (step.action === "fill") {
    return `- ${step.action}: ${step.target} = ${step.value ?? ""}`;
  }
  if (step.action === "assert") {
    return `- ${step.action}: ${step.target} => ${step.expected ?? ""}`;
  }
  return `- ${step.action}: ${step.target}`;
}

function parseAction(action: string): TestCaseStep["action"] {
  if (["navigate", "fill", "click", "assert", "wait", "select"].includes(action)) {
    return action as TestCaseStep["action"];
  }
  return "assert";
}

function parsePriority(value: string): TestCaseScenario["priority"] {
  if (["critical", "high", "medium", "low"].includes(value)) {
    return value as TestCaseScenario["priority"];
  }
  return "medium";
}
