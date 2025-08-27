// helpers.js
// Small helpers + runtime state
// Comments in English
// Author: Domekologe

import { PermissionsBitField } from "discord.js";
import { loadConfig } from "./guildConfig.js";
import { t } from "./i18n.js";

// Per-guild ID counters (orders/sell etc.)
export const counters = {};
export function nextId(guildId) {
  counters[guildId] = (counters[guildId] || 0) + 1;
  return counters[guildId];
}

export function isNumeric(str) {
  return /^\d+$/.test(String(str).trim());
}

export function isModerator(member, guildId) {
  try {
    if (member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) return true;
  } catch {}
  const cfg = loadConfig(guildId);
  const ids = cfg?.modRoleIds || [];
  return member?.roles?.cache?.some(r => ids.includes(r.id)) || false;
}

export function ensureAllowedChannel(interaction) {
  const cfg = loadConfig(interaction.guildId);
  const allowed = cfg?.allowedChannelIds || [];
  if (allowed.length && !allowed.includes(interaction.channelId)) {
    interaction.reply({ content: t(interaction.guildId, "msg.notAllowedChannel") || "This command is not allowed here.", ephemeral: true }).catch(()=>{});
    return false;
  }
  return true;
}

export function wizKey(guildId, userId) {
  return `${guildId}~${userId}`;
}

export function enforceTitlePrefix(type, title, guildId) {
  const raw = String(title || "");
  // vorhandene Präfixe (ankauf/verkauf/buy/sell) am Anfang entfernen – case-insensitive
  const cleaned = raw.replace(/^\s*(ankauf:|verkauf:|buy:|sell:)\s*/i, "").trim();

  const buyP  = (t(guildId, "title.prefix.buy")  || "ANKAUF: ");
  const sellP = (t(guildId, "title.prefix.sell") || "VERKAUF: ");
  const pref  = String(type).toLowerCase() === "sell" ? sellP : buyP;

  return pref + cleaned;
}

export function tt(guildId, type, key) {
  const sellKey = `sell.${key}`;
  return t(guildId, type === "sell" ? sellKey : key) || t(guildId, key) || null;
}