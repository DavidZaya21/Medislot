"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminStaffRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/receptionists");
  }, [router]);

  return null;
}
