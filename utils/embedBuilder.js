// Generic embed builders for blackboard-style messages
// Author: Domekologe

import { EmbedBuilder } from 'discord.js';

/**
 * Build a standard blackboard embed.
 * @param {string} title
 * @param {string} content
 * @param {object} opts optional { color, footer, author }
 */
export function buildBlackboardEmbed(title, content, opts = {}) {
  const { color = 0x0099ff, footer, author } = opts;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📜 ${title}`)
    .setDescription(content)
    .setTimestamp();

  if (footer) embed.setFooter(footer);
  if (author) embed.setAuthor(author);

  return embed;
}

/**
 * Build a compact fielded embed (for short lists / checklists).
 */
export function buildFieldsEmbed(title, fields, opts = {}) {
  const { color = 0x5865F2, footer, author } = opts;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();
  if (footer) embed.setFooter(footer);
  if (author) embed.setAuthor(author);
  return embed;
}
