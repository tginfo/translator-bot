import { setColorEnabled } from "https://deno.land/std@0.140.0/fmt/colors.ts";
import * as log from "https://deno.land/std@0.140.0/log/mod.ts";
import { LogRecord } from "https://deno.land/std@0.140.0/log/mod.ts";

setColorEnabled(false);

const formatter = (logRecord: LogRecord) => {
  const date = new Date();

  return `[${date.toDateString()} ${date.toLocaleTimeString()}] [${
    logRecord.levelName
  }] ${logRecord.msg}`;
};

export const setup = () =>
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("DEBUG", {
        formatter,
      }),
    },
    loggers: {
      default: {
        level: "DEBUG",
        handlers: ["console"],
      },
    },
  });
