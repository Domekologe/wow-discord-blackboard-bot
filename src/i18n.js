// i18n.js
// Simple localization loader for en/de with per-guild language
// Author: Domekologe

import fs from "fs";
import path from "path";
import { loadConfig, saveConfig } from "./guildConfig.js";

const LOCALE_DIR = path.resolve("./locales");
const dictionaries = {
  en: JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, "en.json"), "utf-8")),
  de: JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, "de.json"), "utf-8"))
};

export function getLang(guildId) {
  const cfg = loadConfig(guildId);
  return (cfg.lang === "de" || cfg.lang === "en") ? cfg.lang : "en";
}

export function setLang(guildId, lang) {
  const cfg = loadConfig(guildId);
  cfg.lang = (lang === "de") ? "de" : "en";
  saveConfig(guildId, cfg);
  return cfg.lang;
}

function getByPath(obj, key) {
  return key.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
}

function format(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function t(guildId, key, vars) {
  const lang = getLang(guildId);
  const dict = dictionaries[lang] || dictionaries.en;
  const fallback = dictionaries.en;
  const val = getByPath(dict, key) ?? getByPath(fallback, key) ?? key;
  return format(val, vars);
}
