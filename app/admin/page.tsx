import type { Metadata } from "next";

import { AdminConsole } from "@/features/admin/admin-console";

export const metadata: Metadata = {
  title: "Admin console · Portfolio",
  // Nothing here belongs in a search result, and the page refuses anyone
  // without the role anyway — this keeps it out of the index as well.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminConsole />;
}
