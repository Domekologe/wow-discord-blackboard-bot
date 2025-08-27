// sellFeature.js
// "Ich verkaufe" feature (separate from buy/“Ich suche”)
// - Slash cmds: /sell-create, /sell-list, /sell-remove  (optional: /sell-change -> only hint)
// - Buttons: Buy / Unbuy (+ Close / Remove / Change for seller+mods; Open only for owner when closed)
// - Localized via i18n keys (see notes at bottom)
// Comments in English
// Author: Domekologe

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { loadSell, saveSell } from "./sellStorage.js";

export function registerSellFeature(client, deps) {
  // --- dependencies injected to avoid circular imports ---
  const {
    t,
    ensureAllowedChannel: allowChannel, // alias to avoid naming clashes
    isModerator,
    getItemInfo,
    searchItemsByName,
  } = deps;

  // Guard for easier debugging
  if (typeof allowChannel !== "function") {
    console.error("[sellFeature] ensureAllowedChannel missing in deps");
  }

  // ---------- safe reply helper (prevents 'Unknown interaction') ----------
  async function safeReply(interaction, options) {
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp(options);
      }
      return await interaction.reply(options);
    } catch {
      try { return await interaction.followUp(options); } catch {}
    }
  }

  // ---------- per-guild counters ----------
  const counters = {};
  function nextId(guildId) {
    counters[guildId] = (counters[guildId] || 0) + 1;
    return counters[guildId];
  }

  // init counters on both events (v14: 'ready', v15: 'clientReady')
  const initCounters = () => {
    for (const [guildId] of client.guilds.cache) {
      const items = loadSell(guildId);
      counters[guildId] = items.reduce((m, o) => Math.max(m, o.id || 0), 0);
    }
  };
  client.once("ready", initCounters);
  client.once("clientReady", initCounters);

  // simple pending stash for select menus on create
  const __sellPending = new Map();

  // ---------- helpers ----------
  function qtyText(entry, guildId) {
    if (entry.quantityMode === "infinite") return t(guildId, "quantity.infinite");
    const key = entry.quantityMode === "stacks" ? "quantity.stacks" : "quantity.items";
    return t(guildId, key, { n: entry.quantity });
  }

  function priceToText(entry, guildId) {
    const perStack = entry.pricePer === "per_stack";
    if (entry.priceType === "gold") {
      return perStack
        ? t(guildId, "sell.price.goldPerStack", { n: entry.priceQuantity })
        : t(guildId, "sell.price.goldPerItem",  { n: entry.priceQuantity });
    }
    return perStack
      ? t(guildId, "sell.price.itemPerStack", { n: entry.priceQuantity, id: entry.priceItemId })
      : t(guildId, "sell.price.itemPerItem",  { n: entry.priceQuantity, id: entry.priceItemId });
  }

  function safeT(guildId, key, fallback) {
    const v = t(guildId, key);
    return (v && v !== key) ? v : fallback;
  }

  // ---------- UI builders ----------
  function buildSellEmbed(entry, itemInfo, priceInfo, guildId) {
    const titlePrefix = t(guildId, "sell.embed.titlePrefix") || "Verkauf";
    const desc = (t(guildId, "sell.embed.entry", { id: entry.id }) || `Eintrag #${entry.id}`)
               + (entry.closed ? (t(guildId, "sell.embed.closedSuffix") || " — geschlossen") : "");
    const scopeText = safeT(guildId, `wizard.scope.${entry.scope}`, entry.scope);
    const modeText  = safeT(guildId, `wizard.mode.${entry.mode}`,   entry.mode);

    const embed = new EmbedBuilder()
      .setColor(entry.closed ? 0xcb4335 : 0x2b2d31)
      .setTitle(`${titlePrefix} ${entry.title}`)
      .setDescription(`**${desc}**`)
      .addFields(
        { name: t(guildId, "sell.fields.seller")      || "Verkäufer",    value: entry.seller, inline: true },
        { name: t(guildId, "sell.fields.requestType") || "Angebotstyp",  value: scopeText,    inline: true },
        { name: t(guildId, "sell.fields.mode")        || "Modus",        value: modeText,     inline: true },

        { name: t(guildId, "sell.fields.item")        || "Gegenstand",
          value: `${itemInfo?.name ?? `Item #${entry.wowItemId}`} (ID: ${entry.wowItemId})`,
          inline: false },

        { name: t(guildId, "sell.fields.quantity")    || "Menge", value: qtyText(entry, guildId), inline: true },
        { name: t(guildId, "sell.fields.price")       || "Preis",
          value: priceToText(entry, guildId) + (priceInfo ? `\n• ${priceInfo.name} (ID: ${entry.priceItemId})` : ""),
          inline: true },

        { name: t(guildId, "sell.fields.buyers")      || "Reserviert von",
          value: (Array.isArray(entry.takenBy) && entry.takenBy.length ? entry.takenBy.map(u => `<@${u}>`).join(", ") : "—"),
          inline: false },
      )
      .setFooter({ text: `Created by ${entry.ownerTag}` })
      .setTimestamp();

    if (itemInfo?.iconUrl) embed.setThumbnail(itemInfo.iconUrl);
    embed.setURL(`https://classic.wowhead.com/item=${entry.wowItemId}`);
    return embed;
  }

  function buildSellButtons(entry, viewerMember, guildId) {
    const viewerId = viewerMember?.user?.id ?? viewerMember?.id ?? null;
    const isManager =
      (viewerId && entry.ownerId === viewerId) ||
      isModerator(viewerMember, guildId);

    const taken = Array.isArray(entry.takenBy) ? entry.takenBy : [];
    const alreadyByViewer = viewerId ? taken.includes(viewerId) : false;

    const row = new ActionRowBuilder();

    // Closed: only Open (owner) + Remove (owner/mod)
    if (entry.closed) {
      if (viewerId && viewerId === entry.ownerId) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`sell_open:${entry.id}`)
            .setStyle(ButtonStyle.Primary)
            .setLabel(t(guildId, "sell.buttons.open") || "Öffnen")
        );
      }
      if (isManager) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`sell_remove:${entry.id}`)
            .setStyle(ButtonStyle.Danger)
            .setLabel(t(guildId, "sell.buttons.remove") || "Löschen")
        );
      }
      return row.components.length ? [row] : [];
    }

    // Open: Buy/Unbuy + Close/Remove/Change (manager)
    const canBuy   = !alreadyByViewer && (entry.mode === "multi" || taken.length === 0);
    const canUnbuy = alreadyByViewer;

    if (canBuy) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sell_buy:${entry.id}`)
          .setStyle(ButtonStyle.Success)
          .setLabel(t(guildId, "sell.buttons.buy") || "Kaufen")
      );
    }
    if (canUnbuy) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sell_unbuy:${entry.id}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t(guildId, "sell.buttons.unbuy") || "Stornieren")
      );
    }
    if (isManager) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sell_close:${entry.id}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel(t(guildId, "sell.buttons.close") || "Schließen"),
        new ButtonBuilder()
          .setCustomId(`sell_remove:${entry.id}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel(t(guildId, "sell.buttons.remove") || "Löschen"),
        new ButtonBuilder()
          .setCustomId(`sell_change:${entry.id}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel(t(guildId, "sell.buttons.change") || "Ändern"),
      );
    }

    return row.components.length ? [row] : [];
  }

  async function postOrUpdateSell(interactionLike, entry) {
    const guildId   = interactionLike.guildId;
    const itemInfo  = await getItemInfo(entry.wowItemId);
    const priceInfo = (entry.priceType === "item" && entry.priceItemId)
      ? await getItemInfo(entry.priceItemId)
      : null;

    const embed      = buildSellEmbed(entry, itemInfo, priceInfo, guildId);
    const viewer     = interactionLike.member || interactionLike.user || interactionLike;
    const components = buildSellButtons(entry, viewer, guildId);

    if (!entry.messageId || !entry.channelId) {
      const msg = await interactionLike.channel.send({ embeds: [embed], components });
      entry.messageId = msg.id;
      entry.channelId = msg.channelId;
    } else {
      const channel = await client.channels.fetch(entry.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components });
      }
    }
  }

  // ---------- interactionCreate ----------
  client.on("interactionCreate", async (interaction) => {
    if (!(interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu())) return;

    // ----- Slash commands -----
    if (interaction.isChatInputCommand()) {
      const guildId = interaction.guildId;

      if (interaction.commandName === "sell-create") {
        if (!allowChannel(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        // Inputs
        const sellerUser     = interaction.user;
        const sellerName     = sellerUser.globalName || sellerUser.username;

        const title          = interaction.options.getString("title", true);
        const wowItemInput   = interaction.options.getString("wow_item", true); // id or name
        const quantityMode   = interaction.options.getString("quantity_mode", true); // items|stacks|infinite
        const quantityOpt    = interaction.options.getInteger("quantity"); // optional if infinite
        const mode           = interaction.options.getString("mode", true);  // multi|single
        const scope          = interaction.options.getString("scope", true); // personal|guild

        const priceType      = interaction.options.getString("price_type", true); // gold|item
        const priceQty       = interaction.options.getInteger("price_quantity", true);
        const pricePer       = interaction.options.getString("price_per", true); // per_item|per_stack
        const priceItemIdOpt = interaction.options.getInteger("price_item_id"); // optional
        const priceItemInput = interaction.options.getString("price_item");     // optional text search

        if (scope === "guild" && !isModerator(interaction.member, guildId)) {
          return interaction.editReply(t(guildId, "msg.scopeGuildOnlyMods"));
        }
        if (quantityMode !== "infinite" && (!quantityOpt || quantityOpt < 1)) {
          return interaction.editReply(t(guildId, "msg.invalidQuantity"));
        }

        // Resolve main item
        let finalItemId = null;
        if (/^\d+$/.test(wowItemInput.trim())) {
          finalItemId = parseInt(wowItemInput, 10);
        } else {
          const candidates = await searchItemsByName(wowItemInput);
          if (!candidates.length) return interaction.editReply(t(guildId, "msg.noneFound", { q: wowItemInput }));
          if (candidates.length === 1) {
            finalItemId = candidates[0].id;
          } else {
            const key = interaction.id;
            const options = candidates.slice(0,25).map(c => ({
              label: c.name.slice(0, 100),
              description: `ID ${c.id}`, value: String(c.id),
            }));
            const sel = new StringSelectMenuBuilder()
              .setCustomId(`sell_pick_item:${key}`)
              .setPlaceholder(t(guildId, "sell.msg.multipleFound", { q: wowItemInput }) || "Mehrere gefunden")
              .addOptions(options).setMinValues(1).setMaxValues(1);

            await interaction.editReply({
              content: t(guildId, "sell.msg.multipleFound", { q: wowItemInput }),
              components: [new ActionRowBuilder().addComponents(sel)],
            });

            const draft = {
              id: null,
              title,
              seller: sellerName,
              sellerId: sellerUser.id,
              quantityMode,
              quantity: quantityMode === "infinite" ? null : quantityOpt,
              mode,
              scope,
              priceType,
              priceQuantity: priceQty,
              priceItemId: null,
              pricePer,
              ownerId: sellerUser.id,
              ownerTag: interaction.user.tag,
              takenBy: [],
              channelId: null,
              messageId: null,
              closed: false,
              wowItemId: null,
            };
            __sellPending.set(key, { draft, step: "mainItem" });
            return;
          }
        }

        // Resolve price item if needed
        let priceItemId = priceItemIdOpt || null;
        if (priceType === "item" && !priceItemId) {
          if (priceItemInput && /^\d+$/.test(priceItemInput.trim())) {
            priceItemId = parseInt(priceItemInput, 10);
          } else if (priceItemInput) {
            const cand = await searchItemsByName(priceItemInput);
            if (!cand.length) return interaction.editReply(t(guildId, "msg.noneFound", { q: priceItemInput }));
            if (cand.length === 1) {
              priceItemId = cand[0].id;
            } else {
              const key = `${interaction.id}:price`;
              const options = cand.slice(0,25).map(c => ({
                label: c.name.slice(0,100), description: `ID ${c.id}`, value: String(c.id)
              }));
              const sel = new StringSelectMenuBuilder()
                .setCustomId(`sell_pick_price:${key}`)
                .setPlaceholder(t(guildId, "sell.msg.multiplePriceFound", { q: priceItemInput }) || "Mehrere Preis-Gegenstände gefunden")
                .addOptions(options).setMinValues(1).setMaxValues(1);

              await interaction.editReply({
                content: t(guildId, "sell.msg.multiplePriceFound", { q: priceItemInput }),
                components: [new ActionRowBuilder().addComponents(sel)],
              });

              const draft = {
                id: null,
                title,
                seller: sellerName,
                sellerId: sellerUser.id,
                quantityMode,
                quantity: quantityMode === "infinite" ? null : quantityOpt,
                mode,
                scope,
                priceType,
                priceQuantity: priceQty,
                priceItemId: null,
                pricePer,
                ownerId: sellerUser.id,
                ownerTag: interaction.user.tag,
                takenBy: [],
                channelId: null,
                messageId: null,
                closed: false,
                wowItemId: finalItemId,
              };
              __sellPending.set(key, { draft, step: "priceItem" });
              return;
            }
          } else {
            return interaction.editReply(t(guildId, "sell.msg.priceItemMissing") || "Preis-Item fehlt.");
          }
        }

        const draft = {
          id: null,
          title,
          seller: sellerName,
          sellerId: sellerUser.id,
          quantityMode,
          quantity: quantityMode === "infinite" ? null : quantityOpt,
          mode,
          scope,
          priceType,
          priceQuantity: priceQty,
          priceItemId,
          pricePer,
          ownerId: sellerUser.id,
          ownerTag: interaction.user.tag,
          takenBy: [],
          channelId: null,
          messageId: null,
          closed: false,
          wowItemId: finalItemId,
        };

        const list = loadSell(guildId);
        draft.id = nextId(guildId);
        list.push(draft);
        saveSell(guildId, list);

        await postOrUpdateSell(interaction, draft);
        return interaction.editReply(t(guildId, "sell.msg.created", { id: draft.id, title: draft.title }) || `Verkauf #${draft.id} erstellt.`);
      }

      if (interaction.commandName === "sell-list") {
        const list = loadSell(guildId);
        if (!list.length) return safeReply(interaction, { content: "📭", ephemeral: true });
        const lines = list.map(e => `#${e.id} — **${e.title}** (${e.quantity ?? "∞"} × ${e.wowItemId}) [${e.mode}]${e.closed ? " — closed" : ""}`);
        return safeReply(interaction, { content: lines.join("\n"), ephemeral: true });
      }

      if (interaction.commandName === "sell-remove") {
        const id = interaction.options.getInteger("id", true);
        let list = loadSell(guildId);
        const entry = list.find(x => x.id === id);
        if (!entry) return safeReply(interaction, { content: t(guildId, "sell.msg.notFound") || "Nicht gefunden.", ephemeral: true });
        if (!(entry.ownerId === interaction.user.id || isModerator(interaction.member, guildId))) {
          return safeReply(interaction, { content: "❌ Keine Berechtigung.", ephemeral: true });
        }
        if (entry.channelId && entry.messageId) {
          const ch = await client.channels.fetch(entry.channelId).catch(()=>null);
          const msg = ch ? await ch.messages.fetch(entry.messageId).catch(()=>null) : null;
          if (msg) await msg.delete().catch(()=>{});
        }
        list = list.filter(x => x.id !== id);
        saveSell(guildId, list);
        return safeReply(interaction, { content: t(guildId, "sell.msg.removed", { id }) || `Entfernt: #${id}`, ephemeral: true });
      }
      return;
    }

    // ----- Select menus (for picking items during create) -----
    if (interaction.isStringSelectMenu()) {
      const [tag, what, key] = (interaction.customId || "").split(":");
      if (tag === "sell_pick_item" || tag === "sell_pick_price") {
        await interaction.deferUpdate().catch(()=>{});

        const st = __sellPending.get(key);
        if (!st) return interaction.editReply({ content: "⏱️ Auswahl abgelaufen.", components: [] });

        const id = parseInt(interaction.values?.[0], 10);
        if (tag === "sell_pick_item") st.draft.wowItemId = id;
        else st.draft.priceItemId = id;

        // If both resolved, finish create
        const needPrice = st.draft.priceType === "item" && !st.draft.priceItemId;
        const needItem  = !st.draft.wowItemId;
        __sellPending.set(key, st);

        if (!needItem && !needPrice) {
          const guildId = interaction.guildId;
          const list = loadSell(guildId);
          st.draft.id = nextId(guildId);
          list.push(st.draft);
          saveSell(guildId, list);
          __sellPending.delete(key);

          await interaction.editReply({ content: t(guildId, "sell.msg.created", { id: st.draft.id, title: st.draft.title }) || `Verkauf #${st.draft.id} erstellt.`, components: [] });
          await postOrUpdateSell(interaction, st.draft);
          return;
        }

        // otherwise just acknowledge (remove menu)
        return interaction.editReply({ components: [] });
      }
      return;
    }

    // ----- Buttons -----
    if (interaction.isButton()) {
      const [act, idStr] = (interaction.customId || "").split(":");
      if (!act.startsWith("sell_")) return;

      const guildId = interaction.guildId;
      let list = loadSell(guildId);
      const entry = list.find(x => x.id === Number(idStr));
      if (!entry) return safeReply(interaction, { content: t(guildId, "sell.msg.notFound") || "Nicht gefunden.", ephemeral: true });

      // normalize takenBy for safety
      entry.takenBy = Array.isArray(entry.takenBy) ? entry.takenBy : [];

      try {
        if (act === "sell_buy") {
          if (entry.closed) return safeReply(interaction, { content: t(guildId, "sell.msg.closed") || "Geschlossen.", ephemeral: true });

          const taken = entry.takenBy;
          if (entry.mode === "single" && taken.length > 0 && !taken.includes(interaction.user.id)) {
            return safeReply(interaction, { content: "❌ Bereits reserviert.", ephemeral: true });
          }

          if (!taken.includes(interaction.user.id)) taken.push(interaction.user.id);
          saveSell(guildId, list);

          await interaction.deferUpdate().catch(()=>{});
          const itemInfo  = await getItemInfo(entry.wowItemId);
          const priceInfo = entry.priceType === "item" && entry.priceItemId ? await getItemInfo(entry.priceItemId) : null;
          await interaction.editReply({
            embeds: [buildSellEmbed(entry, itemInfo, priceInfo, guildId)],
            components: buildSellButtons(entry, interaction.member, guildId),
          });
          return;
        }

        if (act === "sell_unbuy") {
          entry.takenBy = entry.takenBy.filter(u => u !== interaction.user.id);
          saveSell(guildId, list);

          await interaction.deferUpdate().catch(()=>{});
          const itemInfo  = await getItemInfo(entry.wowItemId);
          const priceInfo = entry.priceType === "item" && entry.priceItemId ? await getItemInfo(entry.priceItemId) : null;
          await interaction.editReply({
            embeds: [buildSellEmbed(entry, itemInfo, priceInfo, guildId)],
            components: buildSellButtons(entry, interaction.member, guildId),
          });
          return;
        }

        if (act === "sell_close") {
          const canManage = entry.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
          if (!canManage) return safeReply(interaction, { content: "❌ Keine Berechtigung.", ephemeral: true });

          entry.closed = true;
          saveSell(guildId, list);

          await interaction.deferUpdate().catch(()=>{});
          const itemInfo  = await getItemInfo(entry.wowItemId);
          const priceInfo = entry.priceType === "item" && entry.priceItemId ? await getItemInfo(entry.priceItemId) : null;
          await interaction.editReply({
            embeds: [buildSellEmbed(entry, itemInfo, priceInfo, guildId)],
            components: buildSellButtons(entry, interaction.member, guildId),
          });
          return;
        }

        if (act === "sell_open") {
          if (entry.ownerId !== interaction.user.id) {
            return safeReply(interaction, { content: "❌ Nur der Verkäufer darf wieder öffnen.", ephemeral: true });
          }
          entry.closed = false;
          saveSell(guildId, list);

          await interaction.deferUpdate().catch(()=>{});
          const itemInfo  = await getItemInfo(entry.wowItemId);
          const priceInfo = entry.priceType === "item" && entry.priceItemId ? await getItemInfo(entry.priceItemId) : null;
          await interaction.editReply({
            embeds: [buildSellEmbed(entry, itemInfo, priceInfo, guildId)],
            components: buildSellButtons(entry, interaction.member, guildId),
          });
          return;
        }

        if (act === "sell_remove") {
          const canManage = entry.ownerId === interaction.user.id || isModerator(interaction.member, guildId);
          if (!canManage) return safeReply(interaction, { content: "❌ Keine Berechtigung.", ephemeral: true });

          await interaction.deferUpdate().catch(()=>{});
          await interaction.message.delete().catch(()=>{});
          list = list.filter(x => x.id !== entry.id);
          saveSell(guildId, list);
          return;
        }

        if (act === "sell_change") {
          if (entry.closed) return safeReply(interaction, { content: t(guildId, "sell.msg.closedNoChange") || "Geschlossen – nicht änderbar.", ephemeral: true });
          return safeReply(interaction, { content: t(guildId, "sell.msg.useChangeCmd") || "✏️ Nutze `/sell-change` zum Bearbeiten.", ephemeral: true });
        }
      } catch (e) {
        console.error("Sell button error:", e);
        if (!interaction.replied && !interaction.deferred) {
          await safeReply(interaction, { content: "⚠️ Internal error.", ephemeral: true });
        }
      }
    }
  });
}

/*
Expected i18n keys used here (add to your locales):
- sell.embed.titlePrefix
- sell.embed.entry
- sell.embed.closedSuffix
- sell.fields.seller
- sell.fields.requestType
- sell.fields.mode
- sell.fields.item
- sell.fields.quantity
- sell.fields.price
- sell.fields.buyers
- sell.buttons.open
- sell.buttons.remove
- sell.buttons.buy
- sell.buttons.unbuy
- sell.buttons.close
- sell.buttons.change
- sell.msg.multipleFound
- sell.msg.multiplePriceFound
- sell.msg.priceItemMissing
- sell.msg.created
- sell.msg.notFound
- sell.msg.closed
- sell.msg.closedNoChange
- sell.msg.useChangeCmd
*/
