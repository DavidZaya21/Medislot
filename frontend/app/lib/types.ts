import type { Specialization } from "./specializations";

export type Role = "PATIENT" | "DOCTOR" | "RECEPTIONIST" | "ADMIN" | "MANAGER";

export type AppointmentStatus = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "NEEDS_RESCHEDULING";

export type User = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  closedAt?: string | null;
  role: Role;
  specialization?: Specialization | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Doctor = {
  id: number;
  userId: number;
  specialization: Specialization | null;
  user: User;
};

export type CalendarSlot = {
  id: number;
  doctorId: number;
  startTime: string;
  endTime: string;
  isBooked: boolean;
  isBlocked: boolean;
  doctor?: Omit<Doctor, "user"> & { user: Pick<User, "id" | "name"> & Partial<User> };
};

export type Appointment = {
  id: number;
  patientId: number;
  doctorId: number;
  calendarId: number;
  status: AppointmentStatus;
  version: number;
  rescheduleCount?: number;
  disruption?: { notificationId: number; disruptionVersion: number } | null;
  reason: string;
  slotStartTime?: string;
  slotEndTime?: string;
  patient?: Pick<User, "id" | "name" | "closedAt"> & Partial<User>;
  doctor?: Omit<Doctor, "user"> & { user: Pick<User, "id" | "name"> & Partial<User> };
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AuthState = {
  sessionId?: string;
  token: string;
  role: Role;
  userId: number;
};

