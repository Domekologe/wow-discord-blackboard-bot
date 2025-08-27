// src/localStacks.js
import fs from "node:fs";
import path from "node:path";

let stackMap = null;
let loadedFrom = null;

function resolveStackPath() {
  // ENV > ./data/items.json > ./items.json
  const p =
    process.env.STACK_FILE ||
    path.resolve(process.cwd(), "data/items.json");
  if (fs.existsSync(p)) return p;

  const alt = path.resolve(process.cwd(), "items.json");
  if (fs.existsSync(alt)) return alt;

  return null;
}

export function initLocalStacks() {
  try {
    const file = resolveStackPath();
    if (!file) {
      console.warn("[localStacks] Keine items.json gefunden.");
      stackMap = {};
      return;
    }
    const raw = fs.readFileSync(file, "utf8");
    stackMap = JSON.parse(raw);
    loadedFrom = file;
    console.log(`[localStacks] Stackdaten geladen (${Object.keys(stackMap).length} Einträge) aus ${file}`);

    // Optional: Hot-Reload wenn Datei sich ändert
    fs.watchFile(file, { interval: 3000 }, () => {
      try {
        const raw2 = fs.readFileSync(file, "utf8");
        stackMap = JSON.parse(raw2);
        console.log(`[localStacks] Stackdaten neu geladen (${Object.keys(stackMap).length} Einträge).`);
      } catch (e) {
        console.warn("[localStacks] Reload fehlgeschlagen:", e.message);
      }
    });
  } catch (e) {
    console.warn("[localStacks] Laden fehlgeschlagen:", e.message);
    stackMap = {};
  }
}

export function getLocalStackSize(itemId) {
  if (!stackMap) initLocalStacks();
  if (!stackMap) return null;
  const key1 = String(itemId);
  const v = stackMap[key1];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
