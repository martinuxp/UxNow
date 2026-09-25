import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const cargo = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml")],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ),
);

const npmPackages = new Map();
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  const name = entry.name ?? location.split("node_modules/").at(-1);
  const version = entry.version;
  if (!name || !version || !entry.license) {
    throw new Error(`Missing npm name, version or license: ${location}`);
  }
  npmPackages.set(`${name}@${version}`, { name, version, license: entry.license });
}

const rustPackages = new Map();
for (const entry of cargo.packages) {
  if (!entry.license) {
    throw new Error(`Missing Rust license: ${entry.name}@${entry.version}`);
  }
  rustPackages.set(`${entry.name}@${entry.version}`, entry);
}

const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const compare = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
const lines = [
  "# Dependency license inventory",
  "",
  "Generated from `package-lock.json` and `cargo metadata --locked` by `node scripts/write-dependency-notices.mjs`.",
  "This includes build and platform-specific packages as well as packages present in the Windows app, so the list can be broader than a particular installer.",
  "See `THIRD_PARTY_NOTICES.md`, `_internal/RUNTIME_SOURCES.md`, and `_internal/licenses/` for the separately bundled uxPlay/GStreamer runtime.",
  "",
  `## JavaScript packages (${npmPackages.size})`,
  "",
  "| Package | Version | Declared license |",
  "| --- | --- | --- |",
];
for (const entry of [...npmPackages.values()].sort(compare)) {
  lines.push(`| ${cell(entry.name)} | ${cell(entry.version)} | ${cell(entry.license)} |`);
}
lines.push("", `## Rust crates (${rustPackages.size})`, "", "| Crate | Version | Declared license |", "| --- | --- | --- |");
for (const entry of [...rustPackages.values()].sort(compare)) {
  lines.push(`| ${cell(entry.name)} | ${cell(entry.version)} | ${cell(entry.license)} |`);
}
writeFileSync(path.join(root, "THIRD_PARTY_DEPENDENCIES.md"), `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`Wrote THIRD_PARTY_DEPENDENCIES.md: ${npmPackages.size} npm packages, ${rustPackages.size} Rust crates\n`);
