import { useState } from 'react';

const AGENT_INFO = {
  customs: { label: 'Customs Agent', icon: '📦', color: '#3b82f6', desc: 'Phân loại HS, thuế suất' },
  care: { label: 'Care Agent', icon: '💬', color: '#10b981', desc: 'Chăm sóc khách hàng' },
  pricing: { label: 'Pricing Agent', icon: '💰', color: '#f59e0b', desc: 'Báo giá dịch vụ' },
  regulation: { label: 'Regulation Agent', icon: '⚖️', color: '#8b5cf6', desc: 'Pháp luật hải quan' },
};

function StatusDot({ status }) {
  const colors = { idle: '#64748b', routing: '#f59e0b', processing: '#3b82f6', done: '#10b981', error: '#ef4444' };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || colors.idle,
      boxShadow: status === 'processing' ? `0 0 8px ${colors.processing}` : 'none',
      animation: status === 'processing' ? 'pulse-dot 1.4s infinite' : 'none',
    }} />
  );
}

function PanelCard({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="dash-card">
      <button className="dash-card-header" onClick={() => setOpen(!open)}>
        <span>{icon} {title}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="dash-card-body">{children}</div>}
    </div>
  );
}

function MetricRow({ label, value, color }) {
  return (
    <div className="dash-metric">
      <span className="dash-metric-label">{label}</span>
      <span className="dash-metric-value" style={color ? { color } : {}}>{value}</span>
    </div>
  );
}

function Tag({ children, color = '#60a5fa', bg = 'rgba(59,130,246,0.15)' }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 100,
      fontSize: 11, fontWeight: 600, color, background: bg, marginRight: 4, marginBottom: 3,
    }}>{children}</span>
  );
}

