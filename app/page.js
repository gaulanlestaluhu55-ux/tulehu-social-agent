'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export default function CalendarPage() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [slots, setSlots] = useState([]);
  const [showCreate, setShowCreate] = useState(null);
  const [pillar, setPillar] = useState('');
  const [contentType, setContentType] = useState('single_image');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkAuth();
    loadSlots();
  }, [currentDate]);

  const checkAuth = async () => {
    const res = await fetch('/api/auth/check');
    if (!res.ok) router.push('/login');
  };

  const loadSlots = async () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      const res = await fetch(`/api/slots?from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots || []);
      }
    } catch (err) {
      console.error('Failed to load slots:', err);
    }
  };

  const createSlot = async (date) => {
    if (!pillar.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: [{ date, pillar: pillar.trim(), content_type: contentType }] }),
      });
      if (res.ok) {
        setShowCreate(null);
        setPillar('');
        loadSlots();
      }
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return { firstDay, daysInMonth };
  };

  const getSlotForDate = (day) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return slots.find(s => s.calendar_date === dateStr);
  };

  const { firstDay, daysInMonth } = getDaysInMonth();

  return (
    <div className="container">
      <nav className="nav">
        <a href="/" className="active">Kalender</a>
        <a href="/queue">Queue</a>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <button className="btn btn-secondary" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
          ← Prev
        </button>
        <h2>{MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}</h2>
        <button className="btn btn-secondary" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
          Next →
        </button>
      </div>

      <div className="grid grid-7" style={{ marginBottom: '1rem' }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--muted)', padding: '0.5rem' }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-7">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="day-cell empty" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const slot = getSlotForDate(day);
          return (
            <div
              key={day}
              className={`day-cell ${slot ? 'has-slot' : ''}`}
              onClick={() => slot ? router.push(`/slot/${slot.id}`) : setShowCreate(day)}
            >
              <span>{day}</span>
              {slot && (
                <span className={`badge badge-${slot.status}`} style={{ marginTop: '0.25rem', fontSize: '0.625rem' }}>
                  {slot.status.replace('_', ' ')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div className="card" style={{ width: '400px' }}>
            <h3 style={{ marginBottom: '1rem' }}>Buat Slot — {currentDate.getFullYear()}-{String(currentDate.getMonth()+1).padStart(2,'0')}-{String(showCreate).padStart(2,'0')}</h3>
            <input
              className="input"
              placeholder="Pillar name (contoh: Tips/edukasi sablon)"
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              autoFocus
            />
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem', display: 'block' }}>Tipe Konten</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={`btn ${contentType === 'single_image' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setContentType('single_image')}
                  type="button"
                >
                  Single Image
                </button>
                <button
                  className={`btn ${contentType === 'carousel' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setContentType('carousel')}
                  type="button"
                >
                  Carousel
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={() => createSlot(`${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(showCreate).padStart(2,'0')}`)} disabled={loading || !pillar.trim()}>
                {loading ? 'Creating...' : 'Buat Slot'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowCreate(null); setPillar(''); setContentType('single_image'); }}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
