'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

const STATUS_STEPS = ['draft', 'idea_ready', 'script_ready', 'visual_uploaded', 'caption_ready', 'scheduled'];

export default function SlotPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [slot, setSlot] = useState(null);
  const [loading, setLoading] = useState({});
  const [editScript, setEditScript] = useState(null);
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [copiedField, setCopiedField] = useState(null);

  useEffect(() => {
    checkAuth();
    loadSlot();
  }, [id]);

  const checkAuth = async () => {
    const res = await fetch('/api/auth/check');
    if (!res.ok) router.push('/login');
  };

  const loadSlot = async () => {
    const res = await fetch(`/api/slots/${id}`);
    if (res.ok) {
      const data = await res.json();
      setSlot(data.slot);
      if (data.slot.script_content) setEditScript(data.slot.script_content);
      if (data.slot.caption_content) setEditCaption(data.slot.caption_content);
      if (data.slot.hashtags) setEditHashtags(data.slot.hashtags.join(', '));
    }
  };

  const apiCall = async (url, method = 'POST', body = null) => {
    setLoading(l => ({ ...l, [url]: true }));
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } finally {
      setLoading(l => ({ ...l, [url]: false }));
    }
  };

  const generateIdeas = async () => {
    await apiCall(`/api/slots/${id}/idea`);
    loadSlot();
  };

  const selectIdea = async (idx) => {
    await apiCall(`/api/slots/${id}/idea`, 'PUT', { selectedIndex: idx });
    loadSlot();
  };

  const generateScript = async () => {
    const data = await apiCall(`/api/slots/${id}/script`);
    setEditScript(data.scriptContent);
    loadSlot();
  };

  const saveScript = async () => {
    await apiCall(`/api/slots/${id}/script`, 'PUT', { script: editScript });
    loadSlot();
  };

  const generateVisualBrief = async () => {
    await apiCall(`/api/slots/${id}/visual-brief`);
    loadSlot();
  };

  const uploadVisual = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(l => ({ ...l, visual: true }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/slots/${id}/visual`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      loadSlot();
    } finally {
      setLoading(l => ({ ...l, visual: false }));
    }
  };

  const generateCaption = async () => {
    const data = await apiCall(`/api/slots/${id}/caption`);
    setEditCaption(data.caption || '');
    setEditHashtags((data.hashtags || []).join(', '));
    loadSlot();
  };

  const saveCaption = async () => {
    const hashtags = editHashtags.split(',').map(h => h.trim()).filter(Boolean);
    await apiCall(`/api/slots/${id}/caption`, 'PUT', { caption: editCaption, hashtags });
    loadSlot();
  };

  const schedule = async () => {
    if (!scheduleDate) return;
    const scheduledAt = `${scheduleDate}T${scheduleTime}:00+09:00`;
    await apiCall(`/api/slots/${id}/schedule`, 'POST', { scheduledAt });
    loadSlot();
  };

  const copyToClipboard = async (text, field) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getStepIndex = (status) => STATUS_STEPS.indexOf(status);

  if (!slot) return <div className="container"><p>Loading...</p></div>;

  const currentStep = getStepIndex(slot.status);

  return (
    <div className="container">
      <nav className="nav">
        <a href="/">← Kalender</a>
        <a href="/queue">Queue</a>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2>{slot.calendar_date} — {slot.pillar_name}</h2>
          <span className={`badge badge-${slot.status}`}>{slot.status}</span>
        </div>
      </div>

      <div className="step-indicator">
        {STATUS_STEPS.map((step, i) => (
          <div key={step} className={`step ${i < currentStep ? 'done' : i === currentStep ? 'active' : ''}`}>
            {step.replace('_', ' ')}
          </div>
        ))}
      </div>

      {/* Step 1: Ideas */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>1. Idea</h3>
        {slot.idea_options ? (
          <div className="grid grid-2">
            {slot.idea_options.map((idea, i) => (
              <div
                key={i}
                className="card"
                style={{
                  cursor: 'pointer',
                  borderColor: slot.idea_selected_index === i ? 'var(--accent)' : 'var(--border)',
                  background: slot.idea_selected_index === i ? 'rgba(59,130,246,0.1)' : 'var(--card)',
                }}
                onClick={() => selectIdea(i)}
              >
                <strong>{idea.angle || `Opsi ${i + 1}`}</strong>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem' }}>{idea.description}</p>
                {idea.visual_type && <span className="badge badge-draft" style={{ marginTop: '0.5rem' }}>{idea.visual_type}</span>}
              </div>
            ))}
          </div>
        ) : (
          <button className="btn btn-primary" onClick={generateIdeas} disabled={loading.idea}>
            {loading.idea ? 'Generating...' : 'Generate Ideas'}
          </button>
        )}
      </div>

      {/* Step 2: Script */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3>2. Script</h3>
          {slot.status === 'draft' || slot.status === 'idea_ready' ? (
            <button className="btn btn-primary" onClick={generateScript} disabled={loading.script || !slot.idea_selected_index && slot.idea_selected_index !== 0}>
              {loading.script ? 'Generating...' : 'Generate Script'}
            </button>
          ) : editScript ? (
            <button className="btn btn-secondary" onClick={saveScript} disabled={loading.script}>
              Save Changes
            </button>
          ) : null}
        </div>
        {editScript && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>Hook</label>
              <textarea className="input" value={editScript.hook || ''} onChange={(e) => setEditScript({ ...editScript, hook: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>Body</label>
              <textarea className="input" value={editScript.body || ''} onChange={(e) => setEditScript({ ...editScript, body: e.target.value })} style={{ minHeight: '150px' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>CTA</label>
              <textarea className="input" value={editScript.cta || ''} onChange={(e) => setEditScript({ ...editScript, cta: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      {/* Step 3: Visual Brief */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3>3. Visual Brief</h3>
          <button className="btn btn-secondary" onClick={generateVisualBrief} disabled={loading['visual-brief']}>
            {loading['visual-brief'] ? 'Generating...' : 'Generate Brief'}
          </button>
        </div>
        {slot.image_brief && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Style</p>
              <p>{slot.image_brief.style}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Mood</p>
              <p>{slot.image_brief.mood}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Lighting</p>
              <p>{slot.image_brief.lighting}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Composition</p>
              <p>{slot.image_brief.composition}</p>
            </div>
          </div>
        )}
        {slot.optimized_prompt && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>SDXL Prompt (copy ke image generator)</p>
              <button
                className="btn btn-secondary copy-btn"
                onClick={() => copyToClipboard(slot.optimized_prompt.prompt, 'prompt')}
              >
                {copiedField === 'prompt' ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
            <div className="prompt-box">{slot.optimized_prompt.prompt}</div>
            {slot.optimized_prompt.negative_prompt && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Negative Prompt</p>
                  <button
                    className="btn btn-secondary copy-btn"
                    onClick={() => copyToClipboard(slot.optimized_prompt.negative_prompt, 'negative')}
                  >
                    {copiedField === 'negative' ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="prompt-box">{slot.optimized_prompt.negative_prompt}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Step 4: Upload Visual */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>4. Upload Visual</h3>
        {slot.asset_url ? (
          <div>
            <img src={slot.asset_url} alt="Visual" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', marginBottom: '0.5rem' }} />
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Uploaded</p>
          </div>
        ) : (
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            {loading.visual ? 'Uploading...' : 'Pilih Foto'}
            <input type="file" accept="image/*" onChange={uploadVisual} hidden disabled={loading.visual} />
          </label>
        )}
      </div>

      {/* Step 5: Caption */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3>5. Caption</h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={generateCaption} disabled={loading.caption}>
              {loading.caption ? 'Generating...' : 'Generate Caption'}
            </button>
            {editCaption && (
              <button className="btn btn-primary" onClick={saveCaption} disabled={loading.caption}>
                Save Changes
              </button>
            )}
          </div>
        </div>
        <div>
          <textarea className="input" value={editCaption} onChange={(e) => setEditCaption(e.target.value)} style={{ minHeight: '120px' }} />
          <input className="input" style={{ marginTop: '0.5rem' }} placeholder="Hashtags (comma separated)" value={editHashtags} onChange={(e) => setEditHashtags(e.target.value)} />
        </div>
      </div>

      {/* Step 6: Schedule */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>6. Schedule</h3>
        {slot.status === 'scheduled' ? (
          <p style={{ color: 'var(--success)' }}>✓ Scheduled for {slot.scheduled_time || 'configured time'}</p>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Tanggal</label>
              <input className="input" type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Jam (WIT)</label>
              <input className="input" type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={schedule} disabled={!scheduleDate || loading.schedule}>
              {loading.schedule ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
