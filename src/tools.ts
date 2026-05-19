import { tool } from "langchain";
import * as z from "zod";
import { ratingsRepo } from "./db";
import {
    discoverMovies,
    getMovieFull,
    getRecommendationsFor,
    moviesByPerson,
    searchMoviesByTitle,
    summarize,
} from "./tmdb";

const searchByTitle = tool(
    async ({ title, year }) => {
        const results = await searchMoviesByTitle(title, year);
        if (results.length === 0) return "No results.";
        return results.map(summarize).join("\n");
    },
    {
        name: "search_movies_by_title",
        description:
            "Search the movie database by title (optionally by release year). Returns a list of movies with their TMDB id, which is required for other tools.",
        schema: z.object({
            title: z.string().describe("Movie title or fragment."),
            year: z.number().int().optional().describe("Release year, optional."),
        }),
    }
);

const searchByPerson = tool(
    async ({ name, role }) => {
        const results = await moviesByPerson(name, role);
        if (results.length === 0) return `No ${role} credits found for ${name}.`;
        return results.map(summarize).join("\n");
    },
    {
        name: "search_movies_by_person",
        description:
            "Find movies where a person served as director, writer, or producer. Returns TMDB ids needed by other tools.",
        schema: z.object({
            name: z.string().describe("Person's name."),
            role: z.enum(["director", "writer", "producer"]),
        }),
    }
);

const discover = tool(
    async ({ genres, maxAgeRating, minYear, maxYear, sortBy }) => {
        const results = await discoverMovies({ genres, maxAgeRating, minYear, maxYear, sortBy });
        if (results.length === 0) return "No movies match those filters.";
        return results.map(summarize).join("\n");
    },
    {
        name: "discover_movies",
        description:
            "Browse the database with filters: genres (e.g. 'Action','Drama'), US age rating cap (e.g. 'PG-13','R'), year range, sort order.",
        schema: z.object({
            genres: z.array(z.string()).optional(),
            maxAgeRating: z
                .enum(["G", "PG", "PG-13", "R", "NC-17"]).optional()
                .describe("Max US certification to include."),
            minYear: z.number().int().optional(),
            maxYear: z.number().int().optional(),
            sortBy: z
                .enum(["popularity.desc", "vote_average.desc", "primary_release_date.desc", "revenue.desc"])
                .optional(),
        }),
    }
);

const movieDetails = tool(
    async ({ movieId }) => {
        const m = await getMovieFull(movieId);
        return JSON.stringify(m);
    },
    {
        name: "get_movie_details",
        description: "Get full details for a movie by TMDB id: overview, genres, age rating, directors, writers, producers, cast.",
        schema: z.object({ movieId: z.number().int() }),
    }
);

const submitRating = tool(
    async ({ movieId, rating, notes }) => {
        const m = await getMovieFull(movieId);
        ratingsRepo.upsert({
            movie_id: m.id,
            title: m.title,
            rating,
            notes: notes ?? null,
            genres: m.genres.join(", "),
            age_rating: m.age_rating,
            release_year: m.year,
        });
        return `Saved rating ${rating}/10 for "${m.title}" (${m.year ?? "?"}).`;
    },
    {
        name: "submit_rating",
        description: "Save the user's rating (0-10) for a movie they have watched.",
        schema: z.object({
            movieId: z.number().int(),
            rating: z.number().min(0).max(10),
            notes: z.string().optional(),
        }),
    }
);

const listRatings = tool(
    async () => {
        const rows = ratingsRepo.list();
        if (rows.length === 0) return "No ratings yet.";
        return rows
            .map(
                (r) =>
                    `${r.movie_id} | ${r.title}${r.release_year ? ` (${r.release_year})` : ""} — ${r.rating}/10` +
                    (r.genres ? ` [${r.genres}]` : "") +
                    (r.age_rating ? ` ${r.age_rating}` : "") +
                    (r.notes ? ` — ${r.notes}` : "")
            )
            .join("\n");
    },
    {
        name: "list_my_ratings",
        description: "List every movie the user has rated, with their score and notes.",
        schema: z.object({}),
    }
);

const recommend = tool(
    async ({ genres, maxAgeRating, minYear, maxYear, count }) => {
        const mine = ratingsRepo.list();
        const ratedIds = new Set(mine.map((r) => r.movie_id));
        const topRated = mine.filter((r) => r.rating >= 7).slice(0, 5);

        const candidates = new Map<number, { title: string; release_date?: string; vote_average?: number; reason: string }>();

        // Seed from similar-to-favorites
        for (const fav of topRated) {
            const recs = await getRecommendationsFor(fav.movie_id);
            for (const r of recs) {
                if (ratedIds.has(r.id) || candidates.has(r.id)) continue;
                candidates.set(r.id, { title: r.title, release_date: r.release_date, vote_average: r.vote_average, reason: `similar to "${fav.title}"` });
            }
        }

        // Add genre/age-filtered discoveries
        if (genres?.length || maxAgeRating || minYear || maxYear || candidates.size === 0) {
            const disc = await discoverMovies({ genres, maxAgeRating, minYear, maxYear, sortBy: "vote_average.desc" });
            for (const r of disc) {
                if (ratedIds.has(r.id) || candidates.has(r.id)) continue;
                candidates.set(r.id, { title: r.title, release_date: r.release_date, vote_average: r.vote_average, reason: "matches filters" });
            }
        }

        // Apply post-filter on age rating / years for the similar-to-favorites branch
        const filtered: { id: number; line: string }[] = [];
        for (const [id, c] of candidates) {
            const year = c.release_date ? parseInt(c.release_date.slice(0, 4), 10) : null;
            if (minYear && (year ?? 0) < minYear) continue;
            if (maxYear && (year ?? 9999) > maxYear) continue;
            filtered.push({
                id,
                line: `${id} | ${c.title}${year ? ` (${year})` : ""}${c.vote_average ? ` ★${c.vote_average.toFixed(1)}` : ""} — ${c.reason}`,
            });
        }

        if (filtered.length === 0) return "No recommendations could be generated. Try rating a few movies first or relaxing filters.";

        const n = count ?? 8;
        const picks = filtered.slice(0, n);
        for (const p of picks) ratingsRepo.markSuggested(p.id);
        return picks.map((p) => p.line).join("\n");
    },
    {
        name: "recommend_movies",
        description:
            "Recommend movies the user has not yet rated, based on their high-rated history plus optional filters. Returns TMDB ids the user can rate immediately with submit_rating.",
        schema: z.object({
            genres: z.array(z.string()).optional(),
            maxAgeRating: z.enum(["G", "PG", "PG-13", "R", "NC-17"]).optional(),
            minYear: z.number().int().optional(),
            maxYear: z.number().int().optional(),
            count: z.number().int().min(1).max(20).optional(),
        }),
    }
);

const removeRating = tool(
    async ({ movieId }) => {
        const ok = ratingsRepo.remove(movieId);
        return ok ? "Removed." : "No rating existed for that movie.";
    },
    {
        name: "remove_rating",
        description: "Delete a previously saved rating by TMDB movie id.",
        schema: z.object({ movieId: z.number().int() }),
    }
);

export const movieTools = [
    searchByTitle,
    searchByPerson,
    discover,
    movieDetails,
    submitRating,
    listRatings,
    recommend,
    removeRating,
];
