// wizard.js
// DM wizard: each question is a NEW embed; previous one is "frozen" (no components).
// Fixes: no duplicate fields, robust gold qty parsing, proper freeze on next/prev/reset.
// Author: Domekologe

import {
  ButtonStyle,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
} from "discord.js";
import { t } from "./i18n.js";
import { wizKey, isNumeric, isModerator, nextId, enforceTitlePrefix, tt  } from "./helpers.js";
import { searchItemsByName, getItemInfo } from "./blizzardApi.js";
import { loadOrders, saveOrders } from "./storage.js";
import { buildEmbed, buildPublicButtons  } from "./uiBuilders.js";

// Sessions: key = `${guildId}~${userId}`
export const wizardSessions = new Map();

/* ---------------- Steps ---------------- */
const STEPS = [
  "title",
  "item",
  "qmode",
  "quantity",
  "mode",
  "scope",
  "rewardType",
  "rewardItem",
  "rewardQty",
  "rewardPer",
];
const STEP_ORDER = [...STEPS];
const idx = f => Math.max(0, STEP_ORDER.indexOf(f));



function isRelevant(field, d) {
  if (field === "quantity" && String(d.quantityMode).toLowerCase() === "infinite") return false;
  if (field === "rewardItem" && String(d.rewardType).toLowerCase() !== "item") return false;
  return true;
}
function nextRelevantField(field, d) {
  let i = idx(field);
  while (i < STEP_ORDER.length - 1) {
    i++;
    const f = STEP_ORDER[i];
    if (isRelevant(f, d)) return f;
  }
  return null; // end -> summary
}
function prevRelevantField(field, d) {
  let i = idx(field);
  while (i > 0) {
    i--;
    const f = STEP_ORDER[i];
    if (isRelevant(f, d)) return f;
  }
  return STEP_ORDER[0];
}

/* ---------------- Helpers ---------------- */
function ensureMsgMap(session) {
  if (!session.msgIds) session.msgIds = {}; // field -> messageId
}

function parseNumberFromText(text) {
  if (text == null) return null;
  const m = String(text).replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Math.floor(Number(m[0]));
  return Number.isFinite(n) ? n : null;
}

