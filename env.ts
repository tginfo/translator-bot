import { cleanEnv, config, num, str } from "$deps";

await config({ export: true });

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
  NOTIFICATIONS_CHAT: num(),
});
