import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/admin';

// ==================== HELPERS ====================
async function apiGet(path) {
  const res = await fetch(`${API_BASE}/${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
async function apiPut(path, data) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function SaveBtn({ onClick, saving }) {
  return (
    <button className="cp-save-btn" onClick={onClick} disabled={saving}>
      {saving ? '...' : '💾 Lưu'}
    </button>
  );
}

function StatusMsg({ msg }) {
  if (!msg) return null;
  const isErr = msg.startsWith('❌');
  return <span style={{ fontSize: 12, color: isErr ? '#f87171' : '#34d399', marginLeft: 8 }}>{msg}</span>;
}

// ==================== TAB 1: DATA EDITOR ====================
function DataTab() {
  const [subTab, setSubTab] = useState('faq');
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setStatus('');
    try {
      const d = await apiGet(`config?file=${subTab === 'scrape' ? 'scrape-sources' : subTab}`);
      setData(d);
    } catch (e) { setStatus('❌ ' + e.message); }
  }, [subTab]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await apiPut(`config?file=${subTab === 'scrape' ? 'scrape-sources' : subTab}`, data);
      setStatus('✅ Đã lưu');
    } catch (e) { setStatus('❌ ' + e.message); }
    setSaving(false);
  }

  const subTabs = [
    { id: 'faq', label: '❓ FAQ' },
    { id: 'pricing', label: '💰 Bảng giá' },
    { id: 'regulations', label: '📜 Văn bản PL' },
    { id: 'scrape', label: '🌐 Scrape' },
  ];

  return (
    <div>
      <div className="cp-subtabs">
        {subTabs.map(t => (
          <button key={t.id} className={`cp-subtab ${subTab === t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {!data ? <div className="cp-loading">Loading...</div> : (
        <>
          {subTab === 'faq' && <FAQEditor data={data} onChange={setData} />}
          {subTab === 'pricing' && <PricingEditor data={data} onChange={setData} />}
          {subTab === 'regulations' && <RegulationsEditor data={data} onChange={setData} />}
          {subTab === 'scrape' && <ScrapeEditor data={data} onChange={setData} />}
          <div className="cp-actions">
            <SaveBtn onClick={save} saving={saving} />
            <StatusMsg msg={status} />
          </div>
        </>
      )}
    </div>
  );
}

function FAQEditor({ data, onChange }) {
  function update(i, field, value) {
    const arr = [...data];
    arr[i] = { ...arr[i], [field]: value };
    onChange(arr);
  }
  function add() { onChange([...data, { question: '', answer: '' }]); }
  function remove(i) { onChange(data.filter((_, j) => j !== i)); }

  return (
    <div>
      {data.map((item, i) => (
        <div key={i} className="cp-card">
          <div className="cp-card-header">
            <span>FAQ #{i + 1}</span>
            <button className="cp-delete-btn" onClick={() => remove(i)}>✕</button>
          </div>
          <input className="cp-input" placeholder="Câu hỏi" value={item.question} onChange={e => update(i, 'question', e.target.value)} />
          <textarea className="cp-textarea" placeholder="Câu trả lời" value={item.answer} onChange={e => update(i, 'answer', e.target.value)} />
        </div>
      ))}
      <button className="cp-add-btn" onClick={add}>+ Thêm FAQ</button>
    </div>
  );
}

function PricingEditor({ data, onChange }) {
  function updateTop(field, value) { onChange({ ...data, [field]: value }); }
  function updateService(si, field, value) {
    const services = [...data.services];
    services[si] = { ...services[si], [field]: value };
    onChange({ ...data, services });
  }
  function updatePrice(si, pi, field, value) {
    const services = [...data.services];
    const pricing = [...services[si].pricing];
    pricing[pi] = { ...pricing[pi], [field]: value };
    services[si] = { ...services[si], pricing };
    onChange({ ...data, services });
  }
  function addPrice(si) {
    const services = [...data.services];
    services[si].pricing = [...services[si].pricing, { type: '', price: 0, unit: '' }];
    onChange({ ...data, services });
  }
  function removePrice(si, pi) {
    const services = [...data.services];
    services[si].pricing = services[si].pricing.filter((_, j) => j !== pi);
    onChange({ ...data, services });
  }

  return (
    <div>
      <div className="cp-card">
        <label className="cp-label">Tên công ty</label>
        <input className="cp-input" value={data.company || ''} onChange={e => updateTop('company', e.target.value)} />
        <label className="cp-label">Ngày cập nhật</label>
        <input className="cp-input" type="date" value={data.updated || ''} onChange={e => updateTop('updated', e.target.value)} />
      </div>
      {data.services?.map((svc, si) => (
        <div key={si} className="cp-card">
          <div className="cp-card-header"><span>{svc.name || `Dịch vụ ${si + 1}`}</span></div>
          <input className="cp-input" placeholder="Tên dịch vụ" value={svc.name} onChange={e => updateService(si, 'name', e.target.value)} />
          <input className="cp-input" placeholder="Mô tả" value={svc.description || ''} onChange={e => updateService(si, 'description', e.target.value)} />
          <table className="cp-table">
            <thead><tr><th>Loại</th><th>Giá</th><th>Đơn vị</th><th></th></tr></thead>
            <tbody>
              {svc.pricing?.map((p, pi) => (
                <tr key={pi}>
                  <td><input className="cp-input-sm" value={p.type} onChange={e => updatePrice(si, pi, 'type', e.target.value)} /></td>
                  <td><input className="cp-input-sm" value={p.price} onChange={e => updatePrice(si, pi, 'price', e.target.value)} /></td>
                  <td><input className="cp-input-sm" value={p.unit} onChange={e => updatePrice(si, pi, 'unit', e.target.value)} /></td>
                  <td><button className="cp-delete-btn" onClick={() => removePrice(si, pi)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="cp-add-btn" onClick={() => addPrice(si)}>+ Thêm giá</button>
        </div>
      ))}
    </div>
  );
}

function RegulationsEditor({ data, onChange }) {
  function update(i, field, value) {
    const arr = [...data];
    arr[i] = { ...arr[i], [field]: value };
    onChange(arr);
  }
  function add() { onChange([...data, { id: '', type: 'Thông tư', number: '', name: '', summary: '', key_topics: [] }]); }
  function remove(i) { onChange(data.filter((_, j) => j !== i)); }

  return (
    <div>
      {data.map((reg, i) => (
        <div key={i} className="cp-card">
          <div className="cp-card-header">
            <span>{reg.number || `Văn bản ${i + 1}`}</span>
            <button className="cp-delete-btn" onClick={() => remove(i)}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div><label className="cp-label">Loại</label>
              <select className="cp-input" value={reg.type} onChange={e => update(i, 'type', e.target.value)}>
                <option>Luật</option><option>Nghị định</option><option>Thông tư</option><option>Công văn</option>
              </select></div>
            <div><label className="cp-label">Số hiệu</label>
              <input className="cp-input" value={reg.number} onChange={e => update(i, 'number', e.target.value)} /></div>
          </div>
          <label className="cp-label">Tên</label>
          <input className="cp-input" value={reg.name} onChange={e => update(i, 'name', e.target.value)} />
          <label className="cp-label">Tóm tắt</label>
          <textarea className="cp-textarea" value={reg.summary} onChange={e => update(i, 'summary', e.target.value)} />
        </div>
      ))}
      <button className="cp-add-btn" onClick={add}>+ Thêm văn bản</button>
    </div>
  );
}

function ScrapeEditor({ data, onChange }) {
  function update(i, field, value) {
    const arr = [...data];
    arr[i] = { ...arr[i], [field]: value };
    onChange(arr);
  }
  function add() { onChange([...data, { id: '', name: '', url: '', type: 'regulation', frequency: 'daily', enabled: false }]); }

  return (
    <div>
      {data.map((src, i) => (
        <div key={i} className="cp-card">
          <div className="cp-card-header">
            <span>{src.name}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={src.enabled} onChange={e => update(i, 'enabled', e.target.checked)} />
              {src.enabled ? '🟢 Active' : '⚪ Off'}
            </label>
          </div>
          <input className="cp-input" placeholder="URL" value={src.url} onChange={e => update(i, 'url', e.target.value)} />
        </div>
      ))}
      <button className="cp-add-btn" onClick={add}>+ Thêm nguồn</button>
    </div>
  );
}

// ==================== TAB 2: AGENT MANAGER ====================
function AgentsTab() {
  const [profiles, setProfiles] = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiGet('config?file=profiles').then(setProfiles).catch(e => setStatus('❌ ' + e.message));
  }, []);

  async function save(name) {
    setSaving(true);
    try {
      await apiPut(`config?file=profile&name=${name}`, profiles[name]);
      setStatus('✅ Đã lưu ' + name);
    } catch (e) { setStatus('❌ ' + e.message); }
    setSaving(false);
  }

  function updateProfile(name, field, value) {
    setProfiles(prev => ({
      ...prev,
      [name]: { ...prev[name], [field]: value },
    }));
  }

  if (!profiles) return <div className="cp-loading">Loading...</div>;

  const agentList = Object.entries(profiles);

  return (
    <div>
      <div className="cp-agent-grid">
        {agentList.map(([name, profile]) => (
          <div key={name} className={`cp-agent-card ${selected === name ? 'active' : ''}`} onClick={() => setSelected(name)}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>
              {name === 'customs' ? '📦' : name === 'care' ? '💬' : name === 'pricing' ? '💰' : '⚖️'}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>temp: {profile.gemini_config?.temperature}</div>
          </div>
        ))}
      </div>

      {selected && profiles[selected] && (
        <div className="cp-card" style={{ marginTop: 12 }}>
          <div className="cp-card-header"><span>🤖 {profiles[selected].name}</span></div>
          <label className="cp-label">Tên agent</label>
          <input className="cp-input" value={profiles[selected].name} onChange={e => updateProfile(selected, 'name', e.target.value)} />
          <label className="cp-label">Vai trò</label>
          <textarea className="cp-textarea" value={profiles[selected].role} onChange={e => updateProfile(selected, 'role', e.target.value)} />
          <label className="cp-label">Mục tiêu (mỗi dòng 1 mục tiêu)</label>
          <textarea className="cp-textarea" value={profiles[selected].goals?.join('\n')} onChange={e => updateProfile(selected, 'goals', e.target.value.split('\n').filter(Boolean))} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <div>
              <label className="cp-label">Temperature: {profiles[selected].gemini_config?.temperature}</label>
              <input type="range" min="0" max="1" step="0.05" className="cp-range"
                value={profiles[selected].gemini_config?.temperature || 0.2}
                onChange={e => updateProfile(selected, 'gemini_config', { ...profiles[selected].gemini_config, temperature: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className="cp-label">Max Tokens</label>
              <input type="number" className="cp-input" value={profiles[selected].gemini_config?.maxTokens || 4096}
                onChange={e => updateProfile(selected, 'gemini_config', { ...profiles[selected].gemini_config, maxTokens: parseInt(e.target.value) })} />
            </div>
          </div>

          <div className="cp-actions">
            <SaveBtn onClick={() => save(selected)} saving={saving} />
            <StatusMsg msg={status} />
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== TAB 3: ROUTER CONFIG ====================
function RouterTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    apiGet('config?file=router-config').then(setConfig).catch(e => setStatus('❌ ' + e.message));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await apiPut('config?file=router-config', config);
      setStatus('✅ Đã lưu');
    } catch (e) { setStatus('❌ ' + e.message); }
    setSaving(false);
  }

  async function testClassify() {
    if (!testMsg.trim()) return;
    setTestResult(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testMsg, history: [], sessionId: 'test_router' }),
      });
      const data = await res.json();
      setTestResult(data.debug?.routing || { error: 'No routing data' });
    } catch (e) { setTestResult({ error: e.message }); }
  }

  function updateKeywords(intent, value) {
    setConfig(prev => ({
      ...prev,
      keywords: { ...prev.keywords, [intent]: value.split(',').map(k => k.trim()).filter(Boolean) },
    }));
  }

  if (!config) return <div className="cp-loading">Loading...</div>;

  return (
    <div>
      <div className="cp-card">
        <div className="cp-card-header"><span>🔤 Keywords (mỗi intent)</span></div>
        {Object.entries(config.keywords || {}).map(([intent, words]) => (
          <div key={intent} style={{ marginBottom: 8 }}>
            <label className="cp-label">{intent}</label>
            <input className="cp-input" value={words.join(', ')} onChange={e => updateKeywords(intent, e.target.value)} />
          </div>
        ))}
      </div>

      <div className="cp-card">
        <div className="cp-card-header"><span>🎚️ Thresholds</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="cp-label">Keyword confidence: {config.thresholds?.keywordMatchConfidence}</label>
            <input type="range" min="0.5" max="1" step="0.05" className="cp-range"
              value={config.thresholds?.keywordMatchConfidence || 0.95}
              onChange={e => setConfig(prev => ({ ...prev, thresholds: { ...prev.thresholds, keywordMatchConfidence: parseFloat(e.target.value) } }))} />
          </div>
          <div>
            <label className="cp-label">Fallback threshold: {config.thresholds?.fallbackConfidence}</label>
            <input type="range" min="0.3" max="0.9" step="0.05" className="cp-range"
              value={config.thresholds?.fallbackConfidence || 0.6}
              onChange={e => setConfig(prev => ({ ...prev, thresholds: { ...prev.thresholds, fallbackConfidence: parseFloat(e.target.value) } }))} />
          </div>
          <div>
            <label className="cp-label">Short message max words</label>
            <input type="number" className="cp-input" value={config.thresholds?.shortMessageMaxWords || 5}
              onChange={e => setConfig(prev => ({ ...prev, thresholds: { ...prev.thresholds, shortMessageMaxWords: parseInt(e.target.value) } }))} />
          </div>
          <div>
            <label className="cp-label">Fallback agent</label>
            <select className="cp-input" value={config.fallbackAgent || 'care'}
              onChange={e => setConfig(prev => ({ ...prev, fallbackAgent: e.target.value }))}>
              <option value="care">care</option><option value="customs">customs</option>
              <option value="pricing">pricing</option><option value="regulation">regulation</option>
            </select>
          </div>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-header"><span>🧪 Test Router</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="cp-input" style={{ flex: 1 }} placeholder="Nhập tin nhắn test..." value={testMsg} onChange={e => setTestMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && testClassify()} />
          <button className="cp-save-btn" onClick={testClassify}>Test</button>
        </div>
        {testResult && (
          <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}>
            <div>Intent: <strong style={{ color: '#60a5fa' }}>{testResult.effectiveIntent || testResult.intent}</strong></div>
            <div>Confidence: <strong style={{ color: testResult.confidence >= 0.8 ? '#34d399' : '#fbbf24' }}>{((testResult.confidence || 0) * 100).toFixed(0)}%</strong></div>
            <div>Method: {testResult.method || 'N/A'}</div>
            {testResult.error && <div style={{ color: '#f87171' }}>Error: {testResult.error}</div>}
          </div>
        )}
      </div>

      <div className="cp-actions">
        <SaveBtn onClick={save} saving={saving} />
        <StatusMsg msg={status} />
      </div>
    </div>
  );
}

// ==================== TAB 4: KNOWLEDGE BASE ====================
function KBTab() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [newItem, setNewItem] = useState({ type: 'hs_insight', content: '', hs_codes: '', confidence: 0.8 });

  useEffect(() => {
    apiGet('knowledge').then(d => setStats(d.stats)).catch(() => {});
  }, []);

  async function loadItems() {
    try {
      let url = 'knowledge';
      if (filter) url += `?type=${filter}`;
      else if (search) url += `?q=${encodeURIComponent(search)}`;
      const d = await apiGet(url);
      setItems(d.items || []);
    } catch (e) { setStatus('❌ ' + e.message); }
  }

  async function addItem() {
    if (!newItem.content.trim()) return;
    try {
      await apiPost('knowledge', {
        ...newItem,
        hs_codes: newItem.hs_codes ? newItem.hs_codes.split(',').map(c => c.trim()) : [],
      });
      setStatus('✅ Đã thêm');
      setNewItem({ type: 'hs_insight', content: '', hs_codes: '', confidence: 0.8 });
      loadItems();
    } catch (e) { setStatus('❌ ' + e.message); }
  }

  const types = ['hs_insight', 'confusion', 'precedent', 'pricing', 'regulation'];

  return (
    <div>
      {/* Stats */}
      <div className="cp-card">
        <div className="cp-card-header"><span>📊 Thống kê</span></div>
        {stats?.length > 0 ? (
          <table className="cp-table">
            <thead><tr><th>Loại</th><th>Số lượng</th><th>Lượt dùng</th></tr></thead>
            <tbody>{stats.map((s, i) => (
              <tr key={i}><td>{s.type}</td><td>{s.count}</td><td>{s.total_uses}</td></tr>
            ))}</tbody>
          </table>
        ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>Chưa có data trong KB</div>}
      </div>

      {/* Browse */}
      <div className="cp-card">
        <div className="cp-card-header"><span>🔍 Duyệt</span></div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <select className="cp-input" value={filter} onChange={e => { setFilter(e.target.value); setSearch(''); }}>
            <option value="">Tất cả</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="cp-input" style={{ flex: 1 }} placeholder="Tìm kiếm..." value={search} onChange={e => { setSearch(e.target.value); setFilter(''); }} />
          <button className="cp-save-btn" onClick={loadItems}>Tìm</button>
        </div>
        {items.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {items.map((item, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
                <span style={{ color: '#60a5fa', fontWeight: 600 }}>[{item.type}]</span>{' '}
                {item.content?.substring(0, 120)}...
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({item.used_count || 0}x)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new */}
      <div className="cp-card">
        <div className="cp-card-header"><span>➕ Thêm Knowledge</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <label className="cp-label">Loại</label>
            <select className="cp-input" value={newItem.type} onChange={e => setNewItem(p => ({ ...p, type: e.target.value }))}>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="cp-label">Mã HS (phân cách bằng dấu phẩy)</label>
            <input className="cp-input" value={newItem.hs_codes} onChange={e => setNewItem(p => ({ ...p, hs_codes: e.target.value }))} />
          </div>
        </div>
        <label className="cp-label">Nội dung</label>
        <textarea className="cp-textarea" rows={3} value={newItem.content} onChange={e => setNewItem(p => ({ ...p, content: e.target.value }))} />
        <label className="cp-label">Confidence: {newItem.confidence}</label>
        <input type="range" min="0.1" max="1" step="0.05" className="cp-range" value={newItem.confidence}
          onChange={e => setNewItem(p => ({ ...p, confidence: parseFloat(e.target.value) }))} />
        <div className="cp-actions">
          <button className="cp-save-btn" onClick={addItem}>➕ Thêm</button>
          <StatusMsg msg={status} />
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN CONTROL PANEL ====================
export default function ControlPanel() {
  const [tab, setTab] = useState('data');

  const tabs = [
    { id: 'data', label: '📦 Data', icon: '📦' },
    { id: 'agents', label: '🤖 Agents', icon: '🤖' },
    { id: 'router', label: '🔀 Router', icon: '🔀' },
    { id: 'kb', label: '🧠 KB', icon: '🧠' },
  ];

  return (
    <div className="control-panel">
      <div className="cp-header">
        <a href="/" className="cp-back">← Chat</a>
        <h1 className="cp-title">⚙️ Control Panel</h1>
      </div>

      <div className="cp-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`cp-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="cp-content">
        {tab === 'data' && <DataTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'router' && <RouterTab />}
        {tab === 'kb' && <KBTab />}
      </div>
    </div>
  );
}
