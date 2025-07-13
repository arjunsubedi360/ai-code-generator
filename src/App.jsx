import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';

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
  const messagesEndRef = useRef(null);

  useEffect(() => {
    Prism.highlightAll();
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
    
    // Add a small delay to show the typing indicator briefly
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [...messages, userMessage],
          stream: true,
          options: { temperature: 0.7, top_p: 0.9, repeat_penalty: 1.1 }
        })
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
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingCode('');
      setStreamingText('');
      setCurrentAssistantMessage('');
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

  return (
    <div className="app">
      <div className="settings-panel">
        <h2>Abindra Coding Agent</h2>
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
                    <div className="message-content">
                      {msg.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                    </div>
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
              <button type="submit" disabled={isLoading || !input.trim()}>
                {isLoading ? '…' : 'Send'}
              </button>
            </form>
          </div>

          <div className="resizer" />

          <div className={`code-panel resizable-panel right-panel ${isStreaming ? 'streaming' : ''}`}>
            <div className="code-toolbar">
              <span>
                Code preview
                {isStreaming && <span style={{ color: '#00ff00', marginLeft: '8px' }}>● Live</span>}
              </span>
              <button onClick={copyCode}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <pre><code className={`language-javascript ${isStreaming ? 'streaming' : ''}`}>{isStreaming ? streamingCode : code}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
