import { createUserBackup, isBackupConfigured, latestBackupStatus, readLatestUserBackup } from "@/lib/backups";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const latest = await latestBackupStatus(identity.uid);
  return Response.json({
    configured: isBackupConfigured(),
    latest: latest ? {
      createdAt: latest.createdAt,
      status: latest.status,
      sha256: latest.sha256,
      sizeBytes: latest.sizeBytes,
    } : null,
  });
}

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const limited = await rateLimit(request, "backup", identity.uid, 6, 60 * 60 * 1000);
  if (limited) return limited;
  try {
    return Response.json({ backup: await createUserBackup(identity) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Backup failed" }, { status: 503 });
  }
}

/** Verifies that the latest encrypted backup can be downloaded and decrypted. */
export async function PUT(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) {
    return Response.json({ error: "Please sign in again before testing recovery" }, { status: 403 });
  }
  const limited = await rateLimit(request, "backup-test", identity.uid, 3, 60 * 60 * 1000);
  if (limited) return limited;
  try {
    const backup = await readLatestUserBackup(identity);
    return Response.json({ verified: true, createdAt: backup.createdAt, investmentCount: backup.data.investments.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Recovery verification failed" }, { status: 503 });
  }
}
