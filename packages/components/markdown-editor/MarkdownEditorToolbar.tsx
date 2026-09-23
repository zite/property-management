import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Undo,
  Redo,
  Highlighter,
} from 'lucide-react';
import { Toggle } from '../ui/toggle';
import { Separator } from '../ui/separator';

interface MarkdownEditorToolbarProps {
  editor: Editor;
  hideBold?: boolean;
  hideItalic?: boolean;
  hideStrikethrough?: boolean;
  hideCode?: boolean;
  hideHighlight?: boolean;
  hideHeadings?: boolean;
  hideBulletList?: boolean;
  hideOrderedList?: boolean;
  hideBlockquote?: boolean;
  hideHorizontalRule?: boolean;
  hideUndoRedo?: boolean;
}

function ToolbarToggle({
  pressed,
  onPressedChange,
  disabled,
  children,
  title,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      aria-label={title}
      title={title}
    >
      {children}
    </Toggle>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Toggle
      size="sm"
      pressed={false}
      onPressedChange={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
    >
      {children}
    </Toggle>
  );
}

export function MarkdownEditorToolbar({
  editor,
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
}: MarkdownEditorToolbarProps) {
  const showInlineSection =
    !hideBold ||
    !hideItalic ||
    !hideStrikethrough ||
    !hideCode ||
    !hideHighlight;
  const showHeadingsSection = !hideHeadings;
  const showBlockSection =
    !hideBulletList ||
    !hideOrderedList ||
    !hideBlockquote ||
    !hideHorizontalRule;
  const showUndoRedoSection = !hideUndoRedo;

  const editorState = useEditorState({
    editor,
    selector(ctx) {
      return {
        // Text formatting
        isBold: ctx.editor.isActive('bold') ?? false,
        canBold: ctx.editor.can().chain().toggleBold().run() ?? false,
        isItalic: ctx.editor.isActive('italic') ?? false,
        canItalic: ctx.editor.can().chain().toggleItalic().run() ?? false,
        isStrike: ctx.editor.isActive('strike') ?? false,
        canStrike: ctx.editor.can().chain().toggleStrike().run() ?? false,
        isCode: ctx.editor.isActive('code') ?? false,
        canCode: ctx.editor.can().chain().toggleCode().run() ?? false,
        isHighlight: ctx.editor.isActive('highlight') ?? false,
        canHighlight: ctx.editor.can().chain().toggleHighlight().run() ?? false,

        // Block types
        isParagraph: ctx.editor.isActive('paragraph') ?? false,
        isHeading1: ctx.editor.isActive('heading', { level: 1 }) ?? false,
        canHeading1:
          ctx.editor.can().chain().toggleHeading({ level: 1 }).run() ?? false,
        isHeading2: ctx.editor.isActive('heading', { level: 2 }) ?? false,
        canHeading2:
          ctx.editor.can().chain().toggleHeading({ level: 2 }).run() ?? false,
        isHeading3: ctx.editor.isActive('heading', { level: 3 }) ?? false,
        canHeading3:
          ctx.editor.can().chain().toggleHeading({ level: 3 }).run() ?? false,

        // Lists and blocks
        isBulletList: ctx.editor.isActive('bulletList') ?? false,
        canBulletList:
          ctx.editor.can().chain().toggleBulletList().run() ?? false,
        isOrderedList: ctx.editor.isActive('orderedList') ?? false,
        canOrderedList:
          ctx.editor.can().chain().toggleOrderedList().run() ?? false,
        isCodeBlock: ctx.editor.isActive('codeBlock') ?? false,
        isBlockquote: ctx.editor.isActive('blockquote') ?? false,
        canBlockquote:
          ctx.editor.can().chain().toggleBlockquote().run() ?? false,
        canHorizontalRule:
          ctx.editor.can().chain().setHorizontalRule().run() ?? false,

        // History
        canUndo: ctx.editor.can().chain().undo().run() ?? false,
        canRedo: ctx.editor.can().chain().redo().run() ?? false,
      };
    },
  });

  if (
    !showInlineSection &&
    !showHeadingsSection &&
    !showBlockSection &&
    !showUndoRedoSection
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-input p-1 px-[max(calc(var(--radius)-1.5rem),0.25rem)]">
      {showInlineSection && (
        <>
          {!hideBold && (
            <ToolbarToggle
              pressed={editorState.isBold}
              disabled={!editorState.canBold}
              onPressedChange={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <Bold className="size-4" />
            </ToolbarToggle>
          )}
          {!hideItalic && (
            <ToolbarToggle
              pressed={editorState.isItalic}
              disabled={!editorState.canItalic}
              onPressedChange={() =>
                editor.chain().focus().toggleItalic().run()
              }
              title="Italic"
            >
              <Italic className="size-4" />
            </ToolbarToggle>
          )}
          {!hideStrikethrough && (
            <ToolbarToggle
              pressed={editorState.isStrike}
              disabled={!editorState.canStrike}
              onPressedChange={() =>
                editor.chain().focus().toggleStrike().run()
              }
              title="Strikethrough"
            >
              <Strikethrough className="size-4" />
            </ToolbarToggle>
          )}
          {!hideCode && (
            <ToolbarToggle
              pressed={editorState.isCode}
              disabled={!editorState.canCode}
              onPressedChange={() => editor.chain().focus().toggleCode().run()}
              title="Inline code"
            >
              <Code className="size-4" />
            </ToolbarToggle>
          )}
          {!hideHighlight && (
            <ToolbarToggle
              pressed={editorState.isHighlight}
              disabled={!editorState.canHighlight}
              onPressedChange={() =>
                editor.chain().focus().toggleHighlight().run()
              }
              title="Highlight"
            >
              <Highlighter className="size-4" />
            </ToolbarToggle>
          )}
        </>
      )}

      {showInlineSection && showHeadingsSection && (
        <Separator orientation="vertical" className="mx-1 h-6" />
      )}

      {showHeadingsSection && (
        <>
          <ToolbarToggle
            pressed={editorState.isHeading1}
            disabled={!editorState.canHeading1}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            title="Heading 1"
          >
            <Heading1 className="size-4" />
          </ToolbarToggle>
          <ToolbarToggle
            pressed={editorState.isHeading2}
            disabled={!editorState.canHeading2}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            title="Heading 2"
          >
            <Heading2 className="size-4" />
          </ToolbarToggle>
          <ToolbarToggle
            pressed={editorState.isHeading3}
            disabled={!editorState.canHeading3}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            title="Heading 3"
          >
            <Heading3 className="size-4" />
          </ToolbarToggle>
        </>
      )}

      {(showInlineSection || showHeadingsSection) && showBlockSection && (
        <Separator orientation="vertical" className="mx-1 h-6" />
      )}

      {showBlockSection && (
        <>
          {!hideBulletList && (
            <ToolbarToggle
              pressed={editorState.isBulletList}
              disabled={!editorState.canBulletList}
              onPressedChange={() =>
                editor.chain().focus().toggleBulletList().run()
              }
              title="Bullet list"
            >
              <List className="size-4" />
            </ToolbarToggle>
          )}
          {!hideOrderedList && (
            <ToolbarToggle
              pressed={editorState.isOrderedList}
              disabled={!editorState.canOrderedList}
              onPressedChange={() =>
                editor.chain().focus().toggleOrderedList().run()
              }
              title="Ordered list"
            >
              <ListOrdered className="size-4" />
            </ToolbarToggle>
          )}
          {!hideBlockquote && (
            <ToolbarToggle
              pressed={editorState.isBlockquote}
              disabled={!editorState.canBlockquote}
              onPressedChange={() =>
                editor.chain().focus().toggleBlockquote().run()
              }
              title="Blockquote"
            >
              <Quote className="size-4" />
            </ToolbarToggle>
          )}
          {!hideHorizontalRule && (
            <ToolbarButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              disabled={!editorState.canHorizontalRule}
              title="Horizontal rule"
            >
              <Minus className="size-4" />
            </ToolbarButton>
          )}
        </>
      )}

      {(showInlineSection || showHeadingsSection || showBlockSection) &&
        showUndoRedoSection && (
          <Separator orientation="vertical" className="mx-1 h-6" />
        )}

      {showUndoRedoSection && (
        <>
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editorState.canUndo}
            title="Undo"
          >
            <Undo className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editorState.canRedo}
            title="Redo"
          >
            <Redo className="size-4" />
          </ToolbarButton>
        </>
      )}
    </div>
  );
}
