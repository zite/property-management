import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { cn } from '../lib/utils';
import { MarkdownEditorToolbar } from './MarkdownEditorToolbar';

import '../markdown/markdown.css';

declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

export interface MarkdownEditorProps {
  /** Initial markdown content to populate the editor with. */
  content?: string;
  /** Callback fired on every change, receiving the current markdown string. */
  onChange?: (markdown: string) => void;
  /** Additional class names applied to the outer wrapper element. */
  className?: string;
  /** Additional class names applied to the editor content area. */
  editorClassName?: string;
  /**
   * Whether the editor content is editable. When `false`, the toolbar is hidden.
   * @default true
   */
  editable?: boolean;
  /** Hide the bold button from the toolbar. */
  hideBold?: boolean;
  /** Hide the italic button from the toolbar. */
  hideItalic?: boolean;
  /** Hide the strikethrough button from the toolbar. */
  hideStrikethrough?: boolean;
  /** Hide the inline code button from the toolbar. */
  hideCode?: boolean;
  /** Hide the highlight button from the toolbar. */
  hideHighlight?: boolean;
  /** Hide the heading buttons (H1, H2, H3) from the toolbar. */
  hideHeadings?: boolean;
  /** Hide the bullet list button from the toolbar. */
  hideBulletList?: boolean;
  /** Hide the ordered list button from the toolbar. */
  hideOrderedList?: boolean;
  /** Hide the blockquote button from the toolbar. */
  hideBlockquote?: boolean;
  /** Hide the horizontal rule button from the toolbar. */
  hideHorizontalRule?: boolean;
  /** Hide the undo/redo buttons from the toolbar. */
  hideUndoRedo?: boolean;
  /**
   * Controls the editor height. Fixed values (`sm`, `md`, `lg`) set a fixed height.
   * Dynamic values (`dynamic-sm`, `dynamic-md`, `dynamic-lg`) set a minimum height
   * that grows with content.
   * @default "dynamic-md"
   */
  height?: 'sm' | 'md' | 'lg' | 'dynamic-sm' | 'dynamic-md' | 'dynamic-lg';
}

/**
 * A rich text / markdown editor built on TipTap. Use this whenever the user
 * needs to write or edit formatted text. The editor returns markdown via
 * `onChange` and accepts markdown as `content`.
 *
 * Storage: if you need to persist rich text in a Zite database, use the
 * `rich_text` field type for that field — it stores markdown directly.
 *
 * Styling: the editor renders its own border, shadow, and focus ring. Do NOT
 * wrap it in another bordered/shadowed container — you'll get double borders.
 *
 * Read-only rendering: for displaying markdown without an editor, import
 * `Markdown` from `@/components/markdown` instead. Don't pass `editable={false}`
 * here for static content — it still mounts a full TipTap instance.
 *
 * DO NOT build your own rich text editor. DO NOT swap in a different library
 * (Lexical, Slate, Quill, etc.). Use this component.
 *
 * @example
 * ```tsx
 * import { MarkdownEditor } from './'
 *
 * <MarkdownEditor
 *   content="**Hello** world"
 *   onChange={(markdown) => setNotes(markdown)}
 * />
 * ```
 *
 * @example Hide specific toolbar buttons:
 * ```tsx
 * <MarkdownEditor hideHeadings hideBlockquote hideHorizontalRule />
 * ```
 *
 * @example Read-only with toolbar hidden:
 * ```tsx
 * <MarkdownEditor content={notes} editable={false} />
 * ```
 */
export function MarkdownEditor({
  content = '',
  onChange,
  className,
  editorClassName,
  editable = true,
  hideBold,
  hideItalic,
  hideStrikethrough,
  hideCode,
  hideHighlight,
  hideHeadings,
  hideBulletList,
  hideOrderedList,
  hideBlockquote,
  hideHorizontalRule,
  hideUndoRedo,
  height = 'dynamic-md',
}: MarkdownEditorProps) {
  const valueRef = useRef(content);
  const editor = useEditor({
    extensions: [StarterKit, Highlight, Typography, Image, Markdown],
    content,
    editable,
    onUpdate: ({ editor }) => {
      const markdown = editor.storage.markdown.getMarkdown();
      valueRef.current = markdown;
      onChange?.(markdown);
    },
  });

  useEffect(() => {
    if (editor && content !== valueRef.current) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-visible:outline-none focus-within:ring-ring',
        className,
      )}
    >
      {editable && (
        <MarkdownEditorToolbar
          editor={editor}
          hideBold={hideBold}
          hideItalic={hideItalic}
          hideStrikethrough={hideStrikethrough}
          hideCode={hideCode}
          hideHighlight={hideHighlight}
          hideHeadings={hideHeadings}
          hideBulletList={hideBulletList}
          hideOrderedList={hideOrderedList}
          hideBlockquote={hideBlockquote}
          hideHorizontalRule={hideHorizontalRule}
          hideUndoRedo={hideUndoRedo}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          'flex flex-col [&_.tiptap]:flex-1 text-base prose prose-sm max-w-none p-4 overflow-y-auto focus-within:outline-none [&_.tiptap]:outline-none [&_.tiptap>:first-child]:mt-0',
          {
            'h-32': height === 'sm',
            'h-64': height === 'md',
            'h-96': height === 'lg',
          },
          {
            'min-h-32': height === 'dynamic-sm',
            'min-h-64': height === 'dynamic-md',
            'min-h-96': height === 'dynamic-lg',
          },
          editorClassName,
        )}
      />
    </div>
  );
}
