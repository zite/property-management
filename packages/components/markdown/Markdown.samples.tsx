import { useState } from 'react';
import { MarkdownEditor } from '../markdown-editor';
import { Markdown } from './index';

const initialContent = `## Hello, Markdown!

This is a **rich text** editor. Edit the content above and see it rendered below.

### Features

- **Bold**, *italic*, and ~~strikethrough~~ text
- Ordered and unordered lists
- \`Inline code\` and fenced code blocks
- Blockquotes and horizontal rules
- <mark>Highlighted</mark> text

### Code Example

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

### Blockquote

> "The best way to predict the future is to invent it."
> — Alan Kay

---

[Learn more about Markdown](https://www.markdownguide.org)
`;

export function MarkdownSamplesContent() {
  const [content, setContent] = useState(initialContent);

  return (
    <>
      <div>
        <h2 className="mb-2 text-lg font-semibold">Editor</h2>
        <MarkdownEditor content={content} onChange={setContent} />
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold">Preview</h2>
        <Markdown>{content}</Markdown>
      </div>
    </>
  );
}

export function MarkdownSamples() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
        <h1 className="text-2xl font-bold">Markdown</h1>
        <MarkdownSamplesContent />
      </div>
    </div>
  );
}
