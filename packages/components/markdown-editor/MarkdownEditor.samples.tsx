import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { MarkdownEditor, type MarkdownEditorProps } from './index.tsx';

const sampleContent = `## Welcome to the Editor

This is a **rich text** editor built with *TipTap*.

- Supports ==highlighting==
- Lists, quotes, and headings
- Text formatting and more

> Try editing this content!
`;

const toggleOptions = [
  { key: 'hideBold', label: 'Bold' },
  { key: 'hideItalic', label: 'Italic' },
  { key: 'hideStrikethrough', label: 'Strikethrough' },
  { key: 'hideCode', label: 'Code' },
  { key: 'hideHighlight', label: 'Highlight' },
  { key: 'hideHeadings', label: 'Headings' },
  { key: 'hideBulletList', label: 'Bullet List' },
  { key: 'hideOrderedList', label: 'Ordered List' },
  { key: 'hideBlockquote', label: 'Blockquote' },
  { key: 'hideHorizontalRule', label: 'Horizontal Rule' },
  { key: 'hideUndoRedo', label: 'Undo/Redo' },
] as const;

type HideFlags = Record<(typeof toggleOptions)[number]['key'], boolean>;

const externalContents = [
  {
    label: 'Meeting Notes',
    content: `## Meeting Notes\n\nDiscussed **project timeline** and upcoming milestones.\n\n- [ ] Finalize design by Friday\n- [ ] Review PR #42\n- [ ] Deploy to staging\n`,
  },
  {
    label: 'Bug Report',
    content: `## Bug Report\n\n**Steps to reproduce:**\n\n1. Open the app\n2. Click on *Settings*\n3. Toggle dark mode twice\n\n> Expected: Theme switches cleanly\n> Actual: Flicker on second toggle\n`,
  },
  {
    label: 'Release Notes',
    content: `## Release v2.1.0\n\nHighlights:\n\n- ==New markdown editor== with toolbar customization\n- Fixed horizontal rule rendering\n- Improved **performance** for large documents\n\n---\n\nThanks to all contributors!\n`,
  },
];

function ExternalContentEditor() {
  const [content, setContent] = useState(externalContents[0].content);

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">External Content Update</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Update the editor content from the outside by clicking a button.
      </p>
      <div className="mb-3 flex gap-2">
        {externalContents.map(({ label, content: c }) => (
          <button
            key={label}
            onClick={() => setContent(c)}
            className="rounded-md border border-input px-3 py-1 text-sm hover:bg-accent"
          >
            {label}
          </button>
        ))}
      </div>
      <MarkdownEditor content={content} onChange={setContent} />
    </div>
  );
}

function InteractiveEditor() {
  const [flags, setFlags] = useState<HideFlags>(
    () =>
      Object.fromEntries(
        toggleOptions.map(({ key }) => [key, false]),
      ) as HideFlags,
  );
  const [height, setHeight] =
    useState<MarkdownEditorProps['height']>('dynamic-md');

  const toggle = (key: keyof HideFlags) =>
    setFlags(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Interactive Editor</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Toggle toolbar buttons on and off.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toggleOptions.map(({ key, label }) => (
          <label
            key={key}
            className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-sm select-none hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={() => toggle(key)}
              className="accent-primary"
            />
            <span
              className={flags[key] ? 'line-through text-muted-foreground' : ''}
            >
              {label}
            </span>
          </label>
        ))}
        <label className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-sm select-none">
          Height:
          <select
            value={height}
            onChange={e => setHeight(e.target.value as typeof height)}
            className="bg-transparent text-sm outline-none"
          >
            <option value="dynamic-sm">Dynamic Small</option>
            <option value="dynamic-md">Dynamic Medium</option>
            <option value="dynamic-lg">Dynamic Large</option>
            <option value="sm">Fixed Small</option>
            <option value="md">Fixed Medium</option>
            <option value="lg">Fixed Large</option>
          </select>
        </label>
      </div>
      <MarkdownEditor content={sampleContent} {...flags} height={height} />
    </div>
  );
}

export function MarkdownEditorSamplesContent() {
  const [output, setOutput] = useState('');

  return (
    <>
      <div>
        <h2 className="mb-2 text-lg font-semibold">Default Editor</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          An empty editor ready for input.
        </p>
        <MarkdownEditor onChange={setOutput} />
        {output && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
            {output}
          </pre>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Pre-filled Editor</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Editor initialized with sample content.
        </p>
        <MarkdownEditor height="dynamic-sm" content={sampleContent} />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Read-only Editor</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Non-editable view of content — toolbar is hidden.
        </p>
        <MarkdownEditor content={sampleContent} editable={false} />
      </div>

      <ExternalContentEditor />

      <InteractiveEditor />
    </>
  );
}

export function MarkdownEditorSamples() {
  const [dark, setDark] = useState(false);

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Markdown Editor</h1>
            <button
              onClick={() => setDark(!dark)}
              className="rounded-md border border-input p-2 hover:bg-accent"
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
          </div>
          <MarkdownEditorSamplesContent />
        </div>
      </div>
    </div>
  );
}
