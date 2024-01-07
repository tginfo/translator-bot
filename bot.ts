import * as log from "std/log/mod.ts";
import { Bot } from "grammy/mod.ts";
import { hydrateFiles } from "grammy_files/mod.ts";
import { Context } from "./utils.ts";
import handlers from "./handlers/mod.ts";
import env from "./env.ts";

const bot = new Bot<Context>(env.BOT_TOKEN);

bot.catch(({ error }) => log.warning(String(error)));

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

export const start = () =>
  bot.start({
    drop_pending_updates: true,
    onStart: () => {
      log.info("The bot is running.");
    },
    allowed_updates: [
      "callback_query",
      "channel_post",
      "chat_member",
      "edited_channel_post",
      "edited_message",
      "inline_query",
      "message",
    ],
  });
