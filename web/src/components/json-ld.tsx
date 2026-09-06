/** Renders a JSON-LD block. The data is ours, built in lib/seo.ts —
 *  never user input, so serialising it into a script tag is safe here. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
