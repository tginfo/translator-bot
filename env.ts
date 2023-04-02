import "std/dotenv/load.ts";
import { cleanEnv, num, str } from "envalid/mod.ts";

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
  NOTIFICATIONS_CHAT: num(),
});
