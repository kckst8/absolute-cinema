import "./env";
import { createAgent, HumanMessage, SystemMessage, type BaseMessage } from "langchain";
import * as readline from "node:readline";
import { env } from "./env";
import { movieTools } from "./tools";

const SYSTEM_PROMPT = `You are a personal movie recommender that learns from the user's ratings.

You have tools to search a real movie database (TMDB), inspect movies, save the user's ratings,
list past ratings, and generate recommendations. Always use a tool rather than relying on memory.

Workflow guidance:
- When the user mentions a movie title, search for it first to get the canonical TMDB id before doing anything else.
- When asked to recommend, prefer the recommend_movies tool. Present results as a numbered list with the TMDB id, title, year, and a short reason.
- After recommending, invite the user to rate any of them by id.
- For ratings: scale is 0-10 (one decimal allowed). Confirm before saving if the score is ambiguous.
- Respect any filters the user gives (genre, age rating cap, year range).
- Be concise. No long preambles.`;

async function main() {
    const agent = createAgent({
        model: env.MODEL,
        tools: movieTools,
    });

    const history: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

    console.log("Hey there. I'm AC. Ask me about movies, give me some ratings, or type 'exit' to quit.\n");

    while (true) {
        const userInput = (await ask("you > ")).trim();
        if (!userInput) continue;
        if (["exit", "quit", ":q"].includes(userInput.toLowerCase())) break;

        history.push(new HumanMessage(userInput));

        try {
            const result = (await agent.invoke({ messages: history })) as { messages: BaseMessage[] };
            history.length = 0;
            history.push(...result.messages);
            const finalMsg = result.messages[result.messages.length - 1];
            const text = typeof finalMsg?.content === "string" ? finalMsg.content : JSON.stringify(finalMsg?.content);
            console.log(`\nAC > ${text}\n`);
        } catch (err) {
            console.error(`\n[error] ${(err as Error).message}\n`);
            history.pop();
        }
    }

    rl.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});