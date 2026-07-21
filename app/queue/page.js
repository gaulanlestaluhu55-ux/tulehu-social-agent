'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function QueuePage() {
  const router = useRouter();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    loadQueue();
  }, []);

  const checkAuth = async () => {
    const res = await fetch('/api/auth/check');
    if (!res.ok) router.push('/login');
  };

  const loadQueue = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const cancelItem = async (id) => {
    if (!confirm('Batalkan jadwal ini?')) return;
    await fetch(`/api/queue?id=${id}`, { method: 'DELETE' });
    loadQueue();
  };

  const formatDate = (dt) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' });
  };

  return (
    <div className="container">
      <nav className="nav">
        <a href="/">Kalender</a>
        <a href="/queue" className="active">Queue</a>
      </nav>

      <h2 style={{ marginBottom: '1.5rem' }}>Publish Queue</h2>

      {loading ? (
        <p>Loading...</p>
      ) : queue.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>Tidak ada konten terjadwal.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {queue.map((item) => (
            <div key={item.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span className={`badge badge-${item.status}`}>{item.status}</span>
                  <span style={{ fontSize: '0.875rem' }}>{item.platform}</span>
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                  Scheduled: {formatDate(item.scheduled_at)}
                </p>
                {item.platform_permalink && (
                  <a href={item.platform_permalink} target="_blank" rel="noopener" style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>
                    {item.platform_permalink}
                  </a>
                )}
              </div>
              {item.status === 'pending' && (
                <button className="btn btn-danger" onClick={() => cancelItem(item.id)} style={{ fontSize: '0.75rem' }}>
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
