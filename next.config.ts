import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["discord.js", "@discordjs/ws", "@discordjs/rest"],
  outputFileTracingExcludes: {
    "*": ["listener/**"],
  },
};

export default nextConfig;
