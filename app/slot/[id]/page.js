'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const STATUS_STEPS = ['draft', 'idea_ready', 'script_ready', 'visual_uploaded', 'caption_ready', 'scheduled'];

export default function SlotPage({ params }) {
  const { id } = params;
  const router = useRouter();
  const [slot, setSlot] = useState(null);
  const [loading, setLoading] = useState({});
  const [editScript, setEditScript] = useState(null);
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [copiedField, setCopiedField] = useState(null);
  const [activeSlide, setActiveSlide] = useState(0);

  const isCarousel = slot?.content_type === 'carousel';

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

  const apiCall = async (url, method = 'POST', body = null, loadingKey = null) => {
    const key = loadingKey || url;
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      let data;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      return data;
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  };

  const generateIdeas = async () => {
    await apiCall(`/api/slots/${id}/idea`, 'POST', null, 'idea');
    loadSlot();
  };

  const selectIdea = async (idx) => {
    await apiCall(`/api/slots/${id}/idea`, 'PUT', { selectedIndex: idx });
    loadSlot();
  };

  const generateScript = async () => {
    const data = await apiCall(`/api/slots/${id}/script`, 'POST', null, 'script');
    setEditScript(data.scriptContent);
    loadSlot();
  };

  const saveScript = async () => {
    await apiCall(`/api/slots/${id}/script`, 'PUT', { script: editScript }, 'script');
    loadSlot();
  };

  const generateVisualBrief = async () => {
    await apiCall(`/api/slots/${id}/visual-brief`, 'POST', null, 'visual-brief');
    loadSlot();
  };

  const uploadVisual = async (e, slideIndex = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const key = slideIndex !== null ? `visual-${slideIndex}` : 'visual';
    setLoading(l => ({ ...l, [key]: true }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (slideIndex !== null) formData.append('slideIndex', slideIndex);
      const res = await fetch(`/api/slots/${id}/visual`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      loadSlot();
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  };

  const generateCaption = async () => {
    const data = await apiCall(`/api/slots/${id}/caption`, 'POST', null, 'caption');
    setEditCaption(data.caption || '');
    setEditHashtags((data.hashtags || []).join(', '));
    loadSlot();
  };

  const saveCaption = async () => {
    const hashtags = editHashtags.split(',').map(h => h.trim()).filter(Boolean);
    await apiCall(`/api/slots/${id}/caption`, 'PUT', { caption: editCaption, hashtags }, 'caption');
    loadSlot();
  };

  const schedule = async () => {
    if (!scheduleDate) return;
    const scheduledAt = `${scheduleDate}T${scheduleTime}:00+09:00`;
    await apiCall(`/api/slots/${id}/schedule`, 'POST', { scheduledAt }, 'schedule');
    loadSlot();
  };

  const copyToClipboard = async (text, field) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const addSlide = () => {
    if (!editScript?.slides) return;
    const newSlides = [...editScript.slides, { headline: '', description: '', visual_notes: '' }];
    setEditScript({ ...editScript, slides: newSlides });
  };

  const removeSlide = (idx) => {
    if (!editScript?.slides) return;
    const newSlides = editScript.slides.filter((_, i) => i !== idx);
    setEditScript({ ...editScript, slides: newSlides });
  };

  const updateSlide = (idx, field, value) => {
    if (!editScript?.slides) return;
    const newSlides = [...editScript.slides];
    newSlides[idx] = { ...newSlides[idx], [field]: value };
    setEditScript({ ...editScript, slides: newSlides });
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
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span className={`badge badge-${slot.status}`}>{slot.status}</span>
            <span className="badge badge-draft">{isCarousel ? 'Carousel' : 'Single Image'}</span>
          </div>
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
            {loading.idea ? <><span className="spinner" />Generating...</> : 'Generate Ideas'}
          </button>
        )}
      </div>

      {/* Step 2: Script */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3>2. Script {isCarousel && '(Carousel)'}</h3>
          {slot.status === 'draft' || slot.status === 'idea_ready' ? (
            <button className="btn btn-primary" onClick={generateScript} disabled={loading.script || slot.idea_selected_index == null}>
              {loading.script ? <><span className="spinner" />Generating...</> : 'Generate Script'}
            </button>
          ) : editScript ? (
            <button className="btn btn-secondary" onClick={saveScript} disabled={loading.script}>
              {loading.script ? <><span className="spinner" />Saving...</> : 'Save Changes'}
            </button>
          ) : null}
        </div>
        {editScript && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>Hook</label>
              <textarea className="input" value={editScript.hook || ''} onChange={(e) => setEditScript({ ...editScript, hook: e.target.value })} />
            </div>
            {!isCarousel && (
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>Body</label>
                <textarea className="input" value={Array.isArray(editScript.body) ? editScript.body.join('\n') : editScript.body || ''} onChange={(e) => setEditScript({ ...editScript, body: e.target.value.split('\n').filter(Boolean) })} style={{ minHeight: '150px' }} />
              </div>
            )}
            {isCarousel && editScript.slides && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Slides ({editScript.slides.length})</label>
                  <button className="btn btn-secondary" onClick={addSlide} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>+ Tambah Slide</button>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  {editScript.slides.map((slide, i) => (
                    <button
                      key={i}
                      className={`btn ${activeSlide === i ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setActiveSlide(i)}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                {editScript.slides[activeSlide] && (
                  <div className="card" style={{ background: 'var(--bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Slide {activeSlide + 1}</span>
                      {editScript.slides.length > 1 && (
                        <button className="btn btn-danger" onClick={() => removeSlide(activeSlide)} style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>Hapus</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <input className="input" placeholder="Headline" value={editScript.slides[activeSlide].headline || ''} onChange={(e) => updateSlide(activeSlide, 'headline', e.target.value)} />
                      <textarea className="input" placeholder="Deskripsi" value={editScript.slides[activeSlide].description || ''} onChange={(e) => updateSlide(activeSlide, 'description', e.target.value)} style={{ minHeight: '80px' }} />
                      <input className="input" placeholder="Visual Notes" value={editScript.slides[activeSlide].visual_notes || ''} onChange={(e) => updateSlide(activeSlide, 'visual_notes', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}
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
          <h3>3. Visual Brief {isCarousel && `(${(Array.isArray(slot.image_brief) ? slot.image_brief : [slot.image_brief]).filter(Boolean).length} slides)`}</h3>
          <button className="btn btn-secondary" onClick={generateVisualBrief} disabled={loading['visual-brief']}>
            {loading['visual-brief'] ? <><span className="spinner" />Generating...</> : 'Generate Brief'}
          </button>
        </div>
        {slot.image_brief && isCarousel && Array.isArray(slot.image_brief) ? (
          <div>
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {slot.image_brief.map((brief, i) => (
                <button
                  key={i}
                  className={`btn ${activeSlide === i ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActiveSlide(i)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                >
                  Slide {i + 1}
                </button>
              ))}
            </div>
            {slot.image_brief[activeSlide] && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Style</p><p>{slot.image_brief[activeSlide].style}</p></div>
                <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Mood</p><p>{slot.image_brief[activeSlide].mood}</p></div>
                <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Lighting</p><p>{slot.image_brief[activeSlide].lighting}</p></div>
                <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Composition</p><p>{slot.image_brief[activeSlide].composition}</p></div>
                {slot.image_brief[activeSlide].subject && <div style={{ gridColumn: '1 / -1' }}><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Subject</p><p>{slot.image_brief[activeSlide].subject}</p></div>}
              </div>
            )}
          </div>
        ) : slot.image_brief && !isCarousel ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Style</p><p>{slot.image_brief.style}</p></div>
            <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Mood</p><p>{slot.image_brief.mood}</p></div>
            <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Lighting</p><p>{slot.image_brief.lighting}</p></div>
            <div><p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Composition</p><p>{slot.image_brief.composition}</p></div>
          </div>
        ) : null}
        {slot.optimized_prompt && (
          <div style={{ marginTop: '1rem' }}>
            {isCarousel && Array.isArray(slot.optimized_prompt) ? (
              <div>
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  {slot.optimized_prompt.map((_, i) => (
                    <button
                      key={i}
                      className={`btn ${activeSlide === i ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setActiveSlide(i)}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    >
                      Prompt {i + 1}
                    </button>
                  ))}
                </div>
                {slot.optimized_prompt[activeSlide] && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>SDXL Prompt (Slide {activeSlide + 1})</p>
                      <button className="btn btn-secondary copy-btn" onClick={() => copyToClipboard(slot.optimized_prompt[activeSlide].prompt, `prompt-${activeSlide}`)}>
                        {copiedField === `prompt-${activeSlide}` ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="prompt-box">{slot.optimized_prompt[activeSlide].prompt}</div>
                    {slot.optimized_prompt[activeSlide].negative_prompt && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Negative Prompt</p>
                          <button className="btn btn-secondary copy-btn" onClick={() => copyToClipboard(slot.optimized_prompt[activeSlide].negative_prompt, `neg-${activeSlide}`)}>
                            {copiedField === `neg-${activeSlide}` ? '✓ Copied!' : 'Copy'}
                          </button>
                        </div>
                        <div className="prompt-box">{slot.optimized_prompt[activeSlide].negative_prompt}</div>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>SDXL Prompt (copy ke image generator)</p>
                  <button className="btn btn-secondary copy-btn" onClick={() => copyToClipboard(slot.optimized_prompt.prompt, 'prompt')}>
                    {copiedField === 'prompt' ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="prompt-box">{slot.optimized_prompt.prompt}</div>
                {slot.optimized_prompt.negative_prompt && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Negative Prompt</p>
                      <button className="btn btn-secondary copy-btn" onClick={() => copyToClipboard(slot.optimized_prompt.negative_prompt, 'negative')}>
                        {copiedField === 'negative' ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="prompt-box">{slot.optimized_prompt.negative_prompt}</div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Step 4: Upload Visual */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>4. Upload Visual {isCarousel && `(${Array.isArray(slot.asset_url) ? slot.asset_url.filter(Boolean).length : slot.asset_url ? 1 : 0} uploaded)`}</h3>
        {isCarousel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {editScript?.slides?.map((slide, i) => (
              <div key={i} className="card" style={{ background: 'var(--bg)' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Slide {i + 1}: {slide.headline || `Slide ${i + 1}`}</p>
                {Array.isArray(slot.asset_url) && slot.asset_url[i] ? (
                  <div>
                    <img src={slot.asset_url[i]} alt={`Slide ${i + 1}`} style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '6px', marginBottom: '0.5rem' }} />
                    <p style={{ fontSize: '0.75rem', color: 'var(--success)' }}>✓ Uploaded</p>
                  </div>
                ) : (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                    {loading[`visual-${i}`] ? <><span className="spinner" />Uploading...</> : `Upload Slide ${i + 1}`}
                    <input type="file" accept="image/*" onChange={(e) => uploadVisual(e, i)} hidden disabled={loading[`visual-${i}`]} />
                  </label>
                )}
              </div>
            ))}
          </div>
        ) : slot.asset_url ? (
          <div>
            <img src={slot.asset_url} alt="Visual" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', marginBottom: '0.5rem' }} />
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Uploaded</p>
          </div>
        ) : (
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            {loading.visual ? <><span className="spinner" />Uploading...</> : 'Pilih Foto'}
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
              {loading.caption ? <><span className="spinner" />Generating...</> : 'Generate Caption'}
            </button>
            {editCaption && (
              <button className="btn btn-primary" onClick={saveCaption} disabled={loading.caption}>
                {loading.caption ? <><span className="spinner" />Saving...</> : 'Save Changes'}
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
              {loading.schedule ? <><span className="spinner" />Scheduling...</> : 'Schedule'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
