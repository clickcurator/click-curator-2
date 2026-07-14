# Click Curator 2.0 -- backend starter

This is the working foundation for the searchable archive: database schema,
a one-time ingestion script for your cleaned CSV, and a small API that
powers search, filtering, sorting by engagement, and per-creator "used"
tracking.

## 1. Set up the database (Supabase)

1. Create a free Supabase project.
2. In the SQL editor, run `sql/schema.sql`.
3. Copy the connection string (Settings -> Database -> Connection string,
   "URI" format) -- this is your `DATABASE_URL`.

## 2. Set environment variables

Create a `.env` file (or set these in Railway's dashboard):

```
DATABASE_URL=postgres://...supabase connection string...
OPENAI_API_KEY=sk-...
```

## 3. Install dependencies

```
npm install
```

## 4. Run the one-time ingestion

Point this at your cleaned Master CSV (title, url, category, date_sent
columns). It will scrape thumbnails, generate AI summaries + engagement
scores + embeddings, and load everything into Postgres. For ~1,170 rows,
expect this to take a while due to the scraping and AI calls -- consider
running it in batches if you hit rate limits.

```
npm run ingest -- path/to/clean_archive.csv
```

## 5. Run the API

```
npm start
```

This exposes:

- `GET /api/search?q=topic&category=Politics&days=90&creatorId=X&excludeUsed=true`
  -- semantic + filtered + engagement-ranked search
- `POST /api/usage` with `{ creatorId, articleId }` -- marks an article used
  by that specific creator (does not affect other creators' view)

## 6. Deploy to Railway

1. Push this folder to a GitHub repo.
2. Create a new Railway project from that repo.
3. Add the same `DATABASE_URL` and `OPENAI_API_KEY` environment variables.
4. Railway will run `npm start` automatically.

## What's still to build on top of this

- Frontend search UI (the interactive demo shown in chat is a good starting
  point -- wire it up to call `/api/search` instead of using embedded data)
- Magic-link auth so each creator gets a stable `creatorId`
- Going forward, new daily content should call the same enrichment logic
  from `ingest.js` as it's added, rather than batching it after the fact
