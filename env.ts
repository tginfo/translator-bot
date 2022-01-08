import "https://deno.land/x/dotenv/load.ts";
import { cleanEnv, str } from "https://deno.land/x/envalid/mod.ts";

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
  LOG_FILE: str({ default: "logs/logs.txt" }),
});
