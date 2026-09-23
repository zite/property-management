import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { cn } from '../lib/utils';

import './markdown.css';

// Runs before rehype-raw: remove any raw HTML nodes that aren't <mark> tags.
function rehypeAllowOnlyMark() {
  return (tree: any) => {
    const filter = (node: any) => {
      if (!node.children) return;
      node.children = node.children.filter((child: any) => {
        if (child.type === 'raw') {
          return /^<\/?mark(\s[^>]*)?>$/i.test(child.value.trim());
        }
        filter(child);
        return true;
      });
    };
    filter(tree);
  };
}

interface MarkdownProps {
  /** The markdown string to render. */
  children: string;
  /** Additional class names merged onto the prose wrapper. */
  className?: string;
}

/**
 * Renders a markdown string as styled HTML. Use this for read-only rendering
 * of formatted/markdown content (descriptions, AI-generated text, stored
 * rich text from the database, etc.).
 *
 * Supports GitHub Flavored Markdown (tables, strikethrough, task lists) and
 * allows raw `<mark>` tags for highlighted text. All other raw HTML is
 * stripped for safety.
 *
 * For an editable rich text input, import `MarkdownEditor` from
 * `@/components/markdown-editor` instead.
 *
 * DO NOT render markdown manually (regex, `dangerouslySetInnerHTML`,
 * marked.js, etc.) and DO NOT swap in a different library — use this
 * component.
 *
 * @example
 * ```tsx
 * import { Markdown } from './'
 *
 * <Markdown>{post.body}</Markdown>
 * ```
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('prose max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeAllowOnlyMark, rehypeRaw]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
