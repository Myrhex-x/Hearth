// Small local models often say what they will do next ("Let's update the
// addItem function.") and then stop without doing it. Spotting that lets the
// agent ask them, once, to go ahead.

// Doing, and looking: "let's check the function" with nothing after it is unfinished too.
const ACT = '(make|change|update|edit|fix|modify|add|apply|write|create|implement|correct|patch|replace|remove|rename|run|refactor|move|delete|check|look|read|open|search|inspect|examine|investigate|verify|test)'

/** Announces a next step in the first person: "let's fix", "I'll update", "now I will run". The verb in its base form: "what changed" is a report. */
const PROMISE = new RegExp(`\\b(let'?s|let me|i(?:'ll| will| am going to|'m going to)|we(?:'ll| will)|now,? (?:i|we)(?:'ll| will)?)\\b[^.!?\\n]{0,48}?\\b${ACT}\\b`, 'i')

/** Endings that close a turn instead of promising more. */
const CLOSING = /\b(let me know|if you (?:want|would like|need)|should i|would you like|do you want|feel free)\b/i

/**
 * Whether a reply ends by announcing an action it did not take. Only the last
 * paragraph counts: earlier plans were usually followed by tool calls.
 */
export function announcesAction(text: string): boolean {
  const paragraphs = text.trim().split(/\n\s*\n/)
  const last = paragraphs[paragraphs.length - 1] ?? ''
  if (!last || CLOSING.test(last)) return false
  // A finished change reads in the past tense; a promise reads in the future.
  return PROMISE.test(last)
}
