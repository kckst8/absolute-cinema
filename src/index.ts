import "./env";
import { createAgent, tool } from "langchain";
import * as z from "zod";

async function startAgent() {
    const getWeather = tool(
        ({ city }) => `It's always sunny in ${city}!`,
        {
            name: "get_weather",
            description: "Get the weather for a given city",
            schema: z.object({
                city: z.string(),
            }),
        },
    );

    const agent = createAgent({
        model: "gpt-4o-mini",
        tools: [getWeather],
    });

    console.log(
        await agent.invoke({
            messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
        })
    );
}

startAgent();