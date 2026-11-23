"use client";

import type { AppointmentView } from "../lib/appointmentViews";
import { CompactTabs, compactTabId } from "./CompactTabs";

const views: AppointmentView[] = ["All", "Upcoming", "Needs rescheduling", "Past", "Cancelled"];
export const appointmentTabId = (view: AppointmentView) => compactTabId("appointment-tab", view);

export function AppointmentViewTabs({ view, onChange }: { view: AppointmentView; onChange: (view: AppointmentView) => void }) {
  return <CompactTabs options={views} value={view} onChange={onChange} label="Appointment views"
    idPrefix="appointment-tab" panelId="appointment-view-panel" />;
}
