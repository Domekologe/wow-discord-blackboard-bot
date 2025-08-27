// sellStorage.js
// Per-guild JSON persistence for SELL entries
// Comments: English
// Author: Domekologe

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PREFERRED_DIR = path.resolve(PROJECT_ROOT, "data");
const FALLBACK_DIR  = path.resolve(process.cwd(), "data");
const ENV_DIR = process.env.DATA_DIR && path.isAbsolute(process.env.DATA_DIR)
  ? process.env.DATA_DIR
  : null;

function resolveDataDir() {
  const dir = ENV_DIR || PREFERRED_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const DATA_DIR = resolveDataDir();

const CANDIDATE_DIRS = [DATA_DIR];
if (FALLBACK_DIR !== DATA_DIR && fs.existsSync(FALLBACK_DIR)) {
  CANDIDATE_DIRS.push(FALLBACK_DIR);
}

function fileFor(guildId) {
  return path.join(DATA_DIR, `sell-${guildId}.json`);
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

// Normalize legacy/partial records to avoid runtime crashes
function normalizeSell(x) {
  return {
    id: x.id ?? null,
    title: x.title ?? "",
    seller: x.seller ?? "",
    sellerId: x.sellerId ?? x.ownerId ?? null,
    quantityMode: x.quantityMode ?? "items",
    quantity: x.quantity ?? null,
    mode: x.mode ?? "multi",
    scope: x.scope ?? "personal",
    priceType: x.priceType ?? "gold",
    priceQuantity: Number.isFinite(x.priceQuantity) ? x.priceQuantity : 0,
    priceItemId: x.priceItemId ?? null,
    pricePer: x.pricePer ?? "per_item",
    ownerId: x.ownerId ?? x.sellerId ?? null,
    ownerTag: x.ownerTag ?? "",
    takenBy: Array.isArray(x.takenBy) ? x.takenBy : [],
    channelId: x.channelId ?? null,
    messageId: x.messageId ?? null,
    closed: !!x.closed,
    wowItemId: x.wowItemId ?? null,
  };
}

export function loadSell(guildId) {
  for (const dir of CANDIDATE_DIRS) {
    const fp = path.join(dir, `sell-${guildId}.json`);
    const data = readJsonSafe(fp);
    if (Array.isArray(data)) return data.map(normalizeSell);
  }
  return [];
}

export function saveSell(guildId, arr) {
  const fp = fileFor(guildId);
  writeJsonAtomic(fp, Array.isArray(arr) ? arr : []);
}
