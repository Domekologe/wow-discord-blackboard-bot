# WoW Discord Blackboard Bot

A Discord bot to post tidy "blackboard" embeds for World of Warcraft communities. Includes:
- `/blackboard` to post ad-hoc messages (with quick Edit/Delete buttons)
- `/template` to save, list, remove and post templates per guild
- Command registration scripts for quick setup

## Quick Start

1. Install Node.js 18+
2. Create an application & bot in Discord Developer Portal and add it to your server.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, and optionally `GUILD_ID`.
4. Install deps:

```bash
npm install
```

5. Register slash commands (guild-scoped during dev is fastest):

```bash
npm run register:guild
# or for global (can take up to 1h to appear):
npm run register
```

6. Start the bot:

```bash
npm start
```

## Commands

### /blackboard

- **title** *(required)*: Embed title
- **content** *(required)*: Main content body
- **color** *(optional)*: Hex color like `#00AAFF`

The bot adds **Edit** and **Delete** buttons. Edit opens a modal to update the message in-place.

### /template

Subcommands:
- `save name title content [color]` – stores a template for this guild
- `list` – shows saved template names
- `remove name` – deletes a template
- `post name` – posts the template with buttons

Templates are stored under `./data/<guildId>.json`.

## Notes

- The bot only requests the minimal `Guilds` intent for slash commands.
- Make sure the bot has permission to manage messages if you want Delete to work in all channels.

---

Author: **Domekologe**
License: MIT
