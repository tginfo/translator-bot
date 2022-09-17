import * as bot from "./bot.ts";
import * as logger from "./logger.ts";

await logger.setup();
bot.start();
