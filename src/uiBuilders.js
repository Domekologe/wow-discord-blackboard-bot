// uiBuilders.js
// Embeds & Buttons (öffentlicher "Aktionen…"-Button) + Tooltip/ItemCard
// Author: Domekologe

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} from "discord.js";
import { t } from "./i18n.js";
import { isModerator } from "./helpers.js";
import { renderItemCard } from "./itemCardRenderer.js";

/* ---- Helpers (Text) ---- */
export function qtyText(order, guildId) {
  if (order.quantityMode === "infinite") return t(guildId, "quantity.infinite");
  const key = order.quantityMode === "stacks" ? "quantity.stacks" : "quantity.items";
  return t(guildId, key, { n: order.quantity });
}
export function rewardToText(order, guildId) {
  const perStack = order.rewardPer === "per_stack";
  if (order.rewardType === "gold") {
    return perStack
      ? t(guildId, "reward.goldPerStack", { n: order.rewardQuantity })
      : t(guildId, "reward.goldPerItem",  { n: order.rewardQuantity });
  }
  return perStack
    ? t(guildId, "reward.itemPerStack", { n: order.rewardQuantity, id: order.rewardItemId })
    : t(guildId, "reward.itemPerItem",  { n: order.rewardQuantity, id: order.rewardItemId });
}
const tr = (g, key, fb) => {
  const v = t(g, key);
  return (!v || v === key) ? fb : v;
};

const itemLabel = (order, g) =>
  order.type === "sell"
    ? (t(g, "fields.sellItem")   || "Gegenstand zum Verkauf")
    : (t(g, "fields.searchedItem") || "Gesuchter Gegenstand");

const rewardLabel = (order, g) =>
  order.type === "sell"
    ? (t(g, "fields.price") || "Preis")
    : (t(g, "fields.reward") || "Belohnung");

const requesterLabel = (order, g) =>
  order.type === "sell"
    ? (t(g, "fields.seller") || "Verkäufer")
    : (t(g, "fields.requester") || "Antragsteller");


/* ---- Tooltip-Model Builder ---- */
function buildTooltipLinesFor(itemInfo, guildId) {
  if (!itemInfo) return [];
  const out = [];
  if (itemInfo.itemLevel != null) out.push(`${t(guildId,"tooltip.itemLevel",{n:itemInfo.itemLevel})}`);
  if (itemInfo.classs) out.push(itemInfo.classs);
  if (itemInfo.stats) {
    for (const s of itemInfo.stats) out.push(String(s.text));
  }
  if (itemInfo.reqLevel) out.push(`${t(guildId,"tooltip.requiresLevel",{n:itemInfo.reqLevel})}`);
  if (itemInfo.equipText) out.push(itemInfo.equipText);
  if (itemInfo.useText)   out.push(itemInfo.useText);
  return out.filter(Boolean);
}

export function buildTooltipModel(info, guildId) {
  if (!info) return [];
  const L = [];

  const lvl = info.itemLevel ?? info.level ?? null;
  if (lvl != null) L.push({ text: t(guildId, "tooltip.itemLevel", { n: lvl }), color: "#ffd100" });

  if (info.subclass && info.inventoryTypeName) {
    L.push({ text: `${info.subclass}, ${info.inventoryTypeName}`, color: "#00a8ff" });
  } else if (info.classs) {
    L.push({ text: info.classs, color: "#00a8ff" });
  }

  if (info.binding)        L.push({ text: info.binding });
  if (info.durabilityText) L.push({ text: info.durabilityText });

  if (info.damageText) L.push({ text: info.damageText });
  if (info.speedText)  L.push({ text: info.speedText });
  if (info.dpsText)    L.push({ text: info.dpsText });
  if (info.armorText)  L.push({ text: info.armorText });

  if (Array.isArray(info.stats)) {
    for (const s of info.stats) L.push({ text: s.text, color: "#1eff00" });
  }

  if (info.equipText) L.push({ text: info.equipText, color: "#00ff98" });
  if (info.useText)   L.push({ text: info.useText,   color: "#1eff00" });

  if (Array.isArray(info.sockets)) {
    for (const sock of info.sockets) {
      L.push({ text: sock.name || "Sockel", color: "#00a8ff", icon: sock.iconUrl });
    }
  }
  if (info.socketBonus)
    L.push({ text: `${t(guildId, "tooltip.socketBonus")}: ${info.socketBonus}`, color: "#00ff98" });

  if (info.reqLevel)        L.push({ text: t(guildId, "tooltip.requiresLevel", { n: info.reqLevel }) });
  if (info.maxStack != null)L.push({ text: t(guildId, "tooltip.maxStack",      { n: info.maxStack }) });

  return L;
}


