// index.js
// Blackboard Bot main runtime
// - Localized via /locales/{en,de}.json and i18n.js
// - Buttons: Claim / Unclaim / Close / Change / Remove
// - Per-guild JSON persistence
// - Blizzard API lookup for item meta & icon
// - DM Wizard (/wizard-bb) to create/change orders (DM text-based flow; only dropdown when multiple items found)
// Author: Domekologe

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
  StringSelectMenuBuilder,
  Partials,
} from "discord.js";
import { config } from "dotenv";
import { loadOrders, saveOrders } from "./storage.js";
import { t, getLang, setLang } from "./i18n.js";
import { loadConfig, saveConfig } from "./guildConfig.js";
import { registerSellFeature } from "./sellFeature.js";


config();

/* ---------------- Blizzard API helpers ---------------- */
const BLIZZ_REGION = process.env.BLIZZ_REGION || "eu";
const BLIZZ_LOCALE = process.env.BLIZZ_LOCALE || "en_GB";
const BLIZZ_ID     = process.env.BLIZZ_CLIENT_ID;
const BLIZZ_SECRET = process.env.BLIZZ_CLIENT_SECRET;

let blizzToken = null;
let blizzTokenExpiry = 0;

// temporary states
const pendingItemPicks = new Map(); // item/reward/lang pick states (non-wizard /create-bb flow)
const wizardSessions   = new Map(); // DM wizard sessions, key = `${guildId}~${userId}`

// runtime counters per guild
const counters = {};
function nextId(guildId) { counters[guildId] = (counters[guildId] || 0) + 1; return counters[guildId]; }

/* ---------------- Small helpers ---------------- */
function isNumeric(str) { return /^\d+$/.test(String(str).trim()); }

function isModerator(member, guildId) {
  if (member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) return true;
  const cfg = loadConfig(guildId);
  const ids = cfg?.modRoleIds || [];
  return member?.roles?.cache?.some(r => ids.includes(r.id)) || false;
}

function ensureAllowedChannel(interaction) {
  const cfg = loadConfig(interaction.guildId);
  const allowed = cfg?.allowedChannelIds || [];
  if (allowed.length && !allowed.includes(interaction.channelId)) {
    interaction.reply({ content: t(interaction.guildId, "msg.notAllowedChannel"), ephemeral: true });
    return false;
  }
  return true;
}

function wizKey(guildId, userId) {
  return `${guildId}~${userId}`;
}

/* ---------------- Blizzard API ---------------- */
async function getBlizzToken() {
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
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  blizzToken = data.access_token;
  blizzTokenExpiry = Date.now() + data.expires_in * 1000;
  return blizzToken;
}

