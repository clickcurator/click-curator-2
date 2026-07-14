import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(express.json());

// Serve the frontend (public/index.html and any other static assets)
app.use(express.static(path.join(__dirname, "..", "public")));

// POST /api/creator  { email }  -> { id }
// Simple stand-in for real auth: gets or creates a creator row by email.
app.post("/api/creator", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const existing = await pool.query(`select id from creators where email = $1`, [email]);
  if (existing.rows.length) {
    return res.json({ id: existing.rows[0].id });
  }

  const inserted = await pool.query(
    `insert into creators (email) values ($1) returning id`,
    [email]
  );
  res.json({ id: inserted.rows[0].id });
});

// GET /api/search?q=topic&category=Politics&days=90&creatorId=...&excludeUsed=true
app.get("/api/search", async (req, res) => {
  const { q, category, days, creatorId, excludeUsed } = req.query;
  const params = [];
  const clauses = [];

  if (category) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }
  if (days) {
    params.push(Number(days));
    clauses.push(`date_sent >= now() - ($${params.length} || ' days')::interval`);
  }

  let embeddingClause = "";
  if (q) {
    // Semantic search: embed the query, order by cosine distance.
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: q,
    });
    params.push(JSON.stringify(embeddingRes.data[0].embedding));
    embeddingClause = `embedding <=> $${params.length}::vector as distance`;
  }

  let excludeUsedJoin = "";
  if (excludeUsed === "true" && creatorId) {
    params.push(creatorId);
    excludeUsedJoin = `
      and not exists (
        select 1 from article_usage au
        where au.article_id = articles.id and au.creator_id = $${params.length}
      )
    `;
  }

  const where = clauses.length ? `where ${clauses.join(" and ")} ${excludeUsedJoin}` : `where true ${excludeUsedJoin}`;
  const orderBy = q ? "distance asc" : "final_score desc nulls last, date_sent desc";
  const selectExtra = q ? `, ${embeddingClause}` : "";

  const sql = `
    select id, title, url, category, date_sent, thumbnail_url, summary,
           final_score ${selectExtra}
    from articles
    ${where}
    order by ${orderBy}
    limit 100
  `;

  const result = await pool.query(sql, params);
  res.json(result.rows);
});

// POST /api/usage  { creatorId, articleId }
app.post("/api/usage", async (req, res) => {
  const { creatorId, articleId } = req.body;
  await pool.query(
    `insert into article_usage (creator_id, article_id)
     values ($1, $2) on conflict do nothing`,
    [creatorId, articleId]
  );
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Click Curator API listening on ${port}`));
