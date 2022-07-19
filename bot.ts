import { Bot, Context, hydrateFiles, log, p } from "$deps";
import handlers from "./handlers/mod.ts";
import env from "./env.ts";

const bot = new Bot<Context>(env.BOT_TOKEN);

bot.catch(({ error }) => log.warning(String(error)));

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

export const start = () =>
  bot.start({
    onStart: () => {
      log.info("The bot is running.");
    },
  });
