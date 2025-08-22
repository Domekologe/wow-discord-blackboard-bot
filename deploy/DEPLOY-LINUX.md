

---

## `docs/DEPLOY-LINUX.md`
```md
# Linux – Produktion (systemd)

```bash
sudo adduser --system --home /opt/blackboard --group blackboard || true
sudo mkdir -p /opt/blackboard
sudo chown -R blackboard:blackboard /opt/blackboard

sudo cp -r ./wow-discord-blackboard-bot /opt/blackboard/
cd /opt/blackboard/wow-discord-blackboard-bot

sudo -u blackboard cp .env.example .env
sudo -u blackboard nano .env

sudo -u blackboard npm install
sudo -u blackboard npm run register

sudo cp deploy/blackboard-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now blackboard-bot

