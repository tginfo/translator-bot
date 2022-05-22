import { Context as BaseContext } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { FileFlavor } from "https://deno.land/x/grammy_files@v1.0.4/mod.ts";

export type Context = FileFlavor<BaseContext>;
