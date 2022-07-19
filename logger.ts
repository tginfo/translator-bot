import { log, setColorEnabled } from "$deps";

setColorEnabled(false);

export const setup = () =>
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("DEBUG", {
        formatter: (r) =>
          `[${r.datetime.toDateString()} ${r.datetime.toLocaleTimeString()}] [${r.levelName}] ${r.msg}`,
      }),
    },
    loggers: {
      default: {
        level: "DEBUG",
        handlers: ["console"],
      },
    },
  });
