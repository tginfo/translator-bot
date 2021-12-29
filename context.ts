import { Context as BaseContext } from "https://deno.land/x/grammy/mod.ts";
import { FileFlavor } from "https://deno.land/x/grammy_files/mod.ts";

export type Context = FileFlavor<BaseContext>;
