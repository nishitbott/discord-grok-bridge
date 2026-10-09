import { DEFAULT_GUILD_ID } from "../lib/env";

const COMMANDS = [
  {
    name: "grok",
    description: "Ask Grok",
    type: 1,
    options: [
      {
        type: 3,
        name: "question",
        description: "Your question",
        required: true,
      },
    ],
  },
];

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local is optional when the variables are already in the environment.
  }

  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID || DEFAULT_GUILD_ID;

  if (!applicationId || !token) {
    console.error("Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN");
    process.exit(1);
  }

  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(COMMANDS),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    console.error(`Discord command registration failed (${response.status})`);
    console.error(body);
    process.exit(1);
  }

  console.log(`Registered /grok in guild ${guildId}`);
  console.log(body);
}

main().catch(() => {
  console.error("Command registration failed");
  process.exit(1);
});
