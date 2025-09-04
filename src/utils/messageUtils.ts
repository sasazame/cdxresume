import type { ContentPart } from '../types.js';

export function extractMessageText(content: string | ContentPart[] | undefined | null): string {
  if (!content) {
    return '';
  }
  
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    const parts: string[] = [];
    
    for (const item of content) {
      if (!item) continue;
      
      // Claude-style text
      if (item.type === 'text' && item.text) {
        parts.push(item.text);
      // Codex input/output text
      } else if (item.type === 'input_text' && item.text) {
        parts.push(item.text);
      } else if (item.type === 'output_text' && item.text) {
        parts.push(item.text);
      } else if (item.type === 'tool_use' && 'name' in item) {
        // Format tool use messages
        const toolName = item.name;
        let description = '';
        
        if ('input' in item && item.input && typeof item.input === 'object') {
          const input = item.input as Record<string, unknown>;
          const cmd = input?.command as unknown;
          if (typeof cmd === 'string') {
            description = cmd;
          } else if (Array.isArray(cmd)) {
            try {
              // Special handling: apply_patch
              if ((cmd as unknown[])[0] === 'apply_patch' && typeof (cmd as unknown[])[1] === 'string') {
                const patch = (cmd as unknown[])[1] as string;
                const adds = (patch.match(/\*\*\* Add File: /g) || []).length;
                const updates = (patch.match(/\*\*\* Update File: /g) || []).length;
                const deletes = (patch.match(/\*\*\* Delete File: /g) || []).length;
                // Extract up to 3 file paths
                const files: string[] = [];
                const re = /\*\*\* (Add|Update|Delete) File: ([^\n]+)/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(patch)) && files.length < 3) {
                  files.push(m[2]);
                }
                const more = Math.max(0, (patch.match(/\*\*\* (Add|Update|Delete) File:/g) || []).length - files.length);
                const fileSummary = files.length ? ` [${files.join(', ')}${more ? `, +${more} more` : ''}]` : '';
                description = `apply_patch:${fileSummary} +${adds} ~${updates} -${deletes}`;
              } else if (cmd.every((c: unknown) => typeof c === 'string')) {
                description = (cmd as string[]).join(' ');
              }
            } catch {
              description = '';
            }
          } else if (typeof input.description === 'string') {
            description = input.description;
          } else if (typeof input.prompt === 'string') {
            description = input.prompt.substring(0, 100) + '...';
          }
        }
        
        parts.push(`[Tool: ${toolName}] ${description}`);
      } else if (item.type === 'tool_result') {
        // Handle tool results
        parts.push('[Tool Result]');
      } else if (item.type === 'thinking') {
        // Handle thinking messages
        parts.push('[Thinking...]');
      }
    }
    
    return parts.join('\n');
  }
  
  return '';
}
