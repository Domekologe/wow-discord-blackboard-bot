// storage.js
// Simple JSON storage for Blackboard orders per guild
// Author: Domekologe

import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

export function loadOrders(guildId) {
  const file = path.join(DATA_DIR, `blackboard_${guildId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("❌ Error loading orders for", guildId, e);
    return [];
  }
}

export function saveOrders(guildId, orders) {
  const file = path.join(DATA_DIR, `blackboard_${guildId}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(orders, null, 2), "utf-8");
  } catch (e) {
    console.error("❌ Error saving orders for", guildId, e);
  }
}
