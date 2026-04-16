import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

/**
 * Worklet Validator
 *
 * This script scans the codebase for .worklet.js files and attempts
 * to parse them as pure JavaScript. If it finds TypeScript syntax
 * (like 'private', 'interface', or type annotations), esbuild will
 * throw an error and stop the build.
 */

const WORKLET_DIR = "src/lib/audio";

async function validateWorklets() {
  const files = readdirSync(WORKLET_DIR).filter((f) =>
    f.endsWith(".worklet.js"),
  );

  console.log(`🔍 Validating ${files.length} worklet files...`);

  for (const file of files) {
    const path = join(WORKLET_DIR, file);
    const content = readFileSync(path, "utf8");

    try {
      // We attempt to transform it as plain JS.
      // If there is TS syntax, esbuild will fail.
      await esbuild.transform(content, {
        loader: "js",
        target: "esnext",
        format: "esm",
      });
      console.log(`✅ ${file} is valid JavaScript.`);
    } catch (err) {
      console.error(
        `❌ SYNTAX ERROR in ${file}: Worklets must be pure JavaScript.`,
      );
      console.error(err.errors[0].text);
      process.exit(1);
    }
  }
}

validateWorklets();
