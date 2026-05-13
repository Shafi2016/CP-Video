// Implementation for code execution endpoint
import OpenAI from 'openai';

interface CodeExecutionResult {
  outputs: Array<{
    type: 'text' | 'image' | 'error';
    content: string;
  }>;
}

/**
 * Class handling direct code execution for the ML Tutor interface
 */
export class CodeExecutionService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Execute code directly using OpenAI's code interpreter
   * @param code The code to execute
   * @param language The programming language (only Python fully supported)
   * @returns Code execution results
   */
  async executeCode(code: string, language: string = 'python'): Promise<CodeExecutionResult> {
    try {
      console.log(`📝 Executing ${language} code...`);
      
      // Add language-specific handling if needed
      const executableCode = language === 'python' ? code : code;

      // Use OpenAI's API to execute code
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a ${language} code executor. Execute the provided code and return the results exactly as produced.
            Only report the OUTPUT of running the code. DO NOT include any explanatory text around the output.
            If there are errors, return them exactly as they would appear in the console.
            For plots, return appropriate image data.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Execute this ${language} code and return ONLY the output:\n\n${executableCode}`
              }
            ]
          }
        ],
        // Use the correct format for the code_interpreter tool
        tool_choice: { type: 'function', function: { name: 'code_interpreter' } },
        tools: [{ type: 'function', function: { name: 'code_interpreter', description: 'Execute code', parameters: {} } }]
      });
      
      // Extract execution results from the response
      const outputs = this.extractExecutionResults(response);
      
      return {
        outputs
      };
    } catch (error: unknown) {
      console.error('❌ Code execution error:', error);
      return {
        outputs: [
          {
            type: 'error',
            content: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ]
      };
    }
  }

  /**
   * Extract execution results from OpenAI response
   * @param response OpenAI API response
   * @returns Formatted execution results
   */
  private extractExecutionResults(response: any): Array<{type: 'text' | 'image' | 'error', content: string}> {
    const results: Array<{type: 'text' | 'image' | 'error', content: string}> = [];

    try {
      // Get the assistant's response message
      const message = response.choices?.[0]?.message;
      if (!message) return results;

      // Check for tool calls (function calls with code_interpreter)
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function && toolCall.function.name === 'code_interpreter') {
            try {
              // Try to parse function arguments if available
              const args = JSON.parse(toolCall.function.arguments || '{}');
              if (args.output) {
                results.push({
                  type: 'text',
                  content: args.output
                });
              }
            } catch (e) {
              // If parsing fails, just use the raw arguments
              if (toolCall.function.arguments) {
                results.push({
                  type: 'text',
                  content: toolCall.function.arguments
                });
              }
            }
          }
        }
      }

      // Handle standard message content (might be a string or array)
      if (message.content) {
        // For newer API versions, content might be an array of content blocks
        if (Array.isArray(message.content)) {
          for (const content of message.content) {
            if (content.type === 'text') {
              results.push({
                type: 'text',
                content: content.text
              });
            } else if (content.type === 'image_url') {
              // Handle base64 images
              const imageData = content.image_url?.url;
              if (imageData && imageData.startsWith('data:image/')) {
                results.push({
                  type: 'image',
                  content: imageData
                });
              }
            }
          }
        } else if (typeof message.content === 'string') {
          // For older API versions, content might be a simple string
          results.push({
            type: 'text',
            content: message.content
          });
        }
      }

      // Handle empty results
      if (results.length === 0) {
        results.push({
          type: 'text',
          content: 'No output generated from code execution.'
        });
      }

      return results;
    } catch (err: unknown) {
      console.error('Error extracting execution results:', err);
      results.push({
        type: 'error',
        content: 'Error processing execution results: ' + (err instanceof Error ? err.message : String(err))
      });
      return results;
    }
  }
}
