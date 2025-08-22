// sellCommands.js
// Slash commands for the "Ich verkaufe" feature
// Author: Domekologe

import { SlashCommandBuilder } from "discord.js";

export const sellCommands = [
  // /sell-create
  new SlashCommandBuilder()
  .setName("sell-create")
  .setDescription("Create a new SELL entry (Ich verkaufe).")
  // ---- REQUIRED FIRST ----
  .addStringOption(o =>
    o.setName("title")
      .setDescription("Short title of your offer")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("wow_item")
      .setDescription("Item ID or name to sell")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("quantity_mode")
      .setDescription("Quantity mode")
      .addChoices(
        { name: "Items", value: "items" },
        { name: "Stacks", value: "stacks" },
        { name: "Infinite", value: "infinite" },
      )
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("mode")
      .setDescription("Reservation mode")
      .addChoices(
        { name: "Multi", value: "multi" },
        { name: "Single", value: "single" },
      )
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("scope")
      .setDescription("Offer scope")
      .addChoices(
        { name: "Personal", value: "personal" },
        { name: "Guild", value: "guild" },
      )
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("price_type")
      .setDescription("Price: gold or item")
      .addChoices(
        { name: "Gold", value: "gold" },
        { name: "Item", value: "item" },
      )
      .setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("price_quantity")
      .setDescription("Price amount (gold or items)")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("price_per")
      .setDescription("Price per item or per stack")
      .addChoices(
        { name: "Per Item", value: "per_item" },
        { name: "Per Stack", value: "per_stack" },
      )
      .setRequired(true)
  )

  // ---- OPTIONAL AFTER ALL REQUIRED ----
  .addIntegerOption(o =>
    o.setName("quantity")
      .setDescription("Amount (omit for Infinite)")
      .setRequired(false)
  )
  .addIntegerOption(o =>
    o.setName("price_item_id")
      .setDescription("If price is an item: item ID")
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("price_item")
      .setDescription("If price is an item: search by name")
      .setRequired(false)
  )
  .toJSON()

];
