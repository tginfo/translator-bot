import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { hydrateFiles } from "https://deno.land/x/grammy_files/mod.ts";
import handlers from "./handlers/mod.ts";
import { log } from "./utils.ts";
import env from "./env.ts";

const bot = new Bot(env.BOT_TOKEN);

bot.catch(console.error);

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

await bot.api.getMe();

log("The bot is running.", "secondary");

await bot.start();