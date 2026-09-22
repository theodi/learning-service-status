# ODI host status agent

Runs on each server (typically as root). Discovers Node apps under `scanRoots`, checks the host and each app, and POSTs reports to the service-status collector.

## Setup

```bash
cd agent
cp config.json.example config.json
# edit statusReportUrl, statusReportKey, hostId, scanRoots
npm install
npm run once
```

Config is **JSON** so `scanRoots` is a readable array. Legacy `config.env` is still loaded if `config.json` is absent.

Long-running loop:

```bash
npm start
```

Systemd (hourly):

```bash
# copy agent to /opt/odi-status-agent, install deps
sudo cp systemd/odi-status-agent.service systemd/odi-status-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now odi-status-agent.timer
```

## What it reports

| Report `service` | Contents |
|------------------|----------|
| `host:<hostId>` | OS LTS (via collector), apt upgrades, reboot-required |
| each `package.json` name | process, Node/npm, `npm audit`, connectors from app `config.env`/`.env` |

Every report includes `host` for dashboard nesting.

## Connectors

Inferred from env keys when present: Mongo (`MONGO_URI` / `MONGODB_URI` / `MONGO_URL`), HubSpot, Forecast, Moodle, Gmail/Calendar, email OAuth2/SMTP, OpenAI/AI, Google/Django OAuth, session, webhook key.

## Allowlist

Add this server’s egress IP on the collector Configure page (behind Cloudflare, that is `CF-Connecting-IP`).