async function getItemInfo(itemId) {
  try {
    const token = await getBlizzToken();
    if (!token) return { name: `Item #${itemId}`, iconUrl: null };

    const ns      = process.env.BLIZZ_NAMESPACE_STATIC || `static-classic-${BLIZZ_REGION}`;
    const mediaNs = process.env.BLIZZ_NAMESPACE_MEDIA  || `static-classic-${BLIZZ_REGION}`;

    // Base item data
    const itemRes = await fetch(
      `https://${BLIZZ_REGION}.api.blizzard.com/data/wow/item/${itemId}?namespace=${ns}&locale=${BLIZZ_LOCALE}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!itemRes.ok) return { name: `Item #${itemId}`, iconUrl: null };
    const item = await itemRes.json();

    // Icon
    const mediaRes = await fetch(
      `https://${BLIZZ_REGION}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=${mediaNs}&locale=${BLIZZ_LOCALE}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    let iconUrl = null;
    if (mediaRes.ok) {
      const media = await mediaRes.json();
      const asset = (media.assets || []).find(a => a.key === "icon");
      if (asset) iconUrl = asset.value;
    }

    return {
      name: item.name || `Item #${itemId}`,
      iconUrl,
      level: item.level ?? null,
      maxStack: item.max_stack_size ?? null,
      qualityName: item.quality?.name ?? null,
    };
  } catch {
    return { name: `Item #${itemId}`, iconUrl: null };
  }
}

async function searchItemsByName(query) {
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

/* ---------------- UI builders (localized) ---------------- */
function qtyText(order, guildId) {
  if (order.quantityMode === "infinite") return t(guildId, "quantity.infinite");
  const key = order.quantityMode === "stacks" ? "quantity.stacks" : "quantity.items";
  return t(guildId, key, { n: order.quantity });
}

function rewardToText(order, guildId) {
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

function buildTooltipBlock(guildId, meta) {
  if (!meta) return "";
  const lines = [];
  if (meta.qualityName) lines.push(meta.qualityName);
  if (meta.level != null)    lines.push(t(guildId, "tooltip.itemLevel", { n: meta.level }));
  if (meta.maxStack != null) lines.push(t(guildId, "tooltip.maxStack",  { n: meta.maxStack }));
  if (!lines.length) return "";
  return "```fix\n" + lines.join("\n") + "\n```";
}

function buildEmbed(order, itemInfo, rewardInfo, guildId) {
  const titlePrefix = t(guildId, "embed.titlePrefix");
  const desc = t(guildId, "embed.order", { id: order.id }) + (order.closed ? t(guildId, "embed.closedSuffix") : "");
  const embed = new EmbedBuilder()
    .setColor(order.closed ? 0xcb4335 : 0x2b2d31)
    .setTitle(`${titlePrefix} ${order.title}`)
    .setDescription(`**${desc}**`)
    .addFields(
      { name: t(guildId, "fields.requester"),    value: `@${order.requester}`, inline: true },
      { name: t(guildId, "fields.requestType"),  value: t(guildId, `wizard.scope.${order.scope}`) || order.scope, inline: true },
      { name: t(guildId, "fields.mode"),         value: t(guildId, `wizard.mode.${order.mode}`) || order.mode, inline: true  },
      { name: t(guildId, "fields.searchedItem"), value: `${itemInfo?.name ?? `Item #${order.wowItemId}`} (ID: ${order.wowItemId})`, inline: false },
      { name: t(guildId, "fields.quantity"),     value: qtyText(order, guildId), inline: true },
      { name: t(guildId, "fields.reward"),       value: rewardToText(order, guildId) + (rewardInfo ? `\n• ${rewardInfo.name} (ID: ${order.rewardItemId})` : ""), inline: true },
      { name: t(guildId, "fields.claimedBy"),    value: order.takenBy.length ? order.takenBy.map(u => `<@${u}>`).join(", ") : "—", inline: false },
    )
    .setFooter({ text: `Created by ${order.ownerTag}` })
    .setTimestamp();

  const tooltipBlock = buildTooltipBlock(guildId, itemInfo);
  //if (tooltipBlock) {
  //  embed.addFields({ name: t(guildId, "fields.itemTooltipTitle"), value: tooltipBlock, inline: false });
  //}

  if (itemInfo?.iconUrl) {
    embed.setThumbnail(itemInfo.iconUrl);  // small icon
    //embed.setImage(itemInfo.iconUrl);      // big image at bottom
  }
  embed.setURL(`https://classic.wowhead.com/item=${order.wowItemId}`);
  return embed;
}

function buildButtons(order, memberOrUser, guildIdForLang) {
  // memberOrUser kann ein GuildMember (interaction.member) oder ein User sein
  const viewerId =
    memberOrUser?.user?.id ?? memberOrUser?.id ?? null;

  const isManager =
    (viewerId && order.ownerId === viewerId) ||
    isModerator(memberOrUser, guildIdForLang);

  const alreadyClaimedByViewer =
    viewerId ? order.takenBy.includes(viewerId) : false;

  const canClaim =
    !order.closed &&
    !alreadyClaimedByViewer &&
    (order.mode === "multi" || order.takenBy.length === 0);

  const canUnclaim =
    !order.closed && alreadyClaimedByViewer;

  const rows = [];
  const row = new ActionRowBuilder();

  // Claim / Unclaim abhängig vom Status
  if (canClaim) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`claim:${order.id}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t(guildIdForLang, "buttons.claim"))
    );
  }
  if (canUnclaim) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`unclaim:${order.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t(guildIdForLang, "buttons.unclaim"))
    );
  }

  // Manager-Aktionen nur für Ersteller/Mods
  if (isManager) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`close:${order.id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t(guildIdForLang, "buttons.close")),
      new ButtonBuilder()
        .setCustomId(`remove:${order.id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel(t(guildIdForLang, "buttons.remove")),
      new ButtonBuilder()
        .setCustomId(`change:${order.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t(guildIdForLang, "buttons.change"))
    );
  }

  if (row.components.length) rows.push(row);
  return rows;
}


function buildItemSelectComponents(key, candidates, confirmEnabled, selectedId = null, guildId) {
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
    new ButtonBuilder().setCustomId(`confirmitem:${key}`).setLabel(t(guildId, "buttons.ok")).setStyle(ButtonStyle.Primary).setDisabled(!confirmEnabled || selectedId === null),
    new ButtonBuilder().setCustomId(`cancelitem:${key}`).setLabel(t(guildId, "buttons.cancel")).setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

function wizButtonRow(customIdBase, options) {
  // options: [{ label, value, style? }]
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

async function wizSendWithButtons(dm, text, customIdBase, options) {
  const row = wizButtonRow(customIdBase, options);
  return dm.send({ content: text, components: [row] });
}

/* ---------------- Discord client ---------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,  // DM wizard
    GatewayIntentBits.MessageContent,  // read DM text for wizard
  ],
  partials: [Partials.Channel],        // allow DM channels to be resolved
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const [guildId] of client.guilds.cache) {
    const orders = loadOrders(guildId);
    const maxId = orders.reduce((m, o) => Math.max(m, o.id || 0), 0);
    counters[guildId] = maxId;
  }
});

registerSellFeature(client, {
  t,
  ensureAllowedChannel,
  isModerator,
  getItemInfo,
  searchItemsByName,
});


/* ---------------- Wizard helpers (DM text flow) ---------------- */
async function wizSend(dm, text) {
  return dm.send({ content: text });
}
function setAwait(session, field) {
  session.awaitField = field; // field: 'title'|'item'|'qmode'|'quantity'|'mode'|'scope'|'rewardType'|'rewardItem'|'rewardQty'|'rewardPer'|'confirm'
}

async function wizPromptTitle(session, dm) {
  setAwait(session, "title");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.title")}**\n${t(session.guildId, "wizard.hint.typeAnswer") || "Please reply with your answer."}`);
}
async function wizPromptItem(session, dm) {
  setAwait(session, "item");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.item")}**\n${t(session.guildId, "wizard.hint.item") || "Reply with an Item ID or name."}`);
}
async function wizPromptQMode(session, dm) {
  setAwait(session, "qmode");
  const text = `**${t(session.guildId, "wizard.ask.quantityMode")}**`;
  const key = wizKey(session.guildId, session.draft.ownerId);
  await wizSendWithButtons(dm, text, `wiz:choose:qmode:${key}`, [
    { label: t(session.guildId, "wizard.label.items"),    value: "items",    style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.stacks"),   value: "stacks",   style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.infinite"), value: "infinite", style: ButtonStyle.Secondary },
  ]);
}
async function wizPromptQuantity(session, dm) {
  setAwait(session, "quantity");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.quantity")}**\n${t(session.guildId, "wizard.hint.number") || "Reply with a whole number >= 1."}`);
}
async function wizPromptMode(session, dm) {
  setAwait(session, "mode");
  const text = `**${t(session.guildId, "wizard.ask.mode")}**`;
  const key = wizKey(session.guildId, session.draft.ownerId);
  await wizSendWithButtons(dm, text, `wiz:choose:mode:${key}`, [
    { label: t(session.guildId, "wizard.label.single"),    value: "single",    style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.multi"),   value: "multi",   style: ButtonStyle.Primary },
  ]);
}
async function wizPromptScope(session, dm) {
  setAwait(session, "scope");
  const text = `**${t(session.guildId, "wizard.ask.scope")}**`;
  const key = wizKey(session.guildId, session.draft.ownerId);
  await wizSendWithButtons(dm, text, `wiz:choose:scope:${key}`, [
    { label: t(session.guildId, "wizard.label.personal"),    value: "personal",    style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.guild"),   value: "guild",   style: ButtonStyle.Primary },
  ]);
}
async function wizPromptRewardType(session, dm) {
  setAwait(session, "rewardType");
  const text = `**${t(session.guildId, "wizard.ask.rewardType")}**`;
  const key = wizKey(session.guildId, session.draft.ownerId);
  await wizSendWithButtons(dm, text, `wiz:choose:rewardType:${key}`, [
    { label: t(session.guildId, "wizard.label.gold"),    value: "gold",    style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.item"),   value: "item",   style: ButtonStyle.Primary },
  ]);
}
async function wizPromptRewardItem(session, dm) {
  setAwait(session, "rewardItem");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.rewardItem")}**\n${t(session.guildId, "wizard.hint.item") || "Reply with an Item ID or name."}`);
}
async function wizPromptRewardQty(session, dm) {
  setAwait(session, "rewardQty");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.rewardQty")}**\n${t(session.guildId, "wizard.hint.number0") || "Reply with a whole number >= 0."}`);
}
async function wizPromptRewardPer(session, dm) {
  setAwait(session, "rewardPer");
  await wizSend(dm, `**${t(session.guildId, "wizard.ask.rewardPer")}**\n(Type: \`per_item\` or \`per_stack\`)`);

  const text = `**${t(session.guildId, "wizard.ask.rewardPer")}**`;
  const key = wizKey(session.guildId, session.draft.ownerId);
  await wizSendWithButtons(dm, text, `wiz:choose:rewardPer:${key}`, [
    { label: t(session.guildId, "wizard.label.per_item"),    value: "per_item",    style: ButtonStyle.Primary },
    { label: t(session.guildId, "wizard.label.per_stack"),   value: "per_stack",   style: ButtonStyle.Primary },
  ]);
}
async function wizPromptConfirm(session, dm) {
  setAwait(session, "confirm");
  const sum = session.draft;
  const g   = session.guildId;
  const key = wizKey(session.guildId, session.draft.ownerId);
  const lines = [
    `**${t(g, "wizard.summaryTitle")}**`,
    `• ${t(g, "wizard.summary.title")}: ${sum.title}`,
    `• ${t(g, "wizard.summary.item")}: ${sum.wowItemId}`,
    `• ${t(g, "wizard.summary.qty")}: ${sum.quantityMode === "infinite" ? "∞" : `${sum.quantity} (${sum.quantityMode})`}`,
    `• ${t(g, "wizard.summary.mode")}: ${sum.mode}`,
    `• ${t(g, "wizard.summary.scope")}: ${sum.scope}`,
    `• ${t(g, "wizard.summary.reward")}: ${sum.rewardType} ${sum.rewardQuantity} ${sum.rewardPer}${sum.rewardType === "item" ? ` (ID ${sum.rewardItemId})` : ""}`,
    "",
    t(g, "wizard.confirmQuestion") || "Save this order?"
  ].join("\n");
  await wizSendWithButtons(
    dm,
    lines,
    `wiz:choose:confirm:${key}`,
    [
      { label: t(g, "wizard.label.confirmSave") || "Save",   value: "save",   style: ButtonStyle.Success },
      { label: t(g, "wizard.label.cancel")     || "Cancel", value: "cancel", style: ButtonStyle.Secondary },
    ]
  );
  //await wizSend(dm, lines);
}

/* ---------------- Posting / updating embeds ---------------- */
async function postOrUpdateEmbed(interactionLike, order) {
  const guildId = interactionLike.guildId;
  const itemInfo   = await getItemInfo(order.wowItemId);
  const rewardInfo = order.rewardType === "item" && order.rewardItemId ? await getItemInfo(order.rewardItemId) : null;

  const embed = buildEmbed(order, itemInfo, rewardInfo, guildId);

  // <<< NEU: member/user an buildButtons durchreichen
  const viewer = interactionLike.member || interactionLike.user || interactionLike; // robust
  const components = buildButtons(order, viewer, guildId);

  if (!order.messageId || !order.channelId) {
    const msg = await interactionLike.channel.send({ embeds: [embed], components });
    order.messageId = msg.id;
    order.channelId = msg.channelId;
  } else {
    const channel = await client.channels.fetch(order.channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(order.messageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [embed], components });
    }
  }
}


/* ---------------- Interaction handler ---------------- */
client.on("interactionCreate", async interaction => {
  // allow all relevant interaction kinds
  if (!(
    interaction.isChatInputCommand() ||
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isAutocomplete()
  )) return;

  /* ---------- Autocomplete: /change-bb id ---------- */
  if (interaction.isAutocomplete()) {
    try {
      if (interaction.commandName === "change-bb") {
        const focused = interaction.options.getFocused(true);
        if (focused.name === "id") {
          const guildId = interaction.guildId;
          const all = loadOrders(guildId);
          const isMod = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
          const visible = isMod ? all : all.filter(o => o.ownerId === interaction.user.id);

          const q = String(focused.value ?? "").toLowerCase();
          const filtered = visible.filter(o =>
            !q || String(o.id).includes(q) || (o.title ?? "").toLowerCase().includes(q)
          );

          const choices = filtered.slice(0, 25).map(o => ({ name: `#${o.id} — ${o.title}`, value: o.id }));
          await interaction.respond(choices);
        }
      }
    } catch (e) { console.error("Autocomplete error:", e?.message ?? e); }
    return;
  }

  /* ---------- Slash commands ---------- */
  if (interaction.isChatInputCommand()) {
    const guildId = interaction.guildId;
    let orders = loadOrders(guildId);

    try {
      // /bb-setup
      if (interaction.commandName === "bb-setup") {
        const cfg = loadConfig(guildId);
        let changed = false;

        const direct = interaction.options.getString("language");
        if (direct) { setLang(guildId, direct); changed = true; }

        const addRole = interaction.options.getRole("add_mod_role");
        if (addRole) { cfg.modRoleIds = Array.from(new Set([...(cfg.modRoleIds||[]), addRole.id])); changed = true; }

        const remRole = interaction.options.getRole("remove_mod_role");
        if (remRole) { cfg.modRoleIds = (cfg.modRoleIds||[]).filter(id => id !== remRole.id); changed = true; }

        const addCh = interaction.options.getChannel("add_channel");
        if (addCh) { cfg.allowedChannelIds = Array.from(new Set([...(cfg.allowedChannelIds||[]), addCh.id])); changed = true; }

        const remCh = interaction.options.getChannel("remove_channel");
        if (remCh) { cfg.allowedChannelIds = (cfg.allowedChannelIds||[]).filter(id => id !== remCh.id); changed = true; }

        if (changed) saveConfig(guildId, cfg);

        if (interaction.options.getBoolean("show")) {
          const text = [
            t(guildId, "setup.configHeader"),
            `• Lang: \`${getLang(guildId)}\``,
            `• Mod roles: ${(cfg.modRoleIds||[]).length ? (cfg.modRoleIds.map(id=>`<@&${id}>`).join(", ")) : t(guildId,"setup.configNone")}`,
            `• Allowed channels: ${(cfg.allowedChannelIds||[]).length ? (cfg.allowedChannelIds.map(id=>`<#${id}>`).join(", ")) : t(guildId,"setup.configNone")}`,
          ].join("\n");
          return interaction.reply({ content: text, ephemeral: true });
        }

        if (direct) await interaction.reply({ content: t(guildId, "setup.langSet", { lang: direct === "de" ? t(guildId,"setup.langDE") : t(guildId,"setup.langEN") }), ephemeral: true });
        else if (changed) await interaction.reply({ content: "✅", ephemeral: true });
        else return interaction.reply({ content: "ℹ️ Nothing changed.", ephemeral: true });
        return;
      }

      // /wizard-bb (DM text-driven wizard)
      if (interaction.commandName === "wizard-bb") {
        if (!ensureAllowedChannel(interaction)) return;

        const originChannelId = interaction.channelId;
        const dm = await interaction.user.createDM();
        const key = wizKey(guildId, interaction.user.id);

        wizardSessions.set(key, {
          guildId, originChannelId, dmChannelId: dm.id,
          mode: null, step: 0, awaitField: null,
          draft: {
            id: null,
            title: "",
            requester: (interaction.user.globalName || interaction.user.username),
            requesterId: interaction.user.id,
            quantityMode: "items",
            quantity: 1,
            mode: "multi",
            scope: "personal",
            rewardType: "gold",
            rewardQuantity: 0,
            rewardItemId: null,
            rewardPer: "per_item",
            ownerId: interaction.user.id,
            ownerTag: interaction.user.tag,
            takenBy: [],
            channelId: null,
            messageId: null,
            closed: false,
            wowItemId: null
          }
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`wiz:start:create:${key}`).setLabel(t(guildId,"wizard.create")).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`wiz:start:change:${key}`).setLabel(t(guildId,"wizard.change")).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`wiz:start:cancel:${key}`).setLabel(t(guildId,"wizard.cancel")).setStyle(ButtonStyle.Danger),
        );
        await dm.send({ content: `**${t(guildId,"wizard.startTitle")}**\n${t(guildId,"wizard.chooseAction")}`, components: [row] });
        return interaction.reply({ content: t(guildId,"wizard.checkDm"), ephemeral: true });
      }

      // /create-bb
      if (interaction.commandName === "create-bb") {
        if (!ensureAllowedChannel(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const requesterUserOpt = interaction.options.getUser("requester"); // optional (mods only)
        const requesterUser = isModerator(interaction.member, guildId) && requesterUserOpt ? requesterUserOpt : interaction.user;
        const requesterName = requesterUser.globalName || requesterUser.username;
        if (requesterUserOpt && !isModerator(interaction.member, guildId)) {
          await interaction.followUp({ content: t(guildId, "msg.requesterOnlySelf"), ephemeral: true });
        }

        const wowItemInput = interaction.options.getString("wow_item");
        const quantityMode = interaction.options.getString("quantity_mode");   // items|stacks|infinite
        const quantityOpt  = interaction.options.getInteger("quantity");
        const mode         = interaction.options.getString("mode");
        const scope        = interaction.options.getString("scope");
        const rewardType   = interaction.options.getString("reward_type");
        const rewardQty    = interaction.options.getInteger("reward_quantity");
        const rewardPer    = interaction.options.getString("reward_per");
        const rewardItemId = interaction.options.getInteger("reward_item_id") || null;

        if (scope === "guild" && !isModerator(interaction.member, guildId)) {
          return interaction.editReply(t(guildId, "msg.scopeGuildOnlyMods"));
        }
        if (quantityMode !== "infinite" && (!quantityOpt || quantityOpt < 1)) {
          return interaction.editReply(t(guildId, "msg.invalidQuantity"));
        }

        // draft
        const draft = {
          id: null,
          title: interaction.options.getString("title"),
          requester: requesterName,
          requesterId: requesterUser.id,
          quantityMode,
          quantity: quantityMode === "infinite" ? null : quantityOpt,
          mode,
          scope,
          rewardType,
          rewardQuantity: rewardQty,
          rewardItemId,
          rewardPer, // per_item / per_stack
          ownerId: interaction.user.id,
          ownerTag: interaction.user.tag,
          takenBy: [],
          channelId: null,
          messageId: null,
          closed: false,
          wowItemId: null
        };

        // resolve main item
        let finalItemId = null;
        if (isNumeric(wowItemInput)) {
          finalItemId = parseInt(wowItemInput, 30);
        } else {
          const candidates = await searchItemsByName(wowItemInput);
          if (!candidates.length) return interaction.editReply(t(guildId, "msg.noneFound", { q: wowItemInput }));
          if (candidates.length === 1) {
            finalItemId = candidates[0].id;
          } else {
            const key = interaction.id;
            pendingItemPicks.set(key, { draft, selectedId: null, candidates });
            const components = buildItemSelectComponents(key, candidates, false, null, guildId);
            return interaction.editReply({ content: t(guildId, "msg.multipleFound", { q: wowItemInput }), components });
          }
        }
        draft.id = nextId(guildId);
        draft.wowItemId = finalItemId;

        // reward item flow (optional)
        if (rewardType === "item") {
          let rewardItemIdFinal = rewardItemId;
          const rewardItemInput = interaction.options.getString("reward_item");
          if (!rewardItemIdFinal && rewardItemInput) {
            if (isNumeric(rewardItemInput)) {
              rewardItemIdFinal = parseInt(rewardItemInput, 10);
            } else {
              const rewardCandidates = await searchItemsByName(rewardItemInput);
              if (!rewardCandidates.length) return interaction.editReply(t(guildId, "msg.noneFound", { q: rewardItemInput }));
              if (rewardCandidates.length === 1) {
                rewardItemIdFinal = rewardCandidates[0].id;
              } else {
                const key = `${interaction.id}:reward`;
                pendingItemPicks.set(key, { draft, selectedRewardId: null, rewardCandidates });
                const components = buildItemSelectComponents(key, rewardCandidates, false, null, guildId)
                  .map(row => {
                    row.components?.forEach(c => {
                      if (c.data?.custom_id?.startsWith("pickitem:"))    c.data.custom_id = `pickreward:${key}`;
                      if (c.data?.custom_id?.startsWith("confirmitem:")) c.data.custom_id = `confirmreward:${key}`;
                      if (c.data?.custom_id?.startsWith("cancelitem:"))  c.data.custom_id = `cancelreward:${key}`;
                    });
                    return row;
                  });
                return interaction.editReply({ content: t(guildId, "msg.multipleRewardFound", { q: rewardItemInput }), components });
              }
            }
          }
          if (!rewardItemIdFinal) return interaction.editReply(t(guildId, "msg.rewardItemMissing"));
          draft.rewardItemId = rewardItemIdFinal;
        }

        const fresh = loadOrders(guildId);
        fresh.push(draft);
        saveOrders(guildId, fresh);

        await postOrUpdateEmbed(interaction, draft);
        return interaction.editReply(t(guildId, "msg.orderCreated", { id: draft.id, title: draft.title }));
      }

      // /remove-bb
      if (interaction.commandName === "remove-bb") {
        const id = interaction.options.getInteger("id");
        const order = orders.find(o => o.id === id);
        if (!order) return interaction.reply({ content: t(guildId, "msg.orderNotFound"), ephemeral: true });
        if (!(order.ownerId === interaction.user.id || isModerator(interaction.member, guildId))) {
          return interaction.reply({ content: "❌ You cannot remove this order.", ephemeral: true });
        }

        if (order.channelId && order.messageId) {
          const channel = await client.channels.fetch(order.channelId).catch(() => null);
          const msg = channel ? await channel.messages.fetch(order.messageId).catch(() => null) : null;
          if (msg) await msg.delete().catch(() => {});
        }
        orders = orders.filter(o => o.id !== id);
        saveOrders(guildId, orders);
        return interaction.reply({ content: t(guildId, "msg.orderRemoved", { id }), ephemeral: true });
      }

      // /change-bb (partial updates)
      if (interaction.commandName === "change-bb") {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getInteger("id");
        const fresh = loadOrders(guildId);
        const order = fresh.find(o => o.id === id);
        if (!order) return interaction.editReply(t(guildId, "msg.orderNotFound"));
        if (order.closed) return interaction.editReply(t(guildId, "msg.orderClosedNoChange"));
        if (!(order.ownerId === interaction.user.id || isModerator(interaction.member, guildId))) {
          return interaction.editReply("❌ You cannot change this order.");
        }

        const s = (n) => interaction.options.getString(n);
        const i = (n) => interaction.options.getInteger(n);
        const updates = {
          title:          s("title"),
          requester:      s("requester"),
          wowItemId:      i("wow_item_id"),
          quantity:       i("quantity"),
          mode:           s("mode"),
          scope:          s("scope"),
          rewardType:     s("reward_type"),
          rewardQuantity: i("reward_quantity"),
          rewardPer:      s("reward_per"),
          rewardItemId:   i("reward_item_id"),
        };
        Object.entries(updates).forEach(([k, v]) => { if (v !== null && v !== undefined) order[k] = v; });

        saveOrders(guildId, fresh);
        await postOrUpdateEmbed(interaction, order);
        return interaction.editReply(t(guildId, "msg.orderUpdated", { id }));
      }

      // /take-bb (legacy)
      if (interaction.commandName === "take-bb") {
        const id = interaction.options.getInteger("id");
        const order = orders.find(o => o.id === id);
        if (!order) return interaction.reply({ content: t(guildId, "msg.orderNotFound"), ephemeral: true });
        if (order.closed) return interaction.reply({ content: t(guildId, "msg.orderClosed"), ephemeral: true });
        if (order.mode === "single" && order.takenBy.length > 0 && !order.takenBy.includes(interaction.user.id)) {
          return interaction.reply({ content: "❌ This order is already taken by someone else.", ephemeral: true });
        }
        if (order.takenBy.includes(interaction.user.id)) {
          return interaction.reply({ content: "❌ You already took this order.", ephemeral: true });
        }
        order.takenBy.push(interaction.user.id);
        saveOrders(guildId, orders);

        const channel = await client.channels.fetch(order.channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(order.messageId).catch(() => null);
          if (msg) {
            const itemInfo   = await getItemInfo(order.wowItemId);
            const rewardInfo = order.rewardType === "item" && order.rewardItemId ? await getItemInfo(order.rewardItemId) : null;
            await msg.edit({ embeds: [buildEmbed(order, itemInfo, rewardInfo, guildId)], components: buildButtons(order, true, guildId) });
          }
        }
        return interaction.reply({ content: t(guildId, "msg.tookOrder", { id, title: order.title }), ephemeral: true });
      }

      // /list-bb
      if (interaction.commandName === "list-bb") {
        if (orders.length === 0) return interaction.reply({ content: "📭", ephemeral: true });
        const lines = orders.map(o => `#${o.id} — **${o.title}** (${o.quantity ?? "∞"} × ${o.wowItemId}) [${o.mode}]${o.closed ? " — closed" : ""}`);
        return interaction.reply({ content: lines.join("\n"), ephemeral: true });
      }
    } catch (err) {
      console.error("❌ Command error:", err);
      if (!interaction.replied) await interaction.reply({ content: "⚠️ Internal error.", ephemeral: true });
    }
    return;
  }

  /* ---------- Select menus ---------- */
  if (interaction.isStringSelectMenu()) {
    const parts  = (interaction.customId || "").split(":");
    const action = parts[0];                  // "pickitem" | "pickreward" | "picklang" | "wiz"
    const rest   = parts.slice(1).join(":");  // key or remainder

    // Reward item select (from /create-bb flow)
    if (action === "pickreward") {
      const key = rest;
      const guildId = interaction.guildId;
      const state = pendingItemPicks.get(key);
      if (!state) return interaction.reply({ content: t(guildId, "msg.selectionExpired"), ephemeral: true });
      state.selectedRewardId = parseInt(interaction.values?.[0], 10);
      const components = buildItemSelectComponents(key, state.rewardCandidates, true, state.selectedRewardId, guildId);
      return interaction.update({ components });
    }

    // Wizard selects
    if (action === "wiz") {
      const phase = parts[1]; // "itempick" | "rewardpick"
      const key   = parts.slice(2).join(":");
      const session = wizardSessions.get(key);
      if (!session) return interaction.reply({ content: t(session?.guildId || interaction.guildId,"msg.selectionExpired"), ephemeral: true });
      const guildId = session.guildId;
      const dm = await client.channels.fetch(session.dmChannelId);

      // item picked in wizard (create)
      if (phase === "itempick") {
        session.draft.wowItemId = parseInt(interaction.values[0],10);
        await interaction.update({ components: [] });
        await wizPromptQMode(session, dm);
        return;
      }

      // reward item picked in wizard (create)
      if (phase === "rewardpick") {
        session.draft.rewardItemId = parseInt(interaction.values[0],10);
        await interaction.update({ components: [] });
        await wizPromptRewardQty(session, dm);
        return;
      }
      return;
    }

    // standard item selection (create-bb)
    if (action === "pickitem") {
      const key = rest;
      const guildId = interaction.guildId;
      const state = pendingItemPicks.get(key);
      if (!state) return interaction.reply({ content: t(guildId, "msg.selectionExpired"), ephemeral: true });
      state.selectedId = parseInt(interaction.values?.[0], 10);
      const components = buildItemSelectComponents(key, state.candidates, true, state.selectedId, guildId);
      return interaction.update({ components });
    }

    // language selection (optional quick picker)
    if (action === "picklang") {
      const key = rest;
      const guildId = interaction.guildId;
      const state = pendingItemPicks.get(key);
      if (!state) return interaction.reply({ content: t(guildId, "msg.selectionExpired"), ephemeral: true });
      state.selectedLang = interaction.values?.[0];

      const select = new StringSelectMenuBuilder()
        .setCustomId(`picklang:${key}`)
        .setPlaceholder(t(guildId, "setup.pickLang"))
        .addOptions(
          { label: t(guildId, "setup.langEN"), value: "en", default: state.selectedLang === "en" },
          { label: t(guildId, "setup.langDE"), value: "de", default: state.selectedLang === "de" }
        )
        .setMinValues(1).setMaxValues(1);

      const rows = [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirmlang:${key}`).setStyle(ButtonStyle.Primary).setLabel(t(guildId, "buttons.ok")).setDisabled(!state.selectedLang),
          new ButtonBuilder().setCustomId(`cancellang:${key}`).setStyle(ButtonStyle.Secondary).setLabel(t(guildId, "buttons.cancel")),
        )
      ];
      return interaction.update({ components: rows });
    }
    return;
  }

  /* ---------- Buttons ---------- */
if (interaction.isButton()) {
  const parts = (interaction.customId || "").split(":");
  const action = parts[0];

  // ---------- Wizard buttons ----------
  if (action === "wiz") {
    // We support:
    //  - start phase:  wiz:start:<create|change|cancel>:<sessionKey>
    //  - choose phase: wiz:choose:<qmode|mode|scope|rtype|rewardper|confirm>:<sessionKey>:<value>
    const phase       = parts[1];                   // "start" | "choose" | ...
    const sub         = parts[2];                   // for start: create|change|cancel; for choose: qmode|mode|scope|rtype|rewardper|confirm
    const keyForStart = parts.slice(3).join(":");   // session key when phase === "start"
    const keyForChoose= parts[3];                   // session key when phase === "choose"
    const value       = parts[4];                   // button value for choose
    const sessKey     = (phase === "choose") ? keyForChoose : keyForStart;

    const session = wizardSessions.get(sessKey);
    if (!session) {
      return interaction.reply({ content: t(session?.guildId || interaction.guildId, "msg.selectionExpired"), ephemeral: true });
    }

    const guildId   = session.guildId;
    const dmChannel = await client.channels.fetch(session.dmChannelId).catch(()=>null);
    if (!dmChannel) return interaction.reply({ content: "DM unavailable.", ephemeral: true });

    // ----- START phase (existing behavior) -----
    if (phase === "start") {
      if (sub === "cancel") {
        wizardSessions.delete(sessKey);
        return dmChannel.send(t(guildId,"wizard.cancelled"));
      }

      if (sub === "create") {
        session.mode = "create";
        await wizPromptTitle(session, dmChannel); // asks for title in DM (text)
        return interaction.reply({ content: t(guildId, "wizard.started"), ephemeral: true });
      }

      if (sub === "change") {
        session.mode = "change";
        const all    = loadOrders(guildId);
        const guild  = client.guilds.cache.get(session.guildId);
        const member = guild ? await guild.members.fetch(session.draft.ownerId).catch(()=>null) : null;
        const isMod  = isModerator(member, session.guildId);
        const visible = isMod ? all : all.filter(o => o.ownerId === session.draft.ownerId);
        if (!visible.length) {
          wizardSessions.delete(sessKey);
          return dmChannel.send(t(guildId,"msg.orderNotFound"));
        }
        const opts = visible.slice(0,25).map(o => ({
          label: `#${o.id} — ${o.title}`.slice(0,100),
          value: String(o.id)
        }));
        const select = new StringSelectMenuBuilder()
          .setCustomId(`wiz:pickorder:${sessKey}`)
          .setPlaceholder(t(guildId,"wizard.fieldPickerTitle"))
          .addOptions(opts)
          .setMinValues(1).setMaxValues(1);
        await dmChannel.send({ content: t(guildId,"wizard.change"), components: [new ActionRowBuilder().addComponents(select)] });
        return interaction.reply({ content: t(guildId, "wizard.started"), ephemeral: true });
      }

      return; // end START
    }

    // ----- CHOOSE phase (new: button-driven choices, incl. confirm) -----
    if (phase === "choose") {
      // Acknowledge the button by removing the components on the original message (if any).
      if (!interaction.deferred && !interaction.replied) {
        await interaction.update({ components: [] }).catch(()=>{});
      }

      const dm = dmChannel;

      switch (sub) {
        case "qmode": {
          const v = String(value || "").toLowerCase();     // items|stacks|infinite
          if (!["items","stacks","infinite"].includes(v)) {
            await dm.send("Please choose a valid option.");
            return;
          }
          session.draft.quantityMode = v;
          if (v === "infinite") {
            await wizPromptMode(session, dm);              // next: mode (buttons or text)
          } else {
            await wizPromptQuantity(session, dm);          // next: quantity (text)
          }
          return;
        }

        case "mode": {
          const v = String(value || "").toLowerCase();     // multi|single
          if (!["multi","single"].includes(v)) {
            await dm.send("Please choose a valid option.");
            return;
          }
          session.draft.mode = v;
          await wizPromptScope(session, dm);               // next: scope (buttons)
          return;
        }

        case "scope": {
          const v = String(value || "").toLowerCase();     // personal|guild
          if (!["personal","guild"].includes(v)) {
            await dm.send("Please choose a valid option.");
            return;
          }
          if (v === "guild") {
            const g   = client.guilds.cache.get(session.guildId);
            const mem = g ? await g.members.fetch(session.draft.ownerId).catch(()=>null) : null;
            if (!isModerator(mem, session.guildId)) {
              await dm.send(t(guildId,"msg.scopeGuildOnlyMods"));
              await wizPromptScope(session, dm);           // ask again
              return;
            }
          }
          session.draft.scope = v;
          await wizPromptRewardType(session, dm);          // next: reward type (buttons)
          return;
        }

        case "rtype": {
          const v = String(value || "").toLowerCase();     // gold|item
          if (!["gold","item"].includes(v)) {
            await dm.send("Please choose a valid option.");
            return;
          }
          session.draft.rewardType = v;
          if (v === "item") await wizPromptRewardItem(session, dm); // ask reward item (text or dropdown if multiple)
          else await wizPromptRewardQty(session, dm);               // ask reward qty (text)
          return;
        }

        case "rewardper": {
          const v = String(value || "").toLowerCase();     // per_item|per_stack
          if (!["per_item","per_stack"].includes(v)) {
            await dm.send("Please choose a valid option.");
            return;
          }
          session.draft.rewardPer = v;
          await wizPromptConfirm(session, dm);             // show summary with confirm buttons
          return;
        }

        case "confirm": {
          const v = String(value || "").toLowerCase();     // save|cancel
          if (v === "cancel") {
            wizardSessions.delete(sessKey);
            await dm.send(t(guildId, "wizard.cancelled"));
            return;
          }

          // Save order and post the embed in the original channel
          const orders = loadOrders(guildId);
          const order  = { ...session.draft };
          order.id = nextId(guildId);
          orders.push(order);
          saveOrders(guildId, orders);

          const origin = await client.channels.fetch(session.originChannelId).catch(()=>null);
          if (origin) await postOrUpdateEmbed({ channel: origin, guildId }, order);

          wizardSessions.delete(sessKey);
          await dm.send(t(guildId, "wizard.saved"));
          return;
        }
      }

      return; // end CHOOSE
    }

    return; // end wiz
  }

  // ---------- reward item confirm/cancel (non-wizard create flow) ----------
  if (action === "cancelreward") {
    const key = parts[1];
    const guildId = interaction.guildId;
    pendingItemPicks.delete(key);
    return interaction.update({ content: t(guildId, "buttons.cancel"), components: [] });
  }

  if (action === "confirmreward") {
    const key = parts[1];
    const guildId = interaction.guildId;
    const state = pendingItemPicks.get(key);
    if (!state || !state.selectedRewardId) {
      return interaction.reply({ content: t(guildId, "msg.selectFirst"), ephemeral: true });
    }
    const orders = loadOrders(guildId);
    const order = { ...state.draft };
    order.id = nextId(guildId);
    order.rewardItemId = state.selectedRewardId;

    orders.push(order);
    saveOrders(guildId, orders);
    pendingItemPicks.delete(key);

    await interaction.update({ content: t(guildId, "msg.orderCreated", { id: order.id, title: order.title }), components: [] });
    await postOrUpdateEmbed(interaction, order);
    return;
  }

  // ---------- main item confirm/cancel (non-wizard create flow) ----------
  if (action === "cancelitem") {
    const key = parts[1];
    pendingItemPicks.delete(key);
    return interaction.update({ content: "❌", components: [] });
  }

  if (action === "confirmitem") {
    const key = parts[1];
    const guildId = interaction.guildId;
    const state = pendingItemPicks.get(key);
    if (!state) return interaction.reply({ content: t(guildId, "msg.selectionExpired"), ephemeral: true });
    if (!state.selectedId) return interaction.reply({ content: t(guildId, "msg.selectFirst"), ephemeral: true });

    const orders = loadOrders(guildId);
    const order = { ...state.draft };
    order.id = nextId(guildId);
    order.wowItemId = state.selectedId;

    orders.push(order);
    saveOrders(guildId, orders);
    pendingItemPicks.delete(key);

    await interaction.update({ content: t(guildId, "msg.orderCreated", { id: order.id, title: order.title }), components: [] });
    await postOrUpdateEmbed(interaction, order);
    return;
  }

  // ---------- language confirm/cancel ----------
  if (action === "cancellang") {
    const key = parts[1];
    const guildId = interaction.guildId;
    pendingItemPicks.delete(key);
    return interaction.update({ content: t(guildId, "buttons.cancel"), components: [] });
  }

  if (action === "confirmlang") {
    const key = parts[1];
    const guildId = interaction.guildId;
    const state = pendingItemPicks.get(key);
    if (!state || !state.selectedLang) {
      return interaction.reply({ content: t(guildId, "msg.selectFirst"), ephemeral: true });
    }
    const lang = setLang(guildId, state.selectedLang);
    pendingItemPicks.delete(key);
    return interaction.update({ content: t(guildId, "setup.langSet", { lang: lang === "de" ? t(guildId, "setup.langDE") : t(guildId, "setup.langEN") }), components: [] });
  }

  // ---------- order buttons (claim/unclaim/close/remove/change) ----------
  const idMaybe = parts[1];
  const id = Number(idMaybe);
  if (!Number.isFinite(id)) return;

  const guildId = interaction.guildId;
  let orders = loadOrders(guildId);
  const order = orders.find(o => o.id === id);
  if (!order) return interaction.reply({ content: t(guildId, "msg.orderNotFound"), ephemeral: true });

  try {
    if (action === "claim") {
      if (order.closed) return interaction.reply({ content: t(guildId, "msg.orderClosed"), ephemeral: true });
      if (order.mode === "single" && order.takenBy.length > 0 && !order.takenBy.includes(interaction.user.id)) {
        return interaction.reply({ content: "❌ This order is already taken by someone else.", ephemeral: true });
      }
      if (!order.takenBy.includes(interaction.user.id)) order.takenBy.push(interaction.user.id);
      saveOrders(guildId, orders);

      const itemInfo   = await getItemInfo(order.wowItemId);
      const rewardInfo = order.rewardType === "item" && order.rewardItemId ? await getItemInfo(order.rewardItemId) : null;
      // statt canManageThisUser -> nutze buildButtons(order, interaction.member, guildId)
      await interaction.update({
        embeds: [buildEmbed(order, itemInfo, rewardInfo, guildId)],
        components: buildButtons(order, interaction.member, guildId)
      });
      return;
    }

    if (action === "unclaim") {
      order.takenBy = order.takenBy.filter(u => u !== interaction.user.id);
      saveOrders(guildId, orders);

      const itemInfo   = await getItemInfo(order.wowItemId);
      const rewardInfo = order.rewardType === "item" && order.rewardItemId ? await getItemInfo(order.rewardItemId) : null;
      // statt canManageThisUser -> nutze buildButtons(order, interaction.member, guildId)
      await interaction.update({
        embeds: [buildEmbed(order, itemInfo, rewardInfo, guildId)],
        components: buildButtons(order, interaction.member, guildId)
      });
      return;
    }

    if (action === "close") {
      const canManageThisUser = order.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
      if (!canManageThisUser) return interaction.reply({ content: "❌ You cannot close this order.", ephemeral: true });

      order.closed = true;
      saveOrders(guildId, orders);

      const itemInfo   = await getItemInfo(order.wowItemId);
      const rewardInfo = order.rewardType === "item" && order.rewardItemId ? await getItemInfo(order.rewardItemId) : null;
      // statt canManageThisUser -> nutze buildButtons(order, interaction.member, guildId)
      await interaction.update({
        embeds: [buildEmbed(order, itemInfo, rewardInfo, guildId)],
        components: buildButtons(order, interaction.member, guildId)
      });
      return;
    }

    if (action === "remove") {
      const canManageThisUser = order.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
      if (!canManageThisUser) return interaction.reply({ content: "❌ You cannot remove this order.", ephemeral: true });

      await interaction.message.delete().catch(() => {});
      orders = orders.filter(o => o.id !== order.id);
      saveOrders(guildId, orders);
      return;
    }

    if (action === "change") {
      if (order.closed) return interaction.reply({ content: t(guildId, "msg.orderClosedNoChange"), ephemeral: true });
      return interaction.reply({ content: "✏️ Use `/change-bb` to edit this order.", ephemeral: true });
    }
  } catch (err) {
    console.error("❌ Button error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "⚠️ Internal error.", ephemeral: true });
    }
  }
}
});