/* ---------------- i18n ---------------- */
function questionFor(g, field) {
  const map = {
    title:      t(g, "wizard.ask.title"),
    item:       t(g, "wizard.ask.item"),
    qmode:      t(g, "wizard.ask.quantityMode"),
    quantity:   t(g, "wizard.ask.quantity"),
    mode:       t(g, "wizard.ask.mode"),
    scope:      t(g, "wizard.ask.scope"),
    rewardType: t(g, "wizard.ask.rewardType"),
    rewardItem: t(g, "wizard.ask.rewardItem"),
    rewardQty:  t(g, "wizard.ask.rewardQty"),
    rewardPer:  t(g, "wizard.ask.rewardPer"),
  };
  return map[field] || field;
}
function hintFor(g, field) {
  const map = {
    title:      t(g, "wizard.hint.typeAnswer") || "Please reply with your answer.",
    item:       t(g, "wizard.hint.item")       || "Reply with an Item ID or name.",
    qmode:      "items / stacks / infinite",
    quantity:   t(g, "wizard.hint.number")     || "Whole number ≥ 1.",
    mode:       "single / multi",
    scope:      "personal / guild",
    rewardType: "gold / item",
    rewardItem: t(g, "wizard.hint.item")       || "Reply with an Item ID or name.",
    rewardQty:  t(g, "wizard.hint.number0")    || "Whole number ≥ 0.",
    rewardPer:  "per_item / per_stack",
  };
  return map[field];
}
function currentValueText(d, g, field) {
  switch (field) {
    case "title":       return d.title || "—";
    case "item":        return d.wowItemId ? `ID ${d.wowItemId}` : "—";
    case "qmode":       return d.quantityMode || "— (items|stacks|infinite)";
    case "quantity":    return d.quantityMode === "infinite" ? "∞ (ignored)" : (d.quantity ?? "—");
    case "mode":        return d.mode || "— (single|multi)";
    case "scope":       return d.scope || "— (personal|guild)";
    case "rewardType":  return d.rewardType || "— (gold|item)";
    case "rewardItem":  return d.rewardType === "item" ? (d.rewardItemId ? `ID ${d.rewardItemId}` : "—") : "— (not needed)";
    case "rewardQty":   return Number.isInteger(d.rewardQuantity) ? String(d.rewardQuantity) : "— (≥ 0)";
    case "rewardPer":   return d.rewardPer || "— (per_item|per_stack)";
    default: return "—";
  }
}
function isStepSatisfied(d, field) {
  switch (field) {
    case "title":       return !!d.title?.trim();
    case "item":        return Number.isInteger(d.wowItemId);
    case "qmode":       return ["items","stacks","infinite"].includes(String(d.quantityMode||"").toLowerCase());
    case "quantity":    return d.quantityMode === "infinite" ? true : (Number.isInteger(d.quantity) && d.quantity >= 1);
    case "mode":        return ["single","multi"].includes(String(d.mode||"").toLowerCase());
    case "scope":       return ["personal","guild"].includes(String(d.scope||"").toLowerCase());
    case "rewardType":  return ["gold","item"].includes(String(d.rewardType||"").toLowerCase());
    case "rewardItem":  return (String(d.rewardType).toLowerCase() !== "item") || Number.isInteger(d.rewardItemId);
    case "rewardQty":   return Number.isInteger(d.rewardQuantity) && d.rewardQuantity >= 0;
    case "rewardPer":   return ["per_item","per_stack"].includes(String(d.rewardPer||"").toLowerCase());
    default: return true;
  }
}
function resetField(d, field) {
  switch (field) {
    case "title":       d.title = ""; break;
    case "item":        d.wowItemId = null; break;
    case "qmode":       d.quantityMode = null; d.quantity = null; break;
    case "quantity":    d.quantity = null; break;
    case "mode":        d.mode = null; break;
    case "scope":       d.scope = null; break;
    case "rewardType":  d.rewardType = null; d.rewardItemId = null; d.rewardQuantity = null; d.rewardPer = null; break;
    case "rewardItem":  d.rewardItemId = null; break;
    case "rewardQty":   d.rewardQuantity = null; break;
    case "rewardPer":   d.rewardPer = null; break;
  }
}

/* ---------------- UI builders ---------------- */
function buildSelectForField(guildId, field, key, currentVal) {
  const choicesMap = {
    qmode:      [["items","wizard.label.items"], ["stacks","wizard.label.stacks"], ["infinite","wizard.label.infinite"]],
    mode:       [["single","wizard.label.single"], ["multi","wizard.label.multi"]],
    scope:      [["personal","wizard.label.personal"], ["guild","wizard.label.guild"]],
    rewardType: [["gold","wizard.label.gold"], ["item","wizard.label.item"]],
    rewardPer:  [["per_item","wizard.label.per_item"], ["per_stack","wizard.label.per_stack"]],
  };
  const defs = choicesMap[field];
  if (!defs) return null;
  const opts = defs.map(([val, keyName]) => ({
    label: (t(guildId, keyName) || val).slice(0,100),
    value: val,
    default: String(currentVal||"") === String(val),
  }));
  return new StringSelectMenuBuilder()
    .setCustomId(`wizsel:${field}:${key}`)
    .setPlaceholder(t(guildId, "wizard.select.placeholder") || "Bitte auswählen …")
    .addOptions(opts)
    .setMinValues(1).setMaxValues(1);
}

