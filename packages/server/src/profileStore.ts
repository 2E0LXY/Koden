import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsSchema, type Settings } from "@koden/shared";

const DATA_DIR = process.env.KODEN_DATA_DIR ?? join(process.cwd(), "data", "profiles");
// Generous ceiling for a hand-rolled JSON settings blob (a full profile is a
// few KB) -- just enough to stop a misbehaving/malicious client from
// growing a file without bound.
const MAX_JSON_BYTES = 64 * 1024;

function pathFor(callsign: string): string {
  const safe = callsign.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return join(DATA_DIR, `${safe}.json`);
}

export function loadSettings(callsign: string): Settings | null {
  try {
    const raw = readFileSync(pathFor(callsign), "utf8");
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // No saved profile yet, or the file is unreadable/corrupt -- either way
    // the caller just falls back to defaults.
    return null;
  }
}

export function saveSettings(callsign: string, settings: Settings): void {
  try {
    const json = JSON.stringify(settings);
    if (json.length > MAX_JSON_BYTES) return;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(pathFor(callsign), json);
  } catch {
    // Best-effort; profile persistence isn't essential to a working session.
  }
}
