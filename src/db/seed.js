/**
 * Seed content_calendar dengan pilar baseline.
 * Usage: npm run seed
 */
import 'dotenv/config';
import { supabase } from './supabase.js';

const pillars = [
  { day_of_week: 0, pillar_name: 'Fleksibel — rekomendasi Analysis agent', needs_real_photo: false, fallback_ai_pillar: null },
  { day_of_week: 1, pillar_name: 'Produk Highlight — showcase kaos custom', needs_real_photo: true, fallback_ai_pillar: 'Quote grafis inspirasi desain' },
  { day_of_week: 2, pillar_name: 'Tips/edukasi sablon — cara rawat kaos, beda DTF & sablon manual', needs_real_photo: false, fallback_ai_pillar: null },
  { day_of_week: 3, pillar_name: 'BTS Proses — behind the scenes produksi', needs_real_photo: true, fallback_ai_pillar: 'Konten AI visual storytelling' },
  { day_of_week: 4, pillar_name: 'Promo/Quote Grafis — inspirasi desain, promo musiman', needs_real_photo: false, fallback_ai_pillar: null },
  { day_of_week: 5, pillar_name: 'Testimoni Customer — review, unboxing, foto customer', needs_real_photo: true, fallback_ai_pillar: 'Testimoni tekstual + grafis pendukung' },
  { day_of_week: 6, pillar_name: 'Interaktif — Q&A, polling, challenge', needs_real_photo: false, fallback_ai_pillar: null },
];

async function seed() {
  console.log('🌱 Seeding content_calendar...');

  const { error: delError } = await supabase.from('content_calendar').delete().gte('day_of_week', 0);
  if (delError && !delError.message.includes('0 rows')) {
    console.error('❌ Gagal hapus data lama:', delError.message);
    process.exit(1);
  }

  const { data, error } = await supabase.from('content_calendar').insert(pillars).select();

  if (error) {
    console.error('❌ Gagal seed:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${data.length} pilar berhasil di-seed:`);
  for (const p of data) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    console.log(`   ${days[p.day_of_week]}: ${p.pillar_name} ${p.needs_real_photo ? '📸' : '🎨'}`);
  }
}

seed().catch(console.error);
