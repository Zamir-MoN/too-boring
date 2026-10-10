require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  ActivityType
} = require("discord.js");

const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
    if (process.env.CONFIG_DATA) {
      return JSON.parse(process.env.CONFIG_DATA);
    }
  } catch (err) {
    console.warn("Could not read config.json:", err.message);
  }
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("Could not write config.json:", err.message);
  }
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const config = loadConfig();
  return config[guildId] || null;
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const WATCH_REGION = (process.env.WATCH_REGION || "IN").toUpperCase();

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and configure it.");
  process.exit(1);
}
if (!TMDB_READ_TOKEN && !TMDB_API_KEY) {
  console.error("Set TMDB_READ_TOKEN or TMDB_API_KEY in .env.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers]
});
const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdb(path) {
  const url = new URL(`${TMDB_BASE}${path}`);
  if (TMDB_API_KEY && !TMDB_READ_TOKEN) url.searchParams.set("api_key", TMDB_API_KEY);

  const headers = { accept: "application/json" };
  if (TMDB_READ_TOKEN) headers.Authorization = `Bearer ${TMDB_READ_TOKEN}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TMDB returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json();
}

async function omdb(params) {
  if (!OMDB_API_KEY) return null;
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", OMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  return data.Response === "True" ? data : null;
}

function getEmoji(name, fallback = "") {
  const emoji = client.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
  return emoji ? emoji.toString() : fallback;
}

function cleanText(value, max = 900) {
  if (!value) return "No synopsis available.";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function yearFrom(date) {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : "Year unknown";
}

function normalizeTitle(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripArticles(str) {
  return str.replace(/^(the|a|an)\s+/i, "");
}

function getItemYear(item) {
  const date = item.release_date || item.first_air_date || "";
  return /^\d{4}/.test(date) ? parseInt(date.slice(0, 4), 10) : null;
}

function parseQuery(rawTitle, inputYear = null) {
  let cleanTitle = String(rawTitle).trim();
  let targetYear = inputYear ? String(inputYear).trim() : null;

  if (!targetYear) {
    const parenMatch = cleanTitle.match(/\((\d{4})\)$/);
    if (parenMatch) {
      targetYear = parenMatch[1];
      cleanTitle = cleanTitle.replace(/\s*\(\d{4}\)$/, "").trim();
    } else {
      const spaceYearMatch = cleanTitle.match(/^(.*?)\s+(19\d{2}|20\d{2})$/);
      if (spaceYearMatch && spaceYearMatch[1].length > 0) {
        targetYear = spaceYearMatch[2];
        cleanTitle = spaceYearMatch[1].trim();
      }
    }
  }
  return { cleanTitle, targetYear };
}

async function findContent(rawTitle, inputYear = null) {
  const { cleanTitle, targetYear } = parseQuery(rawTitle, inputYear);
  const targetYearNum = targetYear ? parseInt(targetYear, 10) : null;

  const search = await tmdb(
    `/search/multi?query=${encodeURIComponent(cleanTitle)}&include_adult=false&language=en-US&page=1`
  );
  let valid = (search.results || []).filter(
    x => x.media_type === "movie" || x.media_type === "tv"
  );

  // If a year is specified, also search TMDB movie & tv endpoints with primary release year
  if (targetYear) {
    const [movieYearSearch, tvYearSearch] = await Promise.all([
      tmdb(`/search/movie?query=${encodeURIComponent(cleanTitle)}&primary_release_year=${targetYear}&language=en-US&page=1`).catch(() => null),
      tmdb(`/search/tv?query=${encodeURIComponent(cleanTitle)}&first_air_date_year=${targetYear}&language=en-US&page=1`).catch(() => null)
    ]);
    if (movieYearSearch?.results) {
      movieYearSearch.results.forEach(m => valid.push({ ...m, media_type: "movie" }));
    }
    if (tvYearSearch?.results) {
      tvYearSearch.results.forEach(t => valid.push({ ...t, media_type: "tv" }));
    }
  }

  // Deduplicate by media_type + id
  const seen = new Set();
  valid = valid.filter(x => {
    const key = `${x.media_type}:${x.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const qNorm = normalizeTitle(cleanTitle);
  const qStripped = stripArticles(qNorm);

  function scoreItem(x) {
    const title = x.title || x.name || "";
    const norm = normalizeTitle(title);
    const stripped = stripArticles(norm);
    const itemYear = getItemYear(x);

    // Hard disqualification: title MUST have word overlap with query!
    // Prevents TMDB keyword/working-title matches like "Animals" for "The Gentlemen"
    const qWords = qStripped.split(" ").filter(Boolean);
    const hasOverlap = qWords.some(w => stripped.includes(w) || norm.includes(w));
    if (!hasOverlap) {
      return -Infinity;
    }

    let score = 0;

    // Strict exact equality
    if (norm === qNorm) {
      score += 10000000;
    } else if (stripped === qStripped) {
      score += 8000000;
    } else if (norm.startsWith(qNorm) || stripped.startsWith(qStripped)) {
      score += 2000000;
    } else if (norm.includes(qNorm) || stripped.includes(qStripped)) {
      score += 500000;
    } else {
      score += 100000;
    }

    if (targetYearNum && itemYear) {
      if (itemYear === targetYearNum) {
        score += 5000000; // Exact year match
      } else if (Math.abs(itemYear - targetYearNum) === 1) {
        score += 2000000; // ±1 year (festival premiere vs general release)
      } else {
        score -= 1000000; // Different year penalty
      }
    }

    // Popularity & votes
    const votes = x.vote_count || 0;
    const pop = x.popularity || 1;
    score += Math.min(votes * 5 + pop * 10, 500000);

    return score;
  }

  const scored = valid.map(x => ({ item: x, score: scoreItem(x) })).filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  const item = scored[0].item;

  const mediaType = item.media_type;
  const details = await tmdb(
    `/${mediaType}/${item.id}?append_to_response=external_ids,credits&language=en-US`
  );

  let imdb = null;
  const imdbId = details.imdb_id || details.external_ids?.imdb_id;
  if (OMDB_API_KEY && imdbId) {
    imdb = await omdb({ i: imdbId });
  }

  let providers = null;
  try {
    providers = await tmdb(`/${mediaType}/${item.id}/watch/providers`);
  } catch (err) {
    console.warn("Could not retrieve streaming providers:", err.message);
  }

  const regionData = providers?.results?.[WATCH_REGION] || null;

  // ONLY extract streaming / flatrate, free, and ads (completely omit rent and buy)
  const streamList = regionData?.flatrate || [];
  const freeList = regionData?.free || [];
  const adsList = regionData?.ads || [];

  const director =
    details.credits?.crew?.find(c => c.job === "Director")?.name ||
    details.created_by?.[0]?.name ||
    null;

  let kind = "Movie";
  if (mediaType === "tv") {
    if (
      details.type === "Miniseries" ||
      (details.number_of_seasons === 1 && details.status === "Ended")
    ) {
      kind = "Web / Mini Series";
    } else {
      kind = "TV Show";
    }
  }

  return {
    mediaType,
    kind,
    id: item.id,
    title: details.title || details.name || item.title || item.name || cleanTitle,
    originalTitle: details.original_title || details.original_name || "",
    date: details.release_date || details.first_air_date || "",
    tagline: details.tagline || "",
    overview: details.overview || item.overview || "",
    backdrop: details.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
      : null,
    poster: details.poster_path
      ? `https://image.tmdb.org/t/p/w780${details.poster_path}`
      : null,
    rating: imdb?.imdbRating && imdb.imdbRating !== "N/A" ? imdb.imdbRating : null,
    imdbId,
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    tmdbRating: Number.isFinite(details.vote_average) ? details.vote_average.toFixed(1) : null,
    voteCount: details.vote_count || null,
    genres: (details.genres || []).map(g => g.name).slice(0, 5),
    runtime: details.runtime || (details.episode_run_time || []).find(n => n) || null,
    seasons: details.number_of_seasons || null,
    episodes: details.number_of_episodes || null,
    status: details.status || null,
    director,
    providerGroups: regionData
      ? {
          stream: streamList,
          free: freeList,
          ads: adsList
        }
      : null,
    watchLink: regionData?.link || null,
    tmdbUrl: `https://www.themoviedb.org/${mediaType}/${item.id}`,
    region: WATCH_REGION
  };
}

function makeEmbed(data) {
  const dateLabel = yearFrom(data.date);

  // Animated and themed server emojis with fallbacks
  const fireEmoji = getEmoji("fair", "🔥");
  const arrowEmoji = getEmoji("arrow_white", "▶️");
  const trophyEmoji = getEmoji("trophy", "🏆");
  const greenCheckEmoji = getEmoji("greencheck", "✅");
  const redCheckEmoji = getEmoji("redcheck", "❌");
  const listEmoji = getEmoji("list", "📋");
  const giftEmoji = getEmoji("gift", "🎁");

  const embed = new EmbedBuilder()
    .setColor(0x7957d5)
    .setTitle(`${fireEmoji} ${data.title} (${dateLabel})`)
    .setURL(data.imdbUrl || data.watchLink || data.tmdbUrl);

  const sections = [];

  // Section 1: Tagline & Synopsis
  let intro = "";
  if (data.tagline) {
    intro += `*“${data.tagline}”*\n\n`;
  }
  intro += `>>> ${cleanText(data.overview, 1000)}`;
  sections.push(intro);

  // Section 2: Movie / Show Information
  let durationText = "N/A";
  if (data.seasons) {
    durationText = `${data.seasons} Season${data.seasons > 1 ? "s" : ""}${data.episodes ? ` (${data.episodes} Ep)` : ""}`;
  } else if (data.runtime) {
    durationText = `${data.runtime} min`;
  }

  const detailsList = [
    `🎬 **Information**`,
    `${arrowEmoji} **Type:** ${data.kind}`,
    `${arrowEmoji} **Duration:** ${durationText}`,
    `${arrowEmoji} **Released:** ${data.date || dateLabel}`,
    `${arrowEmoji} **Status:** ${data.status || "Released"}`,
    `${arrowEmoji} **${data.mediaType === "movie" ? "Director" : "Creator"}:** ${data.director || "N/A"}`
  ];
  sections.push(detailsList.join("\n"));

  // Section 3: Rating
  let ratingLines = [`${trophyEmoji} **Rating**`];
  let ratingText = `${arrowEmoji} ⭐ **${data.tmdbRating ? `${data.tmdbRating}/10` : "N/A"}**`;
  if (data.voteCount) {
    ratingText += ` \`(${data.voteCount.toLocaleString()} votes)\``;
  }
  ratingLines.push(ratingText);
  if (data.rating) {
    ratingLines.push(`${arrowEmoji} 🏆 **IMDb:** ${data.rating}/10`);
  }
  sections.push(ratingLines.join("\n"));

  // Section 4: Genres
  sections.push(
    `${listEmoji} **Genres**\n${data.genres.length ? `**${data.genres.join("  •  ")}**` : "Not specified"}`
  );

  // Section 5: Where to Watch (Only streaming, NO rent/buy!)
  const streamLines = [];
  if (data.providerGroups?.stream?.length) {
    streamLines.push(
      `${greenCheckEmoji} **Streaming:** ${data.providerGroups.stream.map(p => p.provider_name).join(", ")}`
    );
  }
  if (data.providerGroups?.free?.length) {
    streamLines.push(
      `${giftEmoji} **Free:** ${data.providerGroups.free.map(p => p.provider_name).join(", ")}`
    );
  }
  if (data.providerGroups?.ads?.length) {
    streamLines.push(
      `${arrowEmoji} **With Ads:** ${data.providerGroups.ads.map(p => p.provider_name).join(", ")}`
    );
  }

  const watchContent = streamLines.length
    ? streamLines.join("\n")
    : `${redCheckEmoji} **Not currently available for streaming in ${data.region}.**`;

  sections.push(`📺 **Where to Watch (${data.region})**\n${watchContent}`);
  // Join sections with double newlines for clear spacing
  embed.setDescription(sections.join("\n\n"));

  // Place image at bottom (backdrop widescreen banner or poster)
  const bannerImage = data.backdrop || data.poster;
  if (bannerImage) {
    embed.setImage(bannerImage);
  }

  embed.setFooter({
    text: `Too Boring • Region: ${data.region} • TMDB Data`
  });
  embed.setTimestamp();

  return embed;
}

function makeButtons(data) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("too_boring_add_to_dm")
      .setLabel("Add to DM")
      .setEmoji("📩")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`too_boring_copy:${data.title.slice(0, 80)}`)
      .setLabel("Copy Name")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary)
  );
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Too Boring is online as ${readyClient.user.tag}`);

  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274878220352&integration_type=0&scope=bot+applications.commands`;
  console.log(`🔗 Bot Invite URL: ${inviteUrl}`);

  // Dynamic presence: DND status (Red Dot) + rotating activity description
  let presenceIndex = 0;
  function updatePresence() {
    const serverCount = client.guilds.cache.size;
    const activities = [
      { name: "movies & series 🍿", type: ActivityType.Watching },
      { name: "/recommend for picks 🎬", type: ActivityType.Watching },
      { name: `${serverCount} server${serverCount > 1 ? "s" : ""} 🌐`, type: ActivityType.Watching },
      { name: "/tbsetup for config ⚙️", type: ActivityType.Listening }
    ];

    const current = activities[presenceIndex % activities.length];
    readyClient.user.setPresence({
      status: "dnd", // Red dot (Do Not Disturb)
      activities: [current]
    });
    presenceIndex++;
  }

  updatePresence();
  setInterval(updatePresence, 15000); // Rotates dynamic description every 15 seconds
});

