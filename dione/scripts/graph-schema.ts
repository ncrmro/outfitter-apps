import { writeFile, readFile } from "node:fs/promises";
import { printSchema } from "graphql";
import { documentRows } from "@ai-outfitter/app-sdk/app-documents";
import { graphqlSchema } from "../src/server/graphql";
import { documents } from "../src/server/documents";
const generated = { "schema.graphql": printSchema(graphqlSchema) + "\n", "documents.json": JSON.stringify(documentRows(graphqlSchema, documents).map(row=>({...row,mcp:{description:row.story}})), null, 2) + "\n" };
for (const [file, content] of Object.entries(generated)) {
    const url = new URL(`../graph/${file}`, import.meta.url);
    if (process.argv.includes("--check")) {
        if (await readFile(url, "utf8") !== content)
            throw Error(`Stale graph/${file}`);
    }
    else
        await writeFile(url, content);
}
