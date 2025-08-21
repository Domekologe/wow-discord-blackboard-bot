// Centralized handling for buttons and modals
// Author: Domekologe

import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { buildBlackboardEmbed } from './embedBuilder.js';

export async function handleComponent(interaction) {
  const id = interaction.customId || '';
  if (interaction.isButton()) {
    if (id.startsWith('bb:edit:')) {
      const payload = id.split(':').slice(2).join(':'); // encoded title|content
      const [title, ...rest] = decodeURIComponent(payload).split('|');
      const content = rest.join('|');

      const modal = new ModalBuilder()
        .setCustomId(`bb:modal:${interaction.message.id}`)
        .setTitle('Edit Blackboard');

      const titleInput = new TextInputBuilder()
        .setCustomId('bbTitle')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setValue(title || '')
        .setRequired(true);

      const contentInput = new TextInputBuilder()
        .setCustomId('bbContent')
        .setLabel('Content')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(content || '')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(contentInput)
      );

      return interaction.showModal(modal);
    }
    if (id.startsWith('bb:delete')) {
      try {
        await interaction.message.delete();
        return;
      } catch (e) {
        return interaction.reply({ content: 'I cannot delete that message (missing permissions?).', ephemeral: true });
      }
    }
  } else if (interaction.isModalSubmit()) {
    if (id.startsWith('bb:modal:')) {
      const title = interaction.fields.getTextInputValue('bbTitle');
      const content = interaction.fields.getTextInputValue('bbContent');
      const embed = buildBlackboardEmbed(title, content, { author: { name: `Updated by ${interaction.user.tag}` } });
      try {
        await interaction.update({ embeds: [embed], components: [] });
      } catch {
        // If update fails (older message), reply instead
        await interaction.reply({ embeds: [embed], ephemeral: false });
      }
    }
  }
}
