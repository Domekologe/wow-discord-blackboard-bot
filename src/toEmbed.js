// Minimal placeholder for /to-embed (XML -> Embed) – simplified demo.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export function addToEmbedCommand(client) {
  const data = new SlashCommandBuilder()
    .setName('to-embed')
    .setDescription('Example: show a demo embed')
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('text').setDescription('Text').setRequired(true));

  client.once('ready', async () => {
    try {
      await client.application.commands.set(
        [
          data.toJSON(),
          // other commands are registered by boardPlugin
        ],
        process.env.DISCORD_GUILD_ID // guild-scoped
      );
    } catch (e) {
      console.error('register to-embed failed:', e);
    }
  });

  client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'to-embed') return;
    const title = i.options.getString('title', true);
    const text = i.options.getString('text', true);
    const emb = new EmbedBuilder().setTitle(title).setDescription(text);
    await i.reply({ embeds: [emb] });
  });
}
