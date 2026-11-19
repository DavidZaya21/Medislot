"use client";

import { useEffect, useState } from "react";
import { CLINIC_TIME_ZONE } from "./clinicTime";

export function useClinicTimeNotice() {
  const [differs, setDiffers] = useState(false);
  useEffect(() => {
    setDiffers(Intl.DateTimeFormat().resolvedOptions().timeZone !== CLINIC_TIME_ZONE);
  }, []);
  return differs;
}
