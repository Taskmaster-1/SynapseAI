import { redirect } from "next/navigation";

export default function MemoryRedirect() {
  redirect("/knowledge?tab=memory");
}
