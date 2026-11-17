export type Role = "PATIENT" | "DOCTOR" | "RECEPTIONIST" | "ADMIN" | "MANAGER";

export type AppointmentStatus = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  specialization?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Doctor = {
  id: number;
  userId: number;
  specialization: string | null;
  user: User;
};

export type CalendarSlot = {
  id: number;
  doctorId: number;
  startTime: string;
  endTime: string;
  isBooked: boolean;
  doctor?: Doctor;
};

export type Appointment = {
  id: number;
  patientId: number;
  doctorId: number;
  calendarId: number;
  status: AppointmentStatus;
  reason: string;
  slotStartTime?: string;
  slotEndTime?: string;
  patient?: User;
  doctor?: Doctor;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AuthState = {
  token: string;
  role: Role;
  userId: number;
};

