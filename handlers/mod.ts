import { Composer } from "grammy";
import { Context } from "../utils.ts";
import callback from "./callback.ts";
import edit from "./edit.ts";
import sudoers from "./sudoers.ts";
import translate from "./translate.ts";

const composer = new Composer<Context>();

export default composer;

composer.use(callback);
composer.use(edit);
composer.use(sudoers);
composer.use(translate);
