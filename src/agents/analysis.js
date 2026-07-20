import { supabase, logAgentAction, getPostAnalytics, getTopPosts } from '../db/supabase.js';
import { callWithFailover } from '../llm/client.js';
import { withRetry } from '../engine/retry.js';
import { agentProviders, config, PIPELINE_STATUS } from '../config.js';
import { getMediaInsights, getComments, scoreCommentQuality } from '../platforms/instagram.js';
import { fetchAndStoreAnalytics, getAnalyticsReport } from './analytics.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandContext = fs.readFileSync(path.join(__dirname, '../templates/brand-context.txt'), 'utf-8');
const analysisPromptTemplate = fs.readFileSync(path.join(__dirname, '../templates/prompts/analysis.txt'), 'utf-8').replace(/\{brand_context\}/g, brandContext);

export async function runAnalysisAgent() {
  console.log('[Analysis Agent] Memulai analisis mingguan...');
  const startTime = Date.now();
  const accessToken = config.IG_ACCESS_TOKEN;

  try {
    // Fetch dan store analytics terbaru dari Instagram
    if (accessToken && accessToken !== 'your_long_lived_access_token') {
      console.log('[Analysis Agent] Fetching fresh analytics dari Instagram...');
      await fetchAndStoreAnalytics({ daysBack: 7 });
    }

    // Ambil data dari post_analytics table
    const report = await getAnalyticsReport({ daysBack: 7 });

    if (report.summary.total_posts === 0) {
      console.log('[Analysis Agent] Tidak ada post untuk dianalisis');

      await logAgentAction({
        agent_name: 'analysis',
        action: 'weekly_analysis',
        status: 'success',
        duration_ms: Date.now() - startTime,
      });

      return { analyzedPosts: 0, newInsights: 0 };
    }

    // Build insights summary untuk LLM
    const insightsSummary = report.top_posts.map(p => {
      const captionPreview = p.caption?.substring(0, 80) || 'No caption';
      return `- Type: ${p.type}, Caption: "${captionPreview}...", Engagement: ${p.engagement}%, Reach: ${p.reach}, Likes: ${p.likes}, Comments: ${p.comments}, Saves: ${p.saves}`;
    }).join('\n');

    // Summary by type
    const typeSummary = Object.entries(report.by_type).map(([type, stats]) => {
      return `- ${type}: ${stats.count} posts, Avg Engagement: ${stats.avg_engagement}%, Total Reach: ${stats.total_reach}`;
    }).join('\n');

    // Ambil learnings aktif buat context
    const { data: existingLearnings } = await supabase
      .from('learnings')
      .select('insight_summary, pillar_related, confidence')
      .eq('status', 'active')
      .order('confidence', { ascending: false })
      .limit(10);

    const learningsText = (existingLearnings || [])
      .map(l => `- [${l.confidence}] ${l.insight_summary}${l.pillar_related ? ` (${l.pillar_related})` : ''}`)
      .join('\n') || 'Belum ada learnings.';

    const analysisPrompt = analysisPromptTemplate
      .replace('{insights_summary}', insightsSummary)
      .replace('{existing_learnings}', learningsText)
      .replace('{type_summary}', typeSummary)
      .replace('{total_posts}', report.summary.total_posts)
      .replace('{avg_engagement}', report.summary.avg_engagement);

    const result = await withRetry(async () => {
      return await callWithFailover(agentProviders.analysis, [
        { role: 'system', content: 'Kamu adalah analysis agent yang menghasilkan insight berdasarkan data performa konten.' },
        { role: 'user', content: analysisPrompt },
      ], { temperature: 0.3, maxTokens: 1500 });
    }, 'analysis');

    let insights;
    try {
      let cleaned = result.content.trim();
      // Strip markdown code blocks
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Try to extract JSON array from response
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        insights = JSON.parse(jsonMatch[0]);
      } else {
        insights = JSON.parse(cleaned);
      }
    } catch (err) {
      console.log('[Analysis Agent] Gagal parse, raw:', result.content.substring(0, 300));
      insights = [];
    }

    if (!Array.isArray(insights)) insights = [];

    let created = 0, deprecated = 0, upgraded = 0;

    for (const insight of insights) {
      const action = insight.action || 'create';

      if (action === 'deprecate') {
        // Cari learning lama yang mirip dan deprecate
        const { data: toDeprecate } = await supabase
          .from('learnings')
          .select('id')
          .eq('status', 'active')
          .ilike('insight_summary', `%${(insight.insight_summary || '').slice(0, 30)}%`)
          .limit(3);
        if (toDeprecate?.length) {
          const ids = toDeprecate.map(l => l.id);
          await supabase.from('learnings').update({ status: 'deprecated', updated_at: new Date().toISOString() }).in('id', ids);
          deprecated += ids.length;
        }
        // Tetap simpan insight baru sebagai pengganti
        await supabase.from('learnings').insert({
          insight_summary: insight.insight_summary,
          pillar_related: insight.pillar_related || null,
          confidence: insight.confidence || 'medium',
          based_on_post_count: report.summary.total_posts,
          evidence_notes: JSON.stringify({ source: 'weekly_analysis', action: 'deprecate_old', date: new Date().toISOString() }),
          status: 'active',
        });
        created++;
      } else if (action === 'upgrade') {
        // Cari learning aktif yang mirip dan upgrade confidence
        const { data: toUpgrade } = await supabase
          .from('learnings')
          .select('id, confidence')
          .eq('status', 'active')
          .ilike('insight_summary', `%${(insight.insight_summary || '').slice(0, 30)}%`)
          .limit(1);
        if (toUpgrade?.length) {
          const newConf = insight.confidence || 'high';
          await supabase.from('learnings').update({
            confidence: newConf,
            based_on_post_count: (existingLearnings?.find(l => l.id === toUpgrade[0].id)?.based_on_post_count || 0) + report.summary.total_posts,
            updated_at: new Date().toISOString(),
          }).eq('id', toUpgrade[0].id);
          upgraded++;
        }
      } else {
        // Create baru
        await supabase.from('learnings').insert({
          insight_summary: insight.insight_summary,
          pillar_related: insight.pillar_related || null,
          confidence: insight.confidence || 'medium',
          based_on_post_count: report.summary.total_posts,
          evidence_notes: JSON.stringify({ source: 'weekly_analysis', date: new Date().toISOString() }),
          status: 'active',
        });
        created++;
      }
    }

    // Reflection: deprecate learnings lama yang low confidence + gak didukung data baru
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: oldLow } = await supabase
      .from('learnings')
      .select('id')
      .eq('status', 'active')
      .eq('confidence', 'low')
      .lt('created_at', sevenDaysAgo.toISOString());
    if (oldLow?.length > 3) {
      const oldIds = oldLow.slice(0, Math.floor(oldLow.length / 2)).map(l => l.id);
      await supabase.from('learnings').update({ status: 'deprecated', updated_at: new Date().toISOString() }).in('id', oldIds);
      deprecated += oldIds.length;
    }

    await logAgentAction({
      agent_name: 'analysis',
      action: 'weekly_analysis',
      status: 'success',
      provider_used: result.providerUsed || 'unknown',
      model_used: result.model || null,
      tokens_used: result.usage?.total_tokens || 0,
      duration_ms: Date.now() - startTime,
      metadata: { posts_analyzed: report.summary.total_posts, new_insights: insights.length },
    });

    console.log(`[Analysis Agent] Analisis selesai. ${insights.length} insight baru.`);
    return { analyzedPosts: report.summary.total_posts, newInsights: insights.length };

  } catch (err) {
    console.error(`[Analysis Agent] Gagal: ${err.message}`);
    await logAgentAction({
      agent_name: 'analysis',
      action: 'weekly_analysis',
      status: 'error',
      error_message: err.message,
      duration_ms: Date.now() - startTime,
    });
    throw err;
  }
}
