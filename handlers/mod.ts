import { Composer } from "grammy/mod.ts";
import { Context } from "../utils.ts";
import callback from "./callback.ts";
import edit from "./edit.ts";
import sudoers from "./sudoers.ts";
import translate from "./translate.ts";
import join from "./join.ts";
import utils from "./utils.ts";

const composer = new Composer<Context>();

export default composer;

composer.use(translate);
composer.use(callback);
composer.use(utils);
composer.use(edit);
composer.use(sudoers);
composer.use(join);
