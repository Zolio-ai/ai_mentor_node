import { voice } from "@livekit/agents";
import { ASSISTANT_INSTRUCTIONS } from "./prompts.js";

export class Assistant extends voice.Agent {
  constructor() {
    super({
      instructions: ASSISTANT_INSTRUCTIONS,
    });
  }
}
