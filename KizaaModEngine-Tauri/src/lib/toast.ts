import { toast as sonner } from 'sonner'
import { translate } from './i18n'

/**
 * Sonner's toast, saying its messages in the launcher's language.
 *
 * The messages are written in English where they happen, mostly in the
 * query hooks, which run outside React and cannot ask `useI18n`. Rather
 * than thread a translator through a hundred call sites, the message is
 * translated here, in one of three ways:
 *
 * - whole, when the dictionary has it ("Instance renamed");
 * - by template, when it carries a name or a number ("Installed {name}");
 * - by its label, when it is "Label: details" and the details are an error
 *   the launcher's backend wrote ("Install failed: the file is locked").
 */

/** Messages that carry a value. The `{…}` part is kept as it came. */
const TEMPLATES = [
  'Installed {name}',
  'Imported {name}',
  'Installed to {name}',
  '{name} deleted',
  '{name} connected',
  '{name} installed.',
  'Connected as {name}',
  'Active Minecraft account: {name}',
  'Java {version} ready',
  'Java {version} selected',
  'Version set to {version}. Install to download the new files.',
  'Refreshed {count} mods from disk',
  '{count} file(s) identified',
  '{count} file(s) updated',
  '{count} files installed',
  'Downloaded to {path}',
  '{path} installed and pinned',
  'Lockfile written to {path}',
  'Minecraft launched (PID {pid})',
  'Crash report sent ({reference}).',
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED = TEMPLATES.map((template) => ({
  template,
  pattern: new RegExp(`^${escape(template).replace(/\\\{\w+\\\}/g, '(.+)')}$`, 's'),
}))

export function translateMessage(message: string): string {
  const whole = translate(message)
  if (whole !== message) return whole

  for (const { template, pattern } of COMPILED) {
    const match = pattern.exec(message)
    if (!match) continue
    const translated = translate(template)
    if (translated === template) return message
    let index = 1
    return translated.replace(/\{\w+\}/g, () => match[index++] ?? '')
  }

  const colon = message.indexOf(': ')
  if (colon > 0) {
    const label = message.slice(0, colon)
    const translated = translate(label)
    if (translated !== label) {
      return `${translated}${translate(': ')}${message.slice(colon + 2)}`
    }
  }
  return message
}

const say =
  (show: typeof sonner.success) =>
  (message: Parameters<typeof sonner.success>[0], options?: Parameters<typeof sonner.success>[1]) =>
    show(typeof message === 'string' ? translateMessage(message) : message, options)

export const toast = Object.assign(say(sonner), {
  success: say(sonner.success),
  error: say(sonner.error),
  warning: say(sonner.warning),
  info: say(sonner.info),
  message: say(sonner.message),
  dismiss: sonner.dismiss,
  loading: sonner.loading,
  promise: sonner.promise,
  custom: sonner.custom,
})
