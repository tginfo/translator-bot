import { cleanEnv, config, str } from "./deps.ts";

config({ export: true });

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
});
