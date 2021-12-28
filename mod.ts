import { Bot } from "https://deno.land/x/grammy/mod.ts";
import { client } from "./database/mod.ts";
import env from "./env.ts";

const bot = new Bot(env.BOT_TOKEN);

await client.connect(env.DB_URI);
await bot.start();
