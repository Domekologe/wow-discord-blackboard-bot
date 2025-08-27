// storage.js
// Per-guild JSON persistence for BUY orders
// Comments: English
// Author: Domekologe

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Preferred data dir: projectRoot/data  (projectRoot = one level above this file)
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PREFERRED_DIR = path.resolve(PROJECT_ROOT, "data");

// Fallback (old path some users had): cwd/data
const FALLBACK_DIR = path.resolve(process.cwd(), "data");

// Env override if you want: DATA_DIR=/absolute/path
const ENV_DIR = process.env.DATA_DIR && path.isAbsolute(process.env.DATA_DIR)
  ? process.env.DATA_DIR
  : null;

// Resolve final dir (prefer ENV → preferred → fallback)
function resolveDataDir() {
  const dir = ENV_DIR || PREFERRED_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const DATA_DIR = resolveDataDir();

// if preferred dir is empty but fallback has files, read from fallback too
const CANDIDATE_DIRS = [DATA_DIR];
if (FALLBACK_DIR !== DATA_DIR && fs.existsSync(FALLBACK_DIR)) {
  CANDIDATE_DIRS.push(FALLBACK_DIR);
}

function fileFor(guildId) {
  return path.join(DATA_DIR, `orders-${guildId}.json`);
}

function readJsonSafe(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonAtomic(fp, obj) {
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

// Normalize legacy/partial orders
function normalizeOrder(o) {
  return {
    ...o,
    takenBy: Array.isArray(o.takenBy) ? o.takenBy : [],
    closed: !!o.closed,
  };
}

export function loadOrders(guildId) {
  // try main dir first, then fallbacks
  for (const dir of CANDIDATE_DIRS) {
    const fp = path.join(dir, `orders-${guildId}.json`);
    const data = readJsonSafe(fp);
    if (Array.isArray(data)) return data.map(normalizeOrder);
  }
  return [];
}

export function saveOrders(guildId, arr) {
  const fp = fileFor(guildId);
  writeJsonAtomic(fp, Array.isArray(arr) ? arr : []);
}
