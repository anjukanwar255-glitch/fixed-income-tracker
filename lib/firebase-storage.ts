import { firebaseConfig } from "@/lib/firebase-config";

const storageRoot = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseConfig.storageBucket)}/o`;

function objectUrl(objectKey: string, media = false) {
  const suffix = media ? "?alt=media" : "";
  return `${storageRoot}/${encodeURIComponent(objectKey)}${suffix}`;
}

export async function uploadFirebaseObject(
  token: string,
  objectKey: string,
  bytes: ArrayBuffer,
  contentType: string,
  appCheckToken?: string | null,
) {
  const response = await fetch(`${storageRoot}?uploadType=media&name=${encodeURIComponent(objectKey)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": contentType,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Firebase Storage upload failed (${response.status})`);
  return response.json() as Promise<{ name: string; generation?: string; size?: string; md5Hash?: string }>;
}

export async function downloadFirebaseObject(token: string, objectKey: string, appCheckToken?: string | null) {
  return fetch(objectUrl(objectKey, true), {
    headers: { authorization: `Bearer ${token}`, ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}) },
    cache: "no-store",
  });
}

/**
 * Whether an object exists, without downloading it.
 *
 * Requests the metadata rather than `?alt=media`, so probing for a recovery
 * snapshot costs one small response instead of pulling the whole encrypted
 * payload. Any non-404 failure is reported as "not present": this only decides
 * whether to offer recovery, and offering it when it cannot work is worse than
 * staying quiet.
 */
export async function firebaseObjectExists(token: string, objectKey: string, appCheckToken?: string | null) {
  try {
    const response = await fetch(objectUrl(objectKey), {
      headers: { authorization: `Bearer ${token}`, ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}) },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteFirebaseObject(token: string, objectKey: string, appCheckToken?: string | null) {
  const response = await fetch(objectUrl(objectKey), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}) },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Firebase Storage delete failed (${response.status})`);
  }
}
