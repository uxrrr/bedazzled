import { itemsStore } from "../../lib/stores";

// Temporary: This is NOT wrapped in withAuth so we can debug the raw error
// Will be deleted after diagnosis
export const handler = async () => {
  try {
    const store = itemsStore();
    const result = await store.list();
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        blobs_count: result.blobs?.length ?? 0,
        result_keys: Object.keys(result),
      }),
    };
  } catch (err: any) {
    const envVars = Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith("NETLIFY") || k.includes("BLOB"))
        .sort()
    );
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
        error_name: err.name,
        env_vars: envVars,
      }),
    };
  }
};
