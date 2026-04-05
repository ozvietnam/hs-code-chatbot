import { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';

// Vietnamese text constants
const TEXT = {
  subtitle: 'Nh\u1EADp m\u00F4 t\u1EA3 h\u00E0ng h\u00F3a \u0111\u1EC3 nh\u1EADn m\u00E3 HS 8 s\u1ED1, thu\u1EBF su\u1EA5t, m\u00F4 t\u1EA3 ECUS v\u00E0 ti\u1EC1n l\u1EC7 ph\u00E2n lo\u1EA1i t\u1EEB TCHQ',
  placeholder: 'M\u00F4 t\u1EA3 h\u00E0ng h\u00F3a c\u1EA7n tra m\u00E3 HS...',
  features: ['Llama 3.3 70B (Groq)', 'HS Knowledge API', '9 t\u1EA7ng d\u1EEF li\u1EC7u', 'TB-TCHQ'],
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const ACCEPTED_TYPES = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'application/pdf': 'pdf',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/aac': 'audio',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
};

const FILE_ICONS = {
  image: '\uD83D\uDDBC\uFE0F',
  pdf: '\uD83D\uDCC4',
  audio: '\uD83C\uDFA4',
  doc: '\uD83D\uDCC3',
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]; // strip data:...;base64,
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// --- Markdown formatter (sanitized) ---
function formatMessage(text) {
  const html = text
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (match, header, body) => {
      const headers = header.split('|').filter(Boolean)
        .map(h => `<th>${h.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const cells = row.split('|').filter(Boolean)
          .map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<div class="table-scroll-wrapper"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'code', 'br', 'div'], ALLOWED_ATTR: ['class'] });
}

// --- Icons ---
function BotIcon() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 10,
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
    </svg>
  );
}

// --- Action Buttons for Bot Messages ---
function MessageActions({ content, onRetry, sessionId, messageIndex }) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);

  function handleFeedback(rating) {
    const newRating = feedback === rating ? null : rating;
    setFeedback(newRating);
    if (newRating && sessionId) {
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messageIndex, rating: newRating }),
      }).catch(() => {});
    }
  }

  function handleCopy() {
    // Strip HTML tags for plain text copy
    const plain = content.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="msg-actions">
      <button className="msg-action-btn" onClick={handleCopy} title="Copy">
        {copied ? <span style={{ fontSize: 12 }}>Copied!</span> : <CopyIcon />}
      </button>
      {onRetry && (
        <button className="msg-action-btn" onClick={onRetry} title="Th\u1EED l\u1EA1i">
          <RetryIcon />
        </button>
      )}
      <button
        className={`msg-action-btn ${feedback === 'up' ? 'active-green' : ''}`}
        onClick={() => handleFeedback('up')}
        title="T\u1ED1t"
      >
        <span style={{ fontSize: 13 }}>{feedback === 'up' ? '\uD83D\uDC4D' : '\uD83D\uDC4D'}</span>
      </button>
      <button
        className={`msg-action-btn ${feedback === 'down' ? 'active-red' : ''}`}
        onClick={() => handleFeedback('down')}
        title="Ch\u01B0a t\u1ED1t"
      >
        <span style={{ fontSize: 13 }}>{feedback === 'down' ? '\uD83D\uDC4E' : '\uD83D\uDC4E'}</span>
      </button>
    </div>
  );
}

// --- File Preview ---
function FilePreview({ file, onRemove, isInMessage }) {
  const type = ACCEPTED_TYPES[file.mimeType] || 'doc';
  const icon = FILE_ICONS[type];
  const isImage = type === 'image';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: isInMessage ? '8px 12px' : '8px 14px',
      background: isInMessage ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)',
      border: `1px solid ${isInMessage ? 'rgba(59,130,246,0.2)' : 'var(--border-color)'}`,
      borderRadius: 10,
      animation: 'fadeIn 0.2s ease',
      maxWidth: isInMessage ? 280 : undefined,
    }}>
      {isImage && file.preview ? (
        <img src={file.preview} alt="" style={{
          width: 36, height: 36, borderRadius: 6, objectFit: 'cover',
        }} />
      ) : (
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {file.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {file.sizeLabel || formatFileSize(file.size)}
        </div>
      </div>
      {onRemove && (
        <button onClick={onRemove} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1,
          borderRadius: 6, transition: 'color 0.15s',
        }}
        onMouseOver={e => e.target.style.color = '#f87171'}
        onMouseOut={e => e.target.style.color = 'var(--text-muted)'}
        >
          {'\u2715'}
        </button>
      )}
    </div>
  );
}

// --- Debug Panel ---
function DebugPanel({ debug }) {
  const [open, setOpen] = useState(false);
  if (!debug) return null;

  return (
    <div style={{ marginLeft: 44 }}>
      <button className="debug-toggle" onClick={() => setOpen(!open)}>
        <span style={{ fontSize: 10 }}>{open ? '\u25BC' : '\u25B6'}</span>
        API Debug
        {debug.routing && <span className="debug-badge" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>{debug.routing.effectiveIntent}</span>}
        <span className="debug-badge">{debug.apiCalls?.length || 0} calls</span>
        {debug.strategy && <span className="debug-badge" style={{ background: debug.hasData ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: debug.hasData ? '#34d399' : '#f87171' }}>{debug.strategy}</span>}
        {debug.file && <span className="debug-badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>{debug.file.mimeType?.split('/')[0]}</span>}
      </button>

      {open && (
        <div className="debug-panel">
          {debug.routing && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Agent: </span>
              <span className="debug-tag debug-tag-blue">{debug.routing.effectiveIntent}</span>
              <span style={{ color: '#94a3b8', marginLeft: 6 }}>
                (intent: {debug.routing.intent}, confidence: {(debug.routing.confidence * 100).toFixed(0)}%)
              </span>
              {debug.fallback && <span style={{ color: '#f87171', marginLeft: 6 }}>fallback from {debug.fallback.from}</span>}
            </div>
          )}

          {debug.timing && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Time: </span>
              <span style={{ color: '#94a3b8' }}>{debug.timing.totalMs}ms</span>
            </div>
          )}

          {debug.file && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>File: </span>
              <span className="debug-tag" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>
                {debug.file.name}
              </span>
              <span style={{ color: '#94a3b8', marginLeft: 4 }}>{debug.file.size}</span>
            </div>
          )}

          {/* 4-tier keywords */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Keywords: </span>
            {debug.keywords?.primary?.map((k, i) => (
              <span key={'p'+i} className="debug-tag debug-tag-blue">{k}</span>
            ))}
            {debug.keywords?.short?.map((k, i) => (
              <span key={'s'+i} className="debug-tag debug-tag-orange">{k}</span>
            ))}
            {debug.keywords?.en?.map((k, i) => (
              <span key={'e'+i} className="debug-tag" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>{k}</span>
            ))}
            {debug.keywords?.hs_guess?.map((k, i) => (
              <span key={'h'+i} className="debug-tag debug-tag-green">{k}</span>
            ))}
          </div>

          {/* Data status */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Data: </span>
            <span style={{ color: debug.hasData ? '#34d399' : '#f87171', fontWeight: 600 }}>
              {debug.hasData ? '\u2705 API data found' : '\u274C No data — asking user'}
            </span>
            {debug.strategy && <span style={{ color: '#94a3b8' }}> (via {debug.strategy})</span>}
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Search: </span>
            <span style={{ color: '#94a3b8' }}>
              {debug.searchResultCount || 0} results
              {debug.searchSources && (
                <> &mdash; bieu_thue: {debug.searchSources.bieu_thue}, tb_tchq: {debug.searchSources.tb_tchq}, bao_gom: {debug.searchSources.bao_gom}, conflict: {debug.searchSources.conflict}</>
              )}
            </span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>9-Layer Detail: </span>
            {debug.hsCodesAnalyzed?.map((c, i) => (
              <span key={i} className="debug-tag debug-tag-green">{c}</span>
            )) || <span style={{ color: '#94a3b8' }}>none</span>}
            <span style={{ color: '#64748b', marginLeft: 6 }}>
              ({debug.hsDetailsLoaded || 0} loaded)
            </span>
          </div>

          <div>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Call Log:</span>
            {debug.apiCalls?.map((call, i) => (
              <div key={i} style={{ padding: '2px 0', color: call.status === 'error' ? '#f87171' : '#94a3b8' }}>
                {call.status === 'done' ? '\u2705' : call.status === 'error' ? '\u274C' : '\u23F3'}{' '}
                <span style={{ color: '#cbd5e1' }}>{call.step}</span>
                {call.keyword && <span style={{ color: '#60a5fa' }}> &quot;{call.keyword}&quot;</span>}
                {call.code && <span style={{ color: '#34d399' }}> [{call.code}]</span>}
                {call.keywords && <span style={{ color: '#60a5fa' }}> {'\u2192'} {call.keywords.join(', ')}</span>}
                {call.resultCount !== undefined && <span> {'\u2192'} {call.resultCount} results</span>}
                {call.error && <span style={{ color: '#f87171' }}> {'\u2192'} {call.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Streaming Text ---
function StreamingText({ content, onComplete, scrollRef }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!content) return;

    // Split into chunks: each section separated by \n\n
    // Tables (lines with |) are kept as whole blocks
    const sections = content.split(/\n\n/);
    const chunks = [];
    let tableBuffer = [];

    for (const section of sections) {
      const lines = section.split('\n');
      let inTable = false;

      for (const line of lines) {
        if (line.trim().startsWith('|')) {
          inTable = true;
          tableBuffer.push(line);
        } else {
          if (tableBuffer.length > 0) {
            chunks.push(tableBuffer.join('\n'));
            tableBuffer = [];
            inTable = false;
          }
          chunks.push(line);
        }
      }

      if (tableBuffer.length > 0) {
        chunks.push(tableBuffer.join('\n'));
        tableBuffer = [];
      }

      // Add section break marker
      chunks.push('\n');
    }

    let idx = 0;
    let built = '';

    const timer = setInterval(() => {
      if (idx >= chunks.length) {
        clearInterval(timer);
        setDone(true);
        if (onComplete) onComplete();
        return;
      }

      const chunk = chunks[idx];
      if (chunk === '\n') {
        built += '\n';
      } else {
        built += (built.length > 0 && !built.endsWith('\n') ? '\n' : '') + chunk;
      }
      idx++;
      setDisplayed(built);

      // Auto scroll during streaming
      if (scrollRef?.current) {
        scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 50); // 50ms per chunk — snappy

    return () => clearInterval(timer);
  }, [content]);

  return (
    <div
      className={`bot-content${!done ? ' streaming' : ''}`}
      dangerouslySetInnerHTML={{ __html: formatMessage(displayed) }}
    />
  );
}

// --- Message Bubble ---
function MessageBubble({ role, content, debug, file, isStreaming, onStreamComplete, scrollRef, onRetry, sessionId, messageIndex }) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="msg-enter" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 16,
      }}>
        {file && (
          <div style={{ marginBottom: 6 }}>
            <FilePreview file={file} isInMessage />
          </div>
        )}
        <div style={{
          background: 'var(--user-bubble)',
          color: '#fff',
          padding: '12px 18px',
          borderRadius: '18px 18px 4px 18px',
          maxWidth: '85%',
          fontSize: 15,
          lineHeight: 1.6,
          wordBreak: 'break-word',
          boxShadow: '0 2px 12px rgba(99,102,241,0.25)',
        }}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-enter" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <BotIcon />
        <div style={{
          background: 'var(--bot-bubble)',
          border: '1px solid var(--border-color)',
          padding: '16px 20px',
          borderRadius: '4px 18px 18px 18px',
          maxWidth: 'calc(100% - 44px)',
          wordBreak: 'break-word',
          overflowX: 'auto',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {isStreaming ? (
            <StreamingText content={content} onComplete={onStreamComplete} scrollRef={scrollRef} />
          ) : (
            <div className="bot-content" dangerouslySetInnerHTML={{ __html: formatMessage(content) }} />
          )}
        </div>
      </div>
      {!isStreaming && <MessageActions content={content} onRetry={onRetry} sessionId={sessionId} messageIndex={messageIndex} />}
      {!isStreaming && debug && <DebugPanel debug={debug} />}
    </div>
  );
}

// --- Typing Indicator ---
function TypingIndicator() {
  return (
    <div className="msg-enter" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
      <BotIcon />
      <div style={{
        background: 'var(--bot-bubble)',
        border: '1px solid var(--border-color)',
        padding: '14px 22px',
        borderRadius: '4px 18px 18px 18px',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

// --- Empty State ---
function EmptyState({ onSampleClick }) {
  const samplesFull = [
    { text: 'C\u1EA3m bi\u1EBFn t\u1EEB d\u00F9ng cho xi lanh kh\u00ED n\u00E9n', type: 'customs' },
    { text: 'V\u1EA3i polyester d\u1EC7t thoi', type: 'customs' },
    { text: 'B\u00E1o gi\u00E1 d\u1ECBch v\u1EE5 khai b\u00E1o h\u1EA3i quan', type: 'pricing' },
    { text: 'Th\u00F4ng t\u01B0 38 quy \u0111\u1ECBnh g\u00EC v\u1EC1 th\u1EE7 t\u1EE5c h\u1EA3i quan?', type: 'regulation' },
    { text: 'M\u00E1y n\u00E9n kh\u00ED piston 3HP', type: 'customs' },
    { text: 'Xin ch\u00E0o, chatbot n\u00E0y h\u1ED7 tr\u1EE3 g\u00EC?', type: 'care' },
  ];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 16px', textAlign: 'center',
      animation: 'fadeIn 0.5s ease',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 18,
        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 24, boxShadow: '0 8px 32px rgba(59,130,246,0.3)',
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      </div>

      <h2 style={{
        fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
        marginBottom: 8, letterSpacing: '-0.3px',
      }}>
        HS Code VN Chatbot
      </h2>
      <p style={{
        fontSize: 14, color: 'var(--text-muted)', maxWidth: 400,
        lineHeight: 1.6, marginBottom: 24, padding: '0 8px',
      }}>
        {TEXT.subtitle}
      </p>

      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 24,
      }}>
        {TEXT.features.map((f, i) => (
          <span key={i} style={{
            padding: '5px 12px', borderRadius: 100,
            background: 'rgba(59,130,246,0.1)', color: '#60a5fa',
            fontSize: 12, fontWeight: 600,
          }}>{f}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, width: '100%', padding: '0 8px' }}>
        {samplesFull.map((q, i) => (
          <button key={i} className="sample-btn" onClick={() => onSampleClick(q.text)}>
            {q.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Main Chat UI ---
// Generate stable session ID per browser tab
function getSessionId() {
  if (typeof window === 'undefined') return null;
  let id = sessionStorage.getItem('chatSessionId');
  if (!id) {
    id = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem('chatSessionId', id);
  }
  return id;
}

export default function ChatUI({ onDebugUpdate, onStatusChange, onNewChat }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [streamingIdx, setStreamingIdx] = useState(-1);
  const [docWarning, setDocWarning] = useState(false);
  const sessionId = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    sessionId.current = getSessionId();
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
    };
  }, [attachedFile]);

  function handleNewChat() {
    setMessages([]);
    setInput('');
    setAttachedFile(null);
    setStreamingIdx(-1);
    setDocWarning(false);
    sessionStorage.removeItem('chatSessionId');
    sessionId.current = getSessionId();
    onStatusChange?.('idle');
    onDebugUpdate?.(null);
    onNewChat?.();
    inputRef.current?.focus();
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamingIdx]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be reselected
    e.target.value = '';

    // Validate type
    if (!ACCEPTED_TYPES[file.type]) {
      alert('File kh\u00F4ng h\u1ED7 tr\u1EE3. Ch\u1EA5p nh\u1EADn: \u1EA2nh (PNG, JPG, WebP), PDF, Audio (MP3, WAV, OGG, M4A), DOC/DOCX');
      return;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      alert('File qu\u00E1 l\u1EDBn. Gi\u1EDBi h\u1EA1n: 15MB');
      return;
    }

    // DOC/DOCX warning — accepted but not analyzed by LLM
    const fileType = ACCEPTED_TYPES[file.type];
    if (fileType === 'doc') {
      setDocWarning(true);
      setTimeout(() => setDocWarning(false), 5000);
    }

    // Convert to base64
    const data = await fileToBase64(file);

    // Create preview for images
    let preview = null;
    if (fileType === 'image') {
      preview = URL.createObjectURL(file);
    }

    setAttachedFile({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      sizeLabel: formatFileSize(file.size),
      data,
      preview,
    });
  }

  function removeFile() {
    if (attachedFile?.preview) URL.revokeObjectURL(attachedFile.preview);
    setAttachedFile(null);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const text = input.trim();
    if ((!text && !attachedFile) || loading) return;

    const userMsg = {
      role: 'user',
      content: text || (attachedFile ? `[\u0110\u00EDnh k\u00E8m: ${attachedFile.name}]` : ''),
      file: attachedFile ? { name: attachedFile.name, mimeType: attachedFile.mimeType, size: attachedFile.size, sizeLabel: attachedFile.sizeLabel, preview: attachedFile.preview } : null,
    };

    // Prepare file for API (DOC/DOCX → not supported by LLM, send as text note)
    let apiFile = null;
    if (attachedFile) {
      const fileType = ACCEPTED_TYPES[attachedFile.mimeType];
      if (fileType === 'doc') {
        // DOC/DOCX not supported — note in message
        apiFile = null; // Will be handled as text note
      } else {
        apiFile = {
          name: attachedFile.name,
          mimeType: attachedFile.mimeType,
          data: attachedFile.data,
        };
      }
    }

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const savedFile = attachedFile;
    removeFile();
    setLoading(true);
    onStatusChange?.('routing');

    try {
      // Strip debug/file data from history to reduce payload
      const cleanHistory = [...messages, userMsg].slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));
      const bodyPayload = {
        message: text || (savedFile ? `Phân tích file đính kèm: ${savedFile.name}` : ''),
        history: cleanHistory,
        sessionId: sessionId.current,
      };
      if (apiFile) {
        bodyPayload.file = apiFile;
      }

      onStatusChange?.('processing');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (res.ok) {
        onDebugUpdate?.(data.debug);
        onStatusChange?.('done');
        setMessages(prev => {
          setStreamingIdx(prev.length);
          return [...prev, { role: 'assistant', content: data.reply, debug: data.debug }];
        });
      } else {
        onDebugUpdate?.(data.debug);
        onStatusChange?.('error');
        setMessages(prev => [...prev, { role: 'assistant', content: `Lỗi: ${data.error}`, debug: data.debug }]);
      }
    } catch (err) {
      onStatusChange?.('error');
      setMessages(prev => [...prev, { role: 'assistant', content: `Lỗi kết nối: ${err.message}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleRetry(msgIndex) {
    if (loading) return;
    // Find the user message that preceded this bot response
    const userMsgIdx = msgIndex - 1;
    if (userMsgIdx < 0 || messages[userMsgIdx]?.role !== 'user') return;
    const userMsg = messages[userMsgIdx];
    // Remove the bot response and re-send
    setMessages(prev => prev.slice(0, msgIndex));
    setInput(userMsg.content);
    setTimeout(() => handleSubmit(), 50);
  }

  function handleSampleClick(query) {
    setInput(query);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const canSubmit = !loading && (input.trim() || attachedFile);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      maxWidth: '100%', margin: '0 auto',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <header style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
            letterSpacing: '-0.2px', lineHeight: 1.2,
          }}>
            HS Code VN
          </h1>
          <p style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            Llama 3.3 70B + HS Knowledge API
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {messages.length > 0 && (
            <button
              onClick={handleNewChat}
              className="new-chat-btn"
              title="Cu\u1ED9c h\u1ED9i tho\u1EA1i m\u1EDBi"
            >
              <NewChatIcon />
              <span className="new-chat-label">M\u1EDBi</span>
            </button>
          )}
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--success)',
            boxShadow: '0 0 8px rgba(16,185,129,0.5)',
          }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Online</span>
        </div>
      </header>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 12px',
        background: 'var(--bg-primary)',
      }}>
        {messages.length === 0 && <EmptyState onSampleClick={handleSampleClick} />}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content}
            debug={msg.debug}
            file={msg.file}
            isStreaming={i === streamingIdx}
            onStreamComplete={() => setStreamingIdx(-1)}
            scrollRef={messagesEndRef}
            onRetry={msg.role === 'assistant' ? () => handleRetry(i) : undefined}
            sessionId={sessionId.current}
            messageIndex={i}
          />
        ))}

        {loading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        {/* DOC warning */}
        {docWarning && (
          <div style={{
            padding: '8px 12px', margin: '8px 12px 0',
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 8, fontSize: 12, color: '#fbbf24',
          }}>
            File DOC/DOCX ch\u01B0a h\u1ED7 tr\u1EE3 ph\u00E2n t\u00EDch tr\u1EF1c ti\u1EBFp. H\u00E3y m\u00F4 t\u1EA3 n\u1ED9i dung h\u00E0ng h\u00F3a b\u1EB1ng text \u0111\u1EC3 \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3 t\u1ED1t h\u01A1n.
          </div>
        )}

        {/* File preview */}
        {attachedFile && (
          <div style={{ padding: '10px 12px 0' }}>
            <FilePreview file={attachedFile} onRemove={removeFile} />
          </div>
        )}

        {/* Input row */}
        <form
          onSubmit={handleSubmit}
          className="chat-input-area"
          style={{
            padding: '10px 12px 14px',
            display: 'flex', gap: 8, alignItems: 'center',
          }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.heic,.pdf,.mp3,.wav,.ogg,.m4a,.aac,.doc,.docx"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title={'\u0110\u00EDnh k\u00E8m file (\u1EA3nh, PDF, audio, DOC)'}
            style={{
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              padding: 10,
              color: attachedFile ? 'var(--accent)' : 'var(--text-muted)',
              cursor: loading ? 'default' : 'pointer',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              opacity: loading ? 0.4 : 1,
            }}
            onMouseOver={e => { if (!loading) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = attachedFile ? 'var(--accent)' : 'var(--text-muted)'; }}
          >
            <AttachIcon />
          </button>

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={TEXT.placeholder}
            disabled={loading}
            className="chat-input chat-textarea"
            rows={1}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="send-btn"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