function StepLog({ apiCalls }) {
  if (!apiCalls?.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>No calls</span>;
  return (
    <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 11, lineHeight: 1.8, fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
      {apiCalls.map((call, i) => (
        <div key={i} style={{ color: call.status === 'error' ? '#f87171' : '#94a3b8' }}>
          {call.status === 'done' ? '✅' : call.status === 'error' ? '❌' : '⏳'}
          {' '}<span style={{ color: '#cbd5e1' }}>{call.step}</span>
          {call.keyword && <span style={{ color: '#60a5fa' }}> "{call.keyword}"</span>}
          {call.code && <span style={{ color: '#34d399' }}> [{call.code}]</span>}
          {call.resultCount !== undefined && <span> → {call.resultCount}</span>}
          {call.items !== undefined && <span> → {call.items} items</span>}
          {call.error && <span style={{ color: '#f87171' }}> {call.error}</span>}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ debugData, status, sessionId, messageCount }) {
  const debug = debugData || {};
  const routing = debug.routing || {};
  const agent = AGENT_INFO[routing.effectiveIntent] || AGENT_INFO[debug.agent] || {};
  const timing = debug.timing || {};

  return (
    <div className="dashboard">
      <div className="dash-header">
        <span>📊 Agent Monitor</span>
        <StatusDot status={status} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{status}</span>
      </div>

      <div className="dash-scroll">
        {/* 1. Router Panel */}
        <PanelCard title="Router (Điều phối)" icon="🔀">
          {routing.intent ? (
            <>
              <MetricRow label="Intent detected" value={routing.intent} />
              <MetricRow
                label="Confidence"
                value={`${(routing.confidence * 100).toFixed(0)}%`}
                color={routing.confidence >= 0.8 ? '#34d399' : routing.confidence >= 0.6 ? '#fbbf24' : '#f87171'}
              />
              <MetricRow label="Routing method" value={routing.confidence >= 0.95 ? '⚡ Keyword match' : '🤖 LLM classify'} />
              <MetricRow label="Effective intent" value={
                <Tag color={agent.color || '#60a5fa'}>{routing.effectiveIntent}</Tag>
              } />
              {debug.fallback && (
                <MetricRow label="Fallback" value={
                  <span style={{ color: '#f87171' }}>from {debug.fallback.from}</span>
                } />
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>
              Chờ tin nhắn...
            </div>
          )}
        </PanelCard>

        {/* 2. Active Agent */}
        <PanelCard title="Agent xử lý" icon="🤖">
          {agent.label ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>{agent.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: agent.color }}>{agent.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.desc}</div>
                </div>
              </div>
              <MetricRow label="Status" value={<><StatusDot status={status} /> {status}</>} />
              {timing.totalMs && <MetricRow label="Response time" value={`${timing.totalMs}ms`} color={timing.totalMs < 3000 ? '#34d399' : '#fbbf24'} />}
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Step Log:</div>
                <StepLog apiCalls={debug.apiCalls} />
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>
              Idle — chờ request
            </div>
          )}
        </PanelCard>

        {/* 3. Data Pipeline */}
        <PanelCard title="Data Pipeline" icon="🔍" defaultOpen={!!debug.keywords}>
          {debug.keywords ? (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>Keywords:</div>
                {debug.keywords.primary?.map((k, i) => <Tag key={'p'+i}>{k}</Tag>)}
                {debug.keywords.short?.map((k, i) => <Tag key={'s'+i} color="#fbbf24" bg="rgba(245,158,11,0.15)">{k}</Tag>)}
                {debug.keywords.en?.map((k, i) => <Tag key={'e'+i} color="#a78bfa" bg="rgba(139,92,246,0.15)">{k}</Tag>)}
                {debug.keywords.hs_guess?.map((k, i) => <Tag key={'h'+i} color="#34d399" bg="rgba(16,185,129,0.15)">{k}</Tag>)}
              </div>
              <MetricRow label="Strategy" value={debug.strategy || 'N/A'} />
              <MetricRow label="Data found" value={debug.hasData ? '✅ Yes' : '❌ No'} color={debug.hasData ? '#34d399' : '#f87171'} />
              <MetricRow label="Total results" value={debug.searchResultCount || 0} />
              {debug.searchSources && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>Sources:</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Tag color="#60a5fa">biểu thuế: {debug.searchSources.bieu_thue}</Tag>
                    <Tag color="#f472b6" bg="rgba(244,114,182,0.15)">TB-TCHQ: {debug.searchSources.tb_tchq}</Tag>
                    <Tag color="#34d399" bg="rgba(16,185,129,0.15)">bao_gom: {debug.searchSources.bao_gom}</Tag>
                    <Tag color="#fbbf24" bg="rgba(245,158,11,0.15)">conflict: {debug.searchSources.conflict}</Tag>
                  </div>
                </div>
              )}
              {debug.hsCodesAnalyzed?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>9-Layer Detail:</div>
                  {debug.hsCodesAnalyzed.map((c, i) => <Tag key={i} color="#34d399" bg="rgba(16,185,129,0.15)">{c}</Tag>)}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> ({debug.hsDetailsLoaded} loaded)</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>
              Không có data pipeline (agent không phải customs)
            </div>
          )}
        </PanelCard>

        {/* 4. Knowledge Base */}
        <PanelCard title="Knowledge Base" icon="🧠" defaultOpen={false}>
          <MetricRow label="KB items used" value={debug.knowledgeItemsUsed || 0} color={debug.knowledgeItemsUsed > 0 ? '#34d399' : 'var(--text-muted)'} />
          <MetricRow label="Storage" value={debug.storageBackend || 'N/A'} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            Tri thức được tích lũy tự động từ hội thoại qua Extractor → Librarian pipeline.
          </div>
        </PanelCard>

        {/* 5. Session */}
        <PanelCard title="Session" icon="📋" defaultOpen={false}>
          <MetricRow label="Session ID" value={
            <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{sessionId || 'N/A'}</span>
          } />
          <MetricRow label="Messages" value={messageCount || 0} />
          {timing.totalMs && <MetricRow label="Last response" value={`${timing.totalMs}ms`} />}
          <MetricRow label="Session store" value={debug.sessionBackend || 'N/A'} />
        </PanelCard>
      </div>
    </div>
  );
}
