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

/* The panel is an embed, and an embed has its own limits -- different ones,
   which is exactly why they get forgotten. */
console.log("\nThe panel");
const EMBED = {
  title: 256,
  description: 4096,
  noticeTitle: 256,
  noticeBody: 1024,
  howToTitle: 256,
  howToBody: 1024,
  footer: 2048,
  buttonLabel: 80,
};
for (const [field, limit] of Object.entries(EMBED)) {
  const value = config.panel[field] ?? "";
  check(value.length <= limit, `${field} is ${value.length} of ${limit}`);
}
const modalTitle = config.modal?.title ?? "";
check(modalTitle.length <= 45, `the modal title is ${modalTitle.length} of 45`);
const embedTotal = Object.keys(EMBED)
  .filter((field) => field !== "buttonLabel")
  .map((field) => String(config.panel[field] ?? ""))
  .join("").length;
check(embedTotal <= 6000, `${embedTotal} characters in the embed, of 6000`);

/* Printed rather than asserted: whether it reads well is not something a
   length check can tell you, and this is the only place to see it without
   posting it to a live server. */
const fill = (text) =>
  String(text)
    .replaceAll("{count}", String(config.questions.length))
    .replaceAll("{button}", config.panel.buttonLabel);
const indent = (text) =>
  String(text)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

console.log("\nThe panel as it will read\n");
console.log(`  ${config.panel.title}`);
console.log(indent(config.panel.description));
console.log(`\n  ${config.panel.noticeTitle}`);
console.log(`  ${config.panel.noticeBody}`);
console.log(`\n  ${config.panel.howToTitle}`);
console.log(indent(fill(config.panel.howToBody)));
console.log(`\n  ${fill(config.panel.footer)}`);
console.log(`\n  [ ${config.panel.buttonEmoji} ${config.panel.buttonLabel} ]`);

console.log(`\nThe form as it will read  (${modalTitle})`);
for (const question of config.questions) {
  console.log(`\n  ${question.label}`);
  console.log(`  ${question.description}`);
  console.log(`  > ${question.placeholder}`);
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
