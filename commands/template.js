// /template command - save, list, remove blackboard templates per guild
// Author: Domekologe

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readGuildData, writeGuildData } from '../utils/storage.js';

export default {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Manage blackboard templates')
    .addSubcommand(sc =>
      sc.setName('save')
        .setDescription('Save a new template or overwrite an existing one')
        .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
        .addStringOption(o => o.setName('content').setDescription('Content').setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color like #00AAFF'))
    )
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List available templates')
    )
    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove a template')
        .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('post')
        .setDescription('Post a template')
        .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const data = readGuildData(guildId);

    if (sub === 'save') {
      const name = interaction.options.getString('name');
      const title = interaction.options.getString('title');
      const content = interaction.options.getString('content');
      const colorStr = interaction.options.getString('color');
      const color = colorStr ? parseInt(colorStr.replace('#',''), 16) : 0x0099ff;

      data.templates[name] = { title, content, color };
      writeGuildData(guildId, data);
      return interaction.reply({ content: `✅ Template \`${name}\` saved.`, ephemeral: true });
    }

    if (sub === 'list') {
      const names = Object.keys(data.templates);
      if (!names.length) return interaction.reply({ content: 'No templates saved yet.', ephemeral: true });
      const emb = new EmbedBuilder().setTitle('Saved templates').setDescription(names.map(n => `• \`${n}\``).join('\n'));
      return interaction.reply({ embeds: [emb], ephemeral: true });
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      if (!data.templates[name]) return interaction.reply({ content: `Template \`${name}\` not found.`, ephemeral: true });
      delete data.templates[name];
      writeGuildData(guildId, data);
      return interaction.reply({ content: `🗑️ Template \`${name}\` removed.`, ephemeral: true });
    }

    if (sub === 'post') {
      const name = interaction.options.getString('name');
      const tpl = data.templates[name];
      if (!tpl) return interaction.reply({ content: `Template \`${name}\` not found.`, ephemeral: true });

      const { buildBlackboardEmbed } = await import('../utils/embedBuilder.js');
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');

      const embed = buildBlackboardEmbed(tpl.title, tpl.content, {
        color: tpl.color || 0x0099ff,
        author: { name: `Posted by ${interaction.user.tag}` }
      });

      const payload = encodeURIComponent(`${tpl.title}|${tpl.content}`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bb:edit:${payload}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bb:delete').setLabel('Delete').setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }
  }
}
