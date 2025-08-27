// scripts/render-item.js
import { mkdirSync, writeFileSync } from "node:fs";
import { getItemInfo } from "./src/blizzardApi.js";
import { renderItemCard } from "./src/itemCardRenderer.js";
import { buildTooltipModel } from "./src/uiBuilders.js";

const id = Number(process.argv[2]);
if (!id) throw new Error("Usage: node scripts/render-item.js <itemId>");

const info = await getItemInfo(id);
mkdirSync("./debug", { recursive: true });
writeFileSync(`./debug/item-${id}-info.json`, JSON.stringify(info, null, 2));

const model = buildTooltipModel(info, "debug");
writeFileSync(`./debug/item-${id}-model.json`, JSON.stringify(model, null, 2));

const png = await renderItemCard({
  title: info?.name ?? `Item #${id}`,
  tooltipModel: model,
  price: info?.vendorPrice ? {
    g: Math.floor(info.vendorPrice/10000)%1000,
    s: Math.floor(info.vendorPrice/100)%100,
    c: info.vendorPrice%100,
  } : null,
  iconUrl: info?.iconUrl,
  quality: Number(info?.quality ?? 1),
});
writeFileSync(`./debug/item-${id}.png`, png);
console.log("Wrote ./debug files");
