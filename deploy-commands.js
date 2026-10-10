require("dotenv").config();
const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const recommendCommand = new SlashCommandBuilder()
  .setName("recommend")
  .setDescription("Find movies, TV shows, or web series by title")
  .addStringOption(option =>
    option.setName("title")
      .setDescription("Movie or series name (e.g. Legend or Legend 2015)")
      .setRequired(true)
      .setMaxLength(150))
  .addIntegerOption(option =>
    option.setName("year")
      .setDescription("Optional release year (e.g. 2015) to find exact version")
      .setRequired(false)
      .setMinValue(1900)
      .setMaxValue(2050));

const setupCommand = new SlashCommandBuilder()
  .setName("tbsetup")
  .setDescription("Setup movie & series channels and allowed role")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(option =>
    option.setName("movie_channel")
      .setDescription("Channel where movie recommendations will be sent")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
  .addChannelOption(option =>
    option.setName("series_channel")
      .setDescription("Channel where TV and web series recommendations will be sent")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
  .addRoleOption(option =>
    option.setName("allowed_role")
      .setDescription("Specific role allowed to use /recommend (optional)")
      .setRequired(false));

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);
const commands = [recommendCommand.toJSON(), setupCommand.toJSON()];

async function deploy() {
  try {
    console.log("Registering commands globally...");
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("✅ Registered commands globally (available in all servers)!");

    if (guildId) {
      console.log(`Registering commands for test server (${guildId})...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log("✅ Registered commands for test server immediately!");
    }
  } catch (error) {
    console.error("Failed to register slash commands:", error);
    process.exit(1);
  }
}

deploy();
