# WoW Discord Blackboard Bot

Schwarzes Brett für Discord mit WoW-Item-Embed (MoP Classic), DM-Wizard, Claim-Buttons und Verwaltung.

## Commands
- `/to-embed` – Beispiel aus Basis (XML -> Embed)
- `/auftrag` – Schnell-Erstellung
- `/auftrag_wizard` – Wizard per DM (Modal + Dropdown + Vorschau)
- `/auftrag_list` – offene Aufträge im Channel listen
- `/auftrag_cancel` – Auftrag schließen (Ersteller/Admin)

## Quickstart
```bash
cp .env.example .env   # fülle Discord & Blizzard Werte
npm install
npm run register
npm run dev
