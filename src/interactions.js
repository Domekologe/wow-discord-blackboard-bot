// interactions.js
// Handles slash commands, buttons (public 'Aktionen…' + ephemeral viewer controls)
// Author: Domekologe

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  MessageFlagsBitField
} from "discord.js";
import { t, getLang, setLang } from "./i18n.js";
import { loadOrders, saveOrders } from "./storage.js";
import { loadConfig, saveConfig } from "./guildConfig.js";
import { getItemInfo } from "./blizzardApi.js";
import { ensureAllowedChannel, isModerator, wizKey, enforceTitlePrefix } from "./helpers.js";
import { buildEmbed, buildPublicButtons, buildViewerButtons } from "./uiBuilders.js";
import { wizardSessions } from "./wizard.js";

// --- helpers -------------------------------------------------
async function safeReply(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(options);
    return await interaction.reply(options);
  } catch {
    try { return await interaction.followUp(options); } catch {}
  }
}

async function updateChannelMessage(order, interaction, guildId) {
  const itemInfo   = await getItemInfo(order.wowItemId).catch(()=>null);
  const rewardInfo = (order.rewardType === "item" && order.rewardItemId)
    ? await getItemInfo(order.rewardItemId).catch(()=>null)
    : null;

  const eb = await buildEmbed(order, itemInfo, rewardInfo, guildId);
  const files = [];
  if (eb.___attachment) { files.push(eb.___attachment); delete eb.___attachment; }

  // WICHTIG: die Originalnachricht editieren – nicht editReply()
  await interaction.message.edit({
    embeds: [eb],
    components: buildPublicButtons(order, guildId),
    files,
  });
}

