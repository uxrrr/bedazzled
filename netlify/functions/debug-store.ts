import { getStore } from "@netlify/blobs";

// Temporary: This is NOT wrapped in withAuth so we can debug the raw error
// Will be deleted after diagnosis
export const handler = async () => {
  try {
    const token = process.env.NETLIFY_FUNCTIONS_TOKEN;
    const siteID = process.env.NETLIFY_SITE_ID || "cdb3dfb5-c8e2-44ce-9f8b-1ca931c4dc1d";
    const opts = token && siteID ? { token, siteID } : {};

    const store = getStore("test-items", opts);
    const result = await store.list();
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        blobs_count: result.blobs?.length ?? 0,
        opts_passed: opts,
      }),
    };
  } catch (err: any) {
    const envVars = Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith("NETLIFY") || k.includes("BLOB"))
        .sort()
    );
    const token = process.env.NETLIFY_FUNCTIONS_TOKEN;
    const siteID = process.env.NETLIFY_SITE_ID || "cdb3dfb5-c8e2-44ce-9f8b-1ca931c4dc1d";
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
        error_name: err.name,
        env_vars: envVars,
        attempted_opts: token && siteID ? { token: "***", siteID } : {},
      }),
    };
  }
};
