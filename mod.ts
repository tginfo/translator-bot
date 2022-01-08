import * as logger from "./logger.ts";
import * as bot from "./bot.ts";

await logger.setup();
await bot.start();
