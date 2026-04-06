import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_INSTRUCTIONS,
  INITIAL_GREETING,
} from "../src/prompts.js";

test("assistant instructions preserve mentor behavior", () => {
  assert.match(ASSISTANT_INSTRUCTIONS, /supportive voice mentor/i);
  assert.match(ASSISTANT_INSTRUCTIONS, /brief and easy to follow aloud/i);
  assert.match(
    ASSISTANT_INSTRUCTIONS,
    /Do not use complex formatting, emojis, asterisks, or other symbols\./i,
  );
});

test("initial greeting matches python version", () => {
  assert.equal(
    INITIAL_GREETING,
    "Hi, I am your mentor today. What are you working on, or where do you feel stuck?",
  );
});