/* ---------------- Cards ---------------- */
// Always send a NEW question card and remember its message id.
async function sendQuestionCard(session, dm) {
  ensureMsgMap(session);
  const g     = session.guildId;
  const field = session.awaitField || "title";
  const d     = session.draft;
  const key   = wizKey(session.guildId, session.draft.ownerId);
  const valueForField =
  field === "title"
    ? enforceTitlePrefix(session.type || "buy", d.title, g)  // << Präfix schon in der Vorschau
    : currentValueText(d, g, field);
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`❓ ${questionFor(g, field)}`)
    .setDescription(`**Beispiel:** ${hintFor(g, field)}`)
    .setFields({ name: t(g, "wizard.card.current") || "Aktuelles Feld", value: "`" + valueForField  + "`" });

  const rows = [];
  const currentForSelect = (field === "qmode") ? d.quantityMode : d[field];
  const select = buildSelectForField(g, field, key, currentForSelect);
  if (select) rows.push(new ActionRowBuilder().addComponents(select));

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wiznav:prev:${key}`).setStyle(ButtonStyle.Secondary).setLabel(t(g,"wizard.nav.back") || "Zurück"),
    new ButtonBuilder().setCustomId(`wiznav:reset:${key}`).setStyle(ButtonStyle.Danger).setLabel(t(g,"wizard.nav.reset") || "Reset"),
    new ButtonBuilder().setCustomId(`wiznav:next:${key}`).setStyle(ButtonStyle.Primary).setLabel(t(g,"wizard.nav.next") || "Weiter").setDisabled(!isStepSatisfied(d, field))
  );
  rows.push(nav);

  const sent = await dm.send({ embeds: [embed], components: rows });
  session.msgIds[field] = sent.id;
  return sent;
}

// Freeze a question card: remove components and show a single "Antwort" field.
async function markQuestionAnswered(session, field, dm) {
  ensureMsgMap(session);
  const msgId = session.msgIds?.[field];
  if (!msgId) return;

  const g = session.guildId;
  const d = session.draft;
  const msg = await dm.messages.fetch(msgId).catch(() => null);
  if (!msg) return;

  const answered = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`❓ ${questionFor(g, field)}`)
    .setDescription(`**Beispiel:** ${hintFor(g, field)}`)
    .setFields({ name: t(g, "wizard.card.answer") || "Antwort", value: "`" + currentValueText(d, g, field) + "`" });

  await msg.edit({ embeds: [answered], components: [] }).catch(() => {});
}

/* ---------------- Summary / Success ---------------- */
async function renderSummary(session, dm) {
  const g = session.guildId;
  const sum = session.draft;
  const fullTitle = enforceTitlePrefix(session.type || "buy", sum.title, g);
  const embed = new EmbedBuilder()
    .setColor(0x2e7d32)
    .setTitle(t(g, "wizard.summaryTitle") || "Zusammenfassung")
    .addFields(
      { name: t(g,"wizard.summary.title")  || "Title",    value: sum.fullTitle || "—",  inline: false },
      { name: t(g,"wizard.summary.item")   || "Item",     value: String(sum.wowItemId || "—"), inline: true },
      { name: t(g,"wizard.summary.qty")    || "Quantity", value: sum.quantityMode === "infinite" ? "∞" : `${sum.quantity} (${sum.quantityMode})`, inline: true },
      { name: t(g,"wizard.summary.mode")   || "Mode",     value: sum.mode || "—", inline: true },
      { name: t(g,"wizard.summary.scope")  || "Scope",    value: sum.scope || "—", inline: true },
      { name: t(g,"wizard.summary.reward") || "Reward",
        value: `${sum.rewardType} ${sum.rewardQuantity} ${sum.rewardPer}${sum.rewardType === "item" ? ` (ID ${sum.rewardItemId})` : ""}`,
        inline: false
      },
    );

  const key = wizKey(session.guildId, session.draft.ownerId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wizconfirm:save:${key}`).setStyle(ButtonStyle.Success).setLabel(t(g,"wizard.label.confirmSave") || "Bestätigen"),
    new ButtonBuilder().setCustomId(`wizconfirm:cancel:${key}`).setStyle(ButtonStyle.Secondary).setLabel(t(g,"wizard.label.cancel") || "Abbrechen"),
  );

  const sent = await dm.send({ embeds: [embed], components: [row] });
  session.summaryMsgId = sent.id;
}

