// Blackboard plugin: /auftrag, /auftrag_wizard, /auftrag_list, /auftrag_cancel
// Author: Domekologe | Comments: English (DE/EN locales externalized)

import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  EmbedBuilder, PermissionFlagsBits
} from 'discord.js';
import Database from 'better-sqlite3';
import { request } from 'undici';
import fs from 'node:fs';
import crypto from 'node:crypto';

// --- tiny i18n loader
function loadLocale(locale) {
  const path = new URL(`../locales/${locale}.json`, import.meta.url);
  if (fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  }
  // fallback to de
  const dePath = new URL(`../locales/de.json`, import.meta.url);
  return JSON.parse(fs.readFileSync(dePath, 'utf-8'));
}
function T(dict, key, vars = {}) {
  const raw = dict[key] || key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// --- SQLite (file in project root)
const DB = new Database('blackboard.db');
DB.exec(`
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY,
  messageId TEXT, channelId TEXT, guildId TEXT, creatorId TEXT,
  itemId INTEGER, assignment TEXT, neededBy TEXT,
  rewardTotal TEXT, rewardPerStack TEXT, notes TEXT,
  claims INTEGER DEFAULT 0, maxClaims INTEGER, createdAt INTEGER
);
CREATE TABLE IF NOT EXISTS order_claims(
  orderId TEXT NOT NULL, userId TEXT NOT NULL,
  UNIQUE(orderId, userId) ON CONFLICT IGNORE
);
`);

const Q = {
  insertOrder: DB.prepare(`
    INSERT INTO orders (id,messageId,channelId,guildId,creatorId,itemId,assignment,neededBy,rewardTotal,rewardPerStack,notes,claims,maxClaims,createdAt)
    VALUES (@id,@messageId,@channelId,@guildId,@creatorId,@itemId,@assignment,@neededBy,@rewardTotal,@rewardPerStack,@notes,0,@maxClaims,@createdAt)
  `),
  byMessage: DB.prepare(`SELECT * FROM orders WHERE messageId=?`),
  byChannelOpen: DB.prepare(`SELECT * FROM orders WHERE channelId=? AND messageId IS NOT NULL`),
  setClaims: DB.prepare(`UPDATE orders SET claims=? WHERE id=?`),
  setMessageId: DB.prepare(`UPDATE orders SET messageId=? WHERE id=?`),
  addClaim: DB.prepare(`INSERT OR IGNORE INTO order_claims (orderId,userId) VALUES (?,?)`),
  delClaim: DB.prepare(`DELETE FROM order_claims WHERE orderId=? AND userId=?`),
  listClaims: DB.prepare(`SELECT userId FROM order_claims WHERE orderId=?`),
  deleteOrderByMessage: DB.prepare(`DELETE FROM orders WHERE messageId=?`)
};
const listClaimers = (orderId) => Q.listClaims.all(orderId).map(r => r.userId);

// --- Blizzard API (MoP Classic) via undici
async function blizzToken() {
  const region = process.env.BLIZZ_REGION;
  const auth = Buffer.from(`${process.env.BLIZZ_CLIENT_ID}:${process.env.BLIZZ_CLIENT_SECRET}`).toString('base64');
  const { body } = await request(`https://${region}.battle.net/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const j = await body.json();
  if (!j.access_token) throw new Error('Blizzard token error');
  return j.access_token;
}
async function fetchItem(itemId) {
  const region = process.env.BLIZZ_REGION;
  const locale = process.env.BLIZZ_LOCALE || 'en_US';
  const ns = process.env.BLIZZ_NAMESPACE_STATIC;
  const nsMedia = process.env.BLIZZ_NAMESPACE_MEDIA || ns;
  const token = await blizzToken();
  const head = { authorization: `Bearer ${token}` };

  const itemRes = await request(`https://${region}.api.blizzard.com/data/wow/item/${itemId}?namespace=${ns}&locale=${locale}`, { headers: head });
  if (itemRes.statusCode >= 400) throw new Error(`Item ${itemId} not found`);
  const item = await itemRes.body.json();

  const mediaRes = await request(`https://${region}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=${nsMedia}&locale=${locale}`, { headers: head });
  const media = await mediaRes.body.json();
  const icon = (media.assets || []).find(a => a.key === 'icon')?.value || media.assets?.[0]?.value;

  const quality = item.quality?.name || '';
  const ilvl = item.level ?? item.item_level;
  const tooltip = [quality && `**${quality}**`, ilvl && `iLvl ${ilvl}`, item.required_level && `Req. Level ${item.required_level}`]
    .filter(Boolean).join(' • ');

  return { id: itemId, name: item.name, iconUrl: icon, tooltip };
}

// --- Embed + Buttons
function buildOrderEmbed(dict, order, item) {
  const fields = [
    { name: T(dict, 'embed.creator'), value: `<@${order.creatorId}>`, inline: true },
    { name: T(dict, 'embed.neededBy'), value: order.neededBy, inline: true }
  ];
  if (order.rewardTotal)   fields.push({ name: T(dict, 'embed.rewardTotal'),   value: order.rewardTotal,   inline: true });
  if (order.rewardPerStack)fields.push({ name: T(dict, 'embed.rewardPerStack'),value: order.rewardPerStack,inline: true });
  if (order.notes)         fields.push({ name: T(dict, 'embed.notes'),         value: order.notes,         inline: false });

  return new EmbedBuilder()
    .setAuthor({ name: 'Schwarzes Brett' })
    .setTitle(item.name)
    .setDescription(item.tooltip)
    .setThumbnail(item.iconUrl)
    .setImage(item.iconUrl)
    .addFields(fields)
    .setFooter({ text: `${T(dict, 'embed.claimed')}: ${order.claims || 0}` });
}
function buildButtons(disableClaim=false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('order.claim').setLabel('Übernehmen').setStyle(ButtonStyle.Success).setDisabled(disableClaim),
    new ButtonBuilder().setCustomId('order.unclaim').setLabel('Abmelden').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('order.done').setLabel('Erledigt').setStyle(ButtonStyle.Danger)
  );
}

// --- Slash command builders
const cmdAuftrag = new SlashCommandBuilder()
  .setName('auftrag').setDescription('Erstellt einen Auftrag (Schwarzes Brett)')
  .addIntegerOption(o => o.setName('itemid').setDescription('WoW Item ID').setRequired(true))
  .addStringOption(o => o.setName('typ').setDescription('Einzel oder Mehrfach')
    .addChoices({ name: 'Einzelauftrag', value: 'single' }, { name: 'Mehrfach/Dauerauftrag', value: 'multi' }).setRequired(true))
  .addStringOption(o => o.setName('benoetigt_von').setDescription('z.B. Gildenbank, Spielername').setRequired(true))
  .addStringOption(o => o.setName('belohnung_gesamt').setDescription('z.B. 1000g'))
  .addStringOption(o => o.setName('belohnung_stack').setDescription('Belohnung pro Stack'))
  .addStringOption(o => o.setName('info').setDescription('Extra Informationen'))
  .addIntegerOption(o => o.setName('max_claims').setDescription('Nur bei Mehrfach: maximale Anmeldungen'));

const cmdWizard = new SlashCommandBuilder()
  .setName('auftrag_wizard').setDescription('Erstellt einen Auftrag per DM-Dialog');

const cmdList = new SlashCommandBuilder()
  .setName('auftrag_list').setDescription('Listet offene Aufträge im aktuellen Channel')
  .addBooleanOption(o => o.setName('ephemeral').setDescription('Liste nur für dich anzeigen'));

const cmdCancel = new SlashCommandBuilder()
  .setName('auftrag_cancel').setDescription('Schließt einen Auftrag unter dieser Nachricht')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// --- DM wizard state (in-memory)
const Wizard = new Map(); // userId -> data

async function previewAndConfirm(i, dict) {
  const d = Wizard.get(i.user.id);
  const item = await fetchItem(d.itemId);
  const preview = buildOrderEmbed(dict, { ...d, claims: 0 }, item);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz.publish').setLabel('Veröffentlichen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('wiz.cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
  );
  return i.reply({ ephemeral: true, content: 'Vorschau. Alles korrekt?', embeds: [preview], components: [row] });
}

export async function registerBoard(client, defaultLocale = 'de') {
  const dict = loadLocale(defaultLocale);

  // Register guild-scoped commands (fast updates)
  await client.application.commands.set(
    [cmdAuftrag, cmdWizard, cmdList, cmdCancel].map(c => c.toJSON()),
    process.env.DISCORD_GUILD_ID
  );

  client.on('interactionCreate', async (i) => {
    try {
      // --- /auftrag
      if (i.isChatInputCommand() && i.commandName === 'auftrag') {
        await i.deferReply();
        const itemId = i.options.getInteger('itemid', true);
        const assignment = i.options.getString('typ', true);
        const neededBy = i.options.getString('benoetigt_von', true);
        const rewardTotal = i.options.getString('belohnung_gesamt') || undefined;
        const rewardPerStack = i.options.getString('belohnung_stack') || undefined;
        const notes = i.options.getString('info') || undefined;
        const maxClaims = i.options.getInteger('max_claims') ?? null;

        const item = await fetchItem(itemId);
        const embed = buildOrderEmbed(dict, {
          creatorId: i.user.id, neededBy, rewardTotal, rewardPerStack, notes, claims: 0
        }, item);

        const msg = await i.editReply({ embeds: [embed], components: [buildButtons(false)] });

        const id = crypto.randomUUID();
        Q.insertOrder.run({
          id, messageId: msg.id, channelId: i.channelId, guildId: i.guildId, creatorId: i.user.id,
          itemId, assignment, neededBy, rewardTotal, rewardPerStack, notes, maxClaims, createdAt: Date.now()
        });
        return;
      }

      // --- /auftrag_wizard
      if (i.isChatInputCommand() && i.commandName === 'auftrag_wizard') {
        await i.reply({ ephemeral: true, content: 'Ich habe dir eine DM geschickt – wir erstellen den Auftrag Schritt für Schritt. ✉️' });
        const dm = await i.user.createDM();
        Wizard.set(i.user.id, { guildId: i.guildId, channelId: i.channelId, creatorId: i.user.id, assignment: 'single', maxClaims: null });
        const startRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('wiz.start').setLabel('Auftrag erstellen').setStyle(ButtonStyle.Primary)
        );
        await dm.send({ content: 'Lass uns starten! Klicke unten, um die Felder zu öffnen.', components: [startRow] });
        return;
      }

      // --- /auftrag_list
      if (i.isChatInputCommand() && i.commandName === 'auftrag_list') {
        const ephemeral = i.options.getBoolean('ephemeral') ?? true;
        const orders = Q.byChannelOpen.all(i.channelId);
        if (!orders.length) {
          return i.reply({ ephemeral, content: T(dict, 'list.empty') });
        }
        const lines = [ `**${T(dict,'list.header')}**` ];
        for (const o of orders) {
          // Try fetch item name (best-effort)
          let name = `Item ${o.itemId}`;
          try { const item = await fetchItem(o.itemId); name = item.name; } catch {}
          const type = o.assignment === 'single' ? 'Einzel' : 'Mehrfach';
          lines.push(T(dict, 'list.item', { name, claims: o.claims, type }));
        }
        return i.reply({ ephemeral, content: lines.join('\n') });
      }

      // --- /auftrag_cancel (close message above by author or mod)
      if (i.isChatInputCommand() && i.commandName === 'auftrag_cancel') {
        // Must be reply to a message (or we try last bot message)
        const channel = await i.channel.fetch(true);
        let targetMessage = null;
        try {
          const ref = i.options.getMessage?.('message'); // not available by default; so fallback:
          const fetched = await channel.messages.fetch({ limit: 10 });
          targetMessage = fetched.find(m => m.author.id === client.user.id && m.components?.length);
        } catch {}
        if (!targetMessage) {
          // Try the message being replied to
          if (i.replied || i.deferred) {
            // nothing
          }
        }
        // Simplify: close most recent bot order message in channel
        const recent = await channel.messages.fetch({ limit: 25 });
        const botMsg = recent.find(m => m.author.id === client.user.id && m.components?.length);
        if (!botMsg) return i.reply({ ephemeral: true, content: 'Kein Auftragspost im Blick gefunden.' });

        const rec = Q.byMessage.get(botMsg.id);
        if (!rec) return i.reply({ ephemeral: true, content: 'Order not found.' });

        if (i.user.id !== rec.creatorId && !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
          return i.reply({ ephemeral: true, content: 'No permission.' });
        }
        await botMsg.edit({ components: [] });
        return i.reply({ ephemeral: true, content: T(dict, 'msg.cancelled') });
      }

      // --- Wizard flow
      if (i.isButton() && i.customId === 'wiz.start') {
        const modal = new ModalBuilder().setCustomId('wiz.modal.core').setTitle('Auftrag – Grunddaten');
        const itemId = new TextInputBuilder().setCustomId('f_item').setLabel('Item ID').setStyle(TextInputStyle.Short).setRequired(true);
        const neededBy = new TextInputBuilder().setCustomId('f_needed').setLabel('Benötigt von').setStyle(TextInputStyle.Short).setRequired(true);
        const rewardTotal = new TextInputBuilder().setCustomId('f_rtot').setLabel('Belohnung gesamt (optional)').setStyle(TextInputStyle.Short);
        const rewardStack = new TextInputBuilder().setCustomId('f_rstk').setLabel('Belohnung pro Stack (optional)').setStyle(TextInputStyle.Short);
        const notes = new TextInputBuilder().setCustomId('f_notes').setLabel('Extra Informationen (optional)').setStyle(TextInputStyle.Paragraph);
        modal.addComponents(
          new ActionRowBuilder().addComponents(itemId),
          new ActionRowBuilder().addComponents(neededBy),
          new ActionRowBuilder().addComponents(rewardTotal),
          new ActionRowBuilder().addComponents(rewardStack),
          new ActionRowBuilder().addComponents(notes)
        );
        return i.showModal(modal);
      }

      if (i.isModalSubmit() && i.customId === 'wiz.modal.core') {
        const d = Wizard.get(i.user.id) || {};
        d.itemId = parseInt(i.fields.getTextInputValue('f_item'), 10);
        d.neededBy = i.fields.getTextInputValue('f_needed');
        d.rewardTotal = i.fields.getTextInputValue('f_rtot') || undefined;
        d.rewardPerStack = i.fields.getTextInputValue('f_rstk') || undefined;
        d.notes = i.fields.getTextInputValue('f_notes') || undefined;
        Wizard.set(i.user.id, d);

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('wiz.sel.type').setPlaceholder('Auftragstyp wählen')
            .addOptions(
              { label: 'Einzelauftrag', value: 'single', description: 'Nur eine Person kann übernehmen' },
              { label: 'Mehrfach/Dauerauftrag', value: 'multi', description: 'Mehrere Personen können übernehmen' }
            )
        );
        return i.reply({ ephemeral: true, content: 'Wähle nun den Auftragstyp.', components: [row] });
      }

      if (i.isStringSelectMenu() && i.customId === 'wiz.sel.type') {
        const d = Wizard.get(i.user.id) || {};
        d.assignment = i.values[0];
        Wizard.set(i.user.id, d);

        if (d.assignment === 'multi') {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('wiz.mc.none').setLabel('Unbegrenzt').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('wiz.mc.set').setLabel('Obergrenze setzen').setStyle(ButtonStyle.Primary)
          );
          return i.reply({ ephemeral: true, content: 'Mehrfach/Dauerauftrag: Obergrenze für Anmeldungen?', components: [row] });
        }
        return previewAndConfirm(i, dict);
      }

      if (i.isButton() && i.customId === 'wiz.mc.none') {
        const d = Wizard.get(i.user.id); d.maxClaims = null; Wizard.set(i.user.id, d);
        return previewAndConfirm(i, dict);
      }

      if (i.isButton() && i.customId === 'wiz.mc.set') {
        const modal = new ModalBuilder().setCustomId('wiz.modal.max').setTitle('Maximale Anmeldungen');
        const max = new TextInputBuilder().setCustomId('f_max').setLabel('Max. Claims (Zahl)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(max));
        return i.showModal(modal);
      }

      if (i.isModalSubmit() && i.customId === 'wiz.modal.max') {
        const d = Wizard.get(i.user.id); const n = parseInt(i.fields.getTextInputValue('f_max'), 10);
        d.maxClaims = Number.isFinite(n) ? n : null; Wizard.set(i.user.id, d);
        return previewAndConfirm(i, dict);
      }

      if (i.isButton() && i.customId === 'wiz.publish') {
        const d = Wizard.get(i.user.id); if (!d) return i.reply({ ephemeral: true, content: 'Wizard abgebrochen/abgelaufen.' });
        const item = await fetchItem(d.itemId);
        const ch = await i.client.channels.fetch(d.channelId);
        const msg = await ch.send({ embeds: [buildOrderEmbed(dict, { ...d, claims: 0 }, item)], components: [buildButtons(false)] });

        const id = crypto.randomUUID();
        Q.insertOrder.run({
          id, messageId: msg.id, channelId: d.channelId, guildId: d.guildId, creatorId: d.creatorId,
          itemId: d.itemId, assignment: d.assignment, neededBy: d.neededBy,
          rewardTotal: d.rewardTotal, rewardPerStack: d.rewardPerStack, notes: d.notes, maxClaims: d.maxClaims,
          createdAt: Date.now()
        });
        Wizard.delete(i.user.id);
        return i.reply({ ephemeral: true, content: T(dict, 'msg.published') });
      }

      if (i.isButton() && i.customId === 'wiz.cancel') {
        Wizard.delete(i.user.id);
        return i.reply({ ephemeral: true, content: '❎ Abgebrochen.' });
      }

      // --- Claim buttons on the posted message
      if (i.isButton() && i.customId.startsWith('order.')) {
        const rec = Q.byMessage.get(i.message.id);
        if (!rec) return i.reply({ ephemeral: true, content: 'Order not found.' });

        if (i.customId === 'order.claim') {
          const count = listClaimers(rec.id).length;
          const reachedMax = (rec.assignment === 'multi' && rec.maxClaims != null && count >= rec.maxClaims);
          if ((rec.assignment === 'single' && count >= 1) || reachedMax) {
            return i.reply({ ephemeral: true, content: T(dict, 'msg.locked') });
          }
          const ins = Q.addClaim.run(rec.id, i.user.id);
          if (ins.changes === 0) return i.reply({ ephemeral: true, content: T(dict, 'msg.already') });
        }

        if (i.customId === 'order.unclaim') {
          Q.delClaim.run(rec.id, i.user.id);
        }

        if (i.customId === 'order.done') {
          if (i.user.id !== rec.creatorId && !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return i.reply({ ephemeral: true, content: 'No permission.' });
          }
          await i.message.edit({ components: [] });
          return i.reply({ ephemeral: true, content: T(dict, 'msg.closed') });
        }

        // refresh embed
        const claims = listClaimers(rec.id).length;
        Q.setClaims.run(claims, rec.id);
        const item = await fetchItem(rec.itemId);
        const embed = buildOrderEmbed(dict, { ...rec, claims }, item);
        const lock = (rec.assignment === 'single' && claims >= 1) || (rec.assignment === 'multi' && rec.maxClaims != null && claims >= rec.maxClaims);
        await i.update({ embeds: [embed], components: [buildButtons(lock)] });

        if (i.customId === 'order.claim')   return i.followUp({ ephemeral: true, content: T(dict, 'msg.claimed') });
        if (i.customId === 'order.unclaim') return i.followUp({ ephemeral: true, content: T(dict, 'msg.unclaimed') });
      }
    } catch (e) {
      console.error('[boardPlugin]', e);
      if (i.isRepliable && i.isRepliable() && !i.replied) {
        try { await i.reply({ ephemeral: true, content: 'Unexpected error.' }); } catch {}
      }
    }
  });
}
