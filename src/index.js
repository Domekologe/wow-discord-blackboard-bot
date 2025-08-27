// index.js
// Blackboard Bot main runtime (entrypoint)
// Author: Domekologe

import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "dotenv";
import { loadOrders } from "./storage.js";
import { registerSellFeature } from "./sellFeature.js";
import { counters, ensureAllowedChannel, isModerator } from "./helpers.js";
import { registerInteractionHandler } from "./interactions.js";
import { registerWizardMessageHandler, registerWizardInteractionHandlers } from "./wizard.js";
import { getItemInfo, searchItemsByName } from "./blizzardApi.js";
import { t } from "./i18n.js";
import { upsertGuildCommands } from "./register-commands.js";
import { commands } from "./register-commands.js";

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const [guildId] of client.guilds.cache) {
    const orders = loadOrders(guildId);
    const maxId = orders.reduce((m, o) => Math.max(m, o.id || 0), 0);
    counters[guildId] = maxId;
  }

  console.log(`✅ Logged in as ${client.user.tag}`);

  const appId = client.application?.id || client.user?.id;
  for (const [gid] of client.guilds.cache) {
    try {
      await upsertGuildCommands(appId, gid, commands);
      console.log(`↻ Upserted commands in ${gid}`);
    } catch (e) {
      console.error(`Failed to upsert commands in ${gid}:`, e?.message || e);
    }
  }
});

client.on("guildCreate", async (guild) => {
  try {
    const appId = client.application?.id || client.user?.id;
    await upsertGuildCommands(appId, guild.id, commands);
    console.log(`➕ Commands deployed to ${guild.id} (${guild.name})`);
  } catch (e) {
    console.error(`Failed to deploy commands to ${guild.id}:`, e?.message || e);
  }
});

registerSellFeature(client, {
  t,
  ensureAllowedChannel,
  isModerator,
  getItemInfo,
  searchItemsByName,
});

registerInteractionHandler(client);
registerWizardMessageHandler(client);
registerWizardInteractionHandlers(client);

client.login(process.env.DISCORD_TOKEN);
