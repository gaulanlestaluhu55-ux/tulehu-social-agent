import { getAllUserMedia, getMediaInsights } from '../platforms/instagram.js';
import { upsertPostAnalytics, getPostAnalytics } from '../db/supabase.js';

export async function fetchAndStoreAnalytics(options = {}) {
  const { forceRefresh = true, daysBack = 365 } = options;

  console.log('[Analytics] Fetching Instagram posts...');

  const allMedia = await getAllUserMedia();
  console.log(`[Analytics] Found ${allMedia.length} posts`);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const existingPosts = await getPostAnalytics({ limit: 1000 });
  const existingIds = new Set(existingPosts.map(p => p.ig_media_id));

  let fetched = 0;
  let skipped = 0;
  let errors = 0;

  for (const media of allMedia) {
    const mediaDate = new Date(media.timestamp);

    if (!forceRefresh && mediaDate < cutoffDate) {
      skipped++;
      continue;
    }

    if (!forceRefresh && existingIds.has(media.id)) {
      skipped++;
      continue;
    }

    try {
      const insights = await getMediaInsights(media.id);

      const engagementRate = calculateEngagementRate(insights, media.like_count || 0);

      await upsertPostAnalytics({
        ig_media_id: media.id,
        caption: media.caption || '',
        media_type: media.media_type,
        media_url: media.media_url,
        permalink: media.permalink,
        timestamp: media.timestamp,
        like_count: media.like_count || 0,
        comments_count: media.comments_count || 0,
        saves: insights.saved || 0,
        reach: insights.reach || 0,
        shares: insights.shares || 0,
        profile_visits: insights.profile_visits || 0,
        follows: insights.follows || 0,
        impressions: insights.impressions || 0,
        engagement_rate: engagementRate,
        fetched_at: new Date().toISOString(),
      });

      fetched++;
      console.log(`[Analytics] ✓ ${media.id} (${engagementRate}% engagement)`);

      // Rate limit: 200 requests per hour
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      errors++;
      console.error(`[Analytics] ✗ ${media.id}: ${err.message}`);
    }
  }

  console.log(`[Analytics] Done: ${fetched} fetched, ${skipped} skipped, ${errors} errors`);

  return { total: allMedia.length, fetched, skipped, errors };
}

function calculateEngagementRate(insights, likes) {
  const reach = insights.reach || 0;
  if (reach === 0) return 0;

  const totalEngagement = (likes || 0) + (insights.comments || 0) + (insights.saved || 0) + (insights.shares || 0);
  return ((totalEngagement / reach) * 100).toFixed(2);
}

export async function getAnalyticsReport(options = {}) {
  const { daysBack = 7 } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const posts = await getPostAnalytics({
    startDate: startDate.toISOString(),
    orderBy: 'engagement_rate',
    ascending: false,
  });

  if (posts.length === 0) {
    return {
      summary: { total_posts: 0, avg_engagement: 0, total_reach: 0 },
      top_posts: [],
      by_type: {},
    };
  }

  const summary = {
    total_posts: posts.length,
    avg_engagement: (posts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / posts.length).toFixed(2),
    total_reach: posts.reduce((sum, p) => sum + (p.reach || 0), 0),
    total_likes: posts.reduce((sum, p) => sum + (p.like_count || 0), 0),
    total_comments: posts.reduce((sum, p) => sum + (p.comments_count || 0), 0),
    total_saves: posts.reduce((sum, p) => sum + (p.saves || 0), 0),
    total_shares: posts.reduce((sum, p) => sum + (p.shares || 0), 0),
  };

  const topPosts = posts.slice(0, 5).map(p => ({
    id: p.ig_media_id,
    caption: p.caption?.substring(0, 100),
    type: p.media_type,
    engagement: p.engagement_rate,
    reach: p.reach,
    likes: p.like_count,
    comments: p.comments_count,
    saves: p.saves,
  }));

  const byType = posts.reduce((acc, post) => {
    const type = post.media_type || 'UNKNOWN';
    if (!acc[type]) acc[type] = { count: 0, avg_engagement: 0, total_reach: 0 };
    acc[type].count++;
    acc[type].avg_engagement += post.engagement_rate || 0;
    acc[type].total_reach += post.reach || 0;
    return acc;
  }, {});

  for (const type of Object.keys(byType)) {
    byType[type].avg_engagement = (byType[type].avg_engagement / byType[type].count).toFixed(2);
  }

  return { summary, top_posts: topPosts, by_type: byType };
}
