export function resolveBeyConfig(env = process.env) {
  return {
    apiKey: env.BEY_API_KEY || env.BEYOND_API_KEY || "",
    avatarId: env.BEY_AVATAR_ID || env.BEYOND_AVATAR_ID || "",
    participantIdentity:
      env.BEY_AVATAR_PARTICIPANT_IDENTITY || "bey-avatar-agent",
    participantName: env.BEY_AVATAR_PARTICIPANT_NAME || "bey-avatar-agent",
  };
}
