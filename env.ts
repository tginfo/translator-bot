import "@std/dotenv/load";
import { cleanEnv, num, str } from "envalid/mod.ts";

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str(),
  NOTIFICATIONS_CHAT: num(),
  GOOGLE_APPLICATION_CREDENTIALS: str(),
  GCLOUD_TRANSLATION_PROJECT_ID: str(),
  GCLOUD_TRANSLATION_LOCATION: str(),
  GHOST_URL: str(),
  GHOST_ADMIN_API_KEY: str(),
});
