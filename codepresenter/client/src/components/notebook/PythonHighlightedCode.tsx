import React from 'react';

interface HighlightedCodeProps {
  code: string;
}

// Lightweight Python syntax highlighter used for published/static views
export const PythonHighlightedCode: React.FC<HighlightedCodeProps> = ({ code }) => {
  const codeLines = code.split('\n');
  const keywords = [
    'import','from','as','def','class','for','while','if','else','elif',
    'try','except','finally','with','return','and','or','not','in','is',
    'None','True','False'
  ];

  const processCodePart = (text: string): React.ReactNode => {
    for (const keyword of keywords) {
      const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = Array.from(text.matchAll(keywordRegex));
      if (matches.length > 0) {
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        matches.forEach((match, i) => {
          const start = match.index!;
          if (start > lastIndex) parts.push(text.substring(lastIndex, start));
          parts.push(
            <span key={`kw-${i}`} className="text-blue-600 dark:text-blue-400 font-semibold">{match[0]}</span>
          );
          lastIndex = start + match[0].length;
        });
        if (lastIndex < text.length) parts.push(text.substring(lastIndex));
        return <>{parts}</>;
      }
    }
    return text;
  };

  const processLine = (line: string) => {
    const parts: React.ReactNode[] = [];

    // Comments
    const commentMatch = line.match(/(#.*)$/);
    if (commentMatch) {
      const commentStart = line.indexOf(commentMatch[0]);
      if (commentStart > 0) parts.push(processCodePart(line.substring(0, commentStart)));
      parts.push(<span key={`c-${commentStart}`} className="text-green-600 dark:text-green-400">{commentMatch[0]}</span>);
      return parts;
    }

    // Strings
    const stringMatches = Array.from(line.matchAll(/(['"])(?:(?!\1).|\\.)*?\1/g));
    if (stringMatches.length > 0) {
      let lastIndex = 0;
      stringMatches.forEach((m, i) => {
        const start = m.index!;
        if (start > lastIndex) parts.push(processCodePart(line.substring(lastIndex, start)));
        parts.push(<span key={`s-${i}`} className="text-red-600 dark:text-red-400">{m[0]}</span>);
        lastIndex = start + m[0].length;
      });
      if (lastIndex < line.length) parts.push(processCodePart(line.substring(lastIndex)));
      return parts;
    }

    return processCodePart(line);
  };

  return (
    <pre className="font-mono whitespace-pre-wrap mb-2">
      {codeLines.map((line, i) => (
        <div key={i}>{processLine(line)}</div>
      ))}
    </pre>
  );
};
