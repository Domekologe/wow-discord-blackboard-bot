// Simple JSON file storage for templates (per guild)
// Author: Domekologe

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const base = path.join(__dirname, '..', 'data');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function getGuildStorePath(guildId) {
  ensureDir(base);
  return path.join(base, `${guildId}.json`);
}

export function readGuildData(guildId) {
  const p = getGuildStorePath(guildId);
  if (!fs.existsSync(p)) return { templates: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { templates: {} };
  }
}

export function writeGuildData(guildId, data) {
  const p = getGuildStorePath(guildId);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
