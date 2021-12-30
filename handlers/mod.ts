import { Composer } from "https://deno.land/x/grammy/mod.ts";
import translate from "./translate.ts";
import callback from "./callback.ts";
import sudoers from "./sudoers.ts";

const composer = new Composer();

export default composer;

composer.use(translate);
composer.use(callback);
composer.use(sudoers);
