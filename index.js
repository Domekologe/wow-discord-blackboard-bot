// Main entry point for the bot
// Author: Domekologe
// Notes: Uses discord.js v14, ESM. Commands auto-loaded from ./commands

import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Events } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

// Dynamically load command modules
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const { default: command } = await import(`./commands/${file}`);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[WARN] The command at ${filePath} is missing "data" or "execute".`);
  }
}

// Handle slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  try {
    // Buttons & modals are handled in util router
    if (interaction.isButton() || interaction.isModalSubmit()) {
      const { handleComponent } = await import('./utils/interactions.js');
      return handleComponent(interaction);
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error('[ERROR] Interaction failed:', err);
    const ephemeral = true;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '❌ Something went wrong executing this action.', ephemeral });
    } else {
      await interaction.reply({ content: '❌ Something went wrong executing this action.', ephemeral });
    }
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
