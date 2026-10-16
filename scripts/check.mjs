import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) await walk(path);
    else if (/\.m?js$/.test(path))
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  }
}
for (const dir of ["app", "extension/src", "scripts", "tests"]) await walk(dir);
console.log("JavaScript syntax checks passed.");
