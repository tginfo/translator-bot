import * as log from "std/log/mod.ts";
import { setColorEnabled } from "std/fmt/colors.ts";

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
