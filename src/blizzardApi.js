// blizzardApi.js
// Blizzard API helpers (token, item info, search)
// Comments in English
// Author: Domekologe

import fs from "node:fs";
import { getLocalStackSize, initLocalStacks } from "./localStacks.js";

const BLIZZ_REGION = process.env.BLIZZ_REGION || "eu";
const BLIZZ_LOCALE = process.env.BLIZZ_LOCALE || "de_DE";
const BLIZZ_ID     = process.env.BLIZZ_CLIENT_ID;
const BLIZZ_SECRET = process.env.BLIZZ_CLIENT_SECRET;

let blizzToken = null;
let blizzTokenExpiry = 0;

initLocalStacks();

export async function getBlizzToken() {
  if (!BLIZZ_ID || !BLIZZ_SECRET) return null;
  const now = Date.now();
  if (blizzToken && now < blizzTokenExpiry - 30000) return blizzToken;

  const resp = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: BLIZZ_ID,
      client_secret: BLIZZ_SECRET,
    }),
  }).catch(()=>null);
  if (!resp || !resp.ok) return null;
  const data = await resp.json();
  blizzToken = data.access_token;
  blizzTokenExpiry = Date.now() + data.expires_in * 1000;
  return blizzToken;
}

export async function getItemInfo(itemId) {
  try {
    const token = await getBlizzToken();
    if (!token) return { id: itemId, name: `Item #${itemId}`, iconUrl: null };

    const region = BLIZZ_REGION;
    const locale = BLIZZ_LOCALE;
    const nsStatic  = process.env.BLIZZ_NAMESPACE_STATIC  || `static-classic-${region}`;
    const nsDynamic = process.env.BLIZZ_NAMESPACE_DYNAMIC || `dynamic-classic-${region}`;
    const nsMedia   = process.env.BLIZZ_NAMESPACE_MEDIA   || `static-classic-${region}`;

    // Stammdaten + Media parallel holen
    const [item, media] = await Promise.all([
      fetch(`https://${region}.api.blizzard.com/data/wow/item/${itemId}?namespace=${encodeURIComponent(nsStatic)}&locale=${encodeURIComponent(locale)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
      fetch(`https://${region}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=${encodeURIComponent(nsMedia)}&locale=${encodeURIComponent(locale)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
    ]);

    // Falls im static kein preview_item steckt, versuch dynamic
    let itemDyn = null;
    if (!item?.preview_item) {
      itemDyn = await fetch(`https://${region}.api.blizzard.com/data/wow/item/${itemId}?namespace=${encodeURIComponent(nsDynamic)}&locale=${encodeURIComponent(locale)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null);
    }

    const preview = item?.preview_item || itemDyn?.preview_item || null;

    const iconUrl = media?.assets?.find(a => a.key === "icon")?.value || null;

    // Qualität → Zahl 0..7 (für Farbcodes)
    const QUALITY_ID = { POOR:0, COMMON:1, UNCOMMON:2, RARE:3, EPIC:4, LEGENDARY:5, ARTIFACT:6, HEIRLOOM:7 };
    const qualityType = item?.quality?.type || preview?.quality?.type || null;
    const quality = QUALITY_ID[qualityType] ?? null;

    // Stats als Anzeigetexte
    const statTexts = Array.isArray(preview?.stats)
      ? preview.stats
          .map(s => s?.display?.display_string || s?.display_string)
          .filter(Boolean)
      : [];

    // Sockel (bei Classic oft leer)
    const sockets = Array.isArray(preview?.sockets)
      ? preview.sockets.map(s => ({
          name: s?.display_string || s?.socket_type?.name || "Sockel",
          iconUrl: s?.socket_type?.icon || null,
        }))
      : [];

    // Weapon/Armor Anzeigen
    const damageText = preview?.weapon?.damage?.display_string || null;
    const speedText  = preview?.weapon?.attack_speed?.display_string || null;
    const dpsText    = preview?.weapon?.dps?.display_string || null; // optional
    const armorText  = preview?.armor?.display?.display_string || preview?.armor?.display_string || null;

    // Spells → „Anlegen:“/„Benutzen:“ Zeilen
    const spellDescs = Array.isArray(preview?.spells) ? preview.spells.map(s => s.description).filter(Boolean) : [];
    const equipText = spellDescs.find(d => d.startsWith("Anlegen:")) || null;
    const useText   = spellDescs.find(d => d.startsWith("Benutzen:")) || null;

    // Anforderungen/Bindung/Haltbarkeit
    const reqLevel = preview?.requirements?.level?.value ?? item?.required_level ?? null;
    const binding  = preview?.binding?.name || null;
    const durabilityText = preview?.durability?.display_string || null;

    // Klassen/Typ
    const classs      = item?.item_class?.name || preview?.item_class?.name || null;
    const subclass    = item?.item_subclass?.name || preview?.item_subclass?.name || null;
    const inventory   = item?.inventory_type?.name || preview?.inventory_type?.name || null;

    // Preise
    const vendorPriceBuy = item?.purchase_price ?? null;
    const vendorPriceSell = item?.sell_price ?? null;
    const vendorDisplay  = preview?.sell_price?.display_strings || null;
    //const vendorPrice = vendorPriceNum ?? null;

    const blizzStack = Number(item?.max_stack_size);
    let maxStack = Number.isFinite(blizzStack) && blizzStack > 1 ? blizzStack : null;

    // lokales items.json-Fallback
    if (!maxStack) {
      const local = getLocalStackSize(itemId);
      if (Number.isFinite(local) && local > 1) {
        maxStack = local;
        if (process.env.STACK_DEBUG) {
          console.log(`[STACK] Fallback genutzt für ${itemId}: ${local}`);
        }
      } else if (process.env.STACK_DEBUG) {
        console.log(`[STACK] Keine Stacksize in API und lokal für ${itemId}`);
      }
    }

    // optional: Händler-Packgröße exponieren (falls du das später brauchst)
    const vendorPackSize = Number.isFinite(Number(item?.purchase_quantity)) ? Number(item?.purchase_quantity) : null;

    return {
      id: itemId,
      name: item?.name || preview?.name || `Item #${itemId}`,
      iconUrl,
      quality,
      qualityName: item?.quality?.name || preview?.quality?.name || null,

      // Basics
      itemLevel: item?.level ?? null,
      reqLevel,
      classs,
      subclass,
      inventoryTypeName: inventory,

      // Anzeigezeilen
      stats: statTexts.map(text => ({ text })),
      sockets,
      socketBonus: preview?.socket_bonus?.display_string || null,
      damageText,
      speedText,
      dpsText,
      armorText,
      equipText,
      useText,
      binding,
      durabilityText,

      // Stack/Preis
      maxStack,             // <-- jetzt korrekt mit lokalem Fallback
      vendorPackSize,       // <-- optional: Händler verkauft in Xer-Packs
      vendorPriceBuy,
      vendorPriceSell,
      vendorDisplay,
    };
  } catch {
    return { id: itemId, name: `Item #${itemId}`, iconUrl: null };
  }
}


export async function searchItemsByName(query) {
  const token = await getBlizzToken();
  if (!token) return [];
  const region = BLIZZ_REGION;
  const locale = BLIZZ_LOCALE || "en_US";

  const namespaces = [
    process.env.BLIZZ_NAMESPACE_STATIC || `static-classic-${region}`,
    `static-${region}`,
  ];

  const results = [];
  for (const ns of namespaces) {
    const url =
      `https://${region}.api.blizzard.com/data/wow/search/item` +
      `?namespace=${encodeURIComponent(ns)}` +
      `&name.${encodeURIComponent(locale)}=${encodeURIComponent(query)}` +
      `&_page=1&_pageSize=10&orderby=id`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res || !res.ok) continue;
    const data = await res.json().catch(() => null);
    const hits = (data?.results || []).map(r => ({ id: r?.data?.id })).filter(x => x.id);
    for (const h of hits) {
      const info = await getItemInfo(h.id);
      results.push({ id: h.id, name: info.name || `Item #${h.id}` });
    }
    if (results.length) break;
  }
  const seen = new Set();
  return results.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