async function renderSuccess(session, dm, order) {
  const g = session.guildId;
  const itemInfo   = await getItemInfo(order.wowItemId).catch(()=>null);
const rewardInfo = order.rewardType === "item" && order.rewardItemId
  ? await getItemInfo(order.rewardItemId).catch(()=>null)
  : null;

const itemFieldName   = order.type === "sell"
  ? (tt(g, "sell", "sell.fields.sellItem") || "Gegenstand zum Verkauf")
  : (tt(g, "buy",  "sell.fields.searchedItem") || "Gesuchter Gegenstand");

const rewardFieldName = order.type === "sell"
  ? (tt(g, "sell", "sell.fields.price") || "Preis")
  : (tt(g, "buy",  "sell.fields.reward") || "Belohnung");

const requesterName   = order.type === "sell"
  ? (tt(g, "sell", "sell.fields.seller") || "Verkäufer")
  : (tt(g, "buy",  "sell.fields.requester") || "Antragsteller");
  const embed = new EmbedBuilder()
  .setColor(0x4caf50)
  .setTitle(tt(g, order.type, "wizard.success.title") || "Auftrag erstellt")
  .setDescription(tt(g, order.type, "wizard.success.desc") || "Dein Eintrag wurde gespeichert.")
  .addFields(
    { name: requesterName, value: `@${order.ownerTag}`, inline: false },
    { name: itemFieldName, value: `${itemInfo?.name ?? `Item #${order.wowItemId}`} (ID: ${order.wowItemId})`, inline: false },
    { name: tt(g, order.type, "fields.quantity") || "Menge", value: order.quantityMode === "infinite" ? "∞" : String(order.quantity), inline: true },
    { name: tt(g, order.type, "fields.mode") || "Modus", value: order.mode, inline: true },
    {
      name: rewardFieldName,
      value: order.rewardType === "gold"
        ? `${order.rewardQuantity}g ${order.rewardPer}`
        : `${order.rewardQuantity} × ${rewardInfo?.name ?? `Item #${order.rewardItemId}`} (${order.rewardPer})`,
      inline: false
    },
  )
  .setFooter({ text: `ID: ${order.id}` })
  .setTimestamp();

  try {
    if (session.summaryMsgId) {
      const m = await dm.messages.fetch(session.summaryMsgId).catch(()=>null);
      if (m) await m.edit({ embeds: [embed], components: [] });
      else await dm.send({ embeds: [embed] });
    } else {
      await dm.send({ embeds: [embed] });
    }
  } catch {
    await dm.send({ embeds: [embed] });
  }
}

/* ---------------- Navigation ---------------- */
async function gotoPrev(session, dm) {
  // freeze current
  await markQuestionAnswered(session, session.awaitField, dm);
  const prev = prevRelevantField(session.awaitField, session.draft);
  session.awaitField = prev;
  await sendQuestionCard(session, dm);
}
async function gotoNext(session, dm) {
  // freeze current
  await markQuestionAnswered(session, session.awaitField, dm);
  let next = nextRelevantField(session.awaitField, session.draft);
  if (!next) { 
    await renderSummary(session, dm); 
    return; 
  }
  session.awaitField = next;
  await sendQuestionCard(session, dm);
}


/* ---------------- DM message handler (text answers) ---------------- */
export function registerWizardMessageHandler(client) {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (msg.guildId) return; // only DMs

    // locate session for this DM & user
    let session = null;
    for (const [key, s] of wizardSessions) {
      if (s.dmChannelId === msg.channel.id && key.endsWith(`~${msg.author.id}`)) { session = s; break; }
    }
    if (!session) return;

    const dm = msg.channel;
    const content = (msg.content || "").trim();
    const g = session.guildId;
    const d = session.draft;
    const oneOf = (s, arr) => arr.includes(String(s).toLowerCase());

    const tryDelete = async () => { try { await msg.delete(); } catch {} };

    try {
      switch (session.awaitField) {
        case "title": {
          d.title = content;
          await tryDelete();
          await gotoNext(session, dm);
          break;
        }

        case "item": {
          if (isNumeric(content)) {
            d.wowItemId = parseInt(content, 10);
            await tryDelete();
            await gotoNext(session, dm);
          } else {
            const candidates = await searchItemsByName(content);
            if (!candidates.length) { await dm.send(t(g, "msg.noneFound", { q: content })); await tryDelete(); return; }
            if (candidates.length === 1) {
              d.wowItemId = candidates[0].id;
              await tryDelete();
              await gotoNext(session, dm);
            } else {
              const key = wizKey(session.guildId, d.ownerId);
              const sel = new StringSelectMenuBuilder()
                .setCustomId(`wiz:itempick:${key}`)
                .setPlaceholder(t(g, "wizard.multipleFound", { q: content }))
                .addOptions(candidates.slice(0,25).map(c => ({
                  label: c.name.slice(0,100),
                  description: `ID ${c.id}`,
                  value: String(c.id),
                })))
                .setMinValues(1).setMaxValues(1);
              await dm.send({
                embeds: [ new EmbedBuilder().setColor(0x2b2d31).setTitle("❓ Item-Auswahl").setDescription(t(g,"wizard.multipleFound",{q:content})) ],
                components: [ new ActionRowBuilder().addComponents(sel) ]
              });
              await tryDelete();
            }
          }
          break;
        }

        case "qmode": {
          const v = content.toLowerCase();
          if (!oneOf(v, ["items","stacks","infinite"])) { 
            await dm.send("Bitte `items`, `stacks` oder `infinite`."); 
            await tryDelete(); 
            return; 
          }
          d.quantityMode = v;
          if (v === "infinite") d.quantity = null;
          await tryDelete();
          await gotoNext(session, dm);   // <--- springt automatisch über "quantity"
          break;
        }

        case "quantity": {
          if (d.quantityMode === "infinite") { await tryDelete(); await gotoNext(session, dm); break; }
          const n = parseNumberFromText(content);
          if (n == null || n < 1) { await dm.send(t(g,"msg.invalidQuantity") || "Whole number ≥ 1."); await tryDelete(); return; }
          d.quantity = n;
          await tryDelete();
          await gotoNext(session, dm);
          break;
        }

        case "mode": {
          const v = content.toLowerCase();
          if (!oneOf(v, ["multi","single"])) { await dm.send("Bitte `multi` oder `single`."); await tryDelete(); return; }
          d.mode = v;
          await tryDelete();
          await gotoNext(session, dm);
          break;
        }

        case "scope": {
          const v = content.toLowerCase();
          if (!oneOf(v, ["personal","guild"])) { await dm.send("Bitte `personal` oder `guild`."); await tryDelete(); return; }
          if (v === "guild") {
            const guild = client.guilds.cache.get(session.guildId);
            const m = guild ? await guild.members.fetch(d.ownerId).catch(()=>null) : null;
            if (!isModerator(m, session.guildId)) { await dm.send(t(g,"msg.scopeGuildOnlyMods")); await tryDelete(); return; }
          }
          d.scope = v;
          await tryDelete();
          await gotoNext(session, dm);
          break;
        }

        case "rewardType": {
          const v = content.toLowerCase();
          if (!oneOf(v, ["gold","item"])) { await dm.send("Bitte `gold` oder `item`."); await tryDelete(); return; }
          d.rewardType = v;
          if (v !== "item") d.rewardItemId = null;
          d.rewardQuantity = null;
          await tryDelete();
          session.awaitField = (v === "item") ? "rewardItem" : "rewardQty";
          await sendQuestionCard(session, dm);
          break;
        }

        case "rewardItem": {
          if (String(d.rewardType).toLowerCase() !== "item") { await tryDelete(); await gotoNext(session, dm); break; }
          if (isNumeric(content)) {
            d.rewardItemId = parseInt(content, 10);
            await tryDelete();
            await gotoNext(session, dm);
          } else {
            const candidates = await searchItemsByName(content);
            if (!candidates.length) { await dm.send(t(g, "msg.noneFound", { q: content })); await tryDelete(); return; }
            if (candidates.length === 1) {
              d.rewardItemId = candidates[0].id;
              await tryDelete();
              await gotoNext(session, dm);
            } else {
              const key = wizKey(session.guildId, d.ownerId);
              const sel = new StringSelectMenuBuilder()
                .setCustomId(`wiz:rewardpick:${key}`)
                .setPlaceholder(t(g, "msg.multipleRewardFound", { q: content }))
                .addOptions(candidates.slice(0,25).map(c => ({
                  label: c.name.slice(0,100),
                  description: `ID ${c.id}`,
                  value: String(c.id),
                })))
                .setMinValues(1).setMaxValues(1);
              await dm.send({
                embeds: [ new EmbedBuilder().setColor(0x2b2d31).setTitle("❓ Belohnungs-Item").setDescription(t(g,"msg.multipleRewardFound",{q:content})) ],
                components: [ new ActionRowBuilder().addComponents(sel) ]
              });
              await tryDelete();
            }
          }
          break;
        }

        case "rewardQty": {
          const n = parseNumberFromText(content);
          if (n == null || n < 0) { await dm.send(t(g,"msg.invalidNumber0") || "Whole number ≥ 0."); await tryDelete(); return; }
          d.rewardQuantity = n; // robust parsing; no more 0 unless really 0
          await tryDelete();
          await gotoNext(session, dm);
          break;
        }

        case "rewardPer": {
          const v = content.toLowerCase();
          if (!oneOf(v, ["per_item","per_stack"])) { await dm.send("Bitte `per_item` oder `per_stack`."); await tryDelete(); return; }
          d.rewardPer = v;
          await tryDelete();
          // freeze current and show summary
          await markQuestionAnswered(session, "rewardPer", dm);
          await renderSummary(session, dm);
          break;
        }

        default:
          await tryDelete();
          await dm.send(t(g, "wizard.noPending") || "No question is pending right now.");
      }
    } catch (e) {
      console.error("Wizard DM error:", e);
      await dm.send("⚠️ Error while processing your input. Please try again.");
    }
  });
}

