# Middle East War News Brief

A small GitHub-ready news dashboard that pulls articles from the past 24 hours about the war in the Middle East.

It groups coverage by two outlets each from Israel, Lebanon, Iran, Dubai/UAE, and the USA. The page refreshes when opened, has a manual refresh button, and automatically checks again every 24 hours while it is open.

## Outlets

| Region | Outlets |
| --- | --- |
| Israel | The Times of Israel, The Jerusalem Post |
| Lebanon | Al Jazeera, MTV Lebanon |
| Iran | Tehran Times, Press TV |
| Dubai / UAE | Gulf News, Khaleej Times |
| USA | AP News, CNN |

## Run Locally

On Windows, the easiest option is to double-click:

```text
run-dashboard.cmd
```

That opens the dashboard on your PC and prints phone-friendly URLs for devices on the same Wi-Fi.

You can also run it manually:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

You need Node.js 18 or newer. There are no npm dependencies to install.

## Phone Access

1. Start the dashboard on your PC with `run-dashboard.cmd`.
2. Keep the launcher window open.
3. Make sure your phone is on the same Wi-Fi as your PC.
4. Open one of the printed phone URLs, such as `http://192.168.1.42:3000`.
5. Use your phone browser's share/menu button and choose **Add to Home Screen** for quicker access later.

If the phone URL does not load, allow Node.js through Windows Firewall on private networks.

## How It Updates

- The browser requests fresh data every time the dashboard loads.
- The refresh button requests fresh data immediately.
- The frontend also refreshes automatically every 24 hours.
- The server searches the past 24 hours using Google News RSS first, then GDELT as a fallback.

## Deploy From GitHub

GitHub Pages cannot run the live Node server in this project. Push this repo to GitHub, then deploy it to a Node-capable host such as Render, Railway, Fly.io, or a VPS.

Typical settings:

```text
Build command: none
Start command: npm start
Node version: 18+
```

## Customize Outlets

Edit `config/outlets.json`. Each outlet needs:

- `region`
- `name`
- `domain`
- `homepage`

The dashboard will automatically group outlets by region.

MTV Lebanon uses a special source rule: it pulls the latest 8 timestamped headlines from MTV Lebanon's own homepage and translates the Arabic titles into English.

## API

```text
GET /api/news
```

Returns grouped JSON with article titles, URLs, timestamps, source names, and provider status.
