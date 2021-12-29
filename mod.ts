import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { hydrateFiles } from "https://deno.land/x/grammy_files/mod.ts";
import handlers from "./handlers/mod.ts";
import env from "./env.ts";

const bot = new Bot(env.BOT_TOKEN);

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

await bot.start();
