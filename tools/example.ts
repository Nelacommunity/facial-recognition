import { tool } from "@aixjs/aix";
import * as z from "zod";

export const currentTime = tool({
  name: "current_time",
  description: "Get the current date and time, optionally in an IANA time zone such as Europe/Berlin.",
  input: z.object({ timeZone: z.string().optional() }),
  execute: ({ timeZone }) => {
    const now = new Date();
    return { iso: now.toISOString(), local: now.toLocaleString("en-US", { timeZone: timeZone ?? "UTC", dateStyle: "full", timeStyle: "long" }) };
  },
});
