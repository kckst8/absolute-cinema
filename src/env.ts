import "dotenv/config";

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

export const env = {
    OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
    TMDB_API_KEY: requireEnv("TMDB_API_KEY"),
    MOVIE_DB_PATH: process.env.MOVIE_DB_PATH ?? "movies.db",
    MODEL: process.env.MODEL ?? "gpt-4o-mini",
};
