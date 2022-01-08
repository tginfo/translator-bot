import * as log from "https://deno.land/std@0.119.0/log/mod.ts";
import { LogRecord } from "https://deno.land/std@0.119.0/log/mod.ts";

import env from "./env.ts";

const formatter = (logRecord: LogRecord) => {
  const date = new Date();

  return `[${date.toDateString()} ${date.toLocaleTimeString()}] [${logRecord.levelName}] ${logRecord.msg}`;
};

export const setup = () =>
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("NOTSET", {
        formatter,
      }),
      file: new log.handlers.FileHandler("NOTSET", {
        filename: env.LOG_FILE,
        formatter,
      }),
    },
    loggers: {
      default: {
        level: "NOTSET",
        handlers: ["console", "file"],
      },
    },
  });
