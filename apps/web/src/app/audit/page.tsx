import { redirect } from "next/navigation";

// The audit workflow now lives on the search page (search → pick a version →
// queue an AI audit), so /audit just forwards there.
export default function AuditPage() {
  redirect("/search");
}
