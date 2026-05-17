// scripts/build-userscript.js
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json");
const VERSION_CHECKER_PATH = path.join(
  ROOT_DIR,
  "src",
  "utils",
  "versionChecker.ts",
);
const DASHBOARD_CHANGELOG_PATH = path.join(
  ROOT_DIR,
  "src",
  "ui",
  "sections",
  "changelog.ts",
);

function readFileOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function extractPackageVersion() {
  const raw = readFileOrThrow(PACKAGE_JSON_PATH);
  const pkg = JSON.parse(raw);
  const version = String(pkg.version || "").trim();
  if (!version) {
    throw new Error(`Missing "version" in ${PACKAGE_JSON_PATH}`);
  }
  return version;
}

function extractCurrentVersionConstant() {
  const source = readFileOrThrow(VERSION_CHECKER_PATH);
  const match = source.match(
    /const\s+CURRENT_VERSION\s*=\s*['"]([0-9]+(?:\.[0-9]+)*)['"]/,
  );
  if (!match?.[1]) {
    throw new Error(
      `Unable to read CURRENT_VERSION from ${VERSION_CHECKER_PATH}`,
    );
  }
  return match[1];
}

function extractDashboardChangelogLatestVersion() {
  const source = readFileOrThrow(DASHBOARD_CHANGELOG_PATH);
  const match = source.match(
    /const\s+CHANGELOG[\s\S]*?\[\s*\{\s*version:\s*['"]([0-9]+(?:\.[0-9]+)*)['"]/,
  );
  if (!match?.[1]) {
    throw new Error(
      `Unable to read CHANGELOG[0].version from ${DASHBOARD_CHANGELOG_PATH}`,
    );
  }
  return match[1];
}

function validateVersionSync(packageVersion) {
  const headerVersionMatch = USERSCRIPT_HEADER.match(
    /@version\s+([0-9]+(?:\.[0-9]+)*)/,
  );
  const headerVersion = headerVersionMatch?.[1] || "";
  const currentVersion = extractCurrentVersionConstant();
  const changelogVersion = extractDashboardChangelogLatestVersion();

  const errors = [];
  if (headerVersion !== packageVersion) {
    errors.push(
      `Userscript header @version (${headerVersion || "missing"}) does not match package.json (${packageVersion})`,
    );
  }
  if (currentVersion !== packageVersion) {
    errors.push(
      `CURRENT_VERSION (${currentVersion}) does not match package.json (${packageVersion})`,
    );
  }
  if (changelogVersion !== packageVersion) {
    errors.push(
      `Dashboard CHANGELOG latest version (${changelogVersion}) does not match package.json (${packageVersion})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Version sync check failed.",
        ...errors.map((e) => `- ${e}`),
        "Release requirement: every version bump must also update src/ui/sections/changelog.ts CHANGELOG[0].",
      ].join("\n"),
    );
  }
}

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         QPM (ALPHA)
// @namespace    Quinoa
// @version      3.2.12
// @description  Quality-of-life enhancements for Magic Garden: crop type locking, mutation tracking, value calculator, harvest reminders, journal species checker, and persistent feed statistics.
// @author       TOKYO.#6464
// @match        https://1227719606223765687.discordsays.com/*
// @match        https://magiccircle.gg/r/*
// @match        https://magicgarden.gg/r/*
// @match        https://starweaver.org/r/*
// @connect      magicgarden.gg
// @connect      magiccircle.gg
// @connect      starweaver.org
// @connect      1227719606223765687.discordsays.com
// @connect      ariesmod-api.ariedam.fr
// @connect      mg-api.ariedam.fr
// @connect      xjuvryjgrjchbhjixwzh.supabase.co
// @updateURL    https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/dist/QPM.user.js
// @downloadURL  https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/dist/QPM.user.js
// @run-at       document-start
// @inject-into  page
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @connect      raw.githubusercontent.com
// @grant        GM_openInTab
// @grant        unsafeWindow
// ==/UserScript==

(function() {

`;

const USERSCRIPT_FOOTER = `
})();`;

function buildUserscript() {
  console.log("Building userscript wrapper...");

  try {
    const packageVersion = extractPackageVersion();
    validateVersionSync(packageVersion);

    const builtFile = path.join(
      __dirname,
      "..",
      "dist",
      "quinoa-pet-manager.iife.js",
    );

    if (!fs.existsSync(builtFile)) {
      throw new Error(
        `Bundle not found: ${builtFile}. Run "npm run build" (or "npm run build:bundle") first.`,
      );
    }

    const builtCode = fs.readFileSync(builtFile, "utf8");

    // Remove any source map references
    const cleanedCode = builtCode.replace(/\/\/# sourceMappingURL=.*$/gm, "");

    const userscript = USERSCRIPT_HEADER + cleanedCode + USERSCRIPT_FOOTER;

    const outputPath = path.join(__dirname, "..", "dist", "QPM.user.js");
    fs.writeFileSync(outputPath, userscript, "utf8");

    console.log("Userscript built successfully.");
    console.log(`Output: ${outputPath}`);
    console.log(`Size: ${Math.round(userscript.length / 1024)}KB`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Build failed:", message);
    process.exit(1);
  }
}

buildUserscript();