/* ---- Embed & Itemcard ---- */
export async function buildEmbed(order, itemInfo, rewardInfo, guildId) {
  const titlePrefix = t(guildId, "embed.titlePrefix") || "Blackboard:";
  const desc = (t(guildId, "embed.order", { id: order.id }) || `Order #${order.id}`) +
               (order.closed ? (t(guildId, "embed.closedSuffix") || " — closed") : "");
  const embed = new EmbedBuilder()
    .setColor(order.closed ? 0xcb4335 : 0x2b2d31)
    .setTitle(`${titlePrefix} ${order.title}`)
    .setDescription(`**${desc}**`)
    .addFields(
      { name: requesterLabel(order, guildId), value: `@${order.requester}`, inline: true },
      { name: t(guildId, "fields.requestType") || "Type", value: t(guildId, `wizard.scope.${order.scope}`) || order.scope, inline: true },
      { name: t(guildId, "fields.mode") || "Mode", value: t(guildId, `wizard.mode.${order.mode}`) || order.mode, inline: true  },
      { name: itemLabel(order, guildId), value: `${itemInfo?.name ?? `Item #${order.wowItemId}`} (ID: ${order.wowItemId})`, inline: false },
      { name: t(guildId, "fields.quantity") || "Quantity", value: qtyText(order, guildId), inline: true },
      {
        name: rewardLabel(order, guildId),
        value: rewardToText(order, guildId) + (rewardInfo ? `\n• ${rewardInfo.name} (ID: ${order.rewardItemId})` : ""),
        inline: true
      },
      { name: t(guildId, "fields.claimedBy") || "Claimed by", value: order.takenBy.length ? order.takenBy.map(u => `<@${u}>`).join(", ") : "—", inline: false },
    )
    .setFooter({ text: `Created by ${order.ownerTag}` })
    .setTimestamp();

  if (itemInfo?.iconUrl) embed.setThumbnail(itemInfo.iconUrl);
  embed.setURL(`https://classic.wowhead.com/item=${order.wowItemId}`);

  // Itemkarte
  try {
    const model = buildTooltipModel(itemInfo, guildId);

    const priceBuy = Number.isFinite(itemInfo?.vendorPriceBuy)
      ? {
          g: Math.floor(itemInfo.vendorPriceBuy / 10000) % 1000,
          s: Math.floor(itemInfo.vendorPriceBuy / 100) % 100,
          c: itemInfo.vendorPriceBuy % 100,
        }
      : null;

    const priceSell = Number.isFinite(itemInfo?.vendorPriceSell)
      ? {
          g: Math.floor(itemInfo.vendorPriceSell / 10000) % 1000,
          s: Math.floor(itemInfo.vendorPriceSell / 100) % 100,
          c: itemInfo.vendorPriceSell % 100,
        }
      : null;

    const png = await renderItemCard({
      title: itemInfo?.name ?? `Item #${order.wowItemId}`,
      tooltipModel: model,
      priceBuy,
      priceSell,
      iconUrl: itemInfo?.iconUrl,
      quality: Number(itemInfo?.quality ?? 1),
    });

    const fileName = `itemcard-${order.wowItemId}.png`;
    const attachment = new AttachmentBuilder(png, { name: fileName });
    embed.setImage(`attachment://${fileName}`);
    embed.___attachment = attachment;
  } catch (e) {
    console.error("Render item card failed:", e);
  }

  return embed;
}


/* ---- Öffentlicher Button im Channel-Post ---- */
export function buildPublicButtons(order, guildId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`actions:${order.id}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(tr(guildId, "buttons.actions", "Aktionen…"))
  );
  return [row];
}

/* ---- Personalisierte Buttons (ephemeral) ---- */
export function buildViewerButtons(order, memberOrUser, guildIdForLang) {
  const viewerId = memberOrUser?.user?.id ?? memberOrUser?.id ?? null;
  const isManager =
    (!!viewerId && order.ownerId === viewerId) ||
    isModerator(memberOrUser, guildIdForLang);

  const viewerHasClaim = !!viewerId && order.takenBy.includes(viewerId);
  const canClaim =
    !order.closed && !viewerHasClaim &&
    (order.mode === "multi" || order.takenBy.length === 0);

  const row = new ActionRowBuilder();

  if (canClaim) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`claim:${order.id}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(tr(guildIdForLang, "buttons.claim", "Auftrag annehmen"))
    );
  }
  if (!order.closed && viewerHasClaim) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`unclaim:${order.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(tr(guildIdForLang, "buttons.unclaim", "Auftrag aufgeben"))
    );
  }

  if (isManager) {
    if (order.closed) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`open:${order.id}`).setStyle(ButtonStyle.Primary).setLabel(tr(guildIdForLang,"buttons.open","Auftrag öffnen")),
        new ButtonBuilder().setCustomId(`remove:${order.id}`).setStyle(ButtonStyle.Danger ).setLabel(tr(guildIdForLang,"buttons.remove","Auftrag löschen")),
      );
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId(`close:${order.id}`).setStyle(ButtonStyle.Danger ).setLabel(tr(guildIdForLang,"buttons.close","Auftrag schließen")),
        new ButtonBuilder().setCustomId(`change:${order.id}`).setStyle(ButtonStyle.Primary).setLabel(tr(guildIdForLang,"buttons.change","Auftrag ändern")),
        new ButtonBuilder().setCustomId(`remove:${order.id}`).setStyle(ButtonStyle.Danger ).setLabel(tr(guildIdForLang,"buttons.remove","Auftrag löschen")),
      );
    }
  }

  return row.components.length ? [row] : [];
}

/* ---- Select-Komponenten (Item-Picker) ---- */
export function buildItemSelectComponents(key, candidates, confirmEnabled, selectedId = null, guildId) {
  const options = candidates.slice(0, 25).map(c => ({
    label: c.name.slice(0, 100),
    description: `ID ${c.id}`,
    value: String(c.id),
    default: selectedId !== null && Number(selectedId) === Number(c.id),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`pickitem:${key}`)
    .setPlaceholder("Select the correct item…")
    .addOptions(options)
    .setMinValues(1)
    .setMaxValues(1);

  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirmitem:${key}`).setLabel(t(guildId, "buttons.ok") || "OK").setStyle(ButtonStyle.Primary).setDisabled(!confirmEnabled || selectedId === null),
    new ButtonBuilder().setCustomId(`cancelitem:${key}`).setLabel(t(guildId, "buttons.cancel") || "Cancel").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

export function wizButtonRow(customIdBase, options) {
  const row = new ActionRowBuilder();
  const btns = options.map(opt =>
    new ButtonBuilder()
      .setCustomId(`${customIdBase}:${opt.value}`)
      .setLabel(opt.label)
      .setStyle(opt.style ?? ButtonStyle.Secondary)
  );
  row.addComponents(...btns);
  return row;
}

export async function wizSendWithButtons(dm, text, customIdBase, options) {
  const row = wizButtonRow(customIdBase, options);
  return dm.send({ content: text, components: [row] });
}
