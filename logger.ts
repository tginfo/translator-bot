import { log, setColorEnabled } from "$deps";

setColorEnabled(false);

const formatter = (logRecord: log.LogRecord) => {
  const date = new Date();

  return `[${date.toDateString()} ${date.toLocaleTimeString()}] [${logRecord.levelName}] ${logRecord.msg}`;
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
