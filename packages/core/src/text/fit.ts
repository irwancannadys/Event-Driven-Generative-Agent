/** Cuts a text to at most `max` characters, with an ellipsis, so that it fits the limits of the LLM contracts. */
export function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
