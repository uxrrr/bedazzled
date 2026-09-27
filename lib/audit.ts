import { randomUUID } from "crypto";
import { auditStore } from "./stores";
import type { IdentityUser } from "./auth";

export type AuditAction =
  | "view-item"
  | "create-item"
  | "update-item"
  | "upload-photo"
  | "delete-photo"
  | "download-everything";

export async function logAudit(user: IdentityUser, itemId: string | null, action: AuditAction) {
  const entry = {
    id: randomUUID(),
    user: user.email,
    itemId,
    action,
    at: new Date().toISOString(),
  };
  await auditStore().setJSON(entry.id, entry);
}
