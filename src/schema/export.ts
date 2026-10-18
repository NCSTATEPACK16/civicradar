import { writeFileSync } from "node:fs";
import { z } from "zod";
import { CivicActionSchema } from "./civic_action.js";

writeFileSync("schema/civic_action.json", JSON.stringify(z.toJSONSchema(CivicActionSchema), null, 2) + "\n");
console.log("wrote schema/civic_action.json");
