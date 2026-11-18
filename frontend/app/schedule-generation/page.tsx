"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, type ApiError } from "../lib/api";
import type { Doctor } from "../lib/types";
import { useAuth } from "../lib/useAuth";

type Slot = { startTime: string; endTime: string };
type Preview = { doctorId: number; timeZone: string; slots: Slot[] };
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function errorMessage(caught: unknown) {
  const payload = (caught as ApiError | undefined)?.payload;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (Array.isArray(message)) return message.join("; ");
    if (typeof message === "string") return message;
  }
  return caught instanceof Error ? caught.message : "Could not generate preview";
}

export default function ScheduleGenerationPage() {
  return (
    <AppShell>
      <RequireAuth roles={["ADMIN", "MANAGER"]}>
        <ScheduleGeneration />
      </RequireAuth>
    </AppShell>
  );
}

function ScheduleGeneration() {
  const { auth } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorError, setDoctorError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [invalidated, setInvalidated] = useState(false);
  const revision = useRef(0);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    setDoctorsLoading(true);
    apiRequest<{ data: Doctor[] }>("/doctors", { token: auth.token })
      .then(({ data }) => { if (active) setDoctors(data); })
      .catch((caught) => { if (active) setDoctorError(errorMessage(caught)); })
      .finally(() => { if (active) setDoctorsLoading(false); });
    return () => { active = false; revision.current++; };
  }, [auth]);

  function invalidate() {
    revision.current++;
    setInvalidated(true);
    setPreview(null);
    setRemoved(new Set());
    setError("");
    setLoading(false);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const form = new FormData(event.currentTarget);
    const startDate = String(form.get("startDate"));
    const endDate = String(form.get("endDate"));
    const dailyStartTime = String(form.get("dailyStartTime"));
    const dailyEndTime = String(form.get("dailyEndTime"));
    const workingWeekdays = form.getAll("weekday").map(Number);
    const excludedDates = [...new Set(String(form.get("excludedDates")).split(/[\s,]+/).filter(Boolean))];
    setError("");
    if (!workingWeekdays.length || endDate < startDate || dailyEndTime <= dailyStartTime) {
      setError("Choose at least one weekday, an end date on or after the start date, and an end time after the start time.");
      return;
    }
    if (excludedDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      setError("Enter valid excluded dates as YYYY-MM-DD, separated by commas or new lines.");
      return;
    }
    const request = ++revision.current;
    setLoading(true);
    setPreview(null);
    setRemoved(new Set());
    try {
      const result = await apiRequest<Preview>("/schedulePeriods/preview", {
        method: "POST",
        token: auth.token,
        body: {
          doctorId: Number(form.get("doctorId")), startDate, endDate, workingWeekdays,
          dailyStartTime, dailyEndTime, slotDurationMinutes: Number(form.get("duration")), excludedDates,
        },
      });
      if (request === revision.current) {
        setPreview(result);
        setInvalidated(false);
      }
    } catch (caught) {
      if (request === revision.current) setError(errorMessage(caught));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }

  const groups = new Map<string, { slot: Slot; index: number }[]>();
  preview?.slots.forEach((slot, index) => {
    const date = dateFormatter.format(new Date(slot.startTime));
    const group = groups.get(date) ?? [];
    group.push({ slot, index });
    groups.set(date, group);
  });

  return (
    <>
      <PageHeader eyebrow="Schedules" title="Generate schedule preview" />
      <p>All dates and times use Europe/Warsaw. The date range includes both the start and end dates. This preview is not saved.</p>
      {doctorError ? <Notice tone="error" message={doctorError} /> : null}
      <form className="form-card" onSubmit={generate} onChange={invalidate}>
        <div className="form-grid">
          <label>Doctor
            <select name="doctorId" required disabled={doctorsLoading || Boolean(doctorError)}>
              <option value="">{doctorsLoading ? "Loading doctors…" : "Select a doctor"}</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.user.name}{doctor.specialization ? ` — ${doctor.specialization}` : ""}</option>)}
            </select>
          </label>
          <label>Start date (inclusive)<input type="date" name="startDate" required /></label>
          <label>End date (inclusive)<input type="date" name="endDate" required /></label>
          <label>Daily start (Europe/Warsaw)<input type="time" name="dailyStartTime" defaultValue="09:00" required /></label>
          <label>Daily end (Europe/Warsaw)<input type="time" name="dailyEndTime" defaultValue="17:00" required /></label>
          <label>Slot duration (minutes)<input type="number" name="duration" defaultValue={30} min={1} max={1440} step={1} required /></label>
        </div>
        <fieldset>
          <legend>Working weekdays</legend>
          <div className="row-actions">
            {weekdays.map((weekday, index) => <label key={weekday}>
              <input type="checkbox" name="weekday" value={index + 1} defaultChecked={index < 5} /> {weekday}
            </label>)}
          </div>
        </fieldset>
        <label>Excluded dates (YYYY-MM-DD, separated by commas or new lines)
          <textarea name="excludedDates" rows={3} placeholder="2026-12-24, 2026-12-25" />
        </label>
        <p>Up to 366 days and 10,000 proposed slots. Only full slots are generated, with no gaps.</p>
        <button className="button button-primary" type="submit" disabled={loading || doctorsLoading || Boolean(doctorError) || doctors.length === 0}>
          {loading ? "Generating…" : "Generate preview"}
        </button>
      </form>
      {!doctorsLoading && !doctorError && doctors.length === 0 ? <Notice message="No doctors are available. A doctor account is needed before generating a schedule." /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {invalidated && !loading ? <Notice message="Inputs changed. Generate a new preview to use these settings." /> : null}
      <div aria-live="polite">
        {loading ? <p>Generating proposed slots…</p> : null}
        {preview ? <>
          <h2>Proposed schedule — Europe/Warsaw</h2>
          <p>Total: {preview.slots.length - removed.size} included / {preview.slots.length} generated ({removed.size} removed).</p>
          {preview.slots.length === 0 ? <Notice message="No full slots match these settings. Adjust the dates, weekdays, exclusions, hours, or duration and generate again." /> : null}
          {[...groups].map(([date, entries]) => <section className="table-card" key={date}>
            <h3>{date} — {entries.filter(({ index }) => !removed.has(index)).length} included / {entries.length} generated</h3>
            <div className="table-scroll"><table>
              <thead><tr><th>Start (Europe/Warsaw)</th><th>End (Europe/Warsaw)</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{entries.map(({ slot, index }) => <tr key={index}>
                <td>{timeFormatter.format(new Date(slot.startTime))}</td>
                <td>{timeFormatter.format(new Date(slot.endTime))}</td>
                <td>{removed.has(index) ? "Removed" : "Included"}</td>
                <td><button className="button button-secondary" type="button" aria-label={`${removed.has(index) ? "Restore" : "Remove"} ${date} ${timeFormatter.format(new Date(slot.startTime))}`} onClick={() => setRemoved((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index); else next.add(index);
                  return next;
                })}>{removed.has(index) ? "Restore" : "Remove"}</button></td>
              </tr>)}</tbody>
            </table></div>
          </section>)}
        </> : null}
      </div>
    </>
  );
}