// Automatic setup message when the bot is added to a new server
client.on(Events.GuildCreate, async guild => {
  console.log(`Joined new server: ${guild.name} (${guild.id})`);

  const setupEmbed = new EmbedBuilder()
    .setColor(0x7957d5)
    .setTitle("👋 Welcome to Too Boring!")
    .setThumbnail(client.user.displayAvatarURL())
    .setDescription(
      "Thanks for adding **Too Boring** to your server! 🎉\n\n" +
      "### 🚀 Setup Required\n" +
      "To automatically route movies and series to dedicated channels, an administrator needs to run:\n\n" +
      "**`/tbsetup`**\n" +
      "• **`movie_channel`**: Select your dedicated Movies channel (e.g. `#movies`)\n" +
      "• **`series_channel`**: Select your dedicated Web & TV Series channel (e.g. `#web-series`)\n" +
      "• **`allowed_role`**: *(Optional)* Choose who can run `/recommend` (leave empty for everyone)\n\n" +
      "### 🍿 How It Works\n" +
      "Once configured, members can run:\n" +
      "`/recommend title: <name>`\n\n" +
      "The bot automatically detects whether it's a Movie or Series and posts directly to your designated channel with rich posters, streaming platforms, ratings, and copy button!"
    )
    .setFooter({ text: "Too Boring • Ready to Recommend" })
    .setTimestamp();

  // Find best channel to send welcome message
  let channel = guild.systemChannel;
  const botMember = guild.members.me;

  if (
    !channel ||
    !channel.permissionsFor(botMember)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
  ) {
    channel = guild.channels.cache.find(
      c =>
        c.isTextBased() &&
        c.permissionsFor(botMember)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
    );
  }

  if (channel) {
    await channel.send({ embeds: [setupEmbed] }).catch(err =>
      console.warn("Could not send setup message to channel:", err.message)
    );
  }

  // Also try sending a copy to server owner
  try {
    const owner = await guild.fetchOwner();
    if (owner) {
      await owner.send({ embeds: [setupEmbed] }).catch(() => {});
    }
  } catch (e) {
    // Ignore DM failure
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "tbsetup") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: "❌ You need Administrator permissions to use `/tbsetup`.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const movieChannel = interaction.options.getChannel("movie_channel", true);
    const seriesChannel = interaction.options.getChannel("series_channel", true);
    const allowedRole = interaction.options.getRole("allowed_role");

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "❌ This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const config = loadConfig();
    config[guildId] = {
      movieChannelId: movieChannel.id,
      seriesChannelId: seriesChannel.id,
      roleId: allowedRole ? allowedRole.id : null
    };
    saveConfig(config);

    const greenCheck = getEmoji("greencheck", "✅");
    let replyText = `${greenCheck} **Too Boring setup saved!**\n\n` +
      `🎬 **Movie Channel:** ${movieChannel}\n` +
      `📺 **Series Channel:** ${seriesChannel}\n`;

    if (allowedRole) {
      replyText += `🔒 **Allowed Role:** ${allowedRole} (only members with this role or Admins can use \`/recommend\`)`;
    } else {
      replyText += `🔓 **Allowed Role:** Everyone (no role restriction set)`;
    }

    await interaction.reply({
      content: replyText,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "recommend") {
    const guildConfig = getGuildConfig(interaction.guildId);

    // 1. Mandatory setup check: Must run /tbsetup first!
    if (!guildConfig || !guildConfig.movieChannelId || !guildConfig.seriesChannelId) {
      await interaction.reply({
        content: "⚠️ **Setup Required!**\nThis server has not been configured yet. An administrator must run `/tbsetup` first to configure the Movie and Series channels before `/recommend` can be used.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // 2. Enforce role restriction if configured
    if (guildConfig.roleId) {
      const hasRole = interaction.member?.roles?.cache?.has(guildConfig.roleId);
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
      if (!hasRole && !isAdmin) {
        await interaction.reply({
          content: `❌ You do not have permission to use this command. Only members with the <@&${guildConfig.roleId}> role can use \`/recommend\`.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title = interaction.options.getString("title", true).trim();
    const year = interaction.options.getInteger("year");
    console.log(`[RECOMMEND] Received query: "${title}", year: ${year || "none"} from ${interaction.user.tag}`);

    try {
      const data = await findContent(title, year);
      if (!data) {
        console.log(`[RECOMMEND] No matching content found for: "${title}"`);
        const redCheck = getEmoji("redcheck", "❌");
        await interaction.editReply(
          `${redCheck} I couldn't find **${title}**. Check the spelling or try the original title.`
        );
        return;
      }

      const embed = makeEmbed(data);
      const buttons = makeButtons(data);

      // Determine destination channel based on type
      const targetChannelId = data.mediaType === "movie"
        ? guildConfig.movieChannelId
        : guildConfig.seriesChannelId;

      let targetChannel = null;
      if (targetChannelId && interaction.guild) {
        targetChannel = interaction.guild.channels.cache.get(targetChannelId) ||
          await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
      }

      if (!targetChannel || !targetChannel.isTextBased()) {
        await interaction.editReply({
          content: `❌ Could not find the configured **${data.mediaType === "movie" ? "Movie" : "Series"} Channel** (<#${targetChannelId}>). Please run \`/tbsetup\` again to re-select valid channels.`
        });
        return;
      }

      // Post directly to the designated channel
      const sentMessage = await targetChannel.send({ embeds: [embed], components: [buttons] });
      console.log(`[RECOMMEND] Successfully posted "${data.title}" (${data.kind}) to #${targetChannel.name} (${sentMessage.url})`);
      const greenCheck = getEmoji("greencheck", "✅");
      await interaction.editReply(
        `${greenCheck} Successfully posted **${data.title}** to ${targetChannel}!\n🔗 [Jump to Post](${sentMessage.url})`
      );
    } catch (error) {
      console.error("Recommendation failed:", error);
      await interaction.editReply("Something went wrong while looking that up. Please try again in a moment.");
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === "too_boring_add_to_dm") {
    const message = interaction.message;
    const embed = message.embeds?.[0];
    if (!embed) {
      await interaction.reply({ content: "I couldn't find the recommendation embed to send.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await interaction.user.send({
        embeds: [EmbedBuilder.from(embed)],
        components: []
      });
      await interaction.reply({ content: "📩 Sent the recommendation to your DMs!", flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.warn("Could not DM user:", error.message);
      await interaction.reply({
        content: "I couldn't DM you. Please enable direct messages from this server's members in your Discord privacy settings, then try again.",
        flags: MessageFlags.Ephemeral
      });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith("too_boring_copy:")) {
    let movieName = interaction.customId.slice("too_boring_copy:".length);
    if (!movieName && interaction.message.embeds?.[0]) {
      const raw = interaction.message.embeds[0].title || "";
      movieName = raw.replace(/^<a?:[^>]+:\d+>\s*|[^\w\s\(\)'-]+|\s*\(\d{4}\)$/g, "").trim();
    }

    await interaction.reply({
      content: `\`\`\`${movieName}\`\`\``,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
});

client.login(DISCORD_TOKEN);
