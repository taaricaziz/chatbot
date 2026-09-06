/**
 * Markdown out of chat replies.
 *
 * The system prompt asks the model not to use markdown. It was tested against
 * a real free model and IGNORED — the reply still came back full of
 * `**bold**`, which a plain-text bubble renders as literal asterisks.
 *
 * So this is the same principle the rest of the assistant is built on: a
 * prompt is a request, code is a guarantee. Asking politely stays in the
 * prompt because it costs nothing and helps; this is what actually holds.
 *
 * No dependency and no "server-only": the widget and the transcript writer
 * both use it, so the customer and the staff read exactly the same words.
 */

export function stripMarkdown(text: string): string {
  return (
    text
      // Bold and italic, longest markers first so `**` is not left as a `*`.
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/__([^_]*)__/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1$2")
      // Any unmatched marker left mid-stream: the closing half has not
      // arrived yet, and a dangling `**` on screen looks like a bug.
      .replace(/\*\*/g, "")
      // Inline code and fences — the café has no code to show anyone.
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/`([^`]*)`/g, "$1")
      // Headings, which have no meaning in a chat bubble.
      .replace(/^#{1,6}\s+/gm, "")
      // Markdown's two-space hard break is invisible and only adds noise.
      .replace(/[ \t]+$/gm, "")
      // Three or more blank lines collapse to one gap.
      .replace(/\n{3,}/g, "\n\n")
  );
}
