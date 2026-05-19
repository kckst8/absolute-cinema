import Database from "better-sqlite3";
import { env } from "./env";

export interface RatingRow {
    movie_id: number;
    title: string;
    rating: number;
    notes: string | null;
    genres: string | null;
    age_rating: string | null;
    release_year: number | null;
    rated_at: string;
}

const db = new Database(env.MOVIE_DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
        movie_id      INTEGER PRIMARY KEY,
        title         TEXT    NOT NULL,
        rating        REAL    NOT NULL CHECK (rating >= 0 AND rating <= 10),
        notes         TEXT,
        genres        TEXT,
        age_rating    TEXT,
        release_year  INTEGER,
        rated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS seen_recommendations (
        movie_id   INTEGER PRIMARY KEY,
        suggested_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const upsertStmt = db.prepare(`
    INSERT INTO ratings (movie_id, title, rating, notes, genres, age_rating, release_year, rated_at)
    VALUES (@movie_id, @title, @rating, @notes, @genres, @age_rating, @release_year, datetime('now'))
    ON CONFLICT(movie_id) DO UPDATE SET
        rating = excluded.rating,
        notes  = COALESCE(excluded.notes, ratings.notes),
        title  = excluded.title,
        genres = excluded.genres,
        age_rating = excluded.age_rating,
        release_year = excluded.release_year,
        rated_at = datetime('now')
`);

const getStmt = db.prepare<[number], RatingRow>(`SELECT * FROM ratings WHERE movie_id = ?`);
const listStmt = db.prepare<[], RatingRow>(`SELECT * FROM ratings ORDER BY rating DESC, rated_at DESC`);
const deleteStmt = db.prepare(`DELETE FROM ratings WHERE movie_id = ?`);
const markSeenStmt = db.prepare(`INSERT OR IGNORE INTO seen_recommendations (movie_id) VALUES (?)`);
const hasSeenStmt = db.prepare<[number], { movie_id: number }>(`SELECT movie_id FROM seen_recommendations WHERE movie_id = ?`);

export const ratingsRepo = {
    upsert(row: Omit<RatingRow, "rated_at">): void {
        upsertStmt.run({
            ...row,
            notes: row.notes ?? null,
            genres: row.genres ?? null,
            age_rating: row.age_rating ?? null,
            release_year: row.release_year ?? null,
        });
    },
    get(movieId: number): RatingRow | undefined {
        return getStmt.get(movieId);
    },
    list(): RatingRow[] {
        return listStmt.all();
    },
    remove(movieId: number): boolean {
        return deleteStmt.run(movieId).changes > 0;
    },
    markSuggested(movieId: number): void {
        markSeenStmt.run(movieId);
    },
    wasSuggested(movieId: number): boolean {
        return hasSeenStmt.get(movieId) !== undefined;
    },
};
