"use client";

import type { AppointmentView } from "../lib/appointmentViews";
import { CompactTabs, compactTabId } from "./CompactTabs";

const views: AppointmentView[] = ["All", "Upcoming", "Needs rescheduling", "Past", "Cancelled"];
export const appointmentTabId = (view: AppointmentView) => compactTabId("appointment-tab", view);

export function AppointmentViewTabs({ view, onChange, disabled = false }: { view: AppointmentView; onChange: (view: AppointmentView) => void; disabled?: boolean }) {
  return <CompactTabs options={views} value={view} disabled={disabled} onChange={onChange} label="Appointment views"
    idPrefix="appointment-tab" panelId="appointment-view-panel" />;
}
