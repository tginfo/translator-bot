import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { hydrateFiles } from "https://deno.land/x/grammy_files/mod.ts";
import { Context } from "./context.ts";
import handlers from "./handlers/mod.ts";
import { log } from "./utils.ts";
import env from "./env.ts";

const bot = new Bot<Context>(env.BOT_TOKEN);

bot.catch(({ error }) => log(String(error), "warning"));

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

try {
  await bot.api.getMe();
} catch (err) {
  log(`Failed to start the bot: ${err}`, "error");
  Deno.exit();
}

log("The bot is running.", "secondary");

await bot.start();
