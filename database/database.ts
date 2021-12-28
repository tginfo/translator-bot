import { client } from "./client.ts";

export const getDatabase = () => client.database("translator_bot");
