# Too Boring 🍿 Discord Bot

A modern, automated Discord bot built with **Node.js** and **discord.js v14** for movie, TV show, and web series recommendations. Powered by TMDB and OMDb.

---

## ✨ Features

- 🎯 **Automatic Type Detection**: Automatically identifies whether a title is a Movie, TV Show, or Web/Mini-Series. No manual type selection needed!
- 📺 **Channel Routing (`/tbsetup`)**: Automatically routes movies to your dedicated `#movies` channel and TV/web series to your dedicated `#web-series` channel.
- 🔒 **Role Permissions**: Restrict bot commands to specific roles or leave open for everyone.
- 🎨 **Rich Discord Embeds**: Formatted with animated emojis, clean spacing, high-res widescreen backdrop banners, streaming availability (No Rent/Buy clutter), ratings, and metadata.
- 📋 **One-Click Copy**: Includes a "Copy Name" button that provides the exact title in an instant-copy codeblock.
- 📩 **Add to DM**: Members can click a button to send the recommendation directly to their private DMs.
- 🔴 **Dynamic DND Presence**: 24/7 Do-Not-Disturb status with rotating activity descriptions.
- 👋 **Automatic Setup Greeting**: Sends a welcome embed with setup instructions when invited to new servers.
- 💓 **Public Health Check**: Built-in lightweight HTTP endpoint at `/health` and `/ping` with CORS support for uptime dashboards (e.g. Pengo Stats).

---

## 🚀 Deploy to Railway (24/7 Hosting)

Hosting on **[Railway](https://railway.app/)** keeps your bot online 24/7 without needing your PC running.

### Step 1: Create a Project on Railway
1. Go to [Railway](https://railway.app/) and sign in with GitHub.
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select this repository: `Zamir-MoN/too-boring`.

### Step 2: Configure Environment Variables
In your Railway project, click on your service, go to the **Variables** tab, and add the following:

| Variable | Description | Example / Required |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal | **Required** |
| `DISCORD_CLIENT_ID` | Application ID from Discord Developer Portal | **Required** |
| `TMDB_READ_TOKEN` | TMDB API Read Access Token (Bearer Token) | **Required** (or `TMDB_API_KEY`) |
| `TMDB_API_KEY` | TMDB v3 API Key | Optional (if Read Token set) |
| `OMDB_API_KEY` | OMDb API Key (for IMDb ratings) | Optional |
| `WATCH_REGION` | Country code for streaming providers | `IN` (default) or `US`, etc. |
| `DISCORD_GUILD_ID` | Test server ID for instant slash command updates | Optional |
| `CONFIG_DATA` | Optional preloaded server channel config JSON | Optional |
| `PORT` | Health check HTTP server port | `3001` (assigned automatically by Railway) |

> ⚠️ **Note**: Railway will automatically detect `npm start` and run `node index.js`.

---

## 💻 Local Setup & Development

### 1. Prerequisites
- Node.js 20 or higher
- Git

### 2. Installation
```bash
git clone https://github.com/Zamir-MoN/too-boring.git
cd too-boring
npm install
```

### 3. Environment Configuration
Copy the template file to `.env`:
```bash
cp .env.example .env
```
Fill in your tokens in `.env`.

### 4. Register Slash Commands
Deploy slash commands to Discord globally and to your test server:
```bash
npm run register
```

### 5. Start the Bot
```bash
npm start
```

---

## 🛠️ Bot Commands

| Command | Description | Permissions |
| :--- | :--- | :--- |
| `/tbsetup` | Configure `movie_channel`, `series_channel`, and optional `allowed_role` | **Administrator** |
| `/recommend title: <name> [year: <YYYY>]` | Recommend a movie, TV show, or series with streaming info & posters | Configured role / All |

---

## 🔒 Security

- Never commit your `.env` file or tokens to GitHub.
- If a Discord bot token is ever exposed, regenerate it immediately in the Discord Developer Portal.