/* ---------------- Button & Select handlers ---------------- */
export function registerWizardInteractionHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!(interaction.isButton() || interaction.isStringSelectMenu())) return;

    // Start selector: wizkind:<buy|sell|cancel>:<sessionKey>
    if (interaction.isButton()) {
      const [tag, kind, sessKey] = (interaction.customId || "").split(":");
      if (tag === "wizkind") {
        const session = wizardSessions.get(sessKey);
        if (!session) { try { await interaction.reply({ content: "⏱️ Session abgelaufen.", ephemeral: true }); } catch {} return; }
        const dm = await interaction.user.createDM();
        await interaction.deferUpdate().catch(()=>{});

        if (kind === "cancel") {
          wizardSessions.delete(sessKey);
          await dm.send(t(session.guildId,"wizard.cancelled") || "❌ Abgebrochen.");
          return;
        }
        if (kind === "buy") {
          session.type = "buy";
          session.awaitField = "title";
          await sendQuestionCard(session, dm);
          return;
        }
        if (kind === "sell") {
          session.type = "sell";                 // <— NEU
          session.awaitField = "title";          // <— NEU
          await sendQuestionCard(session, dm);   // <— NEU
          return;
        }
      }
    }

    // Fixed-field selects: wizsel:<field>:<sessionKey>
    if (interaction.isStringSelectMenu()) {
      const [tag, field, sessKey] = (interaction.customId || "").split(":");
      if (tag === "wizsel") {
        const session = wizardSessions.get(sessKey);
        if (!session) { try { await interaction.reply({ content: "⏱️ Session abgelaufen.", ephemeral: true }); } catch {} return; }
        const dm = await interaction.user.createDM();
        const d  = session.draft;
        const val = interaction.values?.[0];

        await interaction.deferUpdate().catch(()=>{});

        // Mappe Feldnamen auf die tatsächlichen Draft-Keys
        const fieldMap = {
          qmode: "quantityMode",
          // die anderen passen bereits 1:1: mode, scope, rewardType, rewardPer
        };

        const targetKey = fieldMap[field] || field;
        d[targetKey] = val;

        if (field === "qmode" && val === "infinite") {
          d.quantity = null;
        }
        if (field === "rewardType") {
          if (val === "gold") d.rewardItemId = null;
          d.rewardQuantity = null;
        }

        if (field === "rewardType") {
          if (val === "gold") d.rewardItemId = null;
          d.rewardQuantity = null;
        }

        await markQuestionAnswered(session, field, dm);

        let next = nextRelevantField(field, d);
        if (field === "rewardType") next = (val === "item") ? "rewardItem" : "rewardQty";
        if (!next) { await renderSummary(session, dm); return; }
        session.awaitField = next;
        await sendQuestionCard(session, dm);
        return;
      }

      // Search picks: wiz:itempick:<key> | wiz:rewardpick:<key>
      const [tag2, action, key] = (interaction.customId || "").split(":");
      if (tag2 === "wiz" && (action === "itempick" || action === "rewardpick")) {
        const session = wizardSessions.get(key);
        if (!session) { try { await interaction.reply({ content: "⏱️ Session abgelaufen.", ephemeral: true }); } catch {} return; }
        const dm = await interaction.user.createDM();
        await interaction.deferUpdate().catch(()=>{});

        if (action === "itempick") {
          session.draft.wowItemId = parseInt(interaction.values[0], 10);
          await markQuestionAnswered(session, "item", dm);
          session.awaitField = nextRelevantField("item", session.draft) || "qmode";
          await sendQuestionCard(session, dm);
          return;
        }
        if (action === "rewardpick") {
          session.draft.rewardItemId = parseInt(interaction.values[0], 10);
          await markQuestionAnswered(session, "rewardItem", dm);
          session.awaitField = nextRelevantField("rewardItem", session.draft) || "rewardQty";
          await sendQuestionCard(session, dm);
          return;
        }
      }
    }

    // Navigation: wiznav:<prev|reset|next>:<sessionKey>
    if (interaction.isButton()) {
      const [tag, action, sessKey] = (interaction.customId || "").split(":");
      if (tag === "wiznav") {
        const session = wizardSessions.get(sessKey);
        if (!session) { try { await interaction.reply({ content: "⏱️ Session abgelaufen.", ephemeral: true }); } catch {} return; }
        const dm = await interaction.user.createDM();
        const d  = session.draft;

        await interaction.deferUpdate().catch(()=>{});

        if (action === "prev") { await gotoPrev(session, dm); return; }
        if (action === "reset") {
          // freeze current (remove components), then reset and ask again
          const msgId = session.msgIds?.[session.awaitField];
          if (msgId) { const m = await dm.messages.fetch(msgId).catch(()=>null); if (m) await m.edit({ components: [] }).catch(()=>{}); }
          resetField(d, session.awaitField);
          await sendQuestionCard(session, dm);
          return;
        }
        if (action === "next") {
          if (!isStepSatisfied(d, session.awaitField)) {
            await dm.send("❗ Bitte zuerst einen gültigen Wert eingeben.");
            return;
          }
          await gotoNext(session, dm);
          return;
        }
      }
    }

    // Confirm: wizconfirm:<save|cancel>:<sessionKey>
    if (interaction.isButton()) {
      const [tag, what, sessKey] = (interaction.customId || "").split(":");
      if (tag === "wizconfirm") {
        const session = wizardSessions.get(sessKey);
        if (!session) { try { await interaction.reply({ content: "⏱️ Session abgelaufen.", ephemeral: true }); } catch {} return; }
        const g  = session.guildId;
        const dm = await interaction.user.createDM();

        await interaction.deferUpdate().catch(()=>{});

        if (what === "cancel") {
          wizardSessions.delete(sessKey);
          await dm.send(t(g, "wizard.cancelled") || "❌ Abgebrochen.");
          return;
        }

        // SAVE
        const orders = loadOrders(g);
        const order  = { ...session.draft, id: nextId(g), type: session.type || "buy" };  
        order.title = enforceTitlePrefix(order.type, order.title, g);
        orders.push(order);
        saveOrders(g, orders);

        // Daten 1x laden (außerhalb von if(origin), damit sie unten verfügbar sind)
        const itemInfo   = await getItemInfo(order.wowItemId).catch(()=>null);
        const rewardInfo = order.rewardType === "item" && order.rewardItemId
          ? await getItemInfo(order.rewardItemId).catch(()=>null)
          : null;

        // Post to original channel (genau EIN send, mit await buildEmbed + files)
        const origin = await interaction.client.channels.fetch(session.originChannelId).catch(()=>null);
        if (origin) {
          const itemInfo   = await getItemInfo(order.wowItemId).catch(()=>null);
          const rewardInfo = order.rewardType === "item" && order.rewardItemId
            ? await getItemInfo(order.rewardItemId).catch(()=>null)
            : null;

            const embed = await buildEmbed(order, itemInfo, rewardInfo, g);
            const files = [];
            if (embed.___attachment) { files.push(embed.___attachment); delete embed.___attachment; }
            
            const sent = await origin.send({
              embeds: [embed],
              components: buildPublicButtons(order, g), // << nur Public-Buttons
              files,
            });
            
            order.channelId = origin.id;
            order.messageId = sent.id;
            saveOrders(g, orders);
        }


        // DM-Success (lassen wir danach laufen)
        await renderSuccess(session, dm, order);

        // Session beenden
        wizardSessions.delete(sessKey);
        return;

      }
    }
  });
}

