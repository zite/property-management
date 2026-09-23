import { toast } from 'sonner';

export async function copyText(text: string, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message, { description: text.length > 80 ? `${text.slice(0, 80)}…` : text });
  } catch {
    // Clipboard access can be denied inside an embedded frame; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast.success(message);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access");
    } finally {
      ta.remove();
    }
  }
}
