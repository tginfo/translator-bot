import { config } from "std/dotenv/mod.ts";
import { cleanEnv, num, str } from "envalid";

await config({ export: true });

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
  NOTIFICATIONS_CHAT: num(),
});
