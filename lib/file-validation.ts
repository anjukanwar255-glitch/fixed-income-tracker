export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const detectedTypes = {
  pdf: { mimeType: "application/pdf", extension: "pdf" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
} as const;

export type ValidatedDocument = {
  bytes: ArrayBuffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  extension: "pdf" | "jpg" | "png";
  sha256: string;
};

type DocumentFile = Pick<File, "name" | "size" | "type" | "arrayBuffer">;

export async function validateDocumentFile(file: DocumentFile): Promise<ValidatedDocument> {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("Upload a non-empty PDF, JPG, JPEG or PNG up to 10 MB");
  }

  const bytes = await file.arrayBuffer();
  const data = new Uint8Array(bytes);
  const detected = detectType(data);
  if (!detected) throw new Error("The file content is not a valid PDF, JPG or PNG");

  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const allowedExtensions = detected.mimeType === "image/jpeg" ? ["jpg", "jpeg"] : [detected.extension];
  if (!allowedExtensions.includes(extension)) throw new Error("The file name extension and content do not match");

  const declared = file.type.toLowerCase();
  if (declared && declared !== "image/jpg" && declared !== detected.mimeType) {
    throw new Error("The file extension and content do not match");
  }

  if (detected.mimeType === "application/pdf") validatePdf(data);
  if (detected.mimeType === "image/png") validatePng(data);
  if (detected.mimeType === "image/jpeg") validateJpeg(data);

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes,
    mimeType: detected.mimeType,
    extension: detected.extension,
    sha256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
}

function detectType(data: Uint8Array) {
  if (matches(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return detectedTypes.pdf;
  if (matches(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return detectedTypes.png;
  if (matches(data, [0xff, 0xd8, 0xff])) return detectedTypes.jpeg;
  return null;
}

function matches(data: Uint8Array, signature: number[]) {
  return signature.every((value, index) => data[index] === value);
}

function validatePdf(data: Uint8Array) {
  const tail = new TextDecoder("latin1").decode(data.slice(Math.max(0, data.length - 2_048)));
  if (!tail.includes("%%EOF")) throw new Error("The PDF appears incomplete or damaged");

  // Private tracker documents do not need active PDF features. Blocking these
  // removes the highest-risk script, launch and automatic-action primitives.
  const text = new TextDecoder("latin1").decode(data);
  if (/\/(JavaScript|JS|Launch|OpenAction|AA|RichMedia)\b/i.test(text)) {
    throw new Error("Active or scripted PDF files are not accepted");
  }
}

function validatePng(data: Uint8Array) {
  if (data.length < 33 || new TextDecoder("ascii").decode(data.slice(12, 16)) !== "IHDR") {
    throw new Error("The PNG image appears damaged");
  }
  const end = data.slice(Math.max(0, data.length - 16));
  if (!new TextDecoder("ascii").decode(end).includes("IEND")) {
    throw new Error("The PNG image appears incomplete");
  }
}

function validateJpeg(data: Uint8Array) {
  if (data.length < 4 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
    throw new Error("The JPEG image appears incomplete or damaged");
  }
}
