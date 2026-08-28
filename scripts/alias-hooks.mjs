import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Next.js and Vitest resolve the "@/*" alias from tsconfig, but plain Node does
 * not. Without this hook every module that imports "@/..." fails to load, which
 * is why the worker could only run with stubbed handlers.
 *
 * Extensionless specifiers are resolved the way a bundler would: exact match
 * first, then .ts/.tsx, then an index file inside the directory.
 */

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const candidateSuffixes = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const basePath = resolvePath(projectRoot, "src", specifier.slice(2));
  for (const suffix of candidateSuffixes) {
    const candidate = `${basePath}${suffix}`;
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  throw new Error(`Cannot resolve alias "${specifier}" under ${projectRoot}/src`);
}
