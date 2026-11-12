import { tableType } from "@ai-outfitter/app-sdk/app-graphql";
import { GraphQLObjectType, GraphQLSchema } from "graphql";
import { items, recommendations, reports, sources } from "./schema";
export const graphqlSchema = new GraphQLSchema({ query: new GraphQLObjectType({ name: "Query", fields: {
            ...tableType(reports, { field: "dioneReports", type: "DioneReport", fields: ["day", "status", "summary", "generatedAt", "completedAt", "timezone"], dates: ["generatedAt", "completedAt"], filters: ["day", "status"] }),
            ...tableType(items, { field: "dioneItems", type: "DioneItem", fields: ["reportId", "source", "sourceId", "title", "kind", "date", "detail", "url", "section"], filters: ["reportId", "source", "kind", "section"] }),
            ...tableType(sources, { field: "dioneSources", type: "DioneSource", fields: ["reportId", "source", "observedAt", "status", "error", "count", "truncated"], dates: ["observedAt"], filters: ["reportId", "source"] }),
            ...tableType(recommendations, { field: "dioneRecommendations", type: "DioneRecommendation", fields: ["source", "sourceId", "title", "status", "receipt", "createdAt", "updatedAt"], dates: ["createdAt", "updatedAt"], filters: ["source", "status"] }),
        } }) });
