import { loadEnvFile } from "node:process";
import { connect } from "framer-api";
import {
  FRAMER_FIELD_DISPLAY_NAMES,
  resolveFramerFieldMap,
  type CmsFieldDescriptor,
} from "../integrations/framer-cms.js";

try {
  loadEnvFile(".env.local");
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code !== "ENOENT") throw error;
}

const token = process.env["FRAMER_API_TOKEN"]?.trim();
const projectId = process.env["FRAMER_PROJECT_ID"]?.trim();
const collectionId = process.env["FRAMER_COLLECTION_ID"]?.trim();
if (!token || !projectId) {
  throw new Error("FRAMER_API_TOKEN and FRAMER_PROJECT_ID are required.");
}

const framer = await connect(projectId, token);
try {
  if (!collectionId) {
    const collections = await framer.getCollections();
    console.log(
      JSON.stringify(
        {
          collections: collections.map((collection) => ({
            id: collection.id,
            name: collection.name,
            managedBy: collection.managedBy,
          })),
          nextStep:
            "Set FRAMER_COLLECTION_ID to the ID for the intended collection, then run this command again.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 0;
  } else {
    const collection = await framer.getCollection(collectionId);
    if (!collection) throw new Error("Configured Framer collection was not found.");
    const fields: CmsFieldDescriptor[] = (await collection.getFields()).map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      ...(field.type === "enum"
        ? { cases: field.cases.map((enumCase) => ({ id: enumCase.id, name: enumCase.name })) }
        : {}),
    }));
    const mapping = resolveFramerFieldMap(fields);
    console.log(
      JSON.stringify(
        {
          collection: { id: collection.id, name: collection.name },
          expectedDisplayNames: FRAMER_FIELD_DISPLAY_NAMES,
          resolvedFieldMap: mapping,
          fieldTypes: Object.fromEntries(fields.map((field) => [field.id, field.type])),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await framer.disconnect();
}
