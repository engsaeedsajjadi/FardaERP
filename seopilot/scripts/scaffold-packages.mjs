// One-time scaffold for workspace packages. Safe to re-run: never overwrites existing files.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
const pkgs = ["shared","security","db","auth","crawler","audit","providers","keywords","serp","rankings","competitors","backlinks","gsc","ga4","pagespeed","ai","content","geo","aeo","reports","billing","usage","notifications","scheduler","storage","api","seo"];
for (const p of pkgs) {
  const dir = `packages/${p}`;
  mkdirSync(`${dir}/src`, { recursive: true });
  if (!existsSync(`${dir}/package.json`)) writeFileSync(`${dir}/package.json`, JSON.stringify({
    name: `@seopilot/${p}`, version: "0.1.0", private: true, type: "module", license: "MIT",
    main: "./src/index.ts", types: "./src/index.ts",
    exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
    scripts: { typecheck: "tsc --noEmit" }, dependencies: {}, devDependencies: {}
  }, null, 2) + "\n");
  if (!existsSync(`${dir}/tsconfig.json`)) writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({
    extends: "../../tsconfig.base.json", include: ["src"], compilerOptions: { rootDir: "src" }
  }, null, 2) + "\n");
  if (!existsSync(`${dir}/src/index.ts`)) writeFileSync(`${dir}/src/index.ts`, `export {};\n`);
}
console.log("scaffolded", pkgs.length, "packages");
