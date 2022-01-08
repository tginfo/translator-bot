import {
  critical,
  info,
  warning,
} from "https://deno.land/std@0.120.0/log/mod.ts";

import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { hydrateFiles } from "https://deno.land/x/grammy_files/mod.ts";

import { Context } from "./context.ts";
import env from "./env.ts";
import handlers from "./handlers/mod.ts";

const bot = new Bot<Context>(env.BOT_TOKEN);

bot.catch(({ error }) => warning(String(error)));

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

export const start = async () => {
  try {
    await bot.api.getMe();
  } catch (err) {
    critical(`Failed to start the bot: ${err}`);
    Deno.exit();
  }

  info("The bot is running.");

  await bot.start();
};
