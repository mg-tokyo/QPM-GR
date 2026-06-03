import { notify } from "../core/notifications";
import { storage } from "./storage";
import { visibleInterval } from "./timerManager";

const CURRENT_VERSION = "3.2.22"; // This should match package.json version
export const GITHUB_URL = "https://github.com/mg-tokyo/QPM-GR";
export const UPDATE_URL =
  "https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/dist/QPM.user.js";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = "qpm.versionCheck.v1";

type GmXhr = (input: {
  method: "GET";
  url: string;
  headers?: Record<string, string>;
  onload: (response: { responseText: string; status: number }) => void;
  onerror: (error: unknown) => void;
}) => void;

const getGmXhr = (): GmXhr | undefined => {
  const globalAny = globalThis as any;
  return globalAny.GM_xmlhttpRequest || globalAny.GM?.xmlHttpRequest;
};

// Use GM_xmlhttpRequest when available to bypass CORS in userscript sandbox.
const fetchText = async (url: string): Promise<string> => {
  const gmXhr = getGmXhr();
  if (gmXhr) {
    return new Promise((resolve, reject) => {
      gmXhr({
        method: "GET",
        url,
        headers: { "Cache-Control": "no-cache" },
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(
              new Error(`GM request failed with status ${response.status}`),
            );
          }
        },
        onerror: (error) => reject(error),
      });
    });
  }

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

export type VersionStatus = "current" | "outdated" | "checking" | "error";

export interface VersionInfo {
  current: string;
  latest: string | null;
  status: VersionStatus;
  updateUrl: string;
  checkedAt: number | null;
}

interface PersistedVersionCheck {
  latest: string;
  status: VersionStatus;
  checkedAt: number;
}

function loadPersistedCheck(): Partial<VersionInfo> {
  const saved = storage.get<PersistedVersionCheck | null>(STORAGE_KEY, null);
  if (!saved || typeof saved.latest !== "string") return {};
  const cmp = compareSemver(saved.latest, CURRENT_VERSION);
  const status: VersionStatus = cmp > 0 ? "outdated" : "current";
  return { latest: saved.latest, status, checkedAt: saved.checkedAt ?? null };
}

function persistCheck(info: VersionInfo): void {
  if (!info.latest) return;
  const data: PersistedVersionCheck = {
    latest: info.latest,
    status: info.status,
    checkedAt: info.checkedAt ?? Date.now(),
  };
  storage.set(STORAGE_KEY, data);
}

const persisted = loadPersistedCheck();
let cached: VersionInfo = {
  current: CURRENT_VERSION,
  latest: persisted.latest ?? null,
  status: persisted.status ?? "checking",
  updateUrl: UPDATE_URL,
  checkedAt: persisted.checkedAt ?? null,
};

const listeners = new Set<(info: VersionInfo) => void>();
let started = false;
let timerCleanup: (() => void) | null = null;
let notifiedOutdated = false;

function emit(): void {
  listeners.forEach((cb) => {
    try {
      cb(cached);
    } catch (error) {
      console.error("[QPM] Version listener error", error);
    }
  });
}

function compareSemver(a: string, b: string): number {
  const toNums = (v: string) =>
    v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const aa = toNums(a);
  const bb = toNums(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const url = `${UPDATE_URL}?t=${Date.now()}`;
    const text = await fetchText(url);
    const headerMatch = text.match(/@version\s+([0-9]+(?:\.[0-9]+)*)/);
    if (headerMatch?.[1]) return headerMatch[1];
    const constMatch = text.match(
      /const\s+CURRENT_VERSION\s*=\s*['"]([0-9.]+)['"]/,
    );
    if (constMatch?.[1]) return constMatch[1];
  } catch (error) {
    console.error("[QPM] Version fetch failed", error);
  }
  return null;
}

/**
 * Get current version info (no network checks)
 */
export function getVersionInfo(): VersionInfo {
  return { ...cached };
}

/**
 * Register callback for version changes
 */
export function onVersionChange(
  callback: (info: VersionInfo) => void,
): () => void {
  listeners.add(callback);
  callback(getVersionInfo());
  return () => listeners.delete(callback);
}

export function startVersionChecker(): void {
  if (started) return;
  started = true;
  void checkForUpdates(true);
  timerCleanup = visibleInterval(
    "version-checker",
    () => void checkForUpdates(false),
    CHECK_INTERVAL_MS,
  );
}

/**
 * Get current version string
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}

/**
 * Check for updates and update cached status
 */
export async function checkForUpdates(_force = false): Promise<VersionInfo> {
  cached = { ...cached, status: "checking" };
  emit();

  const latest = await fetchRemoteVersion();
  const now = Date.now();

  if (!latest) {
    cached = {
      ...cached,
      latest: cached.latest,
      status: "error",
      checkedAt: now,
    };
    emit();
    return getVersionInfo();
  }

  const cmp = compareSemver(latest, CURRENT_VERSION);
  const status: VersionStatus = cmp > 0 ? "outdated" : "current";
  cached = {
    current: CURRENT_VERSION,
    latest,
    status,
    updateUrl: UPDATE_URL,
    checkedAt: now,
  };
  persistCheck(cached);

  if (status === "outdated" && !notifiedOutdated) {
    notifiedOutdated = true;
    notify({
      feature: "versionChecker",
      level: "info",
      message: `QPM update available: v${CURRENT_VERSION} → v${latest}`,
    });
  }

  emit();
  return getVersionInfo();
}
