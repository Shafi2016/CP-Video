import { useState, useEffect, useRef } from "react";
import { Textarea } from "../ui/textarea";
import { Bold, Italic, Heading1, Heading2, Heading3, Link, ListOrdered, List, Image, Code } from "lucide-react";
import { Button } from "../ui/button";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Simple undo stack for this editor instance
  const historyRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize history with the first value once
  useEffect(() => {
    if (historyRef.current.length === 0 && value !== undefined) {
      historyRef.current.push(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Function to insert markdown at cursor position
  const insertMarkdown = (markdownBefore: string, markdownAfter: string = '') => {
    if (!textareaRef.current) return;
    
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selectedText = value.substring(start, end);
    const newText = value.substring(0, start) + 
                    markdownBefore + 
                    selectedText + 
                    markdownAfter + 
                    value.substring(end);
    
    // Push current state to history then apply change
    historyRef.current.push(value);
    onChange(newText);
    
    // Set cursor position after formatting is applied
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          start + markdownBefore.length,
          start + markdownBefore.length + selectedText.length
        );
      }
    }, 0);
  };

  // Handle typing changes: push previous value then update
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    historyRef.current.push(value);
    onChange(e.target.value);
  };

  // Handle keyboard shortcuts (Ctrl/Cmd + Z) for undo
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isUndo = (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z');
    if (isUndo) {
      e.preventDefault();
      // Pop previous state if available (avoid popping the only item)
      if (historyRef.current.length > 0) {
        const prev = historyRef.current.pop();
        if (prev !== undefined) {
          onChange(prev);
          // Restore cursor to end for simplicity
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = prev.length;
              textareaRef.current.setSelectionRange(pos, pos);
            }
          });
        }
      }
    }
  };

  // Markdown formatting handlers
  const handleBold = () => insertMarkdown('**', '**');
  const handleItalic = () => insertMarkdown('*', '*');
  const handleHeading1 = () => insertMarkdown('# ');
  const handleHeading2 = () => insertMarkdown('## ');
  const handleHeading3 = () => insertMarkdown('### ');
  const handleLink = () => {
    const url = prompt('Enter URL:', 'https://');
    if (url) {
      insertMarkdown('[', '](' + url + ')');
    }
  };
  const handleOrderedList = () => insertMarkdown('1. ');
  const handleUnorderedList = () => insertMarkdown('- ');
  const handleImage = () => {
    // Trigger hidden file input for local image selection
    fileInputRef.current?.click();
  };

  const handleImageFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so selecting the same file again still triggers change
    e.currentTarget.value = '';
    if (!file) return;

    try {
      const form = new FormData();
      form.append('file', file);
      const resp = await fetch('/api/files/upload', { method: 'POST', body: form });
      if (!resp.ok) {
        const err = await resp.text();
        alert(`Image upload failed: ${err}`);
        return;
      }
      const data = await resp.json();
      const fileUrl: string = data?.path || '';
      if (!fileUrl) {
        alert('Image upload failed: No URL returned');
        return;
      }

      // Insert markdown image at current cursor position
      if (!textareaRef.current) return;
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const selectedText = value.substring(start, end);
      const altText = selectedText || 'Image';
      const md = `![${altText}](${fileUrl})`;
      const newText = value.substring(0, start) + md + value.substring(end);

      historyRef.current.push(value);
      onChange(newText);

      // Place cursor right after the inserted markdown
      const pos = start + md.length;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(pos, pos);
        }
      }, 0);
    } catch (error: any) {
      console.error('Image upload error', error);
      alert('Image upload error. Please try again.');
    }
  };
  const handleCode = () => {
    if (!textareaRef.current) {
      // Fallback to inline if ref missing
      return insertMarkdown('```\n', '\n```');
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selectedText = value.substring(start, end);
    const before = '```\n';
    const after = '\n```';

    let newText: string;
    let cursorStart: number;
    let cursorEnd: number;

    if (!selectedText) {
      const placeholder = '# This is formatted as code';
      newText = value.substring(0, start) + before + placeholder + after + value.substring(end);
      cursorStart = start + before.length;
      cursorEnd = cursorStart + placeholder.length;
    } else {
      newText = value.substring(0, start) + before + selectedText + after + value.substring(end);
      cursorStart = start + before.length;
      cursorEnd = cursorStart + selectedText.length;
    }

    historyRef.current.push(value);
    onChange(newText);

    // Place cursor inside the code block or reselect the wrapped text
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorStart, cursorEnd);
      }
    }, 0);
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <div className="border rounded-md overflow-hidden bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700">
      {/* Formatting Toolbar */}
      <div className="flex items-center flex-wrap p-1 gap-1 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleBold} 
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleItalic}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1"></div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleHeading1}
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleHeading2}
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleHeading3}
          title="Heading 3"
        >
          <Heading3 className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1"></div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleOrderedList}
          title="Ordered List"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleUnorderedList}
          title="Unordered List"
        >
          <List className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1"></div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleLink}
          title="Link"
        >
          <Link className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleImage}
          title="Image"
        >
          <Image className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7" 
          onClick={handleCode}
          title="Code Block"
        >
          <Code className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="font-mono min-h-[40px] py-1 border-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none"
        placeholder="Enter markdown text here..."
      />
      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelected}
      />
    </div>
  );
}