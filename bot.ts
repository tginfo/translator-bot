import { Bot, hydrateFiles, log } from "./deps.ts";
import { Context } from "./context.ts";
import env from "./env.ts";
import handlers from "./handlers/mod.ts";

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
