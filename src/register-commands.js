// src/register-commands.js
// Registers Blackboard Bot slash commands (guild-scoped)
// Author: Domekologe

import { REST, Routes } from "discord.js";
import { config } from "dotenv";
import { sellCommands } from "./sellCommands.js";
config();

const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
const guildId  = process.env.DISCORD_GUILD_ID  || process.env.GUILD_ID;
const token    = process.env.DISCORD_TOKEN;

if (!token)   throw new Error("DISCORD_TOKEN is missing in .env");
if (!clientId) throw new Error("DISCORD_CLIENT_ID (or CLIENT_ID) is missing in .env");
if (!guildId)  throw new Error("DISCORD_GUILD_ID (or GUILD_ID) is missing in .env");

const commands = [
  
  // ----- create-bb -----
  {
    name: "create-bb",
    description: "Create a new blackboard order",
    options: [
      // REQUIRED
      { name: "title",        description: "Order title",                  type: 3, required: true },
      { name: "wow_item",     description: "WoW item (name or ID)",        type: 3, required: true },
      { name: "quantity_mode",description: "Quantity mode",                type: 3, required: true, choices: [
        { name: "Items",     value: "items" },
        { name: "Stacks",    value: "stacks" },
        { name: "Infinite",  value: "infinite" }
      ]},
      { name: "mode",         description: "Multi or Single",              type: 3, required: true, choices: [
        { name: "Multi",  value: "multi" },
        { name: "Single", value: "single" }
      ]},
      { name: "scope",        description: "Personal or Guild request",    type: 3, required: true, choices: [
        { name: "Personal", value: "personal" },
        { name: "Guild",    value: "guild" }
      ]},
      { name: "reward_type",  description: "Reward type",                  type: 3, required: true, choices: [
        { name: "Item", value: "item" },
        { name: "Gold", value: "gold" }
      ]},
      { name: "reward_quantity", description: "Reward quantity",           type: 4, required: true },
      { name: "reward_per",   description: "Reward applies per Item/Stack",type: 3, required: true, choices: [
        { name: "Per Item",  value: "per_item" },
        { name: "Per Stack", value: "per_stack" }
      ]},
      // OPTIONAL (muss nach allen required stehen)
      { name: "requester",    description: "Requester (mods only)", type: 6, required: false },
      { name: "quantity",     description: "Requested amount (ignored if infinite)", type: 4, required: false },
      { name: "reward_item", description: "Reward item (name or ID)", type: 3, required: false },
    ]
  },

  // ----- remove-bb -----
  {
    name: "remove-bb",
    description: "Remove a blackboard order (owner or moderator only)",
    options: [
      { name: "id", description: "Order ID", type: 4, required: true }
    ]
  },

    // ----- change-bb -----
    {
      name: "change-bb",
      description: "Change an existing order (owner or moderator only)",
      options: [
        // REQUIRED first: ID with autocomplete
        { name: "id", description: "Order ID", type: 4, required: true, autocomplete: true },
  
        // OPTIONAL (only the provided ones will be changed)
        { name: "title",        description: "Order title",                type: 3, required: false },
        { name: "requester",    description: "Who requests it",            type: 3, required: false },
        { name: "wow_item_id",  description: "WoW Item ID",                type: 4, required: false },
        { name: "quantity",     description: "Requested amount of item",   type: 4, required: false },
        { name: "mode",         description: "Multi or Single",            type: 3, required: false, choices: [
          { name: "Multi",  value: "multi" },
          { name: "Single", value: "single" }
        ]},
        { name: "scope",        description: "Personal or Guild request",  type: 3, required: false, choices: [
          { name: "Personal", value: "personal" },
          { name: "Guild",    value: "guild" }
        ]},
        { name: "reward_type",  description: "Reward type",                type: 3, required: false, choices: [
          { name: "Item", value: "item" },
          { name: "Gold", value: "gold" }
        ]},
        { name: "reward_quantity", description: "Reward quantity",         type: 4, required: false },
        { name: "reward_per",   description: "Reward applies per Item/Stack", type: 3, required: false, choices: [
          { name: "Per Item",  value: "per_item" },
          { name: "Per Stack", value: "per_stack" }
        ]},
        { name: "reward_item_id",  description: "Reward Item ID (if type is Item)", type: 4, required: false },
      ]
    },  

  // ----- take-bb -----
  {
    name: "take-bb",
    description: "Take an existing order to fulfill",
    options: [
      { name: "id", description: "Order ID", type: 4, required: true }
    ]
  },

  // ----- list-bb -----
  {
    name: "list-bb",
    description: "List all open orders for this guild"
  },
  // ----- bb-setup -----
  {
    name: "bb-setup",
    description: "Configure Blackboard for this guild",
    options: [
      { name: "language", description: "Set language", type: 3, required: false, choices: [
        { name: "English", value: "en" }, { name: "Deutsch", value: "de" }
      ]},
      { name: "add_mod_role", description: "Add moderator role", type: 8, required: false },
      { name: "remove_mod_role", description: "Remove moderator role", type: 8, required: false },
      { name: "add_channel", description: "Allow a channel for bot usage", type: 7, required: false },
      { name: "remove_channel", description: "Remove an allowed channel", type: 7, required: false },
      { name: "show", description: "Show current configuration", type: 5, required: false } // boolean flag
    ]
  },
  {
    name: "wizard-bb",
    description: "Open a DM wizard to create or change a blackboard order",
    description_localizations: { de: "DM-Assistent zum Erstellen oder Ändern eines Auftrags" }
  },
  ...sellCommands
];



const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  console.log("🔄 Registering slash commands to guild:", guildId);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands },
  );
  console.log("✅ Commands registered successfully!");
})().catch(err => {
  console.error("❌ Error registering commands:", err);
  process.exit(1);
});
