import { collectUserData } from "@/lib/backups";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const data = await collectUserData(user.uid);
  const format = new URL(request.url).searchParams.get("format");
  const day = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const header = ["Name", "Issuer", "Type", "Number", "Principal INR", "Rate %", "Interest type", "Payout frequency", "Investment date", "Maturity date", "Status"];
    const rows = data.investments.filter((item) => !item.deletedAt).map((item) => [
      item.investmentName, item.issuerNameSnapshot, item.investmentType, item.investmentNumber,
      (item.principalPaise / 100).toFixed(2), (item.interestRateBps / 100).toFixed(2), item.interestType,
      item.payoutFrequency, item.investmentDate, item.maturityDate, item.status,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fixed-income-portfolio-${day}.csv"`, "cache-control": "private, no-store" } });
  }
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="fixed-income-account-${day}.json"`, "cache-control": "private, no-store" },
  });
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
