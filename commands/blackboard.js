// /blackboard command - post an embed or use a saved template
// Author: Domekologe
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildBlackboardEmbed } from '../utils/embedBuilder.js';
import { readGuildData } from '../utils/storage.js';

export default {
  data: new SlashCommandBuilder()
    .setName('blackboard')
    .setDescription('Post a WoW blackboard embed')
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('content').setDescription('Main content').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color like #00AAFF')),

  async execute(interaction) {
    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    const colorStr = interaction.options.getString('color');
    const color = colorStr ? parseInt(colorStr.replace('#',''), 16) : 0x0099ff;

    const embed = buildBlackboardEmbed(title, content, {
      color,
      author: { name: `Posted by ${interaction.user.tag}` }
    });

    const payload = encodeURIComponent(`${title}|${content}`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bb:edit:${payload}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bb:delete').setLabel('Delete').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
}