/* ---------------- DM message handler for wizard ---------------- */
// This handles plain-text replies in the user's DM, advancing the wizard state.
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.guildId) return; // only DMs

  // Find a session bound to this DM channel and this user
  let session = null;
  for (const [key, s] of wizardSessions) {
    if (s.dmChannelId === msg.channel.id && key.endsWith(`~${msg.author.id}`)) { session = s; break; }
  }
  if (!session) return;

  const dm = msg.channel;
  const content = msg.content.trim();
  const guildId = session.guildId;

  // Small helper: enforce simple choice sets
  const isOneOf = (str, arr) => arr.includes(String(str).toLowerCase());

  try {
    switch (session.awaitField) {
      case "title": {
        if (!content) { await wizSend(dm, t(guildId, "msg.invalidTitle") || "Please enter a non-empty title."); return; }
        session.draft.title = content;
        await wizSend(dm, t(guildId, "wizard.titleSaved") || "Title saved.");
        await wizPromptItem(session, dm);
        break;
      }

      case "item": {
        // ID or name
        if (isNumeric(content)) {
          session.draft.wowItemId = parseInt(content, 10);
          await wizPromptQMode(session, dm);
        } else {
          const candidates = await searchItemsByName(content);
          if (!candidates.length) {
            await wizSend(dm, t(guildId, "msg.noneFound", { q: content }));
            await wizPromptItem(session, dm);
            return;
          }
          if (candidates.length === 1) {
            session.draft.wowItemId = candidates[0].id;
            await wizPromptQMode(session, dm);
          } else {
            // show dropdown in DM to pick exact one
            const key = wizKey(session.guildId, session.draft.ownerId);
            const select = new StringSelectMenuBuilder()
              .setCustomId(`wiz:itempick:${key}`)
              .setPlaceholder(t(guildId, "wizard.multipleFound", { q: content }))
              .addOptions(candidates.slice(0,25).map(c => ({
                label: c.name.slice(0,100),
                description: `ID ${c.id}`,
                value: String(c.id),
              })))
              .setMinValues(1).setMaxValues(1);
            await dm.send({ content: t(guildId, "wizard.multipleFound", { q: content }), components: [ new ActionRowBuilder().addComponents(select) ] });
            // keep awaiting; next step will be triggered by the select-menu handler
          }
        }
        break;
      }

      case "qmode": {
        const v = content.toLowerCase();
        if (!isOneOf(v, ["items", "stacks", "infinite"])) {
          await wizSend(dm, "Please type `items`, `stacks`, or `infinite`.");
          return;
        }
        session.draft.quantityMode = v;
        if (v === "infinite") {
          await wizPromptMode(session, dm);
        } else {
          await wizPromptQuantity(session, dm);
        }
        break;
      }

      case "quantity": {
        const n = parseInt(content, 10);
        if (!Number.isFinite(n) || n < 1) {
          await wizSend(dm, t(guildId, "msg.invalidQuantity") || "Invalid quantity. Enter a whole number >= 1.");
          return;
        }
        session.draft.quantity = n;
        await wizPromptMode(session, dm);
        break;
      }

      case "mode": {
        const v = content.toLowerCase();
        if (!isOneOf(v, ["multi","single"])) {
          await wizSend(dm, "Please type `multi` or `single`.");
          return;
        }
        session.draft.mode = v;
        await wizPromptScope(session, dm);
        break;
      }

      case "scope": {
        const v = content.toLowerCase();
        if (!isOneOf(v, ["personal","guild"])) {
          await wizSend(dm, "Please type `personal` or `guild`.");
          return;
        }
        if (v === "guild") {
          const guild = client.guilds.cache.get(session.guildId);
          const member = guild ? await guild.members.fetch(session.draft.ownerId).catch(()=>null) : null;
          if (!isModerator(member, session.guildId)) {
            await wizSend(dm, t(guildId,"msg.scopeGuildOnlyMods"));
            await wizPromptScope(session, dm);
            return;
          }
        }
        session.draft.scope = v;
        await wizPromptRewardType(session, dm);
        break;
      }

      case "rewardType": {
        const v = content.toLowerCase();
        if (!isOneOf(v, ["gold","item"])) {
          await wizSend(dm, "Please type `gold` or `item`.");
          return;
        }
        session.draft.rewardType = v;
        if (v === "item") await wizPromptRewardItem(session, dm);
        else await wizPromptRewardQty(session, dm);
        break;
      }

      case "rewardItem": {
        if (isNumeric(content)) {
          session.draft.rewardItemId = parseInt(content,10);
          await wizPromptRewardQty(session, dm);
        } else {
          const candidates = await searchItemsByName(content);
          if (!candidates.length) {
            await wizSend(dm, t(guildId, "msg.noneFound", { q: content }));
            await wizPromptRewardItem(session, dm);
            return;
          }
          if (candidates.length === 1) {
            session.draft.rewardItemId = candidates[0].id;
            await wizPromptRewardQty(session, dm);
          } else {
            const key = wizKey(session.guildId, session.draft.ownerId);
            const select = new StringSelectMenuBuilder()
              .setCustomId(`wiz:rewardpick:${key}`)
              .setPlaceholder(t(guildId, "msg.multipleRewardFound", { q: content }))
              .addOptions(
                candidates.slice(0,25).map(c => ({
                  label: c.name.slice(0,100),
                  description: `ID ${c.id}`,
                  value: String(c.id),
                }))
              ).setMinValues(1).setMaxValues(1);
            await dm.send({ content: t(guildId,"msg.multipleRewardFound",{q:content}), components: [ new ActionRowBuilder().addComponents(select) ] });
          }
        }
        break;
      }

      case "rewardQty": {
        const n = parseInt(content, 10);
        if (!Number.isFinite(n) || n < 0) {
          await wizSend(dm, t(guildId, "msg.invalidNumber0") || "Invalid number. Enter a whole number >= 0.");
          return;
        }
        session.draft.rewardQuantity = n;
        await wizPromptRewardPer(session, dm);
        break;
      }

      case "rewardPer": {
        const v = content.toLowerCase();
        if (!isOneOf(v, ["per_item","per_stack"])) {
          await wizSend(dm, "Please type `per_item` or `per_stack`.");
          return;
        }
        session.draft.rewardPer = v;
        await wizPromptConfirm(session, dm);
        break;
      }

      case "confirm": {
        const v = content.toLowerCase();
        if (v !== "confirm" && v !== "cancel") {
          await wizSend(dm, "Type `confirm` to save, or `cancel` to abort.");
          return;
        }
        if (v === "cancel") {
          wizardSessions.delete(wizKey(session.guildId, session.draft.ownerId));
          await wizSend(dm, t(guildId, "wizard.cancelled"));
          return;
        }
        // Save
        const orders = loadOrders(guildId);
        const order = { ...session.draft };
        order.id = nextId(guildId);
        orders.push(order);
        saveOrders(guildId, orders);

        // Post to original channel
        const origin = await client.channels.fetch(session.originChannelId).catch(()=>null);
        if (origin) await postOrUpdateEmbed({ channel: origin, guildId }, order);

        wizardSessions.delete(wizKey(session.guildId, session.draft.ownerId));
        await wizSend(dm, t(guildId, "wizard.saved"));
        break;
      }

      default: {
        // If no field is awaited, gently remind the user
        await wizSend(dm, t(guildId, "wizard.noPending") || "No question is pending right now.");
      }
    }
  } catch (e) {
    console.error("Wizard DM error:", e);
    await wizSend(dm, "⚠️ Error while processing your input. Please try again.");
  }
});

/* ---------------- Start ---------------- */
client.login(process.env.DISCORD_TOKEN);
