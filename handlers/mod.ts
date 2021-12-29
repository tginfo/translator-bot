import { Composer } from "https://deno.land/x/grammy/mod.ts";
import callback from "./callback.ts";
import translate from "./translate.ts";

const composer = new Composer();

export default composer;

composer.use(translate);
composer.use(callback);
