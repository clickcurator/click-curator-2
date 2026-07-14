// Ingests articles from a CSV (title, url, category, date_sent) into the
// articles table: scrapes an og:image thumbnail, calls OpenAI for a short
// summary + an embedding + a fallback engagement score, and tries the
// X oEmbed endpoint (free, no key) for real engagement signal on X posts.
//
// Usage: node src/ingest.js path/to/clean_archive.csv

import fs from "fs";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import pkg from "pg";
import OpenAI from "openai";

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function scrapeThumbnail(url) {
  try {
    const res = await fetch(url, { redirect: "follow", timeout: 8000 });
    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function tryOembed(url) {
  const domain = domainOf(url);
  if (!domain || !domain.includes("x.com")) return null;
  try {
    // X's public oEmbed endpoint -- no auth required, but rate limited and
    // occasionally blocked. Returns embed HTML, not raw engagement counts,
    // so this mainly confirms the post is alive and gives us author name.
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { author: data.author_name, html: data.html };
  } catch {
    return null;
  }
}

async function aiEnrich(title) {
  // One call gets summary + engagement estimate + embedding input text.
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You help a Christian content curation service score archived posts for creators making reaction videos and still posts. Given a headline/post title, respond ONLY with JSON: {\"summary\": \"one short sentence\", \"engagement_score\": 0-100}. Score higher for emotional intensity, controversy, celebrity involvement, surprising claims, or a clear visual hook. Score lower for routine/dry news.",
      },
      { role: "user", content: title },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(completion.choices[0].message.content);

  const embeddingRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: title,
  });

  return {
    summary: parsed.summary,
    ai_score: parsed.engagement_score,
    embedding: embeddingRes.data[0].embedding,
  };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node src/ingest.js path/to/archive.csv");
    process.exit(1);
  }

  const rows = parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`Loaded ${rows.length} rows. Starting enrichment...`);

  for (const [i, row] of rows.entries()) {
    const { title, url, category, date_sent } = row;
    if (!title || !url) continue;

    const [thumbnail_url, oembed, ai] = await Promise.all([
      scrapeThumbnail(url),
      tryOembed(url),
      aiEnrich(title),
    ]);

    await pool.query(
      `insert into articles
        (title, url, category, date_sent, source_domain, thumbnail_url, summary, ai_score, embedding)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (url) do nothing`,
      [
        title,
        url,
        category,
        date_sent,
        domainOf(url),
        thumbnail_url,
        ai.summary,
        ai.ai_score,
        JSON.stringify(ai.embedding),
      ]
    );

    if ((i + 1) % 25 === 0) console.log(`Processed ${i + 1}/${rows.length}`);
  }

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
