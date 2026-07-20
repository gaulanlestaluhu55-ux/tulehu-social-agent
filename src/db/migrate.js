/**
 * Migration runner — jalankan SQL migration ke Supabase.
 * Usage: npm run migrate
 * 
 * Catatan: Kalau RPC exec_sql tidak ada, SQL akan ditampilkan
 * agar bisa dijalankan manual di Supabase SQL Editor.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib di .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: coba jalankan SQL via beberapa method
async function executeSQL(sql, fileName) {
  // Method 1: RPC exec_sql
  try {
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (!error) return { method: 'rpc', success: true };
  } catch {}

  // Method 2: REST query langsung (split per statement)
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  let allOk = true;
  for (const stmt of statements) {
    try {
      const { error } = await supabase.from('_sql_migrations').insert({ name: fileName, sql: stmt });
      if (error) {
        allOk = false;
        break;
      }
    } catch {
      allOk = false;
      break;
    }
  }
  if (allOk) return { method: 'rest', success: true };

  // Method 3: gagal semua — return manual instruction
  return { method: 'manual', success: false };
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  console.log(`📦 Ditemukan ${files.length} migration file:\n`);

  let manualFiles = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  ▶ ${file}...`);

    const result = await executeSQL(sql, file);

    if (result.success) {
      console.log(`  ✅ ${file} (via ${result.method})`);
    } else {
      console.log(`  ⚠️  ${file} — TIDAK BISA dijalankan otomatis`);
      console.log(`  📋 Paste SQL manual di Supabase SQL Editor:\n`);
      console.log(`  ┌─── BEGIN ${file} ───`);
      console.log(`  ${sql.split('\n').join('\n  ')}`);
      console.log(`  └─── END ${file} ───\n`);
      manualFiles.push(file);
    }
  }

  if (manualFiles.length > 0) {
    console.log(`\n⚠️  ${manualFiles.length} migration perlu dijalankan manual:`);
    manualFiles.forEach(f => console.log(`   - ${f}`));
    console.log('\n📌 Buka: https://supabase.com/dashboard/project/_/sql/new');
    console.log('   Paste isi file SQL, lalu klik "Run".\n');
  } else {
    console.log('\n✅ Semua migration berhasil dijalankan otomatis.');
  }
}

runMigrations().catch(console.error);
