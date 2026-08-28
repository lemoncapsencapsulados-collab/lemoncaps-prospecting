import { register } from "node:module";

/** Registers the "@/*" resolver hook for plain Node processes (worker, scripts). */
register("./alias-hooks.mjs", import.meta.url);
