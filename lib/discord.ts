import nacl from "tweetnacl";

export interface DiscordUser {
  id?: string;
  username?: string;
}

export interface DiscordCommandOption {
  name?: string;
  type?: number;
  value?: string;
}

export interface DiscordInteraction {
  type?: number;
  id?: string;
  application_id?: string;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: {
    roles?: string[];
    user?: DiscordUser;
  };
  data?: {
    name?: string;
    options?: DiscordCommandOption[];
  };
}

export function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const key = decodeHex(publicKey);
    const sig = decodeHex(signature);
    if (!key || !sig) {
      return false;
    }
    if (
      key.length !== nacl.sign.publicKeyLength ||
      sig.length !== nacl.sign.signatureLength
    ) {
      return false;
    }

    const message = Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      Buffer.from(rawBody, "utf8"),
    ]);
    return nacl.sign.detached.verify(message, sig, key);
  } catch {
    return false;
  }
}

function decodeHex(value: string): Buffer | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }
  return Buffer.from(value, "hex");
}

export function questionFromInteraction(interaction: DiscordInteraction): string {
  const option = interaction.data?.options?.find((item) => item.name === "question");
  return typeof option?.value === "string" ? option.value : "";
}
