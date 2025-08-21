// Registers slash commands with Discord (global or guild-scoped)
// Author: Domekologe
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsPath = path.join(__dirname, '..', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const { default: command } = await import(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const useGuild = process.argv.includes('--guild');
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!clientId) {
  console.error('CLIENT_ID is missing from .env');
  process.exit(1);
}

try {
  console.log(`Refreshing ${commands.length} application (/) commands...`);
  if (useGuild) {
    if (!guildId) {
      console.error('GUILD_ID is required for guild registration. Set it in .env or omit --guild.');
      process.exit(1);
    }
    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`✅ Successfully reloaded ${data.length} guild commands for ${guildId}.`);
  } else {
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`✅ Successfully reloaded ${data.length} global commands.`);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
