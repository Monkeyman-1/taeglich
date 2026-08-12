#!/usr/bin/env node
/**
 * Syntax-checks every inline <script> in index.html.
 *
 * Run:  node tools/check-html.mjs
 * The whole app is one HTML file, so a stray typo in a script block is a blank
 * screen for every user. This catches it before it ships. It parses only — it
 * does not execute, so browser globals are irrelevant.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (!blocks.length) {
  console.error("index.html: no inline <script> blocks found — did the file structure change?");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "taeglich-check-"));
let failed = 0;
try {
  blocks.forEach((code, i) => {
    const file = join(dir, `block${i + 1}.js`);
    writeFileSync(file, code);
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      console.log(`  script block ${i + 1}/${blocks.length}: OK (${code.length} chars)`);
    } catch (e) {
      failed++;
      console.error(`  script block ${i + 1}/${blocks.length}: SYNTAX ERROR`);
      console.error(String(e.stderr || e.message).replace(new RegExp(dir, "g"), "<tmp>"));
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`index.html: ${failed} of ${blocks.length} script blocks failed to parse`);
  process.exit(1);
}
console.log(`index.html OK — ${blocks.length} script blocks parse cleanly`);
