/**
 * Checks the ticket form before Discord does.
 *
 * A modal is validated when it is opened, in front of the applicant. Get a
 * length wrong and the button does nothing at all: no message, no log line,
 * just a candidate who concludes the alpha is closed and goes away. That is a
 * bad way to find out, so the same limits are checked here.
 *
 *     npm run verify
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");

/* Discord's own numbers, spelled out so a failure names the rule it broke. */
const LIMITS = { label: 45, description: 100, placeholder: 100 };
const MAX_QUESTIONS = 5;
const SERVICE_CHANNELS = ["stable", "beta", "alpha", "experimental", "maker"];

let failures = 0;
const check = (ok, said) => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${said}`);
  if (!ok) failures += 1;
};

const config = JSON.parse(read("tickets.config.json"));

console.log("The form");
check(
  Array.isArray(config.questions) && config.questions.length > 0,
  "the form asks something",
);
check(
  config.questions.length <= MAX_QUESTIONS,
  `${config.questions.length} questions, and Discord allows ${MAX_QUESTIONS}`,
);

for (const question of config.questions) {
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = question[field] ?? "";
    check(
      value.length <= limit,
      `${question.id}: ${field} is ${value.length} of ${limit}`,
    );
  }
  check(
    Boolean(question.description),
    `${question.id}: says where its own line breaks`,
  );
  check(
    question.minLength <= question.maxLength,
    `${question.id}: ${question.minLength} to ${question.maxLength} is an answerable range`,
  );
}

const ids = config.questions.map((question) => question.id);
check(new Set(ids).size === ids.length, "no two questions share an id");

/* The part that actually proves it: discord.js validates on toJSON. */
console.log("\nThe modal Discord will be sent");
try {
  const modal = new ModalBuilder()
    .setCustomId("ticket:create")
    .setTitle(config.modal.title);
  for (const question of config.questions) {
    const input = new TextInputBuilder()
      .setCustomId(question.id)
      .setStyle(
        question.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph,
      )
      .setRequired(question.required !== false)
      .setMaxLength(question.maxLength);
    if (question.minLength > 0) input.setMinLength(question.minLength);
    if (question.placeholder) input.setPlaceholder(question.placeholder);
    const field = new LabelBuilder()
      .setLabel(question.label)
      .setTextInputComponent(input);
    if (question.description) field.setDescription(question.description);
    modal.addLabelComponents(field);
  }
  modal.toJSON();
  check(true, "builds and passes discord.js validation");
} catch (error) {
  check(false, `would be rejected: ${error.message}`);
}

/* An accepted application that grants nothing is an accepted application the
   person cannot act on, and nobody finds out until they complain. */
console.log("\nWhat acceptance does");
check(
  config.grantOnAccept === null || SERVICE_CHANNELS.includes(config.grantOnAccept),
  `grantOnAccept is ${JSON.stringify(config.grantOnAccept)}, which the service knows`,
);
check(
  config.grantOnAccept !== null,
  "accepting a ticket gives the access it was accepted for",
);

/* Two copies of the questions exist: the file an admin edits, and the fallback
   compiled in for when that file is missing. They drift silently. */
console.log("\nThe built-in fallback");
const source = read("tickets.js");
const defaults = source.slice(
  source.indexOf("const defaultConfig = {"),
  source.indexOf("export const ticketCommand"),
);
for (const question of config.questions) {
  check(
    defaults.includes(`"label": "${question.label}"`),
    `${question.id}: the fallback asks the same thing`,
  );
}

console.log(
  failures === 0
    ? "\nThe form is one Discord will open."
    : `\n${failures} problem${failures === 1 ? "" : "s"}.`,
);
process.exit(failures === 0 ? 0 : 1);
