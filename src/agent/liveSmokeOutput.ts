export function extractTypeScript(output: string) {
  const fenced = output.match(/```(?:ts|typescript)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? fromFirstImport(output);
  if (!candidate) {
    throw new Error(`No TypeScript Playwright source found\n${output}`);
  }
  const source = stripTrailingProse(candidate.trim());
  assertIncludes(source, "@playwright/test", "Playwright import");
  assertIncludes(source, "Order total: 42", "order total assertion");
  return `${source}\n`;
}

export function extractMarkdown(output: string) {
  const fenced = output.match(/```(?:md|markdown)?\s*([\s\S]*?)```/i)?.[1];
  return `${(fenced ?? output).trim()}\n`;
}

function fromFirstImport(output: string) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith("import "));
  return start === -1 ? undefined : lines.slice(start).join("\n");
}

function stripTrailingProse(source: string) {
  const lines = source.split(/\r?\n/);
  let balance = 0;
  let lastCodeLine = lines.length - 1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    balance += count(line, "{") - count(line, "}");
    if (index > 0 && balance === 0 && /^\s*(?:Done\.?|The |This |It )/i.test(lines[index + 1] ?? "")) {
      lastCodeLine = index;
      break;
    }
  }
  return lines.slice(0, lastCodeLine + 1).join("\n").trim();
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function assertIncludes(content: string, expected: string, label: string) {
  if (!content.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}\n${content}`);
  }
}
