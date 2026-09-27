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
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
        stack: err.stack,
        env_prefix: process.env.BLOBS_STORE_PREFIX,
      }),
    };
  }
};