// -------------------------------------------------------------
export function registerInteractionHandler(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!(interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu() || interaction.isAutocomplete())) return;
    async function deleteIfEphemeral(inter) {
      try {
        const isEphemeral =
          inter?.message?.flags?.has?.(MessageFlagsBitField.Flags.Ephemeral);
        if (isEphemeral) {
          // löscht GENAU die ephemere Message, von der der Buttonklick kam
          await inter.webhook.deleteMessage(inter.message.id).catch(() => {});
        }
      } catch {}
    }
    // ---------- Autocomplete: /change-bb id ----------
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

    // ---------- Slash commands ----------
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
              t(guildId, "setup.configHeader") || "Config:",
              `• Lang: \`${getLang(guildId)}\``,
              `• Mod roles: ${(cfg.modRoleIds||[]).length ? (cfg.modRoleIds.map(id=>`<@&${id}>`).join(", ")) : (t(guildId,"setup.configNone") || "—")}`,
              `• Allowed channels: ${(cfg.allowedChannelIds||[]).length ? (cfg.allowedChannelIds.map(id=>`<#${id}>`).join(", ")) : (t(guildId,"setup.configNone") || "—")}`,
            ].join("\n");
            return safeReply(interaction, { content: text, ephemeral: true });
          }

          if (direct) return safeReply(interaction, { content: t(guildId, "setup.langSet", { lang: direct === "de" ? (t(guildId,"setup.langDE")||"Deutsch") : (t(guildId,"setup.langEN")||"English") }), ephemeral: true });
          if (changed) return safeReply(interaction, { content: "✅", ephemeral: true });
          return safeReply(interaction, { content: "ℹ️ Nothing changed.", ephemeral: true });
        }

        // /wizard-bb – Start: DM mit Buy/Sell Auswahl
        if (interaction.commandName === "wizard-bb") {
          if (!ensureAllowedChannel(interaction)) return;
          const dm = await interaction.user.createDM();
          const key = wizKey(guildId, interaction.user.id);

          wizardSessions.set(key, {
            guildId,
            originChannelId: interaction.channelId,
            dmChannelId: dm.id,
            type: null,
            awaitField: null,
            draft: {
              id: null,
              title: "",
              requester: interaction.user.globalName || interaction.user.username,
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
            new ButtonBuilder().setCustomId(`wizkind:buy:${key}`).setLabel("Ankauf").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`wizkind:sell:${key}`).setLabel("Verkauf").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`wizkind:cancel:${key}`).setLabel("Abbrechen").setStyle(ButtonStyle.Danger),
          );
          await dm.send({ content: `**${t(guildId,"wizard.startTitle") || "Assistent starten"}**\n${t(guildId,"wizard.chooseAction") || "Was möchtest du erstellen?"}`, components: [row] });
          return safeReply(interaction, { content: (t(guildId,"wizard.checkDm") || "Ich habe dir eine DM geschickt. 🙂"), ephemeral: true });
        }

        // /list-bb
        if (interaction.commandName === "list-bb") {
          if (orders.length === 0) return safeReply(interaction, { content: "📭", ephemeral: true });
          const lines = orders.map(o => `#${o.id} — **${o.title}** (${o.quantity ?? "∞"} × ${o.wowItemId}) [${o.mode}]${o.closed ? " — closed" : ""}`);
          return safeReply(interaction, { content: lines.join("\n"), ephemeral: true });
        }

        // /change-bb
        if (interaction.commandName === "change-bb") {
          await interaction.deferReply({ ephemeral: true });

          const id = interaction.options.getInteger("id") ?? Number(interaction.options.getString("id"));
          if (!id) return interaction.editReply("Bitte eine gültige ID auswählen.");

          const orders  = loadOrders(guildId);
          const isMod = interaction.inGuild() &&
                        interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
          const order = orders.find(o => o.id === id && (isMod || o.ownerId === interaction.user.id));
          if (!order) return interaction.editReply("❌ Auftrag nicht gefunden (oder keine Berechtigung).");

          // optionale Felder übernehmen
          const setStr = (name, key = name) => {
            const v = interaction.options.getString(name);
            if (typeof v === "string") order[key] = v;
          };
          const setInt = (name, key = name) => {
            const v = interaction.options.getInteger(name);
            if (Number.isInteger(v)) order[key] = v;
          };

          // Titel mit Präfix erzwingen
          const newTitleRaw = interaction.options.getString("title");
          if (typeof newTitleRaw === "string") {
            order.title = enforceTitlePrefix(order.type || "buy", newTitleRaw, guildId);
          }

          setStr("requester", "requester");
          setStr("mode", "mode");
          setStr("scope", "scope");
          setStr("reward_type", "rewardType");
          setStr("reward_per", "rewardPer");
          setInt("quantity", "quantity");
          setInt("reward_quantity", "rewardQuantity");
          setInt("reward_item_id", "rewardItemId");
          setInt("wow_item_id", "wowItemId");

          if (order.rewardType === "gold") order.rewardItemId = null;
          if (order.quantityMode === "infinite") order.quantity = null;
          if (order.scope === "guild" && !isMod) order.scope = "personal";

          saveOrders(guildId, orders);

          // Original-Message aktualisieren (mit nur öffentlichem Button)
          let updatedChannelMsg = false;
          try {
            const itemInfo   = await getItemInfo(order.wowItemId).catch(()=>null);
            const rewardInfo = (order.rewardType === "item" && order.rewardItemId)
              ? await getItemInfo(order.rewardItemId).catch(()=>null)
              : null;

            const eb = await buildEmbed(order, itemInfo, rewardInfo, guildId);
            const files = [];
            if (eb.___attachment) { files.push(eb.___attachment); delete eb.___attachment; }

            if (order.channelId && order.messageId) {
              const ch  = await client.channels.fetch(order.channelId).catch(()=>null);
              const msg = ch ? await ch.messages.fetch(order.messageId).catch(()=>null) : null;
              if (msg) {
                await msg.edit({ embeds: [eb], components: buildPublicButtons(order, guildId), files });
                updatedChannelMsg = true;
              }
            }

            await interaction.editReply(`✅ Auftrag #${order.id} aktualisiert${updatedChannelMsg ? " und im Kanal angepasst." : " (Kanal-Posting nicht gefunden)."}`);
          } catch (e) {
            console.error("change-bb update error:", e);
            await interaction.editReply("⚠️ Aktualisierung gespeichert, aber das Kanal-Posting konnte nicht editiert werden.");
          }

          return;
        }

      } catch (err) {
        console.error("❌ Command error:", err);
        if (!interaction.replied) await safeReply(interaction, { content: "⚠️ Internal error.", ephemeral: true });
      }
      return;
    }

    // ---------- Buttons ----------
    if (interaction.isButton()) {
      const [action, idStr] = (interaction.customId || "").split(":");
      const id = Number(idStr);
      if (!Number.isFinite(id)) return;
    
      const guildId = interaction.guildId;
    
      try { await interaction.deferUpdate(); } catch {}
    
      let orders = loadOrders(guildId);
      const order = orders.find(o => o.id === id);
      if (!order) {
        try { await interaction.followUp({ ephemeral: true, content: t(guildId,"msg.orderNotFound") || "Auftrag nicht gefunden." }); } catch {}
        return;
      }
    
      // ----- öffentl. Kanal-Post aktualisieren -----
      const refresh = async () => {
        const itemInfo   = await getItemInfo(order.wowItemId).catch(() => null);
        const rewardInfo = (order.rewardType === "item" && order.rewardItemId)
          ? await getItemInfo(order.rewardItemId).catch(() => null)
          : null;
    
        const eb = await buildEmbed(order, itemInfo, rewardInfo, guildId);
        const files = [];
        if (eb.___attachment) { files.push(eb.___attachment); delete eb.___attachment; }
    
        // bevorzugt: Original-Message per gespeicherten IDs bearbeiten
        if (order.channelId && order.messageId) {
          const ch  = await interaction.client.channels.fetch(order.channelId).catch(() => null);
          const msg = ch ? await ch.messages.fetch(order.messageId).catch(() => null) : null;
          if (msg) {
            await msg.edit({ embeds: [eb], components: buildPublicButtons(order, guildId), files });
            return;
          }
        }
    
        // Fallback: nur wenn es KEINE ephemere Nachricht ist und sie editierbar ist
        if (!interaction.ephemeral && interaction.message?.editable) {
          await interaction.message.edit({ embeds: [eb], components: buildPublicButtons(order, guildId), files });
        }
      };
    
      try {
        // — Aktionen-Menü öffnet nur ein ephemeres Panel —
        if (action === "actions") {
          await interaction.followUp({
            ephemeral: true,
            content: `⚙️ Aktionen für Auftrag #${order.id}:`,
            components: buildViewerButtons(order, interaction.member, guildId),
          });
          return;
        }
    
        if (action === "claim") {
          if (order.closed) {
            await interaction.followUp({ ephemeral: true, content: t(guildId,"msg.orderClosed") || "Schon geschlossen." });
            return;
          }
          if (order.takenBy.includes(interaction.user.id)) {
            await interaction.followUp({ ephemeral: true, content: "Du hast den Auftrag bereits angenommen." });
            return;
          }
          if (order.mode === "single" && order.takenBy.length > 0) {
            await interaction.followUp({ ephemeral: true, content: "❌ Bereits vergeben." });
            return;
          }
          order.takenBy.push(interaction.user.id);
          saveOrders(guildId, orders);
    
          await refresh(); // öffentl. Post updaten
          await deleteIfEphemeral(interaction); 
          await interaction.followUp({
            ephemeral: true,
            content: "✅ Du hast den Auftrag übernommen.",
            //components: buildViewerButtons(order, interaction.member, guildId),
          });
          return;
        }
    
        if (action === "unclaim") {
          if (!order.takenBy.includes(interaction.user.id)) {
            await interaction.followUp({ ephemeral: true, content: "❌ Du hast diesen Auftrag nicht angenommen." });
            return;
          }
          order.takenBy = order.takenBy.filter(u => u !== interaction.user.id);
          saveOrders(guildId, orders);
    
          await refresh();
          await deleteIfEphemeral(interaction); 
          await interaction.followUp({
            ephemeral: true,
            content: "↩️ Auftrag aufgegeben.",
            //components: buildViewerButtons(order, interaction.member, guildId),
          });
          return;
        }
    
        if (action === "close") {
          const canManage = order.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
          if (!canManage) { await interaction.followUp({ ephemeral: true, content: "❌ Keine Berechtigung." }); return; }
          order.closed = true;
          saveOrders(guildId, orders);
          await refresh();
          await deleteIfEphemeral(interaction); 
          return;
        }
    
        if (action === "open") {
          const canManage = order.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
          if (!canManage) { await interaction.followUp({ ephemeral: true, content: "❌ Keine Berechtigung." }); return; }
          order.closed = false;
          saveOrders(guildId, orders);
          await refresh();
          await deleteIfEphemeral(interaction); 
          return;
        }
    
        if (action === "remove") {
          const canManage =
            order.ownerId === interaction.user.id ||
            isModerator(interaction.member, guildId);
        
          if (!canManage) {
            try {
              await interaction.followUp({ content: "❌ Keine Berechtigung.", ephemeral: true });
            } catch {}
            return;
          }
        
          // 1) Öffentlichen Post löschen (falls wir die IDs kennen)
          try {
            if (order.channelId && order.messageId) {
              const ch  = await interaction.client.channels.fetch(order.channelId).catch(() => null);
              const msg = ch ? await ch.messages.fetch(order.messageId).catch(() => null) : null;
              if (msg) await msg.delete().catch(() => {});
            }
          } catch (e) {
            console.error("remove: delete channel message failed:", e);
          }
        
          // 2) Auftrag aus Storage löschen
          orders = orders.filter(o => o.id !== order.id);
          saveOrders(guildId, orders);
        
          // 3) Ephemere Aktions-Nachricht (falls vorhanden) schließen
          await deleteIfEphemeral(interaction);
        
          // 4) Kurze Bestätigung (ephemeral)
          try {
            await interaction.followUp({
              ephemeral: true,
              content: `🗑️ Auftrag #${order.id} gelöscht.`,
            });
          } catch {}
        
          return;
        }
        
    
        if (action === "change") {
          await deleteIfEphemeral(interaction); 
          if (order.closed) { await interaction.followUp({ ephemeral: true, content: t(guildId,"msg.orderClosedNoChange") || "Geschlossen – nicht änderbar." }); return; }
          const canManage = order.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
          if (!canManage) { await interaction.followUp({ ephemeral: true, content: "❌ Keine Berechtigung." }); return; }
          await interaction.followUp({ ephemeral: true, content: "✏️ Nutze `/change-bb` zum Bearbeiten." });
          return;
        }
    
        // Fallback: falls oben kein Return
        await refresh();
    
      } catch (e) {
        console.error("❌ Button error:", e);
        try { await interaction.followUp({ ephemeral: true, content: "⚠️ Interner Fehler." }); } catch {}
      }
      return;
    }
    
    

  });
}
