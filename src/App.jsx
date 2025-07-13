import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';

const SAMPLE_CODE = `// Example snippet shown on the right‑hand side
fetch(\`\${ollamaUrl}/api/chat\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: modelName,
    messages: [...messages, userMessage],
  }),
});`;

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [modelName, setModelName] = useState('');
  const [modelList, setModelList] = useState([]);
  const [code, setCode] = useState(SAMPLE_CODE);
  const [copied, setCopied] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingCode, setStreamingCode] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [abortController, setAbortController] = useState(null);
  const [wasStopped, setWasStopped] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editInput, setEditInput] = useState('');
  const [editedMessages, setEditedMessages] = useState(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewCss, setPreviewCss] = useState('');
  const [activePreviewTab, setActivePreviewTab] = useState('preview');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Only highlight code in the main code panel, not in preview
    const codeElements = document.querySelectorAll('.code-panel pre code:not(.preview-content code)');
    codeElements.forEach(element => {
      Prism.highlightElement(element);
    });
  }, [code, streamingCode]);

  useEffect(() => {
    // Highlight preview content only when preview tabs change
    if (showPreview) {
      const previewCodeElements = document.querySelectorAll('.preview-content pre code');
      previewCodeElements.forEach(element => {
        Prism.highlightElement(element);
      });
    }
  }, [activePreviewTab, showPreview]);

  useEffect(() => {
    updatePreview();
  }, [code, streamingCode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const resizer = document.querySelector('.resizer');
    const left = document.querySelector('.left-panel');
    const right = document.querySelector('.right-panel');

    let isDragging = false;

    const onMouseDown = () => {
      isDragging = true;
      document.body.style.cursor = 'col-resize';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const container = resizer.parentNode;
      const containerRect = container.getBoundingClientRect();
      const pointerX = e.clientX - containerRect.left;
      const containerWidth = container.offsetWidth;

      const leftWidth = (pointerX / containerWidth) * 100;
      const rightWidth = 100 - leftWidth;

      left.style.width = `${leftWidth}%`;
      right.style.width = `${rightWidth}%`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.body.style.cursor = 'default';
    };

    resizer.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      resizer.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);
    
    // Reset streaming states
    setStreamingCode('');
    setStreamingText('');
    setCurrentAssistantMessage('');
    setWasStopped(false);
    
    // Add a small delay to show the typing indicator briefly
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create abort controller for this request
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [...messages, userMessage],
          stream: true,
          options: { temperature: 0.7, top_p: 0.9, repeat_penalty: 1.1 }
        }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inCodeBlock = false;
      let codeBlockContent = '';
      let textContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              const content = data.message.content;
              
              // Check for code block markers
              if (content.includes('```')) {
                const codeBlockStart = content.indexOf('```');
                const codeBlockEnd = content.lastIndexOf('```');
                
                if (!inCodeBlock) {
                  // Starting a code block
                  if (codeBlockStart !== codeBlockEnd) {
                    // Code block starts and ends in same chunk
                    inCodeBlock = false;
                    const codeStart = codeBlockStart + 3;
                    const firstNewline = content.indexOf('\n', codeStart);
                    const codeEnd = codeBlockEnd;
                    if (firstNewline !== -1 && codeEnd > firstNewline) {
                      const extractedCode = content.substring(firstNewline + 1, codeEnd);
                      setStreamingCode(extractedCode);
                      setCode(extractedCode);
                    }
                  } else {
                    // Code block starts
                    inCodeBlock = true;
                    codeBlockContent = '';
                    const codeStart = codeBlockStart + 3;
                    const firstNewline = content.indexOf('\n', codeStart);
                    if (firstNewline !== -1) {
                      codeBlockContent = content.substring(firstNewline + 1);
                    }
                  }
                } else {
                  // Ending a code block
                  inCodeBlock = false;
                  const codeEnd = codeBlockEnd;
                  if (codeEnd !== -1) {
                    codeBlockContent += content.substring(0, codeEnd);
                  }
                  setStreamingCode(codeBlockContent);
                  setCode(codeBlockContent);
                }
              } else if (inCodeBlock) {
                // Inside a code block
                codeBlockContent += content;
                setStreamingCode(codeBlockContent);
              } else {
                // Regular text content
                textContent += content;
                setStreamingText(textContent);
                setCurrentAssistantMessage(textContent);
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }

      // Finalize the response
      if (textContent.trim()) {
        setMessages((prev) => [...prev, { role: 'assistant', content: textContent.trim() }]);
      }
      
      if (codeBlockContent.trim()) {
        setCode(codeBlockContent.trim());
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was aborted by user, don't show error message
        console.log('Request was aborted by user');
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingCode('');
      setStreamingText('');
      setCurrentAssistantMessage('');
      setAbortController(null);
      setWasStopped(false);
    }
  };

  const checkOllamaConnection = async () => {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      const models = data.models?.map((m) => m.name) || [];
      setModelList(models);
      if (models[0]) setModelName(models[0]);
      alert(`Connected! Models: ${models.join(', ')}`);
    } catch (e) {
      alert(`Connection failed: ${e.message}`);
    }
  };

  const copyCode = () => {
    const codeToCopy = isStreaming ? streamingCode : code;
    navigator.clipboard.writeText(codeToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(console.error);
  };

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
    setIsLoading(false);
    setIsStreaming(false);
    
    // Add a "Stopped" message if there was some content
    if (currentAssistantMessage.trim() || streamingCode.trim()) {
      const stoppedMessage = currentAssistantMessage.trim() 
        ? `${currentAssistantMessage.trim()}\n\n[Generation stopped by user]`
        : '[Generation stopped by user]';
      setMessages((prev) => [...prev, { role: 'assistant', content: stoppedMessage }]);
    }
    
    setStreamingCode('');
    setStreamingText('');
    setCurrentAssistantMessage('');
    setAbortController(null);
    setWasStopped(true);
  };

  const startEditing = (messageIndex) => {
    const message = messages[messageIndex];
    if (message.role === 'user') {
      setEditingMessage(messageIndex);
      setEditInput(message.content);
    }
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setEditInput('');
  };

  const extractHtmlAndCss = (code) => {
    if (!code) return { html: '', css: '' };
    
    let htmlParts = [];
    let cssParts = [];
    
    // Common patterns for HTML and CSS extraction
    const patterns = [
      // HTML patterns
      { regex: /```html\s*([\s\S]*?)```/gi, type: 'html' },
      { regex: /```jsx\s*([\s\S]*?)```/gi, type: 'html' },
      { regex: /```xml\s*([\s\S]*?)```/gi, type: 'html' },
      { regex: /```vue\s*([\s\S]*?)```/gi, type: 'html' },
      
      // CSS patterns
      { regex: /```css\s*([\s\S]*?)```/gi, type: 'css' },
      { regex: /```scss\s*([\s\S]*?)```/gi, type: 'css' },
      { regex: /```sass\s*([\s\S]*?)```/gi, type: 'css' },
      { regex: /```less\s*([\s\S]*?)```/gi, type: 'css' },
      
      // JavaScript patterns (might contain HTML in template literals)
      { regex: /```javascript\s*([\s\S]*?)```/gi, type: 'js' },
      { regex: /```js\s*([\s\S]*?)```/gi, type: 'js' }
    ];
    
    // Extract content from code blocks
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(code)) !== null) {
        const content = match[1].trim();
        
        if (pattern.type === 'html') {
          htmlParts.push(content);
        } else if (pattern.type === 'css') {
          cssParts.push(content);
        } else if (pattern.type === 'js') {
          // Look for HTML in template literals or JSX-like content
          const templateRegex = /`([\s\S]*?)`/g;
          const jsxRegex = /<[^>]+>/g;
          
          if (content.includes('`') || content.match(jsxRegex)) {
            // Extract HTML-like content from JavaScript
            let templateMatch;
            while ((templateMatch = templateRegex.exec(content)) !== null) {
              const templateContent = templateMatch[1];
              if (templateContent.includes('<') && templateContent.includes('>')) {
                htmlParts.push(templateContent);
              }
            }
          }
        }
      }
    });
    
    // If no specific code blocks found, try generic extraction
    if (htmlParts.length === 0 && cssParts.length === 0) {
      // Look for complete HTML document structure
      const htmlDocRegex = /<html[^>]*>[\s\S]*?<\/html>/gi;
      const htmlMatch = code.match(htmlDocRegex);
      if (htmlMatch) {
        htmlParts.push(htmlMatch[0]);
      } else {
        // Look for body content
        const bodyRegex = /<body[^>]*>[\s\S]*?<\/body>/gi;
        const bodyMatch = code.match(bodyRegex);
        if (bodyMatch) {
          htmlParts.push(bodyMatch[0]);
        } else {
          // Look for main content sections
          const mainContentRegex = /<(div|section|main|header|footer|article|nav|aside)[^>]*>[\s\S]*?<\/\1>/gi;
          const mainMatches = code.match(mainContentRegex);
          if (mainMatches) {
            htmlParts.push(...mainMatches);
          }
        }
      }
      
      // Extract CSS from style tags
      const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let styleMatch;
      while ((styleMatch = styleTagRegex.exec(code)) !== null) {
        cssParts.push(styleMatch[1]);
      }
    }
    
    // Remove duplicates and clean up
    const uniqueHtml = [...new Set(htmlParts)].join('\n\n');
    const uniqueCss = [...new Set(cssParts)].join('\n\n');
    
    // If we have HTML but no CSS, try to extract CSS from the HTML
    let finalCss = uniqueCss;
    if (uniqueHtml && !uniqueCss) {
      const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let styleMatch;
      const extractedStyles = [];
      while ((styleMatch = styleRegex.exec(uniqueHtml)) !== null) {
        extractedStyles.push(styleMatch[1]);
      }
      if (extractedStyles.length > 0) {
        finalCss = extractedStyles.join('\n\n');
      }
    }
    
    return { 
      html: uniqueHtml.trim(), 
      css: finalCss.trim() 
    };
  };

  const updatePreview = () => {
    const currentCode = isStreaming ? streamingCode : code;
    if (currentCode) {
      const { html, css } = extractHtmlAndCss(currentCode);
      console.log('=== Preview Extraction Debug ===');
      console.log('Original code length:', currentCode.length);
      console.log('Extracted HTML length:', html.length);
      console.log('Extracted CSS length:', css.length);
      console.log('HTML preview:', html.substring(0, 200) + (html.length > 200 ? '...' : ''));
      console.log('CSS preview:', css.substring(0, 200) + (css.length > 200 ? '...' : ''));
      console.log('================================');
      setPreviewHtml(html);
      setPreviewCss(css);
    }
  };

  const handlePreviewTabChange = (tab) => {
    setActivePreviewTab(tab);
  };

  const saveEdit = async () => {
    if (!editInput.trim()) return;

    // Update the message content
    const updatedMessages = [...messages];
    updatedMessages[editingMessage] = { ...updatedMessages[editingMessage], content: editInput };
    setMessages(updatedMessages);
    
    // Mark this message as edited
    setEditedMessages(prev => new Set([...prev, editingMessage]));

    // Remove the assistant response that followed this message
    const messagesToKeep = updatedMessages.slice(0, editingMessage + 1);
    setMessages(messagesToKeep);

    // Cancel editing mode
    setEditingMessage(null);
    setEditInput('');

    // Resend the edited message
    const userMessage = { role: 'user', content: editInput };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setIsStreaming(true);
    
    // Reset streaming states
    setStreamingCode('');
    setStreamingText('');
    setCurrentAssistantMessage('');
    setWasStopped(false);
    
    // Add a small delay to show the typing indicator briefly
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create abort controller for this request
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: messagesToKeep,
          stream: true,
          options: { temperature: 0.7, top_p: 0.9, repeat_penalty: 1.1 }
        }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inCodeBlock = false;
      let codeBlockContent = '';
      let textContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              const content = data.message.content;
              
              // Check for code block markers
              if (content.includes('```')) {
                const codeBlockStart = content.indexOf('```');
                const codeBlockEnd = content.lastIndexOf('```');
                
                if (!inCodeBlock) {
                  // Starting a code block
                  if (codeBlockStart !== codeBlockEnd) {
                    // Code block starts and ends in same chunk
                    inCodeBlock = false;
                    const codeStart = codeBlockStart + 3;
                    const firstNewline = content.indexOf('\n', codeStart);
                    const codeEnd = codeBlockEnd;
                    if (firstNewline !== -1 && codeEnd > firstNewline) {
                      const extractedCode = content.substring(firstNewline + 1, codeEnd);
                      setStreamingCode(extractedCode);
                      setCode(extractedCode);
                    }
                  } else {
                    // Code block starts
                    inCodeBlock = true;
                    codeBlockContent = '';
                    const codeStart = codeBlockStart + 3;
                    const firstNewline = content.indexOf('\n', codeStart);
                    if (firstNewline !== -1) {
                      codeBlockContent = content.substring(firstNewline + 1);
                    }
                  }
                } else {
                  // Ending a code block
                  inCodeBlock = false;
                  const codeEnd = codeBlockEnd;
                  if (codeEnd !== -1) {
                    codeBlockContent += content.substring(0, codeEnd);
                  }
                  setStreamingCode(codeBlockContent);
                  setCode(codeBlockContent);
                }
              } else if (inCodeBlock) {
                // Inside a code block
                codeBlockContent += content;
                setStreamingCode(codeBlockContent);
              } else {
                // Regular text content
                textContent += content;
                setStreamingText(textContent);
                setCurrentAssistantMessage(textContent);
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }

      // Finalize the response
      if (textContent.trim()) {
        setMessages((prev) => [...prev, { role: 'assistant', content: textContent.trim() }]);
      }
      
      if (codeBlockContent.trim()) {
        setCode(codeBlockContent.trim());
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was aborted by user, don't show error message
        console.log('Request was aborted by user');
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingCode('');
      setStreamingText('');
      setCurrentAssistantMessage('');
      setAbortController(null);
      setWasStopped(false);
    }
  };

  return (
    <div className="app">
      <div className="settings-panel">
        <h2>Arjun Coding Agent</h2>
        <div className="settings-row">
          <label>
            Ollama URL:
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
            />
          </label>
          <button onClick={checkOllamaConnection}>Test Connection</button>
        </div>

        <div className="settings-row">
          <label>
            Model Name:
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              disabled={modelList.length === 0}
            >
              {modelList.length === 0
                ? <option value="">No models found</option>
                : modelList.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="main-content">
        <div className="resizable-container">
          <div className="chat-container resizable-panel left-panel">
            <div className="messages">
              {messages.length === 0 ? (
                <div className="welcome-message">
                  <p>Welcome! Click <strong>Test Connection</strong> and start chatting.</p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.role}`}>
                    {editingMessage === idx ? (
                      <div className="edit-mode">
                        <textarea
                          value={editInput}
                          onChange={(e) => setEditInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.ctrlKey && e.key === 'Enter') {
                              e.preventDefault();
                              saveEdit();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditing();
                            }
                          }}
                          placeholder="Edit your message... (Ctrl+Enter to save, Esc to cancel)"
                          rows={Math.max(3, editInput.split('\n').length)}
                        />
                        <div className="edit-actions">
                          <button onClick={saveEdit} disabled={!editInput.trim() || isLoading}>
                            Save & Resend
                          </button>
                          <button onClick={cancelEditing} disabled={isLoading}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="message-content">
                        {msg.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                        {editedMessages.has(idx) && (
                          <span className="edited-indicator">(edited)</span>
                        )}
                        {msg.role === 'user' && !isLoading && !isStreaming && (
                          <button 
                            className="edit-button"
                            onClick={() => startEditing(idx)}
                            title="Edit this message"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              {isLoading && (
                <div className="message assistant">
                  {currentAssistantMessage ? (
                    <div className="message-content streaming">
                      {currentAssistantMessage.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                    </div>
                  ) : (
                    <div className="typing-indicator"><span>●</span><span>●</span><span>●</span></div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSubmit} className="input-area">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your message…"
                disabled={isLoading}
              />
              {isStreaming ? (
                <button type="button" onClick={stopGeneration} className="stop-button">
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={isLoading || !input.trim()}>
                  Send
                </button>
              )}
            </form>
          </div>

          <div className="resizer" />

          <div className={`code-panel resizable-panel right-panel ${isStreaming ? 'streaming' : ''}`}>
            <div className="code-toolbar">
              <span>
                Code preview
                {isStreaming && <span style={{ color: '#00ff00', marginLeft: '8px' }}>● Live</span>}
                {wasStopped && <span style={{ color: '#ffc107', marginLeft: '8px' }}>● Stopped</span>}
              </span>
              <div className="code-toolbar-actions">
                <button 
                  onClick={() => {
                    setShowPreview(!showPreview);
                    // Re-highlight main code when preview is toggled off
                    if (showPreview) {
                      setTimeout(() => {
                        const codeElements = document.querySelectorAll('.code-panel pre code:not(.preview-content code)');
                        codeElements.forEach(element => {
                          Prism.highlightElement(element);
                        });
                      }, 100);
                    }
                  }}
                  className={`preview-toggle ${showPreview ? 'active' : ''}`}
                  title={showPreview ? 'Hide Preview' : 'Show Preview'}
                >
                  👁️ {showPreview ? 'Hide' : 'Preview'}
                </button>
                <button onClick={copyCode}>{copied ? 'Copied!' : 'Copy'}</button>
              </div>
            </div>
            {showPreview ? (
              <div className="preview-container">
                <div className="preview-frame">
                  <iframe
                    srcDoc={`
                      <!DOCTYPE html>
                      <html>
                        <head>
                          <meta charset="utf-8">
                          <meta name="viewport" content="width=device-width, initial-scale=1">
                          <style>
                            body { 
                              margin: 0; 
                              padding: 20px; 
                              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                              line-height: 1.6;
                              background: white;
                            }
                            ${previewCss}
                          </style>
                        </head>
                        <body>
                          ${previewHtml ? 
                            (previewHtml.includes('<html') ? 
                              previewHtml.replace(/<html[^>]*>[\s\S]*?<body[^>]*>|<\/body>[\s\S]*?<\/html>/gi, '') : 
                              previewHtml
                            ) : 
                            '<p>No HTML content found. Check the HTML tab to see extracted content.</p>'
                          }
                        </body>
                      </html>
                    `}
                    title="Code Preview"
                    sandbox="allow-scripts"
                    className="preview-iframe"
                  />
                </div>
                <div className="preview-info">
                  <div className="preview-tabs">
                    <button 
                      className={`preview-tab ${activePreviewTab === 'preview' ? 'active' : ''}`}
                      onClick={() => handlePreviewTabChange('preview')}
                    >
                      Preview
                    </button>
                    <button 
                      className={`preview-tab ${activePreviewTab === 'html' ? 'active' : ''}`}
                      onClick={() => handlePreviewTabChange('html')}
                    >
                      HTML {previewHtml && <span className="content-indicator">●</span>}
                    </button>
                    <button 
                      className={`preview-tab ${activePreviewTab === 'css' ? 'active' : ''}`}
                      onClick={() => handlePreviewTabChange('css')}
                    >
                      CSS {previewCss && <span className="content-indicator">●</span>}
                    </button>
                  </div>
                  <div className="preview-content">
                    {activePreviewTab === 'preview' && (
                      <div className="preview-placeholder">
                        <p>Live preview is shown above</p>
                      </div>
                    )}
                    {activePreviewTab === 'html' && (
                      <pre><code className="language-markup">{previewHtml || 'No HTML found'}</code></pre>
                    )}
                    {activePreviewTab === 'css' && (
                      <pre><code className="language-css">{previewCss || 'No CSS found'}</code></pre>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <pre><code className={`language-javascript ${isStreaming ? 'streaming' : ''}`}>{isStreaming ? streamingCode : code}</code></pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
