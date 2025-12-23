
import "dotenv/config";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

async function main() {
  const baseURL = process.env.CUSTOM_MODEL_BASE_URL;
  const apiKey = process.env.CUSTOM_MODEL_API_KEY;
  const modelName = process.env.AI_MODEL_NAME;

  console.log("Testing Model Connection...");
  console.log(`Base URL: ${baseURL}`);
  console.log(`API Key: ${apiKey}`);
  console.log(`Model Name: ${modelName}`);

  if (!baseURL || !modelName) {
    console.error("Error: CUSTOM_MODEL_BASE_URL or AI_MODEL_NAME is missing in .env");
    return;
  }

  const customProvider = createOpenAI({
    baseURL: baseURL,
    apiKey: apiKey,
  });

  try {
    console.log("Sending request to model...");
    const { text } = await generateText({
      model: customProvider.chat(modelName),
      prompt: "Hello, are you working?",
    });
    console.log("Response received:");
    console.log(text);
    console.log("Connection successful!");
  } catch (error) {
    console.error("Connection failed:");
    console.error(error);
  }
}

main();
