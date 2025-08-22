// guildConfig.js
// Per-guild configuration (JSON file)
// Author: Domekologe

import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_CFG = {
  lang: "en",
  modRoleIds: [],
  allowedChannelIds: [],
};

function cfgFile(guildId) {
  return path.join(DATA_DIR, `config_${guildId}.json`);
}

export function loadConfig(guildId) {
  const f = cfgFile(guildId);
  if (!fs.existsSync(f)) return { ...DEFAULT_CFG };
  try {
    const raw = fs.readFileSync(f, "utf-8");
    const parsed = JSON.parse(raw);
    // mit Defaults mergen, falls Felder fehlen
    return { ...DEFAULT_CFG, ...(parsed || {}) };
  } catch (e) {
    console.error("⚠️ Error reading config, using defaults:", e?.message || e);
    return { ...DEFAULT_CFG };
  }
}

export function saveConfig(guildId, cfg) {
  try {
    const merged = { ...DEFAULT_CFG, ...(cfg || {}) };
    fs.writeFileSync(cfgFile(guildId), JSON.stringify(merged, null, 2), "utf-8");
  } catch (e) {
    console.error("❌ Error saving config:", e);
  }
}
