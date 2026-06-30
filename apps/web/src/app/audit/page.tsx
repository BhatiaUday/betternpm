import { notFound } from "next/navigation";

// The audit workflow was merged into the search page (search → pick a version →
// queue an AI audit). This standalone route is disabled so it can't be reached on
// the live site; the search page does everything it used to.
export default function AuditPage() {
  notFound();
}
