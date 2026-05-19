import { env } from "./env";

const BASE = "https://api.themoviedb.org/3";

export interface TmdbMovieSummary {
    id: number;
    title: string;
    release_date?: string;
    overview?: string;
    genre_ids?: number[];
    vote_average?: number;
}

export interface TmdbMovieDetails extends TmdbMovieSummary {
    runtime?: number;
    genres: { id: number; name: string }[];
    production_companies?: { name: string }[];
    tagline?: string;
}

export interface Credit {
    id: number;
    name: string;
    job?: string;
    department?: string;
    character?: string;
}

export interface MovieFull {
    id: number;
    title: string;
    year: number | null;
    overview: string;
    genres: string[];
    age_rating: string | null; // US certification
    runtime: number | null;
    vote_average: number | null;
    directors: string[];
    writers: string[];
    producers: string[];
    top_cast: string[];
}

async function tmdb<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("api_key", env.TMDB_API_KEY);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`TMDB ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
}

let genreCache: Map<number, string> | null = null;
async function loadGenres(): Promise<Map<number, string>> {
    if (genreCache) return genreCache;
    const data = await tmdb<{ genres: { id: number; name: string }[] }>("/genre/movie/list");
    genreCache = new Map(data.genres.map((g) => [g.id, g.name]));
    return genreCache;
}

function yearOf(date?: string): number | null {
    if (!date) return null;
    const y = parseInt(date.slice(0, 4), 10);
    return Number.isFinite(y) ? y : null;
}

async function usCertification(movieId: number): Promise<string | null> {
    const data = await tmdb<{ results: { iso_3166_1: string; release_dates: { certification: string }[] }[] }>(
        `/movie/${movieId}/release_dates`
    );
    const us = data.results.find((r) => r.iso_3166_1 === "US");
    const cert = us?.release_dates.find((r) => r.certification)?.certification;
    return cert?.trim() || null;
}

export async function searchMoviesByTitle(query: string, year?: number): Promise<TmdbMovieSummary[]> {
    const data = await tmdb<{ results: TmdbMovieSummary[] }>("/search/movie", {
        query,
        year,
        include_adult: "false",
    });
    return data.results.slice(0, 10);
}

export async function searchPeople(query: string): Promise<{ id: number; name: string; known_for_department: string }[]> {
    const data = await tmdb<{ results: { id: number; name: string; known_for_department: string }[] }>("/search/person", {
        query,
        include_adult: "false",
    });
    return data.results.slice(0, 5);
}

/**
 * Find movies where `personName` matches a credit with given job filter.
 * jobFilter: e.g. "Director", "Writer"/"Screenplay", "Producer".
 */
export async function moviesByPerson(
    personName: string,
    role: "director" | "writer" | "producer"
): Promise<TmdbMovieSummary[]> {
    const people = await searchPeople(personName);
    if (people.length === 0) return [];
    const personId = people[0]!.id;
    const credits = await tmdb<{ crew: (TmdbMovieSummary & { job: string; department: string })[] }>(
        `/person/${personId}/movie_credits`
    );
    const jobMatch = (job: string, dept: string) => {
        const j = job.toLowerCase();
        const d = dept.toLowerCase();
        if (role === "director") return j === "director";
        if (role === "writer") return d === "writing";
        return d === "production" && j.includes("producer");
    };
    const seen = new Set<number>();
    const out: TmdbMovieSummary[] = [];
    for (const c of credits.crew) {
        if (!jobMatch(c.job, c.department) || seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({
            id: c.id,
            title: c.title,
            release_date: c.release_date,
            overview: c.overview,
            vote_average: c.vote_average,
        });
    }
    out.sort((a, b) => (yearOf(b.release_date) ?? 0) - (yearOf(a.release_date) ?? 0));
    return out.slice(0, 20);
}

export async function discoverMovies(opts: {
    genres?: string[]; // names
    maxAgeRating?: string; // e.g. "PG-13"
    minYear?: number;
    maxYear?: number;
    sortBy?: string; // e.g. "popularity.desc", "vote_average.desc"
}): Promise<TmdbMovieSummary[]> {
    const genreMap = await loadGenres();
    const nameToId = new Map(Array.from(genreMap.entries()).map(([id, name]) => [name.toLowerCase(), id]));
    const genreIds = (opts.genres ?? [])
        .map((g) => nameToId.get(g.toLowerCase()))
        .filter((v): v is number => v !== undefined);

    const params: Record<string, string | number | undefined> = {
        sort_by: opts.sortBy ?? "popularity.desc",
        include_adult: "false",
        with_genres: genreIds.length ? genreIds.join(",") : undefined,
        "primary_release_date.gte": opts.minYear ? `${opts.minYear}-01-01` : undefined,
        "primary_release_date.lte": opts.maxYear ? `${opts.maxYear}-12-31` : undefined,
        certification_country: opts.maxAgeRating ? "US" : undefined,
        "certification.lte": opts.maxAgeRating,
        "vote_count.gte": 50,
    };
    const data = await tmdb<{ results: TmdbMovieSummary[] }>("/discover/movie", params);
    return data.results.slice(0, 20);
}

export async function getMovieFull(movieId: number): Promise<MovieFull> {
    const [details, credits, cert] = await Promise.all([
        tmdb<TmdbMovieDetails>(`/movie/${movieId}`),
        tmdb<{ crew: Credit[]; cast: Credit[] }>(`/movie/${movieId}/credits`),
        usCertification(movieId),
    ]);
    const directors = credits.crew.filter((c) => c.job === "Director").map((c) => c.name);
    const writers = credits.crew.filter((c) => c.department === "Writing").map((c) => c.name);
    const producers = credits.crew
        .filter((c) => c.department === "Production" && (c.job ?? "").toLowerCase().includes("producer"))
        .map((c) => c.name);
    return {
        id: details.id,
        title: details.title,
        year: yearOf(details.release_date),
        overview: details.overview ?? "",
        genres: details.genres?.map((g) => g.name) ?? [],
        age_rating: cert,
        runtime: details.runtime ?? null,
        vote_average: details.vote_average ?? null,
        directors: Array.from(new Set(directors)),
        writers: Array.from(new Set(writers)),
        producers: Array.from(new Set(producers)),
        top_cast: credits.cast.slice(0, 8).map((c) => c.name),
    };
}

export async function getRecommendationsFor(movieId: number): Promise<TmdbMovieSummary[]> {
    const data = await tmdb<{ results: TmdbMovieSummary[] }>(`/movie/${movieId}/recommendations`);
    return data.results.slice(0, 10);
}

export function summarize(m: TmdbMovieSummary): string {
    return `${m.id} | ${m.title}${m.release_date ? ` (${m.release_date.slice(0, 4)})` : ""}${m.vote_average ? ` ★${m.vote_average.toFixed(1)}` : ""
        }`;
}