/* ---------------- Optional prompt wrappers ---------------- */
export async function wizPromptTitle(session, dm)      { session.awaitField = "title";      await sendQuestionCard(session, dm); }
export async function wizPromptItem(session, dm)       { session.awaitField = "item";       await sendQuestionCard(session, dm); }
export async function wizPromptQMode(session, dm)      { session.awaitField = "qmode";      await sendQuestionCard(session, dm); }
export async function wizPromptQuantity(session, dm)   { session.awaitField = "quantity";   await sendQuestionCard(session, dm); }
export async function wizPromptMode(session, dm)       { session.awaitField = "mode";       await sendQuestionCard(session, dm); }
export async function wizPromptScope(session, dm)      { session.awaitField = "scope";      await sendQuestionCard(session, dm); }
export async function wizPromptRewardType(session, dm) { session.awaitField = "rewardType"; await sendQuestionCard(session, dm); }
export async function wizPromptRewardItem(session, dm) { session.awaitField = "rewardItem"; await sendQuestionCard(session, dm); }
export async function wizPromptRewardQty(session, dm)  { session.awaitField = "rewardQty";  await sendQuestionCard(session, dm); }
export async function wizPromptRewardPer(session, dm)  { session.awaitField = "rewardPer";  await sendQuestionCard(session, dm); }
