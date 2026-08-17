import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isCliEntryPoint(
  moduleUrl: string,
  argvPath: string | undefined = process.argv[1]
) {
  if (!argvPath) return false;
  return canonicalPath(argvPath) === canonicalPath(fileURLToPath(moduleUrl));
}

function canonicalPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
