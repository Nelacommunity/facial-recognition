import { agent, calculator } from "@aixjs/aix";
import { currentTime } from "../tools/example";

export const assistant = agent({
  name: "assistant",
  model: "auto",
  instructions: `You are a helpful, concise assistant. Use tools for math and time instead of guessing.`,
  tools: [calculator, currentTime],
  // Remembers the conversation per browser session.
  memory: true,
  // Agents are private by default. "public" allows the browser to start runs (rate limited).
  access: "public",
});
