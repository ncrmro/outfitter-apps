import { tableType } from "@ai-outfitter/app-sdk/app-graphql";
import { GraphQLEnumType, GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString, GraphQLBoolean } from "graphql";
import { items, recommendations, reports, sources } from "./schema";
import { mediaReadInput, readMedia } from "./agent-reads";
import type { DioneContext } from "./agent-context";

const libraryProvider = new GraphQLEnumType({
    name: "DioneLibraryProvider",
    values: { radarr: {}, sonarr: {}, lidarr: {}, jellyfin: {} },
});
const mediaItem = new GraphQLObjectType({
    name: "DioneMediaItem",
    fields: { id: { type: GraphQLString }, title: { type: GraphQLString }, kind: { type: GraphQLString } },
});
const mediaPage = new GraphQLObjectType({
    name: "DioneMediaPage",
    fields: {
        status: { type: new GraphQLNonNull(GraphQLString) },
        observedAt: { type: new GraphQLNonNull(GraphQLString) },
        items: { type: new GraphQLList(mediaItem) },
        cursor: { type: GraphQLString },
        truncated: { type: GraphQLBoolean },
    },
});

export const graphqlSchema = new GraphQLSchema({ query: new GraphQLObjectType({ name: "Query", fields: {
            dioneMediaLibrary: {
                type: mediaPage,
                args: { provider: { type: new GraphQLNonNull(libraryProvider) }, limit: { type: GraphQLInt }, cursor: { type: GraphQLString } },
                resolve: (_root, args, context: DioneContext) =>
                    readMedia(context, mediaReadInput.parse({ ...args, view: "library" })),
            },
            ...tableType(reports, { field: "dioneReports", type: "DioneReport", fields: ["day", "status", "summary", "generatedAt", "completedAt", "timezone", "origin", "capturedAt"], dates: ["generatedAt", "completedAt", "capturedAt"], filters: ["day", "status"] }),
            ...tableType(items, { field: "dioneItems", type: "DioneItem", fields: ["reportId", "source", "sourceId", "title", "kind", "date", "detail", "url", "section"], filters: ["reportId", "source", "kind", "section"] }),
            ...tableType(sources, { field: "dioneSources", type: "DioneSource", fields: ["reportId", "source", "observedAt", "status", "error", "count", "truncated"], dates: ["observedAt"], filters: ["reportId", "source"] }),
            ...tableType(recommendations, { field: "dioneRecommendations", type: "DioneRecommendation", fields: ["source", "sourceId", "title", "status", "receipt", "createdAt", "updatedAt"], dates: ["createdAt", "updatedAt"], filters: ["source", "status"] }),
        } }) });
