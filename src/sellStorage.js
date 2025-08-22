// sellStorage.js
// Per-guild JSON storage for SELL entries
// Author: Domekologe

import fs from "fs";
import path from "path";

const DIR = path.resolve("./data");
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function fileFor(guildId) {
  return path.join(DIR, `sell_${guildId}.json`);
}

export function loadSell(guildId) {
  try {
    const p = fileFor(guildId);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSell(guildId, arr) {
  try {
    const p = fileFor(guildId);
    fs.writeFileSync(p, JSON.stringify(arr, null, 2), "utf8");
  } catch {}
}
