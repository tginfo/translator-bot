import { Composer } from "https://deno.land/x/grammy/mod.ts";

import { Context } from "../context.ts";
import callback from "./callback.ts";
import sudoers from "./sudoers.ts";
import translate from "./translate.ts";

const composer = new Composer<Context>();

export default composer;

composer.use(callback);
composer.use(sudoers);
composer.use(translate);
