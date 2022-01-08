import * as log from "https://deno.land/std@0.119.0/log/mod.ts";
import { LogRecord } from "https://deno.land/std@0.119.0/log/mod.ts";
import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { hydrateFiles } from "https://deno.land/x/grammy_files/mod.ts";
import { Context } from "./context.ts";
import handlers from "./handlers/mod.ts";
import env from "./env.ts";

const formatter = (logRecord: LogRecord) => {
  const date = new Date();

  return `[${date.toDateString()} ${date.toLocaleTimeString()}] [${
    logRecord.levelName
  }] ${logRecord.msg}`;
};

await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter,
    }),
    file: new log.handlers.FileHandler("NOTSET", {
      filename: "./log.txt",
      formatter,
    }),
  },
  loggers: {
    default: {
      handlers: ["console", "file"],
    },
  },
});

const bot = new Bot<Context>(env.BOT_TOKEN);

bot.catch(({ error }) => log.warning(String(error)));

bot.api.config.use(hydrateFiles(bot.token));

bot.use(handlers);

try {
  await bot.api.getMe();
} catch (err) {
  log.critical(`Failed to start the bot: ${err}`);
  Deno.exit();
}

log.info("The bot is running.");

await bot.start();
